'use strict';
/**
 * Preloaded by `npm test` (node --require) before any test file runs. `node:fs` is a singleton module, so
 * patching mkdtempSync here once catches every throw-away directory the whole suite creates under the OS
 * temp dir - test/helpers.js's tmpdir()/repo() and the many test files (and src/core/* modules they exercise)
 * that call fs.mkdtempSync directly - without touching each call site. Without this they were never removed
 * and piled up in the OS temp dir indefinitely (hundreds were found accumulated from past runs).
 */
const fs = require('node:fs');

const created = [];
const original = fs.mkdtempSync;
fs.mkdtempSync = function patchedMkdtempSync(...args) {
  const dir = original.apply(fs, args);
  created.push(dir);
  return dir;
};

process.on('exit', () => {
  for (const dir of created) {
    // tests that create a git worktree off a throw-away repo (test/runs.test.js and friends) put it at the
    // sibling path <repo>.worktrees, per src/core/runs.js's own convention - clean that up too when present.
    for (const target of [dir, `${dir}.worktrees`]) {
      try { fs.rmSync(target, { recursive: true, force: true }); } catch { /* still in use, e.g. a lingering handle on Windows: best effort */ }
    }
  }
});
