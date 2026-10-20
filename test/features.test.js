'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const G = require('../src/core/git');
const { runChecks, mavenModuleArgs } = require('../src/core/checks');
const { loadConfig } = require('../src/core/config');
const { runShell, matchesAny, findFiles, which } = require('../src/core/util');
const { search } = require('../src/core/search');
const { buildReviewPrompt, runReview } = require('../src/core/review');
const { reportParsers, maven } = require('../src/core/parsers');

const CLI = path.join(__dirname, '..', 'bin', 'ide-check.js');
const sh = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' });
const write = (root, rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');

function repo(files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bazinga-f-'));
  sh(root, 'init', '-q');
  sh(root, 'config', 'user.email', 't@t');
  sh(root, 'config', 'user.name', 't');
  for (const [rel, text] of Object.entries(files)) write(root, rel, text);
  if (Object.keys(files).length) { sh(root, 'add', '.'); sh(root, 'commit', '-q', '-m', 'init'); }
  return root;
}

// Fake linter: reports "<file>:<line>:1: error: x" for each line number in $LINES, for every file argument.
const LINT_LINES = `
const lines = (process.env.LINES || '1').split(',');
for (const f of process.argv.slice(2)) for (const l of lines) console.log(f + ':' + l + ':1: error: problem on line ' + l);
`;
const REGEX_CHECK = (extra = '') => `useDefaults: false
checks:
  - name: Lint
    match: ["*.py"]
    run: node lint-lines.js {files}
    parser: regex
    pattern: '^(?<file>.+?):(?<line>\\d+):(?<column>\\d+): (?<severity>\\w+): (?<message>.*)$'
    ${extra}
`;

const TEN_LINES = Array.from({ length: 10 }, (_, i) => `line${i + 1}`).join('\n') + '\n';

// ---------------------------------------------------------------- 1. only-my-changes filtering

test('changedFiles distinguishes staged and unstaged changes', async () => {
  const root = repo({ 'a.py': 'a\n', 'b.py': 'b\n' });
  write(root, 'a.py', 'a2\n'); sh(root, 'add', 'a.py');
  write(root, 'b.py', 'b2\n');
  write(root, 'c.py', 'c\n');
  const by = Object.fromEntries((await G.changedFiles(root)).map((f) => [f.path, f]));
  assert.deepEqual([by['a.py'].staged, by['a.py'].unstaged], [true, false]);
  assert.deepEqual([by['b.py'].staged, by['b.py'].unstaged], [false, true]);
  assert.deepEqual([by['c.py'].staged, by['c.py'].unstaged], [false, true]);
});

test('changedLineMap: hunks, deletions and untracked files', async () => {
  const root = repo({ 'lib.py': TEN_LINES });
  write(root, 'lib.py', TEN_LINES.replace('line2\n', 'CHANGED\n').replace('line9\n', '')); // edit line 2, delete line 9
  write(root, 'new.py', 'x\ny\n');
  const map = await G.changedLineMap(root);
  assert.equal(map.get('new.py'), 'all');
  assert.ok(G.isChangedLine(map, 'lib.py', 2));
  assert.ok(!G.isChangedLine(map, 'lib.py', 5));
  assert.ok(G.isChangedLine(map, 'lib.py', 8)); // the line right after the deletion gap
  assert.ok(!G.isChangedLine(map, 'untouched.py', 1));
});

test('findings on lines you did not touch are legacy and not counted; --all-findings counts them', async () => {
  const root = repo({ 'lib.py': TEN_LINES });
  write(root, 'lint-lines.js', LINT_LINES);
  write(root, '.ide/checks.yaml', REGEX_CHECK());
  write(root, 'lib.py', TEN_LINES.replace('line4\n', 'edited4\n'));
  process.env.LINES = '1,4';
  try {
    const res = await runChecks(root, { tier: 'all' });
    const by = Object.fromEntries(res.findings.filter((f) => f.file === 'lib.py').map((f) => [f.line, f]));
    assert.equal(by[1].legacy, true);
    assert.equal(by[4].legacy, false);
    assert.equal(res.counts.error, 1 + 0); // lib.py:4 only (lint-lines.js itself is untracked, but it is not a .py file)
    assert.equal(res.counts.legacy, 1);

    const all = await runChecks(root, { tier: 'all', changedLinesOnly: false });
    assert.equal(all.counts.error, 2);
    assert.equal(all.counts.legacy, 0);

    // hook mode ignores legacy issues unless asked
    write(root, 'lib.py', TEN_LINES.replace('line7\n', 'edited7\n'));
    process.env.LINES = '1';
    const quiet = spawnSync('node', [CLI, '--hook', '--root', root], { encoding: 'utf8', input: '{}' });
    assert.equal(quiet.status, 0, quiet.stderr);
    const strict = spawnSync('node', [CLI, '--hook', '--all-findings', '--root', root], { encoding: 'utf8', input: '{}' });
    assert.equal(strict.status, 2);
  } finally { delete process.env.LINES; }
});

test('project-scope findings (compile/type errors) are never legacy', async () => {
  const root = repo({ 'lib.py': TEN_LINES });
  write(root, '.ide/checks.yaml', `useDefaults: false
checks:
  - name: Compiler
    match: ["*.py"]
    scope: project
    run: "node -e \\"console.log('other.py:50:1: error: broken by your change')\\""
    parser: regex
    pattern: '^(?<file>.+?):(?<line>\\d+):(?<column>\\d+): (?<severity>\\w+): (?<message>.*)$'
`);
  write(root, 'lib.py', TEN_LINES.replace('line1\n', 'x\n'));
  const res = await runChecks(root, { tier: 'all' });
  assert.equal(res.counts.error, 1);
  assert.equal(res.findings[0].legacy, false);
});

// ---------------------------------------------------------------- 4. real cancel + stdin

test('aborting a run kills the running tool and stops the remaining gates', async () => {
  const root = repo({ 'a.py': 'a\n' });
  write(root, 'a.py', 'b\n');
  write(root, '.ide/checks.yaml', `useDefaults: false
checks:
  - { name: Slow, match: ["*.py"], scope: project, run: 'node -e "setTimeout(() => {}, 60000)"' }
  - { name: Never, match: ["*.py"], scope: project, run: 'node -e "0"' }
`);
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 600);
  const t0 = Date.now();
  const res = await runChecks(root, { tier: 'all', signal: ac.signal });
  assert.ok(Date.now() - t0 < 8000, 'should not wait for the 60s tool');
  assert.equal(res.cancelled, true);
  assert.deepEqual(res.runs.map((r) => `${r.name}:${r.status}`), ['Slow:cancelled']);
});

