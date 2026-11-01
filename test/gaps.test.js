'use strict';
// Regression and edge-case tests for paths that the feature tests do not reach.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const G = require('../src/core/git');
const R = require('../src/core/runs');
const H = require('../src/core/history');
const T = require('../src/core/testcmd');
const P = require('../src/core/parsers');
const PR = require('../src/core/pr');
const D = require('../src/core/dupes');
const C = require('../src/core/config');
const U = require('../src/core/util');
const { runChecks } = require('../src/core/checks');
const { repo, write, sh, tmpdir } = require('./helpers');

const posix = process.platform !== 'win32';

// ---------------------------------------------------------------- git
test('git: paths git has to quote (a double quote in the name) come back unquoted', { skip: !posix }, async () => {
  const root = repo({ 'a.txt': 'x\n' });
  write(root, 'we"ird.txt', 'hi\n');
  const files = (await G.changedFiles(root)).map((f) => f.path);
  assert.ok(files.includes('we"ird.txt'), JSON.stringify(files));
});

test('git: unstage works in a repository without any commit (git rm --cached path)', async () => {
  const root = repo({}, { commit: false });
  write(root, 'n.txt', 'new\n');
  await G.stage(root, ['n.txt']);
  assert.equal((await G.changedFiles(root)).find((f) => f.path === 'n.txt').staged, true);
  await G.unstage(root, ['n.txt']);
  const f = (await G.changedFiles(root)).find((x) => x.path === 'n.txt');
  assert.equal(f.status, '?');
  assert.ok(!f.staged);
});

test('git: commit needs a message and reports what git said when there is nothing to commit', async () => {
  const root = repo();
  await assert.rejects(G.commit(root, '   '), /Enter a commit message/);
  await assert.rejects(G.commit(root, 'msg'), (e) => /nothing (added )?to commit|no changes/i.test(e.message) && !/Command failed/.test(e.message), 'regression: the message used to be "Command failed: git commit -m msg"');
  write(root, 'a.txt', 'two\n'); await G.stageAll(root);
  assert.ok((await G.commit(root, 'second')).length > 0);
});

test('git: revertFile restores, removes staged-new, deletes untracked, and refuses paths outside the project', async () => {
  const root = repo({ 'a.txt': 'one\n' });
  write(root, 'a.txt', 'changed\n');
  assert.equal(await G.revertFile(root, 'a.txt'), 'restored');
  assert.equal(fs.readFileSync(path.join(root, 'a.txt'), 'utf8'), 'one\n');
  write(root, 'staged.txt', 's'); await G.stage(root, ['staged.txt']);
  assert.equal(await G.revertFile(root, 'staged.txt'), 'removed');
  assert.ok(!fs.existsSync(path.join(root, 'staged.txt')));
  write(root, 'loose.txt', 'l');
  assert.equal(await G.revertFile(root, 'loose.txt'), 'deleted');
  fs.writeFileSync(path.join(path.dirname(root), 'outside.txt'), 'keep me');
  await assert.rejects(G.revertFile(root, '../outside.txt'), /outside the project/);
  assert.ok(fs.existsSync(path.join(path.dirname(root), 'outside.txt')), 'the file outside was not touched');
});

test('git: projectFiles lists tracked + untracked, honours .gitignore, and falls back to a walk without git', async () => {
  const root = repo({ 'src/a.js': '1', '.gitignore': 'secret.txt\n' });
  write(root, 'new.js', '2'); write(root, 'secret.txt', 'no'); write(root, 'node_modules/x/i.js', 'no');
  const files = await G.projectFiles(root);
  assert.ok(files.includes('src/a.js') && files.includes('new.js'));
  assert.ok(!files.includes('secret.txt') && !files.some((f) => f.startsWith('node_modules')));
  const plain = tmpdir(); write(plain, 'p/q.txt', '1'); write(plain, 'node_modules/z.js', '1');
  const walked = await G.projectFiles(plain);
  assert.deepEqual(walked.filter((f) => !f.startsWith('.')), ['p/q.txt']);
  assert.equal((await G.projectFiles(root, 1)).length, 1, 'limit is honoured');
});

// ---------------------------------------------------------------- runs
test('runs: linkDirs are symlinked into the worktree (node_modules shared, not copied)', { skip: !posix }, async () => {
  const root = repo({ 'a.txt': 'x\n' });
  write(root, 'node_modules/pkg/index.js', 'module.exports = 1;');
  const run = await R.createRun(root, { name: 'link', task: 't', linkDirs: ['node_modules', 'does-not-exist'] });
  assert.ok(fs.lstatSync(path.join(run.root, 'node_modules')).isSymbolicLink());
  assert.ok(fs.existsSync(path.join(run.root, 'node_modules', 'pkg', 'index.js')));
  assert.ok(!fs.existsSync(path.join(run.root, 'does-not-exist')));
});

