'use strict';
/**
 * The socket client for src/daemon/agentd.js, used from src/main/pty.js/src/main/main.js. One AgentdClient
 * instance per daemon connection - the Electron main process keeps exactly one, shared across every
 * daemon-backed (agent-run) pty. Line-framed JSON, matching agentd.js's own framing.
 */
const net = require('node:net');
const { EventEmitter } = require('node:events');

class AgentdClient extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.seq = 0;
    this.pending = new Map();
    this.buf = '';
    socket.on('data', (chunk) => this._onData(chunk));
    socket.on('close', () => {
      for (const p of this.pending.values()) p.reject(new Error('agentd connection closed'));
      this.pending.clear();
      this.emit('close');
    });
    socket.on('error', () => {}); // surfaces via 'close' too - avoid an unhandled 'error' crashing the process
  }

  _onData(chunk) {
    this.buf += chunk.toString('utf8');
    let nl;
    while ((nl = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, nl);
      this.buf = this.buf.slice(nl + 1);
      if (!line.trim()) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.type === 'res') {
        const p = this.pending.get(msg.id);
        if (!p) continue;
        this.pending.delete(msg.id);
        if (msg.ok) p.resolve(msg.result); else p.reject(new Error(msg.error));
      } else if (msg.type === 'event') {
        this.emit('event', msg); // { runId, kind: 'data'|'exit', data? , exitCode? }
      }
    }
  }

  request(op, params = {}, { timeoutMs = 10000 } = {}) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`agentd: "${op}" timed out`)); }, timeoutMs);
      this.pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
      try { this.socket.write(`${JSON.stringify({ op, id, ...params })}\n`); } catch (err) { clearTimeout(timer); this.pending.delete(id); reject(err); }
    });
  }

  close() { try { this.socket.end(); } catch { /* already gone */ } }
}

/** Connects to a daemon already listening at socketPath, or rejects (ENOENT/ECONNREFUSED/timeout) if nothing answers. */
function connect(socketPath, { timeoutMs = 2000 } = {}) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(socketPath);
    let settled = false;
    const fail = (err) => { if (settled) return; settled = true; clearTimeout(timer); sock.removeAllListeners('error'); sock.destroy(); reject(err); };
    const timer = setTimeout(() => fail(new Error('agentd: connect timed out')), timeoutMs);
    sock.once('error', fail);
    sock.once('connect', () => { if (settled) return; settled = true; clearTimeout(timer); sock.removeListener('error', fail); resolve(new AgentdClient(sock)); });
  });
}

/** `{client, info}` when a daemon is already listening and answers a ping, else null. Callers reuse `client` - this never opens a second connection on success. */
async function probe(socketPath, opts) {
  let client;
  try { client = await connect(socketPath, opts); } catch { return null; }
  try { const info = await client.request('ping', {}, { timeoutMs: 2000 }); return { client, info }; }
  catch { client.close(); return null; }
}

module.exports = { AgentdClient, connect, probe };
