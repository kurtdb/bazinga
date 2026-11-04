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
 * Python only for now (debugpy.adapter, spawned directly, launch mode - pythonAdapter() below). Go's `dlv dap`
 * listens on a TCP socket instead of stdio, a different transport, not wired here; see NEXT_STEPS.md.
 */
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');

class DapClient extends EventEmitter {
  constructor(child) {
    super();
    this.child = child;
    this.nextSeq = 1;
    this.pending = new Map();
    this.buffer = Buffer.alloc(0);
    this.closed = false;
    child.stdout.on('data', (d) => this._onData(d));
    child.stderr.on('data', () => { /* adapters log a lot there */ });
    child.on('exit', (code) => this._close(`exited with code ${code}`));
    child.on('error', (err) => this._close(err.code === 'ENOENT' ? 'not installed' : err.message, err.code));
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
    try { this.child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`); this.child.stdin.write(body); } catch { /* closed */ }
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

  kill() { try { this.child.kill(); } catch { /* gone */ } }
}

/** Spawn spec + launch config for debugging a Python script with debugpy's own adapter (`pip install debugpy`). */
function pythonAdapter(platform = process.platform) {
  return {
    command: platform === 'win32' ? 'python' : 'python3',
    args: ['-m', 'debugpy.adapter'],
    launchConfig: (program, opts = {}) => ({ type: 'python', request: 'launch', program, console: 'internalConsole', justMyCode: opts.justMyCode !== false, stopOnEntry: !!opts.stopOnEntry }),
  };
}

class DapSession extends EventEmitter {
  constructor() {
    super();
    this.client = null;
    this.state = 'idle'; // idle | starting | running | stopped (at a breakpoint/step) | terminated
    this.capabilities = {};
  }

  /** adapter: { command, args, launchConfig(program, opts) } - see pythonAdapter() above, or a fake for tests. */
  async start({ adapter, program, cwd, opts = {} }) {
    if (this.client && !this.client.closed) throw new Error('A debug session is already running. Stop it first.');
    this.state = 'starting';
    let child;
    try { child = spawn(adapter.command, adapter.args || [], { cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }); } catch (err) {
      this.state = 'idle'; throw err;
    }
    const client = new DapClient(child);
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

module.exports = { DapClient, DapSession, pythonAdapter };
