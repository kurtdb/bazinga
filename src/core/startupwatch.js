'use strict';
/**
 * Startup watchdog: the window must say "ready" within a time limit. If it never does (a script error before the UI exists,
 * a crashed renderer, a failed load) the user gets one clear message instead of an empty or frozen window.
 * Pure: timers are injected, the caller shows the message.
 */
class StartupWatch {
  /** @param {{timeoutMs?:number, onProblem:(p:{reason:string, details:string[]})=>void, setTimer?:Function, clearTimer?:Function}} o */
  constructor({ timeoutMs = 25000, onProblem, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    this.timeoutMs = timeoutMs; this.onProblem = onProblem; this.setTimer = setTimer; this.clearTimer = clearTimer;
    this.timer = null; this.done = false; this.errors = [];
  }
  start() { this.done = false; this.errors = []; this.clearTimer(this.timer); this.timer = this.setTimer(() => this._problem(`The window did not finish starting within ${Math.round(this.timeoutMs / 1000)} seconds.`), this.timeoutMs); if (this.timer && this.timer.unref) this.timer.unref(); }
  /** Errors seen while starting (console errors, preload errors): shown with the problem. */
  note(text) { if (!this.done && this.errors.length < 8) this.errors.push(String(text).slice(0, 400)); }
  ready() { if (this.done) return; this.done = true; this.clearTimer(this.timer); }
  fail(reason) { this._problem(reason); }
  _problem(reason) { if (this.done) return; this.done = true; this.clearTimer(this.timer); try { this.onProblem({ reason, details: [...this.errors] }); } catch { /* showing the message must not throw */ } }
}

module.exports = { StartupWatch };
