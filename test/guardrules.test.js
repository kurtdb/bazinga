'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { protectedHits, looksLikeBugfix, bugfixWithoutTest, dependencyFiles, DEFAULT_PROTECTED } = require('../src/core/guardrules');
const { evaluateMerge } = require('../src/core/guard');

const f = (path, status = 'M') => ({ path, status });

test('protectedHits: defaults catch env files, workflows and keys', () => {
  const hits = protectedHits([f('.env'), f('app/.env.local'), f('.github/workflows/ci.yml'), f('certs/a.pem'), f('src/App.java')]);
  assert.deepStrictEqual(hits.sort(), ['.env', '.github/workflows/ci.yml', 'app/.env.local', 'certs/a.pem'].sort());
});

test('protectedHits: custom globs replace defaults; basename globs match anywhere', () => {
  assert.deepStrictEqual(protectedHits([f('a/b/legacy.sql'), f('.env')], ['*.sql']), ['a/b/legacy.sql']);
  assert.deepStrictEqual(protectedHits([f('.env')], []), []);
  assert.ok(DEFAULT_PROTECTED.length > 3);
});

test('looksLikeBugfix: task text and branch names', () => {
  assert.ok(looksLikeBugfix('Fix NPE in OrderService'));
  assert.ok(looksLikeBugfix('', 'agent/fix-login-crash'));
  assert.ok(!looksLikeBugfix('Add pagination to the list endpoint', 'agent/pagination'));
});

test('bugfixWithoutTest: only when source changed and no test touched', () => {
  const task = 'fix the null pointer bug';
  assert.ok(bugfixWithoutTest({ task, files: [f('src/Foo.java')] }));
  assert.ok(!bugfixWithoutTest({ task, files: [f('src/Foo.java'), f('src/test/java/FooTest.java', 'A')] }));
  assert.ok(!bugfixWithoutTest({ task: 'add feature', files: [f('src/Foo.java')] }));
  assert.ok(!bugfixWithoutTest({ task, files: [f('README.md')] }));
  // deleting a test is not adding one
  assert.ok(bugfixWithoutTest({ task, files: [f('src/Foo.java'), f('src/test/java/FooTest.java', 'D')] }));
});

test('dependencyFiles: manifests and lockfiles', () => {
  assert.deepStrictEqual(dependencyFiles([f('pom.xml'), f('web/package.json'), f('src/A.java'), f('go.sum')]).sort(), ['go.sum', 'pom.xml', 'web/package.json']);
});

test('evaluateMerge: new rules produce items at the configured level', () => {
  const scope = { files: [f('.env'), f('pom.xml'), f('src/Foo.java')], outOfScope: [], testEdits: [], report: null };
  const g = evaluateMerge({ result: { findings: [] }, scope, task: 'fix bug in Foo', policy: { protectedPaths: 'block', bugfixTest: 'warn', dependencies: 'warn' } });
  const by = Object.fromEntries(g.items.map((i) => [i.id, i]));
  assert.strictEqual(by.protectedPaths.level, 'block');
  assert.deepStrictEqual(by.protectedPaths.files, ['.env']);
  assert.strictEqual(by.bugfixTest.level, 'warn');
  assert.deepStrictEqual(by.dependencies.files, ['pom.xml']);
  assert.strictEqual(g.ok, false);
  const off = evaluateMerge({ result: { findings: [] }, scope, task: 'fix bug in Foo', policy: { protectedPaths: 'off', bugfixTest: 'off', dependencies: 'off' } });
  assert.ok(!off.items.some((i) => ['protectedPaths', 'bugfixTest', 'dependencies'].includes(i.id)));
});

test('evaluateMerge: protected globs from config are honoured', () => {
  const scope = { files: [f('db/schema.sql')], outOfScope: [], testEdits: [], report: null };
  const g = evaluateMerge({ result: { findings: [] }, scope, protectedGlobs: ['db/**'], policy: { protectedPaths: 'block' } });
  assert.deepStrictEqual(g.items.find((i) => i.id === 'protectedPaths').files, ['db/schema.sql']);
});

test('testsImmutable: any edit or delete of an existing test flags, new tests do not', () => {
  const scope = { files: [f('src/test/java/AIT.java', 'M'), f('src/test/java/B Test.java', 'D'), f('src/test/java/NewTest.java', 'A'), f('src/Foo.java')], outOfScope: [], testEdits: [], report: null };
  const on = evaluateMerge({ result: { findings: [] }, scope, policy: { testsImmutable: 'block' } });
  const it = on.items.find((i) => i.id === 'testsImmutable');
  assert.ok(it && it.level === 'block');
  assert.ok(!it.files.includes('src/test/java/NewTest.java'));
  assert.strictEqual(it.files.length, 2);
  assert.ok(!evaluateMerge({ result: { findings: [] }, scope }).items.some((i) => i.id === 'testsImmutable'), 'off by default');
});