test('runShell closes stdin (tools never hang waiting for it) and can feed input', async () => {
  const eof = await runShell('node -e "process.stdin.on(\'end\',()=>console.log(\'EOF\'));process.stdin.resume()"', { timeoutMs: 10000 });
  assert.match(eof.stdout, /EOF/);
  const echo = await runShell('node -e "let s=\'\';process.stdin.on(\'data\',d=>s+=d).on(\'end\',()=>console.log(s.toUpperCase()))"', { input: 'hello', timeoutMs: 10000 });
  assert.match(echo.stdout, /HELLO/);
});

// ---------------------------------------------------------------- 3. Java feedback: reports, modules

const SUREFIRE = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="com.acme.FooTest" tests="2" failures="1">
  <testcase name="shouldAdd" classname="com.acme.FooTest" time="0.01"/>
  <testcase name="shouldSubtract" classname="com.acme.FooTest" time="0.02">
    <failure message="expected: &lt;3&gt; but was: &lt;4&gt;" type="org.opentest4j.AssertionFailedError"><![CDATA[org.opentest4j.AssertionFailedError: expected: <3> but was: <4>
	at org.junit.jupiter.api.AssertionUtils.fail(AssertionUtils.java:55)
	at com.acme.Foo.subtract(Foo.java:12)
	at com.acme.FooTest.shouldSubtract(FooTest.java:21)
]]></failure>
  </testcase>
  <testcase name="skipped" classname="com.acme.FooTest"><skipped/></testcase>
</testsuite>`;

test('JUnit report: a failing test becomes a finding at the test file and line', () => {
  const files = ['src/main/java/com/acme/Foo.java', 'src/test/java/com/acme/FooTest.java'];
  const f = reportParsers.junit(SUREFIRE, { files: () => files });
  assert.equal(f.length, 1);
  assert.equal(f[0].file, 'src/test/java/com/acme/FooTest.java');
  assert.equal(f[0].line, 21);
  assert.equal(f[0].severity, 'error');
  assert.match(f[0].message, /FooTest\.shouldSubtract: expected: <3> but was: <4>/);
  assert.match(f[0].detail, /Foo\.java:12/);
});

test('JUnit report from pytest: location comes from the traceback', () => {
  const xml = `<testsuites><testsuite name="pytest"><testcase classname="tests.test_calc.TestCalc" name="test_add" time="0.001">
