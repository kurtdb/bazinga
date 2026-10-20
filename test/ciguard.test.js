'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ci = require('../src/core/ciguard');
const { parseArgs } = require('../bin/ide-guard');
const { repo, write, sh } = require('./helpers');

const BIN = path.join(__dirname, '..', 'bin', 'ide-guard.js');
const run = (root, args, env = {}) => spawnSync(process.execPath, [BIN, '--root', root, ...args], { encoding: 'utf8', timeout: 60000, env: { ...process.env, ...env } });

/** main has a service, a test and a pom; the feature branch is made by `change`. */
function project(change, policy) {
  const root = repo({
    'src/main/java/Foo.java': 'class Foo {}\n',
    'src/test/java/FooTest.java': 'class FooTest { @Test void a() { assertEquals(1, 1); } }\n',
    'pom.xml': '<project/>\n',
    ...(policy ? { '.ide/policy.json': JSON.stringify(policy) } : {}),
  });
  sh(root, 'checkout', '-q', '-b', 'agent/fix-npe');
  change(root);
  sh(root, 'add', '-A'); sh(root, 'commit', '-q', '-m', 'change');
  return root;
}

test('parseNameStatus: statuses and paths from -z output', () => {
  assert.deepEqual(ci.parseNameStatus('M\0a/b.java\0A\0c.txt\0D\0d.txt\0'), [{ status: 'M', path: 'a/b.java' }, { status: 'A', path: 'c.txt' }, { status: 'D', path: 'd.txt' }]);
  assert.deepEqual(ci.parseNameStatus(''), []);
});

test('branch with a protected file, a bugfix without test and a pom change is flagged', async () => {
  const root = project((r) => { write(r, '.env', 'X=1\n'); write(r, 'src/main/java/Foo.java', 'class Foo { int x; }\n'); write(r, 'pom.xml', '<project>2</project>\n'); });
  const { guard } = await ci.evaluateBranch({ root, base: 'main', task: 'fix NPE in Foo', branch: 'agent/fix-npe' });
  const ids = guard.items.map((i) => `${i.id}:${i.level}`).sort();
  assert.deepEqual(ids, ['bugfixTest:warn', 'dependencies:warn', 'protectedPaths:block']);
  assert.equal(guard.ok, false);
});

test('a new test satisfies the bugfix rule; weakening an existing test blocks', async () => {
  const good = project((r) => { write(r, 'src/main/java/Foo.java', 'class Foo { int x; }\n'); write(r, 'src/test/java/BarTest.java', 'class BarTest {}\n'); });
  assert.ok((await ci.evaluateBranch({ root: good, base: 'main', task: 'fix bug' })).guard.clean);
  const weak = project((r) => write(r, 'src/test/java/FooTest.java', 'class FooTest { @Test void a() { } }\n'));
  const g = (await ci.evaluateBranch({ root: weak, base: 'main', task: 'refactor' })).guard;
  assert.ok(g.items.some((i) => i.id === 'tests' && i.level === 'block'));
});

test('policy.json is a floor: testsImmutable from the policy cannot be switched off by config.json', async () => {
  const root = project((r) => { write(r, 'src/test/java/FooTest.java', 'class FooTest { @Test void a() { assertEquals(2, 2); } }\n'); write(r, '.ide/config.json', JSON.stringify({ mergeGuard: { testsImmutable: 'off' } })); },
    { mergeGuard: { testsImmutable: 'block' }, protectedPaths: ['pom.xml'] });
  const { guard } = await ci.evaluateBranch({ root, base: 'main', task: 'x' });
  assert.ok(guard.items.some((i) => i.id === 'testsImmutable' && i.level === 'block'));
  assert.ok(!guard.items.some((i) => i.id === 'protectedPaths'), 'pom.xml unchanged here');
});

test('config.json may tighten beyond the policy; policy protectedPaths are added to the defaults', () => {
  const root = repo({ '.ide/policy.json': JSON.stringify({ mergeGuard: { dependencies: 'warn' }, protectedPaths: ['db/**'] }) });
  const e = ci.effectivePolicy(root, { mergeGuard: { dependencies: 'block', bugfixTest: 'off' } });
  assert.equal(e.policy.dependencies, 'block');
  assert.equal(e.policy.bugfixTest, 'off');
  assert.ok(e.protectedGlobs.includes('db/**') && e.protectedGlobs.includes('.env'));
  assert.equal(ci.effectivePolicy(root, { mergeGuard: { dependencies: 'off' } }).policy.dependencies, 'warn', 'cannot go below the floor');
  assert.equal(ci.strictest('block', 'warn'), 'block');
});