test('runs: merge without squash keeps the run history as a merge commit; discarding removes branch and folder', async () => {
  const root = repo({ 'a.txt': 'x\n' });
  const run = await R.createRun(root, { name: 'keep history', task: 't' });
  write(run.root, 'f.txt', '1'); sh(run.root, 'add', '.'); sh(run.root, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'agent commit');
  await R.mergeRun(root, run.id, { message: 'merged', squash: false });
  assert.match(sh(root, 'log', '--format=%s %p', '-1'), /^merged \S+ \S+/, 'merge commit has two parents');
  assert.ok(sh(root, 'log', '--format=%s').includes('agent commit'));
  const r2 = await R.createRun(root, { name: 'drop', task: 't' });
  await R.removeRun(root, r2.id);
  assert.ok(!fs.existsSync(r2.top));
  assert.equal(sh(root, 'branch', '--list', r2.branch).trim(), '');
});

test('runs: merging with a dirty main checkout or an empty run is refused', async () => {
  const root = repo({ 'a.txt': 'x\n' });
  const run = await R.createRun(root, { name: 'empty', task: 't' });
  await assert.rejects(R.mergeRun(root, run.id), /no changes to merge/);
  write(root, 'a.txt', 'dirty');
  await assert.rejects(R.mergeRun(root, run.id), /uncommitted changes/);
  await assert.rejects(R.findRun(root, 'nope'), /Unknown agent run/);
});

// ---------------------------------------------------------------- history (stash)
test('history: stash push / apply / pop / drop round trip, with untracked files', async () => {
  const root = repo({ 'a.txt': 'one\n' });
  write(root, 'a.txt', 'two\n'); write(root, 'u.txt', 'untracked\n');
  await H.stashPush(root, 'my stash');
  assert.equal(fs.readFileSync(path.join(root, 'a.txt'), 'utf8'), 'one\n');
  assert.ok(!fs.existsSync(path.join(root, 'u.txt')));
  let list = await H.stashList(root);
  assert.equal(list.length, 1); assert.match(list[0].subject, /my stash/);
  await H.stashApply(root, list[0].ref);
  assert.equal(fs.readFileSync(path.join(root, 'a.txt'), 'utf8'), 'two\n');
  assert.equal((await H.stashList(root)).length, 1, 'apply keeps the stash');
  sh(root, 'checkout', '--', 'a.txt'); fs.rmSync(path.join(root, 'u.txt'));
  await H.stashPop(root, list[0].ref);
  assert.equal((await H.stashList(root)).length, 0, 'pop removes it');
  await H.stashPush(root, '');
  list = await H.stashList(root);
  assert.match(list[0].subject, /Bazinga stash/);
  await H.stashDrop(root, list[0].ref);
  assert.equal((await H.stashList(root)).length, 0);
  await assert.rejects(H.stashDrop(root, 'stash@{0; rm -rf /}'), /./, 'refs are validated');
});

// ---------------------------------------------------------------- test commands
test('testcmd: Gradle project without wrapper, Gradle with wrapper, unknown language', () => {
  const g = tmpdir(); write(g, 'build.gradle', ''); write(g, 'src/test/java/a/FooTest.java', '');
  const t = { name: 'works', kind: 'test', suite: 'FooTest' };
  assert.equal(T.testCommand(g, 'src/test/java/a/FooTest.java', t, { shellKind: 'posix' }).command, `gradle test --tests '*FooTest.works'`);
  write(g, 'gradlew', '');
  const w = T.testCommand(g, 'src/test/java/a/FooTest.java', t, { shellKind: 'powershell' });
  assert.match(w.command, /^\.\\gradlew test --tests '\*FooTest\.works'$/);
  assert.equal(T.testCommand(g, 'x.clj', t, {}), null);
  assert.equal(T.testCommand(tmpdir(), 'src/FooTest.java', t, {}), null, 'no build file: nothing to run');
  assert.equal(T.fileTestCommand(g, 'x.clj', { content: 'test' }), null);
  assert.equal(T.fileTestCommand(g, 'src/test/java/a/FooTest.java', { content: 'class FooTest {}' }), null, 'no @Test in it');
});

// ---------------------------------------------------------------- parsers
test('parsers: a failed pytest test in JUnit XML is located from the traceback line "path.py:12:"', () => {
  const xml = `<testsuite><testcase classname="tests.test_x" name="test_a"><failure message="assert 1 == 2">
def test_a():
>       assert 1 == 2
E       assert 1 == 2

tests/test_x.py:7: AssertionError
</failure></testcase></testsuite>`;
  const out = P.reportParsers.junit(xml, { files: () => ['tests/test_x.py'] });
  assert.equal(out.length, 1);
  assert.equal(out[0].severity, 'error');
  assert.equal(out[0].line, 7);
});