<failure message="assert 3 == 4">self = &lt;x&gt;
    def test_add(self):
&gt;       assert add(1, 2) == 4
E       assert 3 == 4
tests/test_calc.py:12: AssertionError</failure></testcase></testsuite></testsuites>`;
  const f = reportParsers.junit(xml, { files: () => [] });
  assert.deepEqual([f[0].file, f[0].line], ['tests/test_calc.py', 12]);
  assert.match(f[0].message, /TestCalc\.test_add/);
});

test('SpotBugs, PMD and Checkstyle XML reports', () => {
  const sb = `<BugCollection><BugInstance type="NP_NULL_ON_SOME_PATH" priority="1" category="CORRECTNESS">
<ShortMessage>Possible null pointer dereference</ShortMessage><LongMessage>Possible null pointer dereference in com.acme.Foo.bar()</LongMessage>
<SourceLine classname="com.acme.Foo" start="30" end="30" sourcepath="com/acme/Foo.java" primary="true"/></BugInstance></BugCollection>`;
  const s = reportParsers.spotbugs(sb, { files: () => ['module/src/main/java/com/acme/Foo.java'] });
  assert.deepEqual([s[0].file, s[0].line, s[0].severity, s[0].rule], ['module/src/main/java/com/acme/Foo.java', 30, 'error', 'NP_NULL_ON_SOME_PATH']);

  const pm = `<pmd><file name="/p/src/A.java"><violation beginline="5" begincolumn="9" rule="UnusedPrivateField" priority="3">Avoid unused private fields such as 'x'.</violation></file></pmd>`;
  const p = reportParsers.pmd(pm);
  assert.deepEqual([p[0].file, p[0].line, p[0].column, p[0].severity, p[0].rule], ['/p/src/A.java', 5, 9, 'warning', 'UnusedPrivateField']);

  const cs = `<checkstyle><file name="/p/src/A.java"><error line="7" column="3" severity="warning" message="Missing a Javadoc comment." source="com.puppycrawl.tools.checkstyle.checks.javadoc.MissingJavadocMethodCheck"/><error line="9" severity="ignore" message="x" source="y"/></file></checkstyle>`;
  const c = reportParsers.checkstyle(cs);
  assert.equal(c.length, 1);
  assert.deepEqual([c[0].line, c[0].rule], [7, 'MissingJavadocMethod']);
});

test('Maven parser also reads Checkstyle-style [WARN] lines', () => {
  const f = maven('[WARN] /p/src/A.java:[12,5] (whitespace) WhitespaceAround: oops\n[ERROR] /p/src/B.java:[3,1] cannot find symbol');
  assert.deepEqual(f.map((x) => [x.severity, x.rule, x.line]), [['warning', 'whitespace', 12], ['error', 'javac', 3]]);
});

test('a check can read a report written by the command: failing test shows up as a located finding', async () => {
  const root = repo({ 'src/test/java/com/acme/FooTest.java': '// test\n', 'src/main/java/com/acme/Foo.java': '// main\n' });
  write(root, 'src/main/java/com/acme/Foo.java', '// main changed\n');
  write(root, 'write-report.js', `
const fs = require('fs');
fs.mkdirSync('module/target/surefire-reports', { recursive: true });
fs.writeFileSync('module/target/surefire-reports/TEST-com.acme.FooTest.xml', ${JSON.stringify(SUREFIRE)});
process.exit(1);`);
  write(root, '.ide/checks.yaml', `useDefaults: false
checks:
  - name: Tests
    match: ["*.java"]
    scope: project
    run: node write-report.js
    parser: exitcode
    reports: ["**/target/surefire-reports/TEST-*.xml"]
    reportFormat: junit
`);
  const res = await runChecks(root, { tier: 'all' });
  assert.equal(res.runs[0].status, 'findings');
  assert.equal(res.findings.length, 1, 'no extra generic "exit 1" finding when the report explains the failure');
  assert.deepEqual([res.findings[0].file, res.findings[0].line], ['src/test/java/com/acme/FooTest.java', 21]);
});

test('stale reports from an earlier run are ignored', async () => {
  const root = repo({ 'a.java': 'x\n' });
  write(root, 'a.java', 'y\n');
  write(root, 'target/surefire-reports/TEST-old.xml', SUREFIRE);
  const old = new Date(Date.now() - 3600 * 1000);
  fs.utimesSync(path.join(root, 'target/surefire-reports/TEST-old.xml'), old, old);
  write(root, '.ide/checks.yaml', `useDefaults: false
