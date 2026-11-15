'use strict';
/**
 * A minimal Debug Adapter Protocol (DAP) client: one adapter process, one debug session at a time (start,
 * breakpoints, continue/step, call stack/scopes/variables, stop). Same Content-Length-over-stdio framing LSP
 * uses (src/core/lsp.js); only the message shape differs (DAP: seq/type/command/request_seq, not JSON-RPC's
 * method/id). Verified end-to-end against a real debugpy.adapter session during development: initialize, launch,
 * the "initialized" event, setBreakpoints, configurationDone (which is what actually unblocks the launch
 * response - the adapter answers "launch" only once configuration is done, not right away), a real breakpoint
 * hit, stackTrace, scopes, variables, continue, and terminated.
 *
 * Python (debugpy.adapter) and Dart (`dart debug_adapter`) talk DAP over their own stdio, spawned directly.
 * Go's `dlv dap` instead listens on a TCP socket - a different transport - so DapClient takes a `transport`
 * (write/onData/onClose/kill) rather than a child process directly; stdioTransport()/tcpTransport() below adapt
 * either shape to it. The Go and Dart adapters are NOT verified against the real `dlv`/`dart` binaries (neither
 * toolchain is installed in the environment this was written in) - only the protocol framing and DapSession's
 * choreography are exercised, against a fake adapter (see test/dap.test.js and its tcp fixture).
 */
const { spawn } = require('node:child_process');
const net = require('node:net');
const { EventEmitter } = require('node:events');

/** Adapts a spawned child's own stdio to the {write, onData, onClose, kill} shape DapClient expects. */
function stdioTransport(child) {
  return {
    write: (buf) => { try { child.stdin.write(buf); } catch { /* closed */ } },
    onData: (cb) => child.stdout.on('data', cb),
    onClose: (cb) => {
      let closed = false;
      const once = (reason) => { if (closed) return; closed = true; cb(reason); };
      child.on('exit', (code) => once(`exited with code ${code}`));
      child.on('error', (err) => once(err.code === 'ENOENT' ? 'not installed' : err.message));
    },
    kill: () => { try { child.kill(); } catch { /* gone */ } },
  };
}

/** Adapts a TCP socket (the actual DAP channel) plus its owning child process (for lifecycle/kill) to the same shape. */
function tcpTransport(child, socket) {
  return {
    write: (buf) => { try { socket.write(buf); } catch { /* closed */ } },
    onData: (cb) => socket.on('data', cb),
    onClose: (cb) => {
      let closed = false;
      const once = (reason) => { if (closed) return; closed = true; cb(reason); };
      socket.on('close', () => once('connection closed'));
      socket.on('error', (err) => once(err.message));
      child.on('exit', (code) => once(`exited with code ${code}`));
      child.on('error', (err) => once(err.code === 'ENOENT' ? 'not installed' : err.message));
    },
    kill: () => { try { socket.destroy(); } catch { /* gone */ } try { child.kill(); } catch { /* gone */ } },
  };
}

/** Connects to a just-spawned TCP DAP server, retrying until it is accepting connections (it needs a moment to bind) or `timeoutMs` passes. */
function connectWithRetry(host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const attempt = () => {
      const socket = net.connect(port, host);
      const onError = () => {
        socket.destroy();
        if (Date.now() > deadline) { reject(new Error(`could not connect to the debug adapter at ${host}:${port}`)); return; }
        setTimeout(attempt, 150);
      };
      socket.once('error', onError);
      socket.once('connect', () => { socket.off('error', onError); resolve(socket); });
    };
    attempt();
  });
}

class DapClient extends EventEmitter {
  constructor(transport) {
    super();
    this.transport = transport;
    this.nextSeq = 1;
    this.pending = new Map();
    this.buffer = Buffer.alloc(0);
    this.closed = false;
    transport.onData((d) => this._onData(d));
    transport.onClose((reason) => this._close(reason));
  }

  _close(reason) {
    if (this.closed) return;
    this.closed = true;
    for (const { reject, timer } of this.pending.values()) { clearTimeout(timer); reject(new Error(`debug adapter ${reason}`)); }
    this.pending.clear();
    this.emit('close', reason);
  }

  _send(msg) {
    if (this.closed) return;
    const body = Buffer.from(JSON.stringify(msg), 'utf8');
    this.transport.write(Buffer.from(`Content-Length: ${body.length}\r\n\r\n`));
    this.transport.write(body);
  }

