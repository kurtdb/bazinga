'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { changedFiles, headContent, branch, isRepo } = require('../src/core/git');
const { runChecks } = require('../src/core/checks');
const { loadScripts, loadChecksConfig, loadConfig } = require('../src/core/config');
const { matchesAny } = require('../src/core/util');

const CLI = path.join(__dirname, '..', 'bin', 'ide-check.js');

function git(cwd, ...args) { return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf8' }); }
function write(root, rel, text) { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); }

/** A repo with one committed file, one modified, one untracked and one deleted. */
function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bazinga-'));
  git(root, 'init', '-q');
  write(root, 'keep.py', 'print("keep")\n');
  write(root, 'edit.py', 'print("v1")\n');
  write(root, 'gone.py', 'print("gone")\n');
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'init');
  write(root, 'edit.py', 'print("v2")\n');
  write(root, 'new file.py', 'print("new")\n');
  fs.unlinkSync(path.join(root, 'gone.py'));
  return root;
}

// A fake linter: prints "<file>:1:1: error: bad" for every file argument and logs each invocation.
const FAKE_LINT = `
const fs = require('fs');
const files = process.argv.slice(2);
fs.appendFileSync(process.env.LOG || 'lint.log', files.length + '\\n');
for (const f of files) console.log(f + ':1:1: error: bad thing');
process.exit(files.length ? 1 : 0);
`;
const REGEX = '^(?<file>.+?):(?<line>\\\\d+):(?<column>\\\\d+): (?<severity>\\\\w+): (?<message>.*)$';

test('changedFiles reports modified, untracked (even with spaces) and deleted files', async () => {
  const root = makeRepo();
  assert.equal(await isRepo(root), true);
  const files = await changedFiles(root);
  const by = Object.fromEntries(files.map((f) => [f.path, f.status]));
  assert.equal(by['edit.py'], 'M');
  assert.equal(by['new file.py'], '?');
  assert.equal(by['gone.py'], 'D');
  assert.equal(by['keep.py'], undefined);
  assert.ok(await branch(root));
});

test('changedFiles works when the project is a sub-directory of the repo', async () => {
  const root = makeRepo();
  write(root, 'sub/inner.py', 'x = 1\n');
  write(root, 'other.txt', 'y\n');
  const files = await changedFiles(path.join(root, 'sub'));
  assert.deepEqual(files.map((f) => f.path), ['inner.py']);
});

test('headContent returns the committed version, empty for new files', async () => {
  const root = makeRepo();
  assert.equal(await headContent(root, 'edit.py'), 'print("v1")\n');
  assert.equal(await headContent(root, 'new file.py'), '');
});

test('runChecks only checks changed files, normalises paths and skips deleted files', async () => {
  const root = makeRepo();
  write(root, 'fake-lint.js', FAKE_LINT);
  write(root, '.ide/checks.yaml', `useDefaults: false
checks:
  - name: Fake
    match: ["*.py"]
    run: node fake-lint.js {files}
    parser: regex
    pattern: '${REGEX.replace(/\\\\/g, '\\')}'
`);
  const res = await runChecks(root, { tier: 'all' });
  // the helper files written by this test are untracked, so they count as changed too; keep.py (committed, untouched) and gone.py (deleted) must not
  assert.deepEqual(res.files.filter((f) => f.endsWith('.py')).sort(), ['edit.py', 'new file.py']);
  assert.ok(!res.files.includes('gone.py') && !res.files.includes('keep.py'));
  assert.equal(res.runs[0].status, 'findings');
  assert.deepEqual(res.findings.map((f) => f.file).sort(), ['edit.py', 'new file.py']);
  assert.equal(res.counts.error, 2);
  assert.ok(res.findings.every((f) => f.tool === 'Fake' && f.line === 1));
});

test('many files are split over several command lines', async () => {
  const root = makeRepo();
  for (let i = 0; i < 400; i++) write(root, `pkg/a_long_directory_name_to_inflate_the_command_line/module_number_${i}.py`, 'x = 1\n');
  write(root, 'fake-lint.js', FAKE_LINT);
  write(root, '.ide/checks.yaml', `useDefaults: false
checks:
  - name: Fake
    match: ["*.py"]
    run: node fake-lint.js {files}
    parser: regex
    pattern: '${REGEX.replace(/\\\\/g, '\\')}'
`);
  const res = await runChecks(root, { tier: 'all' });
  const batches = fs.readFileSync(path.join(root, 'lint.log'), 'utf8').trim().split('\n').map(Number);
  assert.ok(batches.length > 1, `expected several batches, got ${batches.length}`);
  assert.equal(batches.reduce((a, b) => a + b, 0), 402);
  assert.equal(res.counts.error, 402);
});

