'use strict';
/**
 * A small in-memory debug log (ring buffer) that the "Debug" tab shows and that is also appended to a file, so it can be sent along with a bug report.
 * Sources: workflow, agent, idle, prompt, fixloop, model, pty, app. Secrets never go in: callers log commands and decisions, not environment values.
 */
const fs = require('node:fs');

const pad = (n, w = 2) => String(n).padStart(w, '0');
const clock = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`; };
const clip = (s, n) => { const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n)}…` : t; };
const SOURCES = ['workflow', 'agent', 'idle', 'prompt', 'fixloop', 'model', 'pty', 'hook', 'app'];

class DebugLog {
  constructor({ max = 3000, file = null, maxFileBytes = 1024 * 1024, now = Date.now } = {}) {
    this.max = max; this.file = file; this.maxFileBytes = maxFileBytes; this.now = now;
    this.items = []; this.n = 0; this.fileBytes = 0;
  }

  /** Adds a line; returns the entry. Never throws. */
  add(source, text) {
    const src = SOURCES.includes(source) ? source : 'app';
    const entry = { n: ++this.n, at: this.now(), source: src, text: clip(text, 600) };
    this.items.push(entry);
    if (this.items.length > this.max) this.items.splice(0, this.items.length - this.max);
    if (this.file) this._append(`${DebugLog.line(entry)}\n`);
    return entry;
  }

  _append(text) {
    try {
      if (this.fileBytes + text.length > this.maxFileBytes) { try { fs.renameSync(this.file, `${this.file}.1`); } catch { /* none yet */ } this.fileBytes = 0; }
      fs.appendFileSync(this.file, text); this.fileBytes += text.length;
    } catch { /* the log must never break the app */ }
  }

  since(n = 0) { return this.items.filter((e) => e.n > n); }
  all() { return this.items.slice(); }
  clear() { this.items = []; }
  /** Plain text of the entries (optionally one source only), oldest first. */
  text(source = '') { return this.items.filter((e) => !source || e.source === source).map(DebugLog.line).join('\n'); }
  static line(e) { return `${clock(e.at)} [${e.source}] ${e.text}`; }
}

module.exports = { DebugLog, SOURCES, clip };