  _onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const headEnd = this.buffer.indexOf('\r\n\r\n');
      if (headEnd < 0) return;
      const m = /Content-Length:\s*(\d+)/i.exec(this.buffer.subarray(0, headEnd).toString('ascii'));
      if (!m) { this.buffer = this.buffer.subarray(headEnd + 4); continue; }
      const len = Number(m[1]);
      if (this.buffer.length < headEnd + 4 + len) return;
      const body = this.buffer.subarray(headEnd + 4, headEnd + 4 + len).toString('utf8');
      this.buffer = this.buffer.subarray(headEnd + 4 + len);
      let msg;
      try { msg = JSON.parse(body); } catch { continue; }
      this._dispatch(msg);
    }
  }

  _dispatch(msg) {
    if (msg.type === 'response') {
      const p = this.pending.get(msg.request_seq);
      if (!p) return;
      this.pending.delete(msg.request_seq);
      clearTimeout(p.timer);
      if (msg.success) p.resolve(msg.body || {}); else p.reject(new Error(msg.message || `${msg.command} failed`));
    } else if (msg.type === 'event') {
      this.emit('event', msg.event, msg.body || {});
    }
    // requests FROM the adapter (e.g. runInTerminal) are not answered here: launch always uses console "internalConsole", which never asks for one
  }

  request(command, args, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      if (this.closed) { reject(new Error('debug adapter is not running')); return; }
      const seq = this.nextSeq++;
      const timer = setTimeout(() => { this.pending.delete(seq); reject(new Error(`debug adapter did not answer ${command} in time`)); }, timeoutMs);
      this.pending.set(seq, { resolve, reject, timer });
      this._send({ seq, type: 'request', command, arguments: args || {} });
    });
  }

  kill() { this.transport.kill(); }
}

/** Spawn spec + launch config for debugging a Python script with debugpy's own adapter (`pip install debugpy`). */
function pythonAdapter(platform = process.platform) {
  return {
    transport: 'stdio',
    command: platform === 'win32' ? 'python' : 'python3',
    args: ['-m', 'debugpy.adapter'],
    launchConfig: (program, opts = {}) => ({ type: 'python', request: 'launch', program, console: 'internalConsole', justMyCode: opts.justMyCode !== false, stopOnEntry: !!opts.stopOnEntry }),
  };
}

/**
 * Spawn spec + launch config for debugging a single Dart file/package with the Dart SDK's own adapter
 * (`dart debug_adapter`, bundled with the SDK - nothing extra to install). Stdio, same shape as Python.
 * UNVERIFIED: written from the documented `dart debug_adapter` CLI and DAP launch arguments; no Dart SDK was
 * available to run it against in the environment this was written in.
 */
function dartAdapter() {
  return {
    transport: 'stdio',
    command: 'dart',
    args: ['debug_adapter'],
    launchConfig: (program, opts = {}) => ({ request: 'launch', program, cwd: opts.cwd, noDebug: false, args: [] }),
  };
}

/**
 * Spawn spec + launch config for debugging a Go program with Delve's own adapter (`dlv dap`, needs `dlv`
 * installed separately - not part of the Go toolchain). Unlike the other adapters here, `dlv dap` speaks DAP
 * over a TCP socket it listens on, not its own stdio - DapSession.start() below picks a local port, spawns
 * `dlv` with `--listen` on it, and connects once it is accepting connections (see connectWithRetry()).
 * UNVERIFIED: written from Delve's documented `dap` subcommand and launch arguments; no Go toolchain/`dlv` was
 * available to run it against in the environment this was written in.
 */
function goAdapter() {
  return {
    transport: 'tcp',
    command: 'dlv',
    args: (port) => ['dap', '--listen', `127.0.0.1:${port}`],
    // `program` is the file being debugged; dlv accepts either a single main.go or its containing package
    // directory in `mode: "debug"` - the file path is passed through as-is, same as the other adapters.
    launchConfig: (program, opts = {}) => ({ request: 'launch', mode: 'debug', program, cwd: opts.cwd, stopOnEntry: !!opts.stopOnEntry }),
  };
}

class DapSession extends EventEmitter {
  constructor() {
    super();
    this.client = null;
    this.state = 'idle'; // idle | starting | running | stopped (at a breakpoint/step) | terminated
    this.capabilities = {};
  }