test('an oversight preset in policy.json sets the floor', () => {
  const root = repo({ '.ide/policy.json': JSON.stringify({ oversight: 'guided' }) });
  assert.equal(ci.effectivePolicy(root, { mergeGuard: { dependencies: 'off' } }).policy.dependencies, 'block');
});

test('CLI: exit codes, formats, strict, pipeline defaults', () => {
  const root = project((r) => { write(r, '.env', 'X=1\n'); write(r, 'pom.xml', '<p>2</p>\n'); });
  const r1 = run(root, ['--base', 'main']);
  assert.equal(r1.status, 1);
  assert.match(r1.stdout, /BLOCK protectedPaths/);
  assert.match(run(root, ['--base', 'main', '--format', 'azure']).stdout, /##vso\[task\.logissue type=error\]protectedPaths/);
  assert.match(run(root, ['--base', 'main', '--format', 'github']).stdout, /::error title=Bazinga guard::protectedPaths/);
  assert.equal(JSON.parse(run(root, ['--base', 'main', '--format', 'json']).stdout).blockers, 1);

  const warnOnly = project((r) => write(r, 'pom.xml', '<p>2</p>\n'));
  assert.equal(run(warnOnly, ['--base', 'main']).status, 0);
  assert.equal(run(warnOnly, ['--base', 'main', '--strict']).status, 1);

  const bad = run(root, ['--base', 'does-not-exist']);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /fetchDepth|fetch/);

  const a = parseArgs([], { SYSTEM_PULLREQUEST_TARGETBRANCH: 'refs/heads/develop', SYSTEM_PULLREQUEST_SOURCEBRANCH: 'refs/heads/agent/x' });
  assert.equal(a.base, 'origin/develop'); assert.equal(a.branch, 'agent/x');
  assert.equal(parseArgs([], { GITHUB_BASE_REF: 'main' }).base, 'origin/main');
  assert.equal(parseArgs([], {}).base, 'origin/main');
});

test('regression: a PR cannot loosen the guard by editing or deleting .ide/policy.json (the floor is read from the target branch)', async () => {
  const root = project((r) => {
    write(r, '.ide/policy.json', JSON.stringify({ mergeGuard: { dependencies: 'off', protectedPaths: 'off' } })); // the PR "relaxes" the policy ...
    write(r, 'pom.xml', '<project>3</project>\n');                                                             // ... and changes a dependency file
  }, { mergeGuard: { dependencies: 'block' } });
  const { guard } = await ci.evaluateBranch({ root, base: 'main', task: 'x' });
  assert.ok(guard.items.some((i) => i.id === 'dependencies' && i.level === 'block'), 'floor from main still applies');
  assert.ok(guard.items.some((i) => i.id === 'protectedPaths' && i.files.includes('.ide/policy.json')), 'editing the policy is itself flagged');
  const deleted = project((r) => { require('node:fs').rmSync(path.join(r, '.ide', 'policy.json')); write(r, 'pom.xml', '<project>4</project>\n'); }, { mergeGuard: { dependencies: 'block' } });
  assert.ok((await ci.evaluateBranch({ root: deleted, base: 'main', task: 'x' })).guard.items.some((i) => i.id === 'dependencies' && i.level === 'block'));
});

test('export-guard: the exported copy is self-contained and works on its own', () => {
  const { exportGuard } = require('../scripts/export-guard');
  const { tmpdir } = require('./helpers');
  const dest = tmpdir('bz-export-');
  const files = exportGuard(dest);
  assert.ok(files.includes('bin/ide-guard.js') && files.includes('src/core/util.js'));
  const root = project((r) => write(r, '.env', 'X=1\n'));
  const out = spawnSync(process.execPath, [path.join(dest, 'bin', 'ide-guard.js'), '--root', root, '--base', 'main'], { encoding: 'utf8', cwd: tmpdir('bz-cwd-') });
  assert.equal(out.status, 1, out.stderr);
  assert.match(out.stdout, /protectedPaths/);
});
