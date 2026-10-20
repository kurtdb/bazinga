'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { friendly } = require('../src/core/friendly');
const { StartupWatch } = require('../src/core/startupwatch');

test('low-level errors become one plain sentence and keep the raw text in brackets', () => {
  const a = friendly(new Error('spawn mvn ENOENT'));
  assert.match(a, /“mvn” was not found/);
  assert.match(a, /\(spawn mvn ENOENT\)/);
  assert.match(friendly('fatal: not a git repository (or any of the parent directories): .git'), /not a git repository.*git init/);
  assert.match(friendly("EACCES: permission denied, open '/x'"), /did not allow/);
  assert.match(friendly('connect ECONNREFUSED 127.0.0.1:11434'), /Nothing is listening/);
  assert.match(friendly('Unable to create .git/index.lock: File exists'), /another git command|Another git command/i);
  assert.match(friendly('Unexpected token } in JSON at position 4'), /not valid JSON/);
});
test('messages Bazinga wrote itself, and unknown ones, pass through untouched', () => {
  const own = 'The main working tree has uncommitted changes. Commit or stash them first, then merge.';
  assert.equal(friendly(own), own);
  assert.equal(friendly(new Error('some odd thing')), 'some odd thing');
  assert.match(friendly(''), /no details/);
  assert.match(friendly(undefined), /no details/);
});
test('long raw text is clipped inside the brackets', () => {
  assert.ok(friendly(`spawn x ENOENT ${'a'.repeat(1000)}`).length < 500);
});

test('startup watchdog: ready in time is silent; no ready, failure, or repeated problems report exactly once', () => {
  const calls = []; const timers = [];
  const mk = () => new StartupWatch({ timeoutMs: 1000, onProblem: (p) => calls.push(p), setTimer: (fn) => { timers.push(fn); return timers.length; }, clearTimer: () => {} });
  const ok = mk(); ok.start(); ok.ready(); timers[0]();
  assert.equal(calls.length, 0);
  const slow = mk(); slow.start(); slow.note('Uncaught ReferenceError: x is not defined'); timers[1]();
  assert.equal(calls.length, 1);
  assert.match(calls[0].reason, /did not finish starting within 1 seconds/);
  assert.match(calls[0].details[0], /ReferenceError/);
  slow.fail('again'); timers[1]();
  assert.equal(calls.length, 1);
  const crash = mk(); crash.start(); crash.fail('crashed'); assert.equal(calls.length, 2);
});
test('the real window reports ready, the main process listens, and failures go through safe()', () => {
  const fs = require('node:fs'); const path = require('node:path');
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  assert.match(read('src/renderer/app.js'), /api\.appReady\(\)/);
  assert.match(read('src/main/main.js'), /ipcMain\.on\('app:ready'/);
  assert.match(read('src/main/main.js'), /error: friendlyCore\.friendly\(err\)/);
});