checks:
  - name: Tests
    match: ["*.java"]
    scope: project
    run: node -e "0"
    reports: ["**/target/surefire-reports/TEST-*.xml"]
`);
  const res = await runChecks(root, { tier: 'all' });
  assert.equal(res.runs[0].status, 'passed');
});

test('mavenModuleArgs narrows a multi-module build to the changed modules', () => {
  const root = repo();
  write(root, 'pom.xml', '<project><modules><module>mod-a</module><module>mod-b</module></modules></project>');
  write(root, 'mod-a/pom.xml', '<project/>');
  write(root, 'mod-b/pom.xml', '<project/>');
  assert.deepEqual(mavenModuleArgs(root, ['mod-a/src/main/java/A.java', 'mod-b/src/test/java/BTest.java']), { modules: '-pl "mod-a,mod-b" -am', modulesOnly: '-pl "mod-a,mod-b"' });
  assert.deepEqual(mavenModuleArgs(root, ['mod-a/src/main/java/A.java', 'README.md']), { modules: '-pl "mod-a" -am', modulesOnly: '-pl "mod-a"' });
  assert.equal(mavenModuleArgs(root, ['pom.xml']).modules, '', 'root pom change builds everything');
  assert.equal(mavenModuleArgs(root, ['src/main/java/Root.java']).modules, '', 'root module source builds everything');
  const single = repo();
  write(single, 'pom.xml', '<project/>');
  assert.equal(mavenModuleArgs(single, ['src/main/java/A.java']).modules, '');
});

test('{modules} is expanded in the command line', async () => {
  const root = repo({
    'pom.xml': '<project><modules><module>mod-a</module></modules></project>',
    'mod-a/pom.xml': '<project/>',
    'mod-a/src/main/java/A.java': 'x\n',
  });
  write(root, 'mod-a/src/main/java/A.java', 'y\n');
  write(root, 'dump.js', "require('fs').writeFileSync('args.json', JSON.stringify(process.argv.slice(2)));");
  write(root, '.ide/checks.yaml', `useDefaults: false
checks:
  - name: Build
    match: ["*.java"]
    scope: project
    run: node dump.js {modules} compile