test('a missing tool is skipped, not failed; a crashing tool is reported as failed', async () => {
  const root = makeRepo();
  write(root, '.ide/checks.yaml', `useDefaults: false
checks:
  - name: Ghost
    match: ["*.py"]
    requiresBin: definitely-not-installed-xyz
    run: definitely-not-installed-xyz {files}
  - name: Crash
    match: ["*.py"]
    scope: project
    run: node -e "console.error('kaboom'); process.exit(3)"
    parser: exitcode
  - name: Clean
    match: ["*.py"]
    scope: project
    run: node -e "process.exit(0)"
`);
  const res = await runChecks(root, { tier: 'all' });
  const by = Object.fromEntries(res.runs.map((r) => [r.name, r]));
  assert.equal(by.Ghost.status, 'skipped');
  assert.equal(by.Crash.status, 'failed');
  assert.equal(by.Clean.status, 'passed');
  const crash = res.findings.find((f) => f.tool === 'Crash');
  assert.match(crash.message, /exit 3/);
  assert.match(crash.detail, /kaboom/);
});

test('tier selection and "only" filter', async () => {
  const root = makeRepo();
  write(root, '.ide/checks.yaml', `useDefaults: false
checks:
  - { name: Quick, tier: fast, match: ["*.py"], scope: project, run: 'node -e "0"' }
  - { name: Heavy, tier: slow, match: ["*.py"], scope: project, run: 'node -e "0"' }
`);
  assert.deepEqual((await runChecks(root, { tier: 'fast' })).runs.map((r) => r.name), ['Quick']);
  assert.deepEqual((await runChecks(root, { tier: 'slow' })).runs.map((r) => r.name), ['Heavy']);
  assert.deepEqual((await runChecks(root, { tier: 'all' })).runs.map((r) => r.name), ['Quick', 'Heavy']);
  assert.deepEqual((await runChecks(root, { only: ['Heavy'] })).runs.map((r) => r.name), ['Heavy']);
});

test('no changed files means nothing runs', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bazinga-'));
  git(root, 'init', '-q');
  write(root, 'a.py', 'x\n');
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'init');
  const res = await runChecks(root, { tier: 'all' });
  assert.equal(res.files.length, 0);
  assert.ok(res.runs.every((r) => r.status === 'skipped'));
});

test('config: scripts, defaults merge, disable and custom flag', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bazinga-'));
  assert.deepEqual(loadScripts(root), []);
  assert.equal(loadChecksConfig(root).custom, false);
  assert.ok(loadChecksConfig(root).checks.length >= 8);
  assert.equal(loadConfig(root).agents[0].command, 'claude');

  write(root, '.ide/scripts.yaml', 'scripts:\n  - name: Dry run\n    command: python x.py --dry\n    description: safe\n  - name: broken\n');
  assert.deepEqual(loadScripts(root).map((s) => s.name), ['Dry run']);

  write(root, '.ide/checks.yaml', 'disable: [Semgrep]\nchecks:\n  - name: ESLint\n    run: echo custom\n  - name: Extra\n    run: echo extra\n');
  const cfg = loadChecksConfig(root);
  assert.equal(cfg.custom, true);
  assert.ok(!cfg.checks.some((c) => c.name === 'Semgrep'));
  assert.equal(cfg.checks.find((c) => c.name === 'ESLint').run, 'echo custom');
  assert.ok(cfg.checks.some((c) => c.name === 'Extra'));

  write(root, '.ide/checks.yaml', 'checks: [unclosed');
  assert.throws(() => loadChecksConfig(root), /Invalid YAML/);
});

test('glob matching: basename patterns and path patterns', () => {
  assert.ok(matchesAny('src/app/a.ts', ['*.ts']));
  assert.ok(!matchesAny('src/app/a.tsx', ['*.ts']));
  assert.ok(matchesAny('pom.xml', ['pom.xml']));
  assert.ok(matchesAny('src/main/java/A.java', ['src/**/*.java']));
  assert.ok(!matchesAny('test/A.java', ['src/**/*.java']));
  assert.ok(matchesAny('anything', []));
});

test('CLI hook mode: silent + exit 0 when clean, stderr + exit 2 when errors', () => {
  const root = makeRepo();
  write(root, 'fake-lint.js', FAKE_LINT);
  write(root, '.ide/checks.yaml', `useDefaults: false
checks:
  - name: Fake
    match: ["*.py"]
    run: node fake-lint.js {files}
    parser: regex
    pattern: '${REGEX.replace(/\\\\/g, '\\')}'
`);
  const bad = spawnSync('node', [CLI, '--hook', '--root', root], { encoding: 'utf8', input: '{}' });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /edit\.py:1:1\s+error\s+\[Fake\]\s+bad thing/);
  assert.equal(bad.stdout, '');

  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'all');
  const clean = spawnSync('node', [CLI, '--hook', '--root', root], { encoding: 'utf8', input: '{}' });
  assert.equal(clean.status, 0);
  assert.equal(clean.stderr, '');

  write(root, 'edit.py', 'print("v3")\n');
  const json = spawnSync('node', [CLI, '--json', '--root', root], { encoding: 'utf8' });
  assert.equal(json.status, 1);
  assert.equal(JSON.parse(json.stdout).counts.error, 1);
});
