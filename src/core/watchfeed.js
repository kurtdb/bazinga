'use strict';
/**
 * Turns raw file-system events into debounced "something changed" messages for the UI.
 * Events that arrive while the quality gates run are NOT dropped (a gate that hangs must never blind the IDE);
 * they are reported as `{ poll: true }`, which refreshes the views but does not trigger another automatic check run
 * (the gates write files themselves, so that would loop).
 */
function createFeed({ send, isChecksRunning = () => false, delay = 600, maxWait = 3000 }) {
  let timer = null;
  let firstAt = 0;
  let duringChecks = false;
  return {
    event() {
      if (isChecksRunning()) duringChecks = true;
      clearTimeout(timer);
      if (!firstAt) firstAt = Date.now();
      // a file that keeps changing (a lock file rewritten in a loop) must not postpone the refresh forever
      const wait = Math.max(0, Math.min(delay, maxWait - (Date.now() - firstAt)));
      timer = setTimeout(() => {
        const quiet = duringChecks;
        duringChecks = false;
        firstAt = 0;
        if (quiet) send('fs:changed', { poll: true }); else send('fs:changed');
      }, wait);
    },
    stop() { clearTimeout(timer); timer = null; firstAt = 0; duringChecks = false; },
  };
}

module.exports = { createFeed };