// ---------------------------------------------------------------- dupes
test('dupes: a Vue/Svelte file counts as a component named after its file (capitalised only)', () => {
  assert.deepEqual(D.parseComponents('src/UserCard.vue', '<template/>'), [{ name: 'UserCard', line: 1 }]);
  assert.deepEqual(D.parseComponents('src/index.vue', '<template/>'), []);
  assert.deepEqual(D.parseComponents('src/Pane.svelte', ''), [{ name: 'Pane', line: 1 }]);
  assert.deepEqual(D.parseComponents('src/util.js', 'export const a = 1;'), []);
});

// ---------------------------------------------------------------- config
test('config: withDefaults fills missing keys of nested option objects and tolerates null', () => {
  const d = C.DEFAULT_CONFIG.fixLoop;
  assert.deepEqual(C.withDefaults({ fixLoop: { maxRounds: 9 } }, 'fixLoop'), { ...d, maxRounds: 9 });
  assert.deepEqual(C.withDefaults(null, 'fixLoop'), d);
  assert.deepEqual(C.withDefaults({}, 'fixLoop'), d);
});

// ---------------------------------------------------------------- util
test('util: killTree ends the whole process group, grandchildren included', { skip: !posix }, async () => {
  const child = spawn('sh', ['-c', 'sleep 60 & echo $!; wait'], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
  const grandchild = await new Promise((res) => child.stdout.once('data', (d) => res(Number(String(d).trim()))));
  U.killTree(child);
  await new Promise((r) => setTimeout(r, 300));
  const alive = (pid) => { try { process.kill(pid, 0); } catch { return false; } try { return !/^\d+ \(.*\) Z/.test(fs.readFileSync(`/proc/${pid}/stat`, 'utf8')); } catch { return true; } }; // a zombie is dead too
  assert.equal(alive(grandchild), false, 'grandchild is gone');
  U.killTree(child); U.killTree(null); U.killTree({}); // harmless when already gone / nothing given
});

// ---------------------------------------------------------------- checks: report file written by the command
test('checks: a command can write a SARIF report into {tmpdir}; findings are read and the folder is removed', async () => {
  const root = repo({ 'a.py': 'x = 1\n' });
  write(root, 'a.py', 'x = 2\n');
  write(root, 'tools/rep.js', `const fs = require('fs'), path = require('path');
fs.writeFileSync(path.join(process.argv[2], 'out.sarif'), JSON.stringify({ runs: [{ tool: { driver: { name: 'x' } }, results: [{ ruleId: 'R1', level: 'error', message: { text: 'leaked key' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'a.py' }, region: { startLine: 1 } } }] }] }] }));
console.log('wrote ' + process.argv[2]);`);
  write(root, '.ide/checks.yaml', `useDefaults: false
checks:
  - name: Reporter
    match: ["*.py"]
    scope: project
    run: "node tools/rep.js {tmpdir}"
    parser: exitcode
    tmpReport: out.sarif
    reportFormat: sarif
`);
  const res = await runChecks(root, { tier: 'all', files: 'changed' });
  assert.ok(res.findings.some((f) => f.message.includes('leaked key') && f.file === 'a.py'), JSON.stringify(res.findings));
  // the temporary folder is gone afterwards
  const used = (res.runs[0].output || '').match(/wrote (.+)/);
  if (used) assert.ok(!fs.existsSync(used[1].trim()));
});

test('checks: a missing report file is not an error by itself', async () => {
  const root = repo({ 'a.py': 'x = 1\n' }); write(root, 'a.py', 'x = 2\n');
  write(root, '.ide/checks.yaml', `useDefaults: false
checks:
  - name: Silent
    match: ["*.py"]
    scope: project
    run: "node -e \\"0\\" {tmpdir}"
    parser: exitcode
    tmpReport: nothing.sarif
    reportFormat: sarif
`);
  const res = await runChecks(root, { tier: 'all', files: 'changed' });
  assert.equal(res.counts.error, 0);
});

// ---------------------------------------------------------------- pull request: push failure
test('pr: a failing push is reported with git’s own words and nothing is opened', async () => {
  const root = repo({ 'a.txt': 'x\n' });
  sh(root, 'remote', 'add', 'origin', path.join(tmpdir(), 'no-such-remote.git'));
  const run = await R.createRun(root, { name: 'pushfail', task: 't' });
  write(run.root, 'f.txt', 'new');
  await assert.rejects(PR.createPr(root, run.id, { title: 't' }), /git push failed/);
  const none = repo({ 'a.txt': 'x\n' });
  const r2 = await R.createRun(none, { name: 'noorigin', task: 't' });
  await assert.rejects(PR.createPr(none, r2.id, {}), /no "origin" remote/);
});
