'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { IdleDetector, isTerminalReply } = require('../core/idle');
const { PromptWatcher } = require('../core/promptdetect');
const { Osc7501Tracker, capabilityReply } = require('../core/osc7501');

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

    const oscOn = !(config && config.osc7501 && config.osc7501.enabled === false);
    const session = { proc, buffer: '', timer: null, idle: watch ? new IdleDetector({ idleMs: idleMs || 8000 }) : null, prompt: watch ? new PromptWatcher({ quietMs: this.promptQuietMs }) : null, osc: oscOn ? new Osc7501Tracker() : null };
    if (session.idle) this._startIdlePolling();
    const flush = () => {
      session.timer = null;
      if (session.buffer) { this.send('pty:data', id, session.buffer); session.buffer = ''; }
    };
    proc.onData((data) => {
      if (session.idle) session.idle.feed(data);
      if (session.prompt) session.prompt.feed(data);
      if (session.osc) {
        for (const ev of session.osc.feed(data)) {
          if (ev.query) { try { proc.write(capabilityReply()); } catch { /* exited */ } continue; }
          if (ev.id || !watch) continue; // v1 only surfaces the root record, and only for a watched (agent) session
          const st = ev.cleared ? null : ev.record.state;
          if (st === 'blocked') { session.hooked = true; this.onPrompt(id, { text: ev.record.msg || 'The program is waiting on you.', hook: true }); }
          else if (st === 'done' || st === 'idle' || st === 'error') { session.hooked = true; this.onIdle(id, 0, { prompt: false, hook: true }); }
        }
      }
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
    if (initialInput) {
      // A login shell's startup files (oh-my-zsh, nvm, conda, powerlevel10k...) can still be sourcing well past a fixed
      // delay; typing before the shell starts reading the tty can be swallowed or left sitting unsubmitted at the prompt.
      // Wait for the shell's first output (its prompt) and settle briefly, with a fallback for a shell that prints
      // nothing before reading stdin.
      let sent = false;
      let dataDisp = null;
      const fire = () => {
        if (sent) return;
        sent = true;
        if (dataDisp) { dataDisp.dispose(); dataDisp = null; }
        clearTimeout(fallback);
        try { if (session.idle) session.idle.input(); if (session.prompt) session.prompt.input(); proc.write(initialInput); } catch { /* exited */ }
      };
      dataDisp = proc.onData(() => { if (dataDisp) { dataDisp.dispose(); dataDisp = null; } setTimeout(fire, 100); });
      const fallback = setTimeout(fire, 4000);
    }
    return { id, shell };
  }

  /**
   * Like create(), but the pty itself lives in a separate daemon process (src/daemon/agentd.js) under the stable
   * id `runId`, so it survives this app quitting - src/main/main.js uses this only for agent runs, never a plain
   * personal shell. idle/prompt/osc detection still happens here, fed by the data the daemon relays (it never
   * runs there too - see agentd.js's own header comment on why).
   * @param {{ runId: string, client: import('../daemon/agentdClient').AgentdClient }} o
   */
  async createRemote({ runId, client, cwd, config, cols = 100, rows = 30, initialInput, env: extraEnv, watch = true, idleMs, baseEnv }) {
    let created;
    try { created = await client.request('create', { runId, cwd, config, cols, rows, env: extraEnv, baseEnv, initialInput }); }
    catch (err) { return { error: String((err && err.message) || err) }; }
    let sub;
    try { sub = await client.request('subscribe', { runId }); } catch (err) { return { error: String((err && err.message) || err) }; }

    const id = ++this.seq;
    const session = {
      proc: {
        write: (data) => { client.request('write', { runId, data }).catch(() => {}); },
        resize: (c, r) => { client.request('resize', { runId, cols: c, rows: r }).catch(() => {}); },
        kill: () => { client.request('kill', { runId }).catch(() => {}); },
      },
      buffer: '', timer: null,
      idle: watch ? new IdleDetector({ idleMs: idleMs || 8000 }) : null,
      prompt: watch ? new PromptWatcher({ quietMs: this.promptQuietMs }) : null,
      osc: !(config && config.osc7501 && config.osc7501.enabled === false) ? new Osc7501Tracker() : null,
      runId, remote: true,
    };
    if (session.idle) this._startIdlePolling();
    const flush = () => {
      session.timer = null;
      if (session.buffer) { this.send('pty:data', id, session.buffer); session.buffer = ''; }
    };
    const onEvent = (msg) => {
      if (msg.runId !== runId) return;
      if (msg.kind === 'data') {
        const data = msg.data;
        if (session.idle) session.idle.feed(data);
        if (session.prompt) session.prompt.feed(data);
        if (session.osc) {
          for (const ev of session.osc.feed(data)) {
            if (ev.query) continue; // the daemon's own internal pty already answers this at the byte level
            if (ev.id || !watch) continue; // v1 only surfaces the root record, and only for a watched (agent) session
            const st = ev.cleared ? null : ev.record.state;
            if (st === 'blocked') { session.hooked = true; this.onPrompt(id, { text: ev.record.msg || 'The program is waiting on you.', hook: true }); }
            else if (st === 'done' || st === 'idle' || st === 'error') { session.hooked = true; this.onIdle(id, 0, { prompt: false, hook: true }); }
          }
        }
        session.buffer += data;
        if (session.buffer.length > 65536) flush(); else if (!session.timer) session.timer = setTimeout(flush, 8);
      } else if (msg.kind === 'exit') {
        if (session.timer) clearTimeout(session.timer);
        flush();
        this.sessions.delete(id);
        client.removeListener('event', onEvent);
        this.send('pty:exit', id, msg.exitCode);
      }
    };
    session.cleanup = () => client.removeListener('event', onEvent);
    client.on('event', onEvent);
    this.sessions.set(id, session);
    if (sub.replay) { session.buffer = sub.replay; flush(); } // prior output from before this window attached - shown, but not re-fed through the detectors above (their timing model doesn't apply retroactively)
    return { id, shell: created.shell, reattached: !!created.reattached };
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

  kill(id) { const s = this.sessions.get(id); if (s) { try { s.proc.kill(); } catch { /* exited */ } if (s.cleanup) s.cleanup(); this.sessions.delete(id); } }

  /** Stops watching a daemon-owned session from this window (no more local idle/prompt relay here) without killing the real process - this is what quitting/switching projects does to a remote session, so a background agent run keeps going. */
  detach(id) { const s = this.sessions.get(id); if (s) { if (s.cleanup) s.cleanup(); this.sessions.delete(id); } }

  count() { return this.sessions.size; }

  /** Kills every session this window owns directly; a daemon-owned (remote) one is only detached, never killed - this is what makes an agent run survive quitting. */
  killAll() { for (const [id, s] of [...this.sessions]) (s.remote ? this.detach(id) : this.kill(id)); }
}

module.exports = { PtyManager };
