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
test('go test -v, cargo test, dotnet test counts', () => {
  const go = '=== RUN   TestFoo\n--- PASS: TestFoo (0.00s)\n=== RUN   TestBar\n--- FAIL: TestBar (0.00s)\nFAIL\nexit status 1\nFAIL\tx\t0.004s';
  assert.deepStrictEqual(parseCounts(go), { total: 2, passed: 1, failed: 1, skipped: 0 });
  assert.strictEqual(run(go, 1).status, 'failed');
  assert.strictEqual(run('ok  \tx\t0.004s [no tests to run]').status, 'notfound');
  const cargo = 'running 2 tests\ntest tests::foo ... ok\ntest tests::bar ... FAILED\n\ntest result: FAILED. 1 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s';
  assert.deepStrictEqual(parseCounts(cargo), { total: 2, passed: 1, failed: 1, skipped: 0 });
  assert.strictEqual(run(cargo, 1).status, 'failed');
  const net = 'Failed!  - Failed:     1, Passed:     2, Skipped:     0, Total:     3, Duration: 15 ms - MyTests.dll';
  assert.deepStrictEqual(parseCounts(net), { failed: 1, passed: 2, skipped: 0, total: 3 });
  assert.strictEqual(run(net, 1).status, 'failed');
  assert.strictEqual(run('Passed!  - Failed:     0, Passed:     3, Skipped:     0, Total:     3, Duration: 12 ms - MyTests.dll').status, 'passed');
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
