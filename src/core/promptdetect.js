'use strict';
/**
 * "Is the agent asking me for permission?" Looks at the last bit of terminal output once it has gone quiet.
 * Heuristic: it recognises the usual wording (Claude Code, Copilot CLI, plain [y/N] prompts). A miss means no early
 * notification, a false hit means one notification too many; neither changes what the agent does.
 */
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][A-Za-z0-9]|\x1b[=>78]/g;
const stripAnsi = (s) => String(s || '').replace(ANSI, '').replace(/\r/g, '');

const PATTERNS = [
  /\b(?:do you want to|would you like to|shall i|can i|may i)\b[^\n]{0,100}\?/i,
  /\ballow\b[^\n]{0,100}\?\s*$/im,
  /[[(]\s*(?:y\/n|y\/N|Y\/n|yes\/no)\s*[\])]/,
  /^\s*[❯>›]?\s*1\.\s*(?:yes|allow|approve)\b[^\n]*\n\s*[❯>›]?\s*2\./im,
  /\bpress enter to (?:continue|confirm|approve)\b/i,
  /\besc(?:ape)? to (?:cancel|deny)\b/i,
  /\bapprove\b[^\n]{0,60}\?\s*$/im,
];

/** @returns {{ kind: 'permission', text: string } | null} */
function detectPrompt(raw) {
  const tail = stripAnsi(raw).slice(-900);
  const lines = tail.split('\n').map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim());
  const recent = lines.slice(-8).join('\n');
  for (const re of PATTERNS) {
    if (re.test(recent)) {
      const hit = lines.slice(-8).find((l) => re.test(l)) || lines[lines.length - 1] || '';
      return { kind: 'permission', text: hit.trim().slice(0, 160) };
    }
  }
  return null;
}

/** Collects the output tail of one terminal and reports a prompt once, after `quietMs` without output. */
class PromptWatcher {
  constructor({ quietMs = 1500, now = Date.now } = {}) { this.quietMs = quietMs; this.now = now; this.tail = ''; this.last = 0; this.reported = false; this.pending = null; }
  feed(data) { this.tail = (this.tail + String(data)).slice(-4000); this.last = this.now(); this.reported = false; this.pending = null; }
  /** Something was typed or pasted: whatever was asked is answered (or interrupted). */
  input() { this.tail = ''; this.last = 0; this.reported = false; this.pending = null; }
  /** The prompt, exactly once per quiet period; null otherwise. */
  poll() {
    if (this.reported || !this.last || this.now() - this.last < this.quietMs) return null;
    const p = detectPrompt(this.tail);
    if (!p) return null;
    this.reported = true; this.pending = p;
    return p;
  }
}

module.exports = { detectPrompt, PromptWatcher, stripAnsi };
