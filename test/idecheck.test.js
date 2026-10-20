'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { repo, write } = require('./helpers');

const BIN = path.join(__dirname, '..', 'bin', 'ide-check.js');
const run = (args, opts = {}) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', timeout: 60000, ...opts });

// one gate that reports one finding on a.py line 1 (as error or warning)
function project(severity = 'error') {
  const root = repo({ 'a.py': 'x = 1\n', 'README.md': '# t\n' });
  write(root, 'a.py', 'x = 2\n');
  write(root, 'README.md', '# changed\n');
  write(root, '.ide/checks.yaml', `useDefaults: false
checks:
  - name: Demo gate
    match: ["*.py"]
    scope: project
    run: "node -e \\"console.log('a.py:1:1: ${severity}: demo finding')\\""
    parser: regex
    pattern: '^(?<file>.+?):(?<line>\\d+):(?<column>\\d+): (?<severity>\\w+): (?<message>.*)$'
  - name: Other gate
    match: ["*.md"]
    scope: project
    run: "node -e \\"0\\""
    parser: exitcode
`);
  return root;
}

test('--help prints the usage text and exits 0', () => {
  const r = run(['--help']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /ide-check/i);
});

test('text mode: lists each gate, the finding, the totals; exit 1 on errors', () => {
  const r = run(['--root', project()]);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stdout, /FAIL\s+Demo gate/); assert.match(r.stdout, /PASS\s+Other gate/);
  assert.match(r.stdout, /demo finding/); assert.match(r.stdout, /1 error\(s\)/);
});

test('warnings alone exit 0', () => {
  const r = run(['--root', project('warning')]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /0 error\(s\), 1 warning\(s\)/);
});

test('--json prints the full result, exit code follows the errors', () => {
  const r = run(['--root', project(), '--json']);
  assert.equal(r.status, 1);
  const out = JSON.parse(r.stdout);
  assert.equal(out.counts.error, 1);
  assert.ok(out.findings.some((f) => f.message === 'demo finding' && f.file === 'a.py'));
  assert.equal(run(['--root', project('warning'), '--json']).status, 0);
});

test('--only runs just the named gates', () => {
  const r = run(['--root', project(), '--only', 'Other gate']);
  assert.equal(r.status, 0);
  assert.doesNotMatch(r.stdout, /Demo gate/); assert.match(r.stdout, /Other gate/);
});

test('--hook: silent success; on errors exit 2 with the findings on stderr (what Claude Code reads)', () => {
  const ok = run(['--root', project('warning'), '--hook'], { input: '{}' });
  assert.equal(ok.status, 0); assert.equal(ok.stderr, '');
  const bad = run(['--root', project(), '--hook'], { input: '{"tool_name":"Edit"}' });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /Quality gate: 1 error\(s\)/); assert.match(bad.stderr, /demo finding/);
});

test('findings on lines you did not touch are hidden unless --all-findings', () => {
  const root = repo({ 'a.py': 'old = 1\nline2 = 2\n' });
  write(root, 'a.py', 'old = 1\nline2 = 3\n'); // changed line 2 only
  write(root, '.ide/checks.yaml', `useDefaults: false
checks:
  - name: Line one
    match: ["*.py"]
    scope: files
    run: "node -e \\"console.log('a.py:1:1: error: pre-existing')\\" {files}"
    parser: regex
    pattern: '^(?<file>.+?):(?<line>\\d+):(?<column>\\d+): (?<severity>\\w+): (?<message>.*)$'
`);
  const hidden = run(['--root', root]);
  assert.equal(hidden.status, 0, hidden.stdout);
  assert.match(hidden.stdout, /pre-existing on untouched lines ignored/);
  assert.equal(run(['--root', root, '--all-findings']).status, 1);
});

test('a folder that does not exist is a clean failure, not a stack trace', () => {
  const r = run(['--root', path.join(__dirname, 'no-such-folder'), '--json']);
  assert.ok(r.status === 0 || r.status === 1);
  assert.doesNotMatch(r.stderr, /at .*\.js:\d+/);
});
