'use strict';
/**
 * Agent Client Protocol (ACP) client: Bazinga starts an ACP agent as a child process, speaks JSON-RPC to it over stdin/stdout (the official
 * SDK does the protocol), and turns what the agent says into plain events for the window: text, thoughts, tool calls, plans, permission
 * questions, the end of a turn. Unlike a terminal, "done" and "needs permission" are exact, not guessed.
 *
 * The agent works in `cwd` (the run's worktree). File reads and writes it asks of us are limited to that folder.
 * The SDK is ESM-only, so it is loaded with import().
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { Readable, Writable } = require('node:stream');

let sdk = null;
const loadSdk = async () => { if (!sdk) sdk = await import('@agentclientprotocol/sdk'); return sdk; };

/** `pool acp --x "a b"` -> ['pool', 'acp', '--x', 'a b'] (no shell involved) */
function splitCommand(text) {
  const out = []; let cur = ''; let q = null; let had = false;
  for (const ch of String(text || '')) {
    if (q) { if (ch === q) q = null; else cur += ch; } else if (ch === '"' || ch === "'") { q = ch; had = true; } else if (/\s/.test(ch)) { if (cur || had) out.push(cur); cur = ''; had = false; } else cur += ch;
  }
  if (cur || had) out.push(cur);
  return out;
}

/** An absolute path the agent asked for, only when it is inside the run's folder (symbolic links resolved) and not inside .git. */
function insideRoot(root, p, { forWrite = false } = {}) {
  const abs = path.resolve(root, String(p || ''));
  const base = fs.realpathSync(root);
  let probe = abs;
  if (forWrite) { while (!fs.existsSync(probe) && path.dirname(probe) !== probe) probe = path.dirname(probe); } // a new file: check the nearest folder that exists
  let real; try { real = fs.realpathSync(probe); } catch { return null; }
  const rel = path.relative(base, real);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  if (rel.split(path.sep)[0] === '.git') return null;
  return abs;
}

/** Which permission option a policy picks. policy: 'allow' | 'reject' | 'ask' (the caller asks the user: returns null). */
function pickOption(options, policy) {
  const by = (kinds) => (options || []).find((o) => kinds.includes(o.kind));
  if (policy === 'allow') return (by(['allow_once']) || by(['allow_always']) || {}).optionId || null;
  if (policy === 'reject') return (by(['reject_once']) || by(['reject_always']) || {}).optionId || null;
  return null;
}

const MAX_FILE = 5 * 1024 * 1024;

class AcpRun {
  /**
   * @param {{ command: string, args?: string[], cwd: string, env?: object, policy?: 'ask'|'allow'|'reject', onEvent?: (e: object) => void, spawnFn?: Function }} o
   * Events: { type: 'ready', sessionId, agent } | text | thought | tool | tool_update | plan | permission | stop | error | exit
   */
  constructor(o) {
    this.o = { args: [], env: {}, policy: 'ask', onEvent: () => {}, ...o };
    this.pending = new Map(); // permission id -> resolve
    this.permSeq = 0;
    this.queue = []; this.wake = null;
    this.closed = false; this.busy = false;
    this.ready = new Promise((resolve, reject) => { this._ready = { resolve, reject }; });
    this.ready.catch(() => {}); // reported through events as well
  }

  emit(e) { try { this.o.onEvent(e); } catch { /* a listener must not break the protocol loop */ } }

