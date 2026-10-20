'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { summarize, parseCounts } = require('../src/core/testrun');

const run = (stdout, code = 0, extra = {}) => summarize({ stdout, stderr: '', code, ...extra });

test('node:test: pass and fail are read from the summary', () => {
  assert.strictEqual(run('# tests 3\n# pass 3\n# fail 0\n# skipped 0\n').status, 'passed');
  const f = run('# tests 3\n# pass 2\n# fail 1\n', 1);
  assert.strictEqual(f.status, 'failed');
  assert.match(f.headline, /1 failed, 2 passed/);
});
test('REGRESSION: exit 0 with zero tests run is not a pass (a mistyped name filter looks exactly like this)', () => {
  assert.strictEqual(run('# tests 0\n# pass 0\n# fail 0\n').status, 'notfound');
  assert.strictEqual(run('============ no tests ran in 0.01s ============').status, 'notfound');
  assert.strictEqual(run('No tests found, exiting with code 1', 1).status, 'notfound');
});
test('pytest, jest, vitest, maven counts', () => {
  assert.deepStrictEqual(parseCounts('=== 1 failed, 2 passed, 1 skipped in 0.12s ==='), { total: 4, passed: 2, failed: 1, skipped: 1 });
  assert.strictEqual(run('2 passed in 0.01s').status, 'passed');
  assert.deepStrictEqual(parseCounts('Tests:       1 failed, 2 passed, 3 total'), { total: 3, passed: 2, failed: 1, skipped: 0 });
  assert.deepStrictEqual(parseCounts(' Tests  1 failed | 2 passed (3)'), { total: 3, passed: 2, failed: 1, skipped: 0 });
  const mvn = 'Tests run: 2, Failures: 0, Errors: 0, Skipped: 0\nTests run: 5, Failures: 1, Errors: 1, Skipped: 1';
  assert.deepStrictEqual(parseCounts(mvn), { total: 5, failed: 2, skipped: 1, passed: 2 });
  assert.strictEqual(run(mvn, 1).status, 'failed');
});
test('a runner that is not installed is reported as such, not as a failing test', () => {
  assert.strictEqual(run('sh: 1: mvn: not found', 127).status, 'unavailable');
  assert.strictEqual(run("'mvn' is not recognized as an internal or external command", 1).status, 'unavailable');
});
test('timeout, cancel, ANSI colours and unknown output', () => {
  assert.strictEqual(run('', -1, { timedOut: true }).status, 'timeout');
  assert.strictEqual(run('', -1, { cancelled: true }).status, 'cancelled');
  assert.ok(!/\u001b/.test(run('\u001b[31mred\u001b[0m').output));
  assert.strictEqual(run('all good', 0).status, 'passed');
  assert.match(run('boom', 3).headline, /exit code 3/);
});
