'use strict';
/**
 * "Has the agent stopped and is it waiting for me?" without knowing anything about the agent.
 * An interactive agent (Claude Code, Copilot CLI) keeps redrawing its terminal while it works (spinner, streamed text)
 * and goes quiet when it waits for input. So: enough output since you last typed, followed by silence = idle.
 * Output that is just the echo of your own typing is below `minBytes` and does not count.
 */
class IdleDetector {
  constructor({ idleMs = 8000, minBytes = 400, now = Date.now } = {}) {
    this.idleMs = idleMs;
    this.minBytes = minBytes;
    this.now = now;
    this.bytes = 0;
    this.last = 0;
    this.first = 0;
    this.lastBusyMs = 0; // length of the busy period that poll() last reported
  }

  /** Terminal output arrived. */
  feed(data) {
    this.bytes += String(data).length;
    this.last = this.now();
    if (!this.first) this.first = this.last;
  }

  /** Something was typed or pasted into the terminal (by you or by the IDE): start counting again. */
  input() {
    this.bytes = 0;
    this.last = 0;
    this.first = 0;
  }

  /** True exactly once per busy period, when the output has been quiet for idleMs. */
  poll() {
    if (this.bytes < this.minBytes || !this.last) return false;
    if (this.now() - this.last < this.idleMs) return false;
    this.lastBusyMs = Math.max(0, this.last - (this.first || this.last));
    this.bytes = 0;
    this.last = 0;
    this.first = 0;
    return true;
  }
}

// What a terminal sends back by itself: focus in/out (when the agent asked for focus reports), cursor position, device attributes, mouse reports.
// None of it is somebody typing, so it must not restart the "has the agent gone quiet?" count.
// eslint-disable-next-line no-control-regex
const AUTOMATIC = /^(?:\x1b\[[IO]|\x1b\[\d+;\d+R|\x1b\[[?>][\d;]*c|\x1b\[\d+n|\x1b\[<\d+;\d+;\d+[Mm]|\x1b\[\?[\d;]*\$y)+$/;
const isTerminalReply = (data) => AUTOMATIC.test(String(data || ''));

/**
 * What happens when an agent has gone quiet. Whatever the fix loop does (it runs checks, which can throw or take long), the IDE is told
 * that the agent went idle: a workflow waits for exactly that message, and used to wait forever when the fix loop failed.
 * @param {object} o  { prompt: the agent is asking for permission, fix: () => Promise<{action}>, send: () => void, notify: (title, body) => void, label }
 */
async function afterIdle({ prompt = false, fix, send, notify = () => {}, label = 'Agent' }) {
  if (prompt) { send(); return { action: 'prompt' }; } // never paste a fix prompt into a permission question
  let res;
  try { res = await fix(); } catch (err) {
    res = { action: 'error', error: String((err && err.message) || err) };
    notify(`${label}: the fix loop failed`, `The agent stopped, but checking its work failed: ${res.error}`);
  }
  if (res && res.action === 'disabled') notify(`${label} is waiting for you`, 'The agent stopped and is waiting for input.');
  send();
  return res;
}

module.exports = { IdleDetector, isTerminalReply, afterIdle };