  /** Reports every JSON-RPC line in both directions to `onWire(direction, message)` (capture). Never in the way of the protocol. */
  _tap() {
    const report = (dir) => { let buf = ''; return (chunk) => { buf += chunk.toString('utf8'); let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!line) continue; try { this.o.onWire(dir, JSON.parse(line)); } catch { /* not JSON or the listener failed */ } } }; };
    const fromAgent = report('agent→client'); const toAgent = report('client→agent');
    this.child.stdout.on('data', fromAgent);
    const write = this.child.stdin.write.bind(this.child.stdin);
    this.child.stdin.write = (chunk, ...rest) => { try { toAgent(Buffer.from(chunk)); } catch { /* tap only */ } return write(chunk, ...rest); };
  }

  async open() {
    const acp = await loadSdk();
    const { command, args, cwd, env } = this.o;
    const isWinShim = process.platform === 'win32' && !/\.exe$/i.test(command);
    this.child = (this.o.spawnFn || spawn)(command, args, { cwd, env: { ...(this.o.baseEnv || process.env), ...env }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: isWinShim });
    this.child.on('error', (err) => { this.emit({ type: 'error', message: `Could not start “${command}”: ${err.message}` }); this._ready.reject(err); this._finish(null); });
    this.child.on('exit', (code) => { this.emit({ type: 'exit', code }); this._ready.reject(new Error('the agent exited before it was ready')); this._finish(code); });
    let stderr = '';
    this.child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-4000); });
    if (this.o.onWire) this._tap();
    this.stderrTail = () => stderr;
    const stream = acp.ndJsonStream(Writable.toWeb(this.child.stdin), Readable.toWeb(this.child.stdout));
    this.done = acp.client({ name: 'bazinga', version: '1.0.0' })
      .onRequest(acp.methods.client.session.requestPermission, (ctx) => this._permission(ctx.params))
      .onRequest(acp.methods.client.fs.readTextFile, (ctx) => this._read(ctx.params))
      .onRequest(acp.methods.client.fs.writeTextFile, (ctx) => this._write(ctx.params))
      .connectWith(stream, async (ctx) => {
        this.ctx = ctx; this.methods = acp.methods;
        const init = await ctx.request(acp.methods.agent.initialize, { protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } }, clientInfo: { name: 'bazinga', version: '1.0.0' } });
        return ctx.buildSession(cwd).withSession(async (session) => {
          this.session = session;
          const agent = init.agentInfo ? `${init.agentInfo.name || ''} ${init.agentInfo.version || ''}`.trim() : '';
          this._ready.resolve({ sessionId: session.sessionId, agent });
          this.emit({ type: 'ready', sessionId: session.sessionId, agent });
          while (!this.closed) {
            if (!this.queue.length) await new Promise((r) => { this.wake = r; });
            if (this.closed) break;
            const text = this.queue.shift();
            this.busy = true;
            session.prompt(text).catch(() => {}); // the stop message arrives through nextUpdate
            for (;;) {
              const msg = await session.nextUpdate();
              if (msg.kind === 'stop') { this.busy = false; this.emit({ type: 'stop', reason: (msg.response && msg.response.stopReason) || 'end_turn' }); break; }
              this._update(msg.notification && msg.notification.update);
            }
          }
        });
      })
      .catch((err) => { if (!this.closed) this.emit({ type: 'error', message: `${err.message || err}${this.stderrTail() ? `\n${this.stderrTail().trim().slice(-400)}` : ''}` }); this._ready.reject(err); })
      .finally(() => this._finish(null));
    return this.ready;
  }

  _update(u) {
    if (!u) return;
    const clip = (s, n = 4000) => String(s == null ? '' : s).slice(0, n);
    switch (u.sessionUpdate) {
      case 'agent_message_chunk': if (u.content && u.content.type === 'text') this.emit({ type: 'text', text: clip(u.content.text) }); break;
      case 'agent_thought_chunk': if (u.content && u.content.type === 'text') this.emit({ type: 'thought', text: clip(u.content.text) }); break;
      case 'tool_call': this.emit({ type: 'tool', id: u.toolCallId, title: clip(u.title, 300), kind: u.kind || 'other', status: u.status || 'pending', paths: (u.locations || []).map((l) => l.path).filter(Boolean).slice(0, 5) }); break;
      case 'tool_call_update': this.emit({ type: 'tool_update', id: u.toolCallId, status: u.status || '', title: u.title ? clip(u.title, 300) : '' }); break;
      case 'plan': this.emit({ type: 'plan', entries: (u.entries || []).map((e) => ({ text: clip(e.content, 300), status: e.status || 'pending' })).slice(0, 50) }); break;
      default: break; // modes, commands, usage...: not needed
    }
  }

  async _permission(params) {
    const options = (params.options || []).map((o) => ({ optionId: o.optionId, name: o.name, kind: o.kind }));
    const tc = params.toolCall || {};
    const auto = pickOption(options, this.o.policy);
    if (this.o.policy !== 'ask' && auto) { this.emit({ type: 'tool_update', id: tc.toolCallId, status: '', title: '', note: `${this.o.policy === 'allow' ? 'allowed' : 'rejected'} by policy: ${tc.title || ''}` }); return { outcome: { outcome: 'selected', optionId: auto } }; }
    const id = ++this.permSeq;
    this.emit({ type: 'permission', id, title: String(tc.title || 'The agent asks for permission').slice(0, 300), kind: tc.kind || 'other', paths: (tc.locations || []).map((l) => l.path).filter(Boolean).slice(0, 5), options });
    return new Promise((resolve) => {
      this.pending.set(id, (optionId) => resolve(optionId ? { outcome: { outcome: 'selected', optionId } } : { outcome: { outcome: 'cancelled' } }));
    });
  }

  /** The user's answer to a permission question; optionId null = cancel. */
  answer(id, optionId) {
    const f = this.pending.get(id);
    if (!f) return false;
    this.pending.delete(id);
    f(optionId || null);
    return true;
  }

  async _read(p) {
    const file = insideRoot(this.o.cwd, p.path);
    if (!file) throw new Error('Reading outside the run\'s folder is not allowed.');
    const st = fs.statSync(file);
    if (st.size > MAX_FILE) throw new Error('The file is too large to hand over.');
    let content = fs.readFileSync(file, 'utf8');
    if (p.line || p.limit) { const lines = content.split('\n'); const from = Math.max(0, (Number(p.line) || 1) - 1); content = lines.slice(from, p.limit ? from + Number(p.limit) : undefined).join('\n'); }
    return { content };
  }

  async _write(p) {
    const file = insideRoot(this.o.cwd, p.path, { forWrite: true });
    if (!file) throw new Error('Writing outside the run\'s folder (or into .git) is not allowed.');
    const content = String(p.content == null ? '' : p.content);
    if (Buffer.byteLength(content) > MAX_FILE) throw new Error('The content is too large.');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    this.emit({ type: 'tool_update', id: '', status: '', title: '', note: `wrote ${path.relative(this.o.cwd, file) || p.path}` });
    return {};
  }

  /** A message for the agent; it is run when the previous turn has ended. */
  send(text) {
    if (this.closed) return false;
    this.queue.push(String(text));
    if (this.wake) { const w = this.wake; this.wake = null; w(); }
    return true;
  }

  async cancel() {
    if (!this.ctx || !this.session) return false;
    for (const [id, f] of this.pending) { this.pending.delete(id); f(null); } // an open question is cancelled too
    try { await this.ctx.notify(this.methods.agent.session.cancel, { sessionId: this.session.sessionId }); return true; } catch { return false; }
  }

  _finish() {
    if (this.finished) return;
    this.finished = true; this.closed = true;
    for (const [id, f] of this.pending) { this.pending.delete(id); f(null); }
    if (this.wake) { const w = this.wake; this.wake = null; w(); }
  }

  close() {
    this.closed = true;
    for (const [id, f] of this.pending) { this.pending.delete(id); f(null); }
    if (this.wake) { const w = this.wake; this.wake = null; w(); }
    try { this.child && this.child.kill(); } catch { /* gone */ }
  }
}

module.exports = { AcpRun, splitCommand, insideRoot, pickOption };
