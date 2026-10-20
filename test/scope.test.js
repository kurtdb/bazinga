'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const G = require('../src/core/git');
const S = require('../src/core/scope');

const sh = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' });
const write = (root, rel, t) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), t); };

function repo(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bazinga-s-'));
  sh(root, 'init', '-q'); sh(root, 'config', 'user.email', 't@t'); sh(root, 'config', 'user.name', 't');
  for (const [k, v] of Object.entries(files)) write(root, k, v);
  sh(root, 'add', '.'); sh(root, 'commit', '-q', '-m', 'init');
  return root;
}

test('isTestPath recognises common test layouts', () => {
  for (const p of ['src/test/java/FooTest.java', 'a/b.test.ts', 'tests/x.py', 'pkg/test_x.py', 'x_test.go', 'src/FooIT.java']) assert.ok(S.isTestPath(p), p);
  for (const p of ['src/main/Foo.java', 'README.md', 'src/contest.py']) assert.ok(!S.isTestPath(p), p);
});

test('inScope: directories, globs, basenames', () => {
  assert.ok(S.inScope('src/billing/a.js', ['src/billing']));
  assert.ok(S.inScope('src/billing/a.js', ['src/billing/']));
  assert.ok(S.inScope('src/billing/deep/a.js', ['src/billing/**']));
  assert.ok(!S.inScope('src/other/a.js', ['src/billing/**']));
  assert.ok(S.inScope('x/y/z.md', ['*.md']));
  assert.ok(S.inScope('anything', []));
  assert.deepEqual(S.parseAllow('src/a/**, docs/\n*.md'), ['src/a/**', 'docs/', '*.md']);
});

test('out-of-scope files are flagged; baseline excludes pre-existing edits', async () => {
  const root = repo({ 'src/billing/a.js': 'a\n', 'src/other/b.js': 'b\n', 'pom.xml': '<p/>\n' });
  write(root, 'pom.xml', '<p>dirty before the task</p>\n');
  const baseline = S.snapshot(root, await G.changedFiles(root));
  write(root, 'src/billing/a.js', 'a2\n');
  write(root, 'src/other/b.js', 'b2\n');
  const res = await S.analyzeScope({ root, changed: await G.changedFiles(root), baseline, allow: 'src/billing/**' });
  assert.deepEqual(res.files.map((f) => f.path).sort(), ['src/billing/a.js', 'src/other/b.js']);
  assert.deepEqual(res.outOfScope, ['src/other/b.js']);
  assert.equal(res.warnings, 1);
  // editing the pre-dirty file again makes it part of the task
  write(root, 'pom.xml', '<p>changed by agent</p>\n');
  const res2 = await S.analyzeScope({ root, changed: await G.changedFiles(root), baseline, allow: 'src/billing/**' });
  assert.ok(res2.outOfScope.includes('pom.xml'));
});

test('edited and deleted tests are flagged, new tests are not', async () => {
  const root = repo({ 'tests/test_a.py': 'def test_a():\n    assert 1 == 1\n    assert 2 == 2\n', 'tests/test_b.py': 'def test_b():\n    assert True\n' });
  write(root, 'tests/test_a.py', 'def test_a():\n    assert 1 == 1\n');
  fs.unlinkSync(path.join(root, 'tests/test_b.py'));
  write(root, 'tests/test_new.py', 'def test_new():\n    assert True\n');
  const res = await S.analyzeScope({ root, changed: await G.changedFiles(root), baseline: {}, allow: '' });
  const byPath = Object.fromEntries(res.testEdits.map((t) => [t.path, t]));
  assert.equal(byPath['tests/test_a.py'].removedAssertions, 1);
  assert.equal(byPath['tests/test_b.py'].status, 'D');
  assert.ok(!byPath['tests/test_new.py']);
  assert.equal(res.flags['tests/test_a.py'][0].level, 'warn');
});

test('self-report: unexplained edits and claims about unchanged files', async () => {
  const root = repo({ 'src/a/Foo.java': 'x\n', 'src/b/Bar.java': 'y\n', 'src/c/Baz.java': 'z\n' });
  write(root, 'src/a/Foo.java', 'x2\n');
  write(root, 'src/b/Bar.java', 'y2\n');
  const changed = await G.changedFiles(root);
  const summary = 'Files changed:\n- `src/a/Foo.java`: fixed the bug\n- Baz.java: also tidied';
  const res = await S.analyzeScope({ root, changed, baseline: {}, summary, knownFiles: await G.projectFiles(root) });
  assert.deepEqual(res.report.unexplained, ['src/b/Bar.java']);
  assert.deepEqual(res.report.claimedButUnchanged, ['Baz.java']);
  assert.ok(res.flags['src/b/Bar.java'].some((f) => f.kind === 'report'));
});

test('self-report accepts a unique basename but not an ambiguous one', async () => {
  const root = repo({ 'a/index.js': '1\n', 'b/index.js': '1\n', 'c/util.js': '1\n' });
  for (const f of ['a/index.js', 'b/index.js', 'c/util.js']) write(root, f, '2\n');
  const res = await S.analyzeScope({ root, changed: await G.changedFiles(root), baseline: {}, summary: 'edited index.js and util.js' });
  assert.deepEqual(res.report.unexplained.sort(), ['a/index.js', 'b/index.js']);
});