  /** adapter: { transport: 'stdio'|'tcp', command, args, launchConfig(program, opts) } - see pythonAdapter()/goAdapter() above, or a fake for tests. */
  async start({ adapter, program, cwd, opts = {} }) {
    if (this.client && !this.client.closed) throw new Error('A debug session is already running. Stop it first.');
    this.state = 'starting';
    const client = adapter.transport === 'tcp'
      ? await this._startTcp(adapter, cwd)
      : this._startStdio(adapter, cwd);
    this.client = client;
    client.on('event', (event, body) => {
      if (event === 'stopped') this.state = 'stopped';
      else if (event === 'continued') this.state = 'running';
      else if (event === 'terminated') {
        this.state = 'terminated';
        // most adapters (debugpy included) exit on their own shortly after this; a fallback so a caller that forgets
        // to call stop() never leaves an orphaned adapter process running, same idiom as LspClient.shutdown()'s unref'd kill.
        setTimeout(() => { if (this.client === client) client.kill(); }, 500).unref();
      }
      this.emit('event', event, body);
    });
    client.on('close', (reason) => { if (this.state !== 'terminated') { this.state = 'terminated'; this.emit('event', 'terminated', { reason }); } });
    try {
      this.capabilities = await client.request('initialize', { adapterID: 'bazinga', linesStartAt1: true, columnsStartAt1: true, pathFormat: 'path', supportsRunInTerminalRequest: false });
      const launchDone = client.request('launch', adapter.launchConfig(program, opts));
      await new Promise((resolve, reject) => {
        const onEvent = (event) => { if (event === 'initialized') { client.off('event', onEvent); resolve(); } };
        client.on('event', onEvent);
        launchDone.catch((err) => { client.off('event', onEvent); reject(err); });
        setTimeout(() => { client.off('event', onEvent); reject(new Error('debug adapter never sent "initialized"')); }, 15000).unref();
      });
      this._launchDone = launchDone;
    } catch (err) {
      this.state = 'idle'; client.kill(); this.client = null; throw err;
    }
    this.state = 'running';
    return { capabilities: this.capabilities };
  }

  _startStdio(adapter, cwd) {
    let child;
    try { child = spawn(adapter.command, adapter.args || [], { cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }); } catch (err) {
      this.state = 'idle'; throw err;
    }
    child.stderr.on('data', () => { /* adapters log a lot there */ });
    return new DapClient(stdioTransport(child));
  }

  async _startTcp(adapter, cwd) {
    const port = 20000 + Math.floor(Math.random() * 20000);
    let child;
    try { child = spawn(adapter.command, adapter.args(port), { cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }); } catch (err) {
      this.state = 'idle'; throw err;
    }
    // the actual DAP channel is the TCP socket below - this is just the adapter's own stdout (dlv can log there).
    // Undrained, an OS pipe buffer fills and the write blocks, stalling the adapter's whole event loop, socket
    // included - same shape as stderr right below, which was already drained.
    child.stdout.on('data', () => { /* adapters log a lot there */ });
    child.stderr.on('data', () => { /* adapters log a lot there */ });
    // if the binary is missing or exits before it ever starts listening, fail fast instead of waiting out the full connect timeout
    const earlyFail = new Promise((_resolve, reject) => {
      child.once('error', (err) => reject(new Error(err.code === 'ENOENT' ? 'debug adapter not installed' : err.message)));
      child.once('exit', (code) => reject(new Error(`debug adapter exited with code ${code} before it was ready`)));
    });
    earlyFail.catch(() => {}); // observed regardless of which promise below wins, so a later rejection is never unhandled
    let socket;
    try { socket = await Promise.race([connectWithRetry('127.0.0.1', port, 5000), earlyFail]); } catch (err) {
      this.state = 'idle'; try { child.kill(); } catch { /* gone */ } throw err;
    }
    return new DapClient(tcpTransport(child, socket));
  }

  /** The full set of breakpoints for one source file - DAP replaces them, it does not add incrementally. */
  async setBreakpoints(path, lines) {
    if (!this.client) throw new Error('No debug session running');
    const res = await this.client.request('setBreakpoints', { source: { path }, breakpoints: lines.map((line) => ({ line })) });
    return (res.breakpoints || []).map((b) => ({ line: b.line, verified: !!b.verified, message: b.message || null }));
  }

  async configurationDone() { await this.client.request('configurationDone'); await this._launchDone; }
  async threads() { return (await this.client.request('threads')).threads || []; }
  async stackTrace(threadId) { return (await this.client.request('stackTrace', { threadId })).stackFrames || []; }
  async scopes(frameId) { return (await this.client.request('scopes', { frameId })).scopes || []; }
  async variables(variablesReference) { return (await this.client.request('variables', { variablesReference })).variables || []; }
  continue_(threadId) { return this.client.request('continue', { threadId }); }
  next(threadId) { return this.client.request('next', { threadId }); }
  stepIn(threadId) { return this.client.request('stepIn', { threadId }); }
  stepOut(threadId) { return this.client.request('stepOut', { threadId }); }
  pause(threadId) { return this.client.request('pause', { threadId }); }

  async stop() {
    if (!this.client || this.client.closed) { this.state = 'idle'; return; }
    try { await this.client.request('disconnect', { terminateDebuggee: true }, 3000); } catch { /* going away regardless */ }
    this.client.kill();
    this.state = 'idle';
  }
}

module.exports = { DapClient, DapSession, pythonAdapter, dartAdapter, goAdapter };