`);
  await runChecks(root, { tier: 'all' });
  assert.deepEqual(JSON.parse(read(root, 'args.json')), ['-pl', 'mod-a', '-am', 'compile']);
});

test('glob helpers: **/ matches zero or more directories; findFiles looks inside target/', () => {
  assert.ok(matchesAny('A.java', ['**/*.java']));
  assert.ok(matchesAny('x/y/A.java', ['**/*.java']));
  assert.ok(!matchesAny('x/y/A.kt', ['**/*.java']));
  const root = repo();
  write(root, 'm/target/surefire-reports/TEST-a.xml', '<x/>');
  write(root, 'node_modules/x/target/surefire-reports/TEST-b.xml', '<x/>');
  assert.deepEqual(findFiles(root, ['**/target/surefire-reports/TEST-*.xml']), ['m/target/surefire-reports/TEST-a.xml']);
});

// ---------------------------------------------------------------- 2. stage, commit, revert, checkpoints

test('stage, unstage and commit', async () => {
  const root = repo({ 'a.py': 'a\n' });
  write(root, 'a.py', 'a2\n');
  write(root, 'b.py', 'b\n');
  await G.stage(root, ['a.py']);
  let by = Object.fromEntries((await G.changedFiles(root)).map((f) => [f.path, f]));
  assert.equal(by['a.py'].staged, true);
  await G.unstage(root, ['a.py']);
  by = Object.fromEntries((await G.changedFiles(root)).map((f) => [f.path, f]));
  assert.equal(by['a.py'].staged, false);
  await assert.rejects(() => G.commit(root, '   '), /commit message/);
  await G.stageAll(root);
  await G.commit(root, 'add stuff');
  assert.deepEqual(await G.changedFiles(root), []);
  assert.match(sh(root, 'log', '-1', '--pretty=%s'), /add stuff/);
});

test('revertFile: tracked, staged-new and untracked files', async () => {
  const root = repo({ 'a.py': 'original\n' });
  write(root, 'a.py', 'agent edit\n');
  sh(root, 'add', 'a.py');
  write(root, 'a.py', 'agent edit 2\n');
  assert.equal(await G.revertFile(root, 'a.py'), 'restored');
  assert.equal(read(root, 'a.py'), 'original\n');
  assert.deepEqual(await G.changedFiles(root), []);

  write(root, 'new.py', 'x\n');
  sh(root, 'add', 'new.py');
  assert.equal(await G.revertFile(root, 'new.py'), 'removed');
  assert.ok(!fs.existsSync(path.join(root, 'new.py')));

  write(root, 'scratch.py', 'x\n');
  assert.equal(await G.revertFile(root, 'scratch.py'), 'deleted');
  assert.ok(!fs.existsSync(path.join(root, 'scratch.py')));
  assert.deepEqual(await G.changedFiles(root), []);
});

test('checkpoints snapshot everything without touching the index, and restore undoes the agent', async () => {
  const root = repo({ 'keep.py': 'keep\n', 'edit.py': 'v1\n', 'gone.py': 'gone\n' });
  write(root, 'edit.py', 'v2 (before agent)\n');
  write(root, 'scratch.txt', 'my untracked notes\n');
  const statusBefore = sh(root, 'status', '--porcelain');
  const cp = await G.createCheckpoint(root, 'before Claude');
  assert.equal(sh(root, 'status', '--porcelain'), statusBefore, 'creating a checkpoint must not change the working tree or index');
  assert.equal(sh(root, 'rev-list', '--count', 'HEAD').trim(), '1', 'checkpoints must not add commits to the branch');

  // the "agent" edits, deletes and creates files
  write(root, 'edit.py', 'agent rewrote this\n');
  fs.unlinkSync(path.join(root, 'gone.py'));
  write(root, 'agent_new.py', 'new\n');
  write(root, 'pkg/deep/agent_new2.py', 'new\n');

  const list = await G.listCheckpoints(root);
  assert.equal(list.length, 1);
  assert.equal(list[0].label, 'before Claude');

  const res = await G.restoreCheckpoint(root, cp.id);
  assert.equal(read(root, 'edit.py'), 'v2 (before agent)\n');
  assert.equal(read(root, 'gone.py'), 'gone\n');
  assert.equal(read(root, 'scratch.txt'), 'my untracked notes\n', 'pre-existing untracked files survive');
  assert.ok(!fs.existsSync(path.join(root, 'agent_new.py')));
  assert.ok(!fs.existsSync(path.join(root, 'pkg/deep/agent_new2.py')));
  assert.deepEqual(res.removed.sort(), ['agent_new.py', 'pkg/deep/agent_new2.py']);

  // the restore itself is undoable: a safety checkpoint holds the agent's version
  assert.equal((await G.listCheckpoints(root)).length, 2);
  await G.restoreCheckpoint(root, res.safetyCheckpoint);
  assert.equal(read(root, 'edit.py'), 'agent rewrote this\n');
  assert.ok(fs.existsSync(path.join(root, 'agent_new.py')));

  await G.deleteCheckpoint(root, cp.id);
  assert.ok(!(await G.listCheckpoints(root)).some((c) => c.id === cp.id));
});

test('checkpoints work in a repository with no commits yet', async () => {
  const root = repo();
  write(root, 'a.py', 'a\n');
  const cp = await G.createCheckpoint(root, 'empty repo');
  write(root, 'a.py', 'changed\n');
  write(root, 'b.py', 'b\n');
  await G.restoreCheckpoint(root, cp.id);
  assert.equal(read(root, 'a.py'), 'a\n');
  assert.ok(!fs.existsSync(path.join(root, 'b.py')));
});

// ---------------------------------------------------------------- 6. search

test('search (JS engine): plain, case-insensitive and regex; skips ignored and binary files', async () => {
  const root = repo({ 'src/a.py': 'def Hello():\n    return 1\n', 'src/b.py': 'hello = 2\n', '.gitignore': 'node_modules/\n' });
  write(root, 'node_modules/x/hello.js', 'hello\n');
  fs.writeFileSync(path.join(root, 'bin.dat'), Buffer.from([104, 101, 108, 108, 111, 0, 1, 2]));
  const plain = await search(root, { query: 'hello', engine: 'js' });
  assert.deepEqual(plain.results.map((r) => `${r.file}:${r.line}`).sort(), ['src/a.py:1', 'src/b.py:1']);
  const cs = await search(root, { query: 'hello', caseSensitive: true, engine: 'js' });
  assert.deepEqual(cs.results.map((r) => r.file), ['src/b.py']);
  const re = await search(root, { query: 'def \\w+\\(', regex: true, engine: 'js' });
  assert.equal(re.results[0].column, 1);
  assert.ok((await search(root, { query: '(', regex: true, engine: 'js' })).error);
  assert.deepEqual((await search(root, { query: '' })).results, []);
});

test('search with ripgrep gives the same hits (when rg is installed)', { skip: !which('rg') }, async () => {
  const root = repo({ 'src/a.py': 'def Hello():\n', 'src/b.py': 'hello = 2\n' });
  const res = await search(root, { query: 'hello', engine: 'rg' });
  assert.equal(res.engine, 'rg');
  assert.deepEqual(res.results.map((r) => `${r.file}:${r.line}`).sort(), ['src/a.py:1', 'src/b.py:1']);
});

test('projectFiles lists tracked + untracked files and honours .gitignore', async () => {
  const root = repo({ 'a.py': '1\n', '.gitignore': 'secret.txt\n' });
  write(root, 'new dir/b.py', '2\n');
  write(root, 'secret.txt', 'x\n');
  assert.deepEqual((await G.projectFiles(root)).sort(), ['.gitignore', 'a.py', 'new dir/b.py']);
});

// ---------------------------------------------------------------- 5. AI review

test('review prompt contains instructions, gate findings (not legacy), the diff and new files', async () => {
  const root = repo({ 'a.py': 'old line\n' });
  write(root, 'a.py', 'new line\n');
  write(root, 'fresh.py', 'print("brand new")\n');
  const prompt = await buildReviewPrompt(root, { findings: [
    { file: 'a.py', line: 1, tool: 'Ruff', rule: 'F401', message: 'unused import', legacy: false },
    { file: 'a.py', line: 9, tool: 'Ruff', rule: 'E501', message: 'old long line', legacy: true },
  ] });
  assert.match(prompt, /reviewing a code change made by an AI coding agent/);
  assert.match(prompt, /a\.py:1 \[Ruff F401\] unused import/);
  assert.ok(!prompt.includes('old long line'));
  assert.match(prompt, /-old line\n\+new line/);
  assert.match(prompt, /## New file: fresh\.py\nprint\("brand new"\)/);
});

test('review prompt is capped', async () => {
  const root = repo({ 'big.txt': 'x\n' });
  write(root, 'big.txt', 'y'.repeat(200000) + '\n');
  const prompt = await buildReviewPrompt(root, { maxChars: 10000 });
  assert.ok(prompt.length < 11000);
  assert.match(prompt, /\[diff truncated\]/);
});

test('runReview pipes the prompt to the command on stdin and returns its output', async () => {
  const root = repo({ 'a.py': 'x\n' });
  write(root, 'a.py', 'y\n');
  const command = 'node -e "let s=\'\';process.stdin.on(\'data\',d=>s+=d).on(\'end\',()=>console.log((s.includes(\'## Diff against HEAD\')?\'GOT_DIFF\':\'NO_DIFF\')+\' \'+s.length))"';
  const res = await runReview(root, { command, findings: [] });
  assert.match(res.output, /^GOT_DIFF \d+/);
  assert.match((await runReview(root, { command: 'node -e "process.exit(3)"', findings: [] })).error, /exit 3/);
  assert.match((await runReview(root, { command: '', findings: [] })).error, /No review command/);
});

// ---------------------------------------------------------------- 7. config layering

test('config: defaults < global settings < project .ide/config.json', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bazinga-c-'));
  assert.equal(loadConfig(root).autoCheckpoint, true);
  assert.equal(loadConfig(root, { shell: 'cmd.exe', autoCheck: true }).shell, 'cmd.exe');
  write(root, '.ide/config.json', JSON.stringify({ shell: 'bash', agents: [{ name: 'X', command: 'x' }] }));
  const cfg = loadConfig(root, { shell: 'cmd.exe', autoCheck: true });
  assert.equal(cfg.shell, 'bash');
  assert.equal(cfg.autoCheck, true);
  assert.deepEqual(cfg.agents, [{ name: 'X', command: 'x' }]);
  assert.match(cfg.reviewCommand, /claude -p/);
  write(root, '.ide/config.json', '{ nope');
  assert.throws(() => loadConfig(root), /Invalid JSON/);
});
