'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { safeFetch, drain } = require('../src/core/safeFetch');

/** A fetch()-shaped mock Response: a body stream whose cancel() is spyable, and bodyUsed flips once a read method runs. */
function mockRes({ ok = true, status = 200, statusText = 'OK', readers = {}, hasBody = true } = {}) {
  const res = { ok, status, statusText, bodyUsed: false };
  if (hasBody) {
    let cancelCalls = 0;
    res.body = { get cancelCalls() { return cancelCalls; }, cancel: async () => { cancelCalls++; } };
  }
  for (const [name, impl] of Object.entries(readers)) {
    res[name] = async (...args) => { const r = await impl(...args); res.bodyUsed = true; return r; };
  }
  return res;
}

test('safeFetch: success reads the body via the requested method and never cancels it', async () => {
  const res = mockRes({ readers: { json: async () => ({ hello: 'world' }) } });
  const fetchImpl = async () => res;
  const { res: got, body } = await safeFetch('https://x.test', undefined, 'json', fetchImpl);
  assert.equal(got, res);
  assert.deepStrictEqual(body, { hello: 'world' });
  assert.equal(res.bodyUsed, true);
  assert.equal(res.body.cancelCalls, 0, 'the body was fully read - cancelling it too would be a no-op bug, not a leak, but it should simply never happen');
});

test('safeFetch: a non-2xx response still has its body read, not left dangling (this is the actual fix for crbug 378822137)', async () => {
  const res = mockRes({ ok: false, status: 404, statusText: 'Not Found', readers: { text: async () => 'not found' } });
  const fetchImpl = async () => res;
  const { res: got, body } = await safeFetch('https://x.test', undefined, 'text', fetchImpl);
  assert.equal(got.ok, false);
  assert.equal(body, 'not found');
  assert.equal(res.bodyUsed, true, 'the body must be consumed on the error path too - that is exactly the branch the old code leaked on');
  assert.equal(res.body.cancelCalls, 0);
});

test('safeFetch: when fetch() itself throws or aborts, there is no response and nothing to cancel', async () => {
  const abort = Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
  const fetchImpl = async () => { throw abort; };
  await assert.rejects(() => safeFetch('https://x.test', undefined, 'json', fetchImpl), (err) => err === abort);
});

test('safeFetch: when reading the body throws (bad JSON, a mid-stream abort), the body is cancelled so nothing leaks', async () => {
  const parseErr = new SyntaxError('Unexpected token');
  const res = mockRes({ readers: {} });
  res.json = async () => { throw parseErr; }; // throws before marking bodyUsed, as a stream error genuinely would
  const fetchImpl = async () => res;
  await assert.rejects(() => safeFetch('https://x.test', undefined, 'json', fetchImpl), (err) => err === parseErr);
  assert.equal(res.body.cancelCalls, 1, 'the failed read must fall back to cancelling the stream');
});

test('safeFetch: read "none" drains a fire-and-forget response without parsing it', async () => {
  const res = mockRes();
  const fetchImpl = async () => res;
  const { res: got, body } = await safeFetch('https://x.test', undefined, 'none', fetchImpl);
  assert.equal(got, res);
  assert.equal(body, undefined);
  assert.equal(res.body.cancelCalls, 1);
});

test('drain: no-ops when the body was already consumed, already cancelled/closed, or never existed', async () => {
  await drain(null);
  await drain(undefined);
  await drain(mockRes({ hasBody: false }));
  const used = mockRes();
  used.bodyUsed = true;
  await drain(used);
  assert.equal(used.body.cancelCalls, 0, 'already-consumed bodies must not be double-cancelled');
  const closed = mockRes();
  closed.body.cancel = async () => { throw new Error('already closed'); };
  await assert.doesNotReject(() => drain(closed), 'a cancel() that throws because the stream is already closed must not propagate');
});

test('safeFetch threads a caller-supplied fetchImpl through untouched (the fetchFn injection pattern used by jira.js/skillsearch.js)', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return mockRes({ readers: { text: async () => 'ok' } }); };
  await safeFetch('https://x.test/path', { method: 'POST' }, 'text', fetchImpl);
  assert.deepStrictEqual(calls, [{ url: 'https://x.test/path', init: { method: 'POST' } }]);
});

test('lint regression: no shipped source file calls bare fetch() outside the safeFetch helper', () => {
  // Runs the project's own committed eslint.config.js (which scopes the no-restricted-syntax/bare-fetch rule to
  // src/**, excluding src/core/safeFetch.js itself) rather than re-describing the rule here, so this test fails
  // the moment that rule or its scoping drifts, not just when a new bare fetch() call appears.
  const root = path.join(__dirname, '..');
  let out;
  try {
    execFileSync('npx', ['--no-install', 'eslint', '--format', 'json', 'src'], { cwd: root });
  } catch (err) {
    out = err.stdout;
  }
  if (out === undefined) return; // clean run: eslint exited 0, nothing to check
  const results = JSON.parse(out.toString('utf8'));
  const offenders = results
    .filter((r) => r.messages.some((m) => m.ruleId === 'no-restricted-syntax'))
    .map((r) => path.relative(root, r.filePath));
  assert.deepStrictEqual(offenders, [], 'every call site must go through safeFetch() instead of bare fetch() - see src/core/safeFetch.js');
});
