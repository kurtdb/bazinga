'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { IdleDetector, isTerminalReply } = require('../core/idle');
const { PromptWatcher } = require('../core/promptdetect');

/** node-pty's macOS helper must be executable; some install paths (zip extraction, copied folders) drop the bit. */
function ensureSpawnHelperExecutable() {
  if (process.platform !== 'darwin') return;
  try {
    const base = path.join(path.dirname(require.resolve('node-pty/package.json')), 'prebuilds');
    for (const dir of fs.readdirSync(base)) {
      const helper = path.join(base, dir, 'spawn-helper');
      try { if (fs.existsSync(helper)) fs.chmodSync(helper, 0o755); } catch { /* read-only: nothing to do */ }
    }
  } catch { /* no prebuilds folder (built from source) */ }
}

/** Thin wrapper around node-pty with output batching. node-pty is loaded lazily so a missing native binary shows up as a readable error in the terminal tab instead of crashing the app. */
class PtyManager {
  /** onIdle(id): a watched terminal produced output and then went quiet (see core/idle.js). */
  constructor(send, { onIdle, onPrompt, promptQuietMs } = {}) {
    this.send = send;
    this.onIdle = onIdle || (() => {});
    this.onPrompt = onPrompt || (() => {});
    this.promptQuietMs = promptQuietMs || 1500;
    this.seq = 0;
    this.sessions = new Map();
    this.idleTimer = null;
  }

  _startIdlePolling() {
    if (this.idleTimer) return;
    this.idleTimer = setInterval(() => {
      for (const [id, s] of this.sessions) {
        if (s.prompt) { const p = s.prompt.poll(); if (p) this.onPrompt(id, p); }
        // idle while the agent is asking for permission: tell the callback, so the fix loop does not paste text into the question
        if (s.idle && s.idle.poll()) this.onIdle(id, s.idle.lastBusyMs, { prompt: !!(s.prompt && s.prompt.pending) });
      }
      if (![...this.sessions.values()].some((s) => s.idle)) { clearInterval(this.idleTimer); this.idleTimer = null; }
    }, 1000);
    if (this.idleTimer.unref) this.idleTimer.unref();
  }

  static defaultShell(config) {
    if (config && config.shell) return { shell: config.shell, args: config.shellArgs || [] };
    if (process.platform === 'win32') return { shell: 'powershell.exe', args: ['-NoLogo'] };
    return { shell: process.env.SHELL || '/bin/bash', args: ['-l'] };
  }

  create({ cwd, config, cols = 100, rows = 30, initialInput, env: extraEnv, watch = false, idleMs, baseEnv }) {
    let nodePty;
    try { nodePty = require('node-pty'); } catch (err) {
      return { error: `Could not load node-pty: ${err.message}\nOn Windows run "npm install" again (a prebuilt binary is expected); on Linux you need build tools.` };
    }
    ensureSpawnHelperExecutable();
    const { shell, args } = PtyManager.defaultShell(config);
    const id = ++this.seq;
    let proc;
    try {
      proc = nodePty.spawn(shell, args, {
        name: 'xterm-256color',
        cols: Math.max(cols, 20),
        rows: Math.max(rows, 5),
        cwd,
        env: { ...(baseEnv || process.env), ...(extraEnv || {}), TERM: 'xterm-256color', COLORTERM: 'truecolor' },
      });
    } catch (err) {
      return { error: `Could not start "${shell}": ${err.message}` };
    }

    const session = { proc, buffer: '', timer: null, idle: watch ? new IdleDetector({ idleMs: idleMs || 8000 }) : null, prompt: watch ? new PromptWatcher({ quietMs: this.promptQuietMs }) : null };
    if (session.idle) this._startIdlePolling();
    const flush = () => {
      session.timer = null;
      if (session.buffer) { this.send('pty:data', id, session.buffer); session.buffer = ''; }
    };
    proc.onData((data) => {
      if (session.idle) session.idle.feed(data);
      if (session.prompt) session.prompt.feed(data);
      session.buffer += data;
      if (session.buffer.length > 65536) flush();
      else if (!session.timer) session.timer = setTimeout(flush, 8);
    });
    proc.onExit(({ exitCode }) => {
      if (session.timer) clearTimeout(session.timer);
      flush();
      this.sessions.delete(id);
      this.send('pty:exit', id, exitCode);
    });
    this.sessions.set(id, session);
    if (initialInput) setTimeout(() => { try { if (session.idle) session.idle.input(); if (session.prompt) session.prompt.input(); proc.write(initialInput); } catch { /* exited */ } }, 250);
    return { id, shell };
  }

  write(id, data) {
    const s = this.sessions.get(id);
    if (!s) return;
    if (!isTerminalReply(data)) { if (s.idle) s.idle.input(); if (s.prompt) s.prompt.input(); } // the terminal's own replies (focus changes ...) are not typing
    s.proc.write(data);
  }

  /** The agent itself said it finished (a hook): report it now, and make the quiet-terminal guess wait much longer so it does not fire a second time. */
  hookIdle(id, { prompt = false } = {}) {
    const s = this.sessions.get(id);
    if (!s) return false;
    let busyMs = 0;
    if (s.idle) { busyMs = s.idle.last ? Math.max(0, s.idle.last - (s.idle.first || s.idle.last)) : 0; s.idle.idleMs = Math.max(s.idle.idleMs, 60000); s.idle.bytes = 0; s.idle.last = 0; s.idle.first = 0; }
    if (s.prompt && !prompt) s.prompt.input();
    s.hooked = true;
    this.onIdle(id, busyMs, { prompt, hook: true });
    return true;
  }

  /** The agent said it needs permission (a hook). */
  hookPrompt(id, text) {
    const s = this.sessions.get(id);
    if (!s) return false;
    s.hooked = true;
    this.onPrompt(id, { text: String(text || ''), hook: true });
    return true;
  }

  resize(id, cols, rows) {
    const s = this.sessions.get(id);
    if (s && cols > 0 && rows > 0) { try { s.proc.resize(cols, rows); } catch { /* exited */ } }
  }

  kill(id) { const s = this.sessions.get(id); if (s) { try { s.proc.kill(); } catch { /* exited */ } this.sessions.delete(id); } }

  count() { return this.sessions.size; }

  killAll() { for (const id of [...this.sessions.keys()]) this.kill(id); }
}

module.exports = { PtyManager };
