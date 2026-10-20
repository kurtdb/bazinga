'use strict';
/**
 * A real "the agent is done" signal from Claude Code, instead of guessing from a quiet terminal.
 * Claude Code runs hooks at fixed moments: Stop (it finished responding), Notification (it needs permission), UserPromptSubmit (it got a task).
 * Bazinga hands each agent a settings file (`--settings`) whose hooks post to a small server on 127.0.0.1; the URL holds a random token
 * that is later bound to the terminal. The idle detector stays as a fallback for agents or versions without hooks.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// SubagentStart / SubagentStop: Claude Code started / finished a helper agent inside the session (Task tool); they feed the Fleet panel
const EVENTS = { Stop: 'stop', Notification: 'notification', UserPromptSubmit: 'start', SubagentStart: 'substart', SubagentStop: 'substop' };

const newToken = () => crypto.randomBytes(12).toString('hex');

/** The settings object: one http hook per event. */
function settingsFor(base, token, { statusLine } = {}) {
  const hooks = {};
  for (const [name, slug] of Object.entries(EVENTS)) hooks[name] = [{ hooks: [{ type: 'http', url: `${base}/hook/${token}/${slug}`, timeout: 5 }] }];
  return statusLine ? { hooks, statusLine: { type: 'command', command: statusLine } } : { hooks };
}

function writeSettings(dir, base, token, extra) {
  fs.mkdirSync(dir, { recursive: true });
  // old files of earlier sessions: the tokens are dead anyway
  try { for (const f of fs.readdirSync(dir)) { const p = path.join(dir, f); if (Date.now() - fs.statSync(p).mtimeMs > 24 * 3600e3) fs.unlinkSync(p); } } catch { /* tidy up only */ }
  const file = path.join(dir, `${token}.json`);
  fs.writeFileSync(file, JSON.stringify(settingsFor(base, token, extra), null, 2));
  return file;
}

/** `claude ... ` -> `claude ... --settings "file"`; anything that is not a Claude Code command, or already has its own --settings, is left alone. */
function injectSettings(cmd, file) {
  const c = String(cmd || '');
  if (!/^\s*(?:[^\s]*[\\/])?claude(?:\.exe|\.cmd)?(?:\s|$)/i.test(c) || /(^|\s)--settings(\s|=)/.test(c)) return c;
  return `${c} --settings "${file}"`;
}

class HookServer {
  /** onEvent(terminalId, event, payload): event is stop | notification | start | substart | substop. */
  constructor({ onEvent, onRaw, log = () => {} } = {}) {
    this.onEvent = onEvent || (() => {});
    this.onRaw = onRaw || (() => {}); // every valid report as it arrived, bound or not (capture)
    this.log = log;
    this.server = null; this.port = 0;
    this.tokens = new Map(); // token -> terminal id
  }

  get base() { return `http://127.0.0.1:${this.port}`; }

  async start() {
    if (this.server) return this.base;
    this.server = http.createServer((req, res) => this._handle(req, res));
    await new Promise((resolve, reject) => { this.server.once('error', reject); this.server.listen(0, '127.0.0.1', resolve); });
    this.port = this.server.address().port;
    if (this.server.unref) this.server.unref();
    return this.base;
  }

  bind(token, id) { if (/^[0-9a-f]{24}$/.test(String(token))) this.tokens.set(String(token), id); }
  unbind(id) { for (const [t, v] of this.tokens) if (v === id) this.tokens.delete(t); }

  _handle(req, res) {
    const m = /^\/hook\/([0-9a-f]{24})\/(stop|notification|start|substart|substop)$/.exec(String(req.url || '').split('?')[0]);
    const done = (code, body = '{}') => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(body); };
    if (req.method !== 'POST' || !m) { req.resume(); return done(404); }
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => {
      let payload = {};
      try { payload = JSON.parse(data || '{}'); } catch { /* an empty or odd body still counts as the event */ }
      try { this.onRaw(m[2], payload || {}, { bound: this.tokens.has(m[1]), bytes: data.length }); } catch { /* capture never breaks a hook */ }
      const id = this.tokens.get(m[1]);
      if (id === undefined) { this.log(`hook ${m[2]} for a terminal that is not bound (yet): ignored`); return done(200); }
      try { this.onEvent(id, m[2], payload || {}); } catch (err) { this.log(`hook ${m[2]}: ${err.message}`); }
      done(200); // never a decision: the hook only reports
    });
  }

  close() { if (this.server) { try { this.server.close(); } catch { /* closed */ } this.server = null; } }
}

module.exports = { HookServer, settingsFor, writeSettings, injectSettings, newToken, EVENTS };