test('testStrength / compareStrength: cases, assertions and always-true assertions', () => {
  const good = "import pytest\n# assert nothing here\ndef test_a():\n    assert add(1, 2) == 3\n    assert add(0, 0) == 0\ndef test_b():\n    with pytest.raises(ValueError):\n        add('x', 1)\n";
  assert.deepEqual(S.testStrength(good), { cases: 2, assertions: 3, trivial: 0 });
  const js = "describe('x', () => {\n  it('a', () => { expect(f(1)).toBe(2); });\n  test.each([1])('b', () => { expect(f(2)).toEqual(3); });\n});\n";
  assert.deepEqual(S.testStrength(js), { cases: 2, assertions: 2, trivial: 0 });
  const java = "@Test\nvoid a() { assertEquals(3, add(1, 2)); }\n@ParameterizedTest\nvoid b() { assertThrows(X.class, () -> f()); }\n";
  assert.deepEqual(S.testStrength(java), { cases: 2, assertions: 2, trivial: 0 });
  const empty = "def test_a():\n    assert True\ndef test_b():\n    assert 1 == 1\n";
  const e = S.testStrength(empty);
  assert.equal(e.trivial, 2);
  const cmp = S.compareStrength(S.testStrength(good), e);
  assert.equal(cmp.weaker, true);
  assert.match(cmp.reasons.join(' '), /always-true assertion\(s\) added/);
  assert.match(cmp.reasons.join(' '), /fewer assertion/);
  assert.equal(S.compareStrength(S.testStrength(good), S.testStrength(good + 'def test_c():\n    assert add(2, 2) == 4\n')).weaker, false, 'more tests is not weaker');
  assert.equal(S.testStrength("expect(true).toBe(true)\nexpect(5).toBe(5)\nassertTrue(true)\nassertEquals(x, x)\nassert_eq!(a, a)\n").trivial, 5);
  assert.equal(S.testStrength('expect(f(1)).toBe(1)\nassertEquals(3, add(1, 2))').trivial, 0, 'real assertions are not trivial');
});

test('regression: good tests overwritten by worthless ones are flagged as weakened, even with the same number of lines', async () => {
  const good = "def test_a():\n    assert add(1, 2) == 3\ndef test_b():\n    assert add(2, 2) == 4\ndef test_c():\n    assert add(3, 3) == 6\n";
  const root = repo({ 'src/add.py': 'def add(a, b): return a + b\n', 'tests/test_add.py': good });
  write(root, 'tests/test_add.py', "def test_a():\n    assert True\ndef test_b():\n    assert True\ndef test_c():\n    assert True\n");
  const res = await S.analyzeScope({ root, changed: await G.changedFiles(root) });
  const t = res.testEdits.find((x) => x.path === 'tests/test_add.py');
  assert.equal(t.weaker, true);
  assert.deepEqual(t.before, { cases: 3, assertions: 3, trivial: 0 });
  assert.deepEqual(t.after, { cases: 3, assertions: 0, trivial: 3 });
  assert.match(res.flags['tests/test_add.py'][0].text, /weaker than before/);
  const { evaluateMerge } = require('../src/core/guard');
  const g = evaluateMerge({ result: { findings: [] }, scope: res });
  const item = g.items.find((i) => i.id === 'tests');
  assert.ok(item && item.level === 'block', JSON.stringify(g.items));
  assert.match(item.text, /always-true/);
  // an honest edit that adds a test is only "edited" (info)
  write(root, 'tests/test_add.py', good + "def test_d():\n    assert add(4, 4) == 8\n");
  const ok = await S.analyzeScope({ root, changed: await G.changedFiles(root) });
  assert.equal(ok.testEdits[0].weaker, false);
  assert.equal(ok.flags['tests/test_add.py'][0].level, 'info');
});

test('scope words: @new-tests allows only new test files, @tests any test file', async () => {
  assert.ok(S.inScope('tests/test_a.py', ['@new-tests'], 'A'));
  assert.ok(S.inScope('tests/test_a.py', ['@new-tests'], '?'));
  assert.ok(!S.inScope('tests/test_a.py', ['@new-tests'], 'M'), 'an existing test file may not be replaced');
  assert.ok(!S.inScope('src/a.py', ['@new-tests'], 'A'), 'production code is out of scope');
  assert.ok(S.inScope('tests/test_a.py', ['@tests'], 'M'));
  assert.ok(S.inScope('src/a.py', ['@new-tests', 'src/a.py'], 'M'), 'words combine with paths');
  const root = repo({ 'src/a.py': 'x = 1\n', 'tests/test_old.py': 'def test_a():\n    assert 1 + 1 == 2\n' });
  write(root, 'tests/test_old.py', 'def test_a():\n    pass\n');
  write(root, 'tests/test_new.py', 'def test_b():\n    assert 2 + 2 == 4\n');
  const res = await S.analyzeScope({ root, changed: await G.changedFiles(root), allow: '@new-tests' });
  assert.deepEqual(res.outOfScope, ['tests/test_old.py']);
});
