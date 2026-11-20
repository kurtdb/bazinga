'use strict';
/**
 * A tiny standalone process (no Electron APIs) that owns pty sessions for agent runs so they survive Bazinga
 * quitting - the thing herdr calls herdr-core. Spawned detached+unref'd by src/main/main.js on first need;
 * src/daemon/agentdClient.js is the socket client src/main/pty.js's callers use. Reuses PtyManager
 * (src/main/pty.js) exactly as the Electron main process does, with `watch` always false here: idle/prompt/
 * status detection stays client-side (fed by the bytes this relays), so it isn't run twice. Sessions are keyed
 * by the run's own stable id (bazinga-run.json's id/slug, core/runs.js) rather than PtyManager's own throwaway
 * per-launch counter, so a session can be found again after this process - and Bazinga itself - restarts.
 */
const net = require('node:net');
const fs = require('node:fs');
const { PtyManager } = require('../main/pty');

const MAX_RING_BYTES = 2 * 1024 * 1024; // a hard ceiling under any configured scrollback - one noisy agent can't grow this process without bound

class Agentd {
  constructor() {
    this.byRunId = new Map(); // runId -> numeric pty id, while the process is alive
    this.runIdByPtyId = new Map();
    this.ring = new Map(); // runId -> { parts: string[], bytes } - kept after exit too, so a late reattach still sees the final output
    this.subs = new Map(); // runId -> Set<socket>
    this.sockets = new Set();
    this.ptys = new PtyManager((channel, ptyId, a) => this._onPtyEvent(channel, ptyId, a));
  }

  _onPtyEvent(channel, ptyId, a) {
    const runId = this.runIdByPtyId.get(ptyId);
    if (!runId) return;
    if (channel === 'pty:data') this._broadcast(runId, { type: 'event', runId, kind: 'data', data: a });
    else if (channel === 'pty:exit') {
      this._broadcast(runId, { type: 'event', runId, kind: 'exit', exitCode: a });
      this.byRunId.delete(runId);
      this.runIdByPtyId.delete(ptyId);
    }
  }

  _appendRing(runId, data) {
    let r = this.ring.get(runId);
    if (!r) { r = { parts: [], bytes: 0 }; this.ring.set(runId, r); }
    r.parts.push(data);
    r.bytes += Buffer.byteLength(data, 'utf8');
    while (r.bytes > MAX_RING_BYTES && r.parts.length > 1) r.bytes -= Buffer.byteLength(r.parts.shift(), 'utf8');
  }

  _broadcast(runId, msg) {
    if (msg.kind === 'data') this._appendRing(runId, msg.data);
    const subs = this.subs.get(runId);
    if (!subs || !subs.size) return;
    const line = `${JSON.stringify(msg)}\n`;
    for (const sock of subs) { try { sock.write(line); } catch { /* gone */ } }
  }

  /** @returns {{ok:true, result} | {ok:false, error}} never throws - every op is caught, so one bad request can't take the daemon down. */
  handle(sock, req) {
    try {
      if (req.op === 'ping') return { ok: true, result: { pid: process.pid } };
      if (req.op === 'list') return { ok: true, result: [...this.byRunId.keys()] };
      if (req.op === 'create') return this._create(req);
      if (req.op === 'write') { this.ptys.write(this.byRunId.get(req.runId), req.data); return { ok: true, result: {} }; }
      if (req.op === 'resize') { this.ptys.resize(this.byRunId.get(req.runId), req.cols, req.rows); return { ok: true, result: {} }; }
      if (req.op === 'kill') return this._kill(req);
      if (req.op === 'subscribe') return this._subscribe(sock, req);
      if (req.op === 'unsubscribe') { const subs = this.subs.get(req.runId); if (subs) subs.delete(sock); return { ok: true, result: {} }; }
      return { ok: false, error: `unknown op "${req.op}"` };
    } catch (err) { return { ok: false, error: String((err && err.message) || err) }; }
  }

  _create(req) {
    if (this.byRunId.has(req.runId)) {
      const ptyId = this.byRunId.get(req.runId);
      if (req.cols && req.rows) this.ptys.resize(ptyId, req.cols, req.rows);
      return { ok: true, result: { alive: true, reattached: true } };
    }
    this.ring.delete(req.runId); // starting fresh forgets any previous (exited) run under this id
    const res = this.ptys.create({ cwd: req.cwd, config: req.config, cols: req.cols, rows: req.rows, initialInput: req.initialInput, env: req.env, baseEnv: req.baseEnv, watch: false });
    if (res.error) return { ok: false, error: res.error };
    this.byRunId.set(req.runId, res.id);
    this.runIdByPtyId.set(res.id, req.runId);
    return { ok: true, result: { alive: true, reattached: false, shell: res.shell } };
  }

  _kill(req) {
    const ptyId = this.byRunId.get(req.runId);
    if (ptyId) { this.ptys.kill(ptyId); this.runIdByPtyId.delete(ptyId); }
    this.byRunId.delete(req.runId);
    this.ring.delete(req.runId);
    this.subs.delete(req.runId);
    return { ok: true, result: {} };
  }

  _subscribe(sock, req) {
    let subs = this.subs.get(req.runId);
    if (!subs) { subs = new Set(); this.subs.set(req.runId, subs); }
    subs.add(sock);
    const ring = this.ring.get(req.runId);
    return { ok: true, result: { alive: this.byRunId.has(req.runId), replay: ring ? ring.parts.join('') : '' } };
  }

  /** Every session this process owns, killed - used on SIGTERM/SIGINT so nothing is orphaned past the daemon's own life. */
  shutdown() {
    for (const ptyId of this.runIdByPtyId.keys()) this.ptys.kill(ptyId);
    for (const sock of this.sockets) { try { sock.destroy(); } catch { /* gone */ } }
  }

  /** @returns {Promise<import('node:net').Server>} */
  listen(socketPath) {
    try { fs.unlinkSync(socketPath); } catch { /* nothing there yet, or a Windows pipe path (not a filesystem entry) */ }
    const server = net.createServer((sock) => {
      this.sockets.add(sock);
      let buf = '';
      sock.on('data', (chunk) => {
        buf += chunk.toString('utf8');
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (!line.trim()) continue;
          let req;
          try { req = JSON.parse(line); } catch { continue; } // a malformed line has no id to reply to - drop it
          const res = this.handle(sock, req);
          try { sock.write(`${JSON.stringify({ type: 'res', id: req.id, ok: res.ok, ...(res.ok ? { result: res.result } : { error: res.error }) })}\n`); } catch { /* gone */ }
        }
      });
      sock.on('close', () => { this.sockets.delete(sock); for (const subs of this.subs.values()) subs.delete(sock); });
      sock.on('error', () => {}); // a reset/broken-pipe surfaces via 'close' - nothing to do here but not crash the process
    });
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, () => { server.removeListener('error', reject); resolve(server); });
    });
  }
}

module.exports = { Agentd, MAX_RING_BYTES };

if (require.main === module) {
  const socketPath = process.argv[2];
  const pidPath = process.argv[3];
  if (!socketPath) { process.stderr.write('agentd: usage: agentd.js <socketPath> [pidPath]\n'); process.exit(1); }
  const d = new Agentd();
  d.listen(socketPath).then((server) => {
    if (pidPath) { try { fs.writeFileSync(pidPath, String(process.pid)); } catch { /* best effort - a missing pidfile just means the next probe relies on the socket alone */ } }
    const stop = () => { d.shutdown(); server.close(() => process.exit(0)); };
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);
  }).catch((err) => { process.stderr.write(`agentd: could not listen: ${(err && err.message) || err}\n`); process.exit(1); });
}
