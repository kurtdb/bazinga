'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { findRelatedTests, runRelatedTests, stem } = require('../src/core/relatedtests');
const { nextStep, fingerprint } = require('../src/core/fixloop');
const { tmpdir, write } = require('./helpers');

test('stem strips test naming conventions', () => {
  for (const n of ['FooTest', 'FooTests', 'FooIT', 'FooSpec', 'Foo.test', 'test_foo', 'foo_test']) assert.strictEqual(stem(n), 'foo', n);
});

test('finds tests by name, changed tests, and imports; ignores deleted files', () => {
  const all = ['src/Foo.java', 'src/test/FooTest.java', 'src/test/BarTest.java', 'src/test/UsesFooTest.java', 'lib/util.js', 'lib/util.test.js', 'lib/other.test.js', 'README.md'];
  const body = { 'src/test/UsesFooTest.java': 'new Foo()', 'src/test/BarTest.java': 'nothing' };
  const r = findRelatedTests({ changed: [{ path: 'src/Foo.java', status: 'M' }, { path: 'lib/util.js', status: 'M' }, { path: 'lib/other.test.js', status: 'M' }, { path: 'src/Gone.java', status: 'D' }], allFiles: all, readFile: (f) => body[f] || '' });
  assert.deepStrictEqual(r.slice(0, 1), ['lib/other.test.js']); // changed tests first
  assert.deepStrictEqual(new Set(r), new Set(['lib/other.test.js', 'src/test/FooTest.java', 'lib/util.test.js', 'src/test/UsesFooTest.java']));
});

test('respects the max and returns nothing for non-code changes', () => {
  const all = Array.from({ length: 9 }, (_, i) => `t/a${i}.test.js`);
  assert.strictEqual(findRelatedTests({ changed: all.map((p) => ({ path: p, status: 'M' })), allFiles: all, max: 3 }).length, 3);
  assert.deepStrictEqual(findRelatedTests({ changed: [{ path: 'README.md', status: 'M' }], allFiles: ['a.test.js'] }), []);
});

test('real node:test run: pass is silent, failure becomes one stable finding with the output', async () => {
  const root = tmpdir();
  write(root, 'package.json', '{}');
  write(root, 'ok.test.js', "const test=require('node:test');\ntest('fine',()=>{});");
  write(root, 'bad.test.js', "const test=require('node:test');const a=require('node:assert');\ntest('broken',()=>{a.strictEqual(1,2,'one is not two');});");
  const read = (f) => require('node:fs').readFileSync(path.join(root, f), 'utf8');
  // a node:test child inherits NODE_TEST_CONTEXT from this runner and then reports exit 0 for failures
  const ctx = process.env.NODE_TEST_CONTEXT; delete process.env.NODE_TEST_CONTEXT;
  let r;
  try { r = await runRelatedTests({ root, files: ['ok.test.js', 'bad.test.js'], readFile: read, timeoutSec: 60 }); } finally { if (ctx !== undefined) process.env.NODE_TEST_CONTEXT = ctx; }
  assert.deepStrictEqual(r.passed, ['ok.test.js']);
  assert.strictEqual(r.findings.length, 1);
  const f = r.findings[0];
  assert.strictEqual(f.file, 'bad.test.js'); assert.strictEqual(f.rule, 'test-failure'); assert.strictEqual(f.severity, 'error');
  assert.match(f.message, /^Tests fail: /); assert.match(f.detail, /one is not two/);
});

test('timeouts and missing runners are skipped, not reported as failures', async () => {
  const root = tmpdir();
  write(root, 't.test.js', "const test=require('node:test');\ntest('x',()=>{});");
  const content = () => "const test=require('node:test');\ntest('x',()=>{});";
  const slow = await runRelatedTests({ root, files: ['t.test.js'], readFile: content, run: async () => ({ code: -1, timedOut: true, stdout: '', stderr: '' }) });
  assert.deepStrictEqual(slow.findings, []); assert.match(slow.skipped[0].reason, /timed out/);
  const missing = await runRelatedTests({ root, files: ['t.test.js'], readFile: content, run: async () => ({ code: 127, stdout: '', stderr: 'sh: pytest: command not found' }) });
  assert.deepStrictEqual(missing.findings, []); assert.match(missing.skipped[0].reason, /not available/);
  const none = await runRelatedTests({ root, files: ['x.unknown'], readFile: () => '', run: async () => { throw new Error('should not run'); } });
  assert.match(none.skipped[0].reason, /no test command/);
});

test('fix loop: same test failure output = no progress; different output = progress', () => {
  const f = (detail) => [{ tool: 'tests', file: 'a.test.js', line: 0, rule: 'test-failure', message: 'Tests fail: x', detail, severity: 'error' }];
  const first = nextStep({ round: 0, maxRounds: 3, findings: f('expected 1 got 2 (12ms)') });
  assert.strictEqual(first.action, 'fix');
  const same = nextStep({ round: 1, maxRounds: 3, findings: f('expected 1 got 2 (45ms)'), prevFingerprint: first.fingerprint });
  assert.strictEqual(same.action, 'stop'); assert.match(same.reason, /same tests fail/);
  const moved = nextStep({ round: 1, maxRounds: 3, findings: f('expected 5 got 6 and more words'), prevFingerprint: first.fingerprint });
  assert.strictEqual(moved.action, 'fix');
  assert.notStrictEqual(fingerprint(f('a b')), fingerprint(f('a c')));
});
