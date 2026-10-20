'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const p = require('../src/core/parsers');

test('eslint JSON', () => {
  const out = JSON.stringify([{ filePath: '/p/a.js', messages: [{ ruleId: 'no-unused-vars', severity: 2, message: 'x is unused', line: 3, column: 7 }, { ruleId: 'semi', severity: 1, message: 'Missing semicolon', line: 4, column: 1 }] }]);
  const f = p.eslint(out);
  assert.equal(f.length, 2);
  assert.deepEqual([f[0].severity, f[0].line, f[0].column, f[0].rule], ['error', 3, 7, 'no-unused-vars']);
  assert.equal(f[1].severity, 'warning');
});

test('JSON parsers tolerate leading noise', () => {
  const f = p.eslint(`npm warn something\n${JSON.stringify([{ filePath: 'a.js', messages: [{ severity: 2, message: 'boom', line: 1, column: 1 }] }])}\n`);
  assert.equal(f.length, 1);
});

test('ruff JSON: F-codes are errors, style codes are warnings', () => {
  const f = p.ruff(JSON.stringify([
    { code: 'F401', message: 'unused import', filename: '/p/a.py', location: { row: 1, column: 8 } },
    { code: 'E501', message: 'line too long', filename: '/p/a.py', location: { row: 9, column: 89 } },
  ]));
  assert.deepEqual(f.map((x) => x.severity), ['error', 'warning']);
  assert.equal(f[0].line, 1);
});

test('pyright JSON uses 1-based lines', () => {
  const f = p.pyright(JSON.stringify({ generalDiagnostics: [{ file: '/p/a.py', severity: 'error', message: 'bad type', rule: 'reportArgumentType', range: { start: { line: 4, character: 2 } } }] }));
  assert.equal(f[0].line, 5);
  assert.equal(f[0].column, 3);
});

test('shellcheck JSON', () => {
  const f = p.shellcheck(JSON.stringify([{ file: 'a.sh', line: 2, column: 1, level: 'style', code: 2086, message: 'Double quote' }]));
  assert.equal(f[0].rule, 'SC2086');
  assert.equal(f[0].severity, 'info');
});

test('yamllint parsable', () => {
  const f = p.yamllint('a.yml:3:1: [warning] missing document start "---" (document-start)\nb.yml:10:5: [error] syntax error: x (syntax)');
  assert.equal(f.length, 2);
  assert.equal(f[0].rule, 'document-start');
  assert.equal(f[1].severity, 'error');
});

test('tsc plain output', () => {
  const f = p.tsc("src/a.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.\nFound 1 error.");
  assert.equal(f.length, 1);
  assert.deepEqual([f[0].file, f[0].line, f[0].column, f[0].rule], ['src/a.ts', 10, 5, 'TS2322']);
});

test('mypy output', () => {
  const f = p.mypy('app/x.py:12: error: Incompatible types  [assignment]\napp/x.py:12: note: see docs');
  assert.equal(f.length, 2);
  assert.equal(f[0].rule, 'assignment');
  assert.equal(f[1].severity, 'info');
});

test('maven javac errors', () => {
  const f = p.maven('[INFO] Compiling\n[ERROR] /home/u/proj/src/main/java/com/x/A.java:[12,8] cannot find symbol\n[ERROR] COMPILATION ERROR :');
  assert.equal(f.length, 1);
  assert.deepEqual([f[0].line, f[0].column], [12, 8]);
});

test('sarif (semgrep style)', () => {
  const sarif = { runs: [{ results: [{ ruleId: 'python.lang.eval', level: 'error', message: { text: 'Avoid eval' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'src/app.py' }, region: { startLine: 7, startColumn: 3 } } }] }] }] };
  const f = p.sarif(JSON.stringify(sarif));
  assert.deepEqual([f[0].file, f[0].line, f[0].severity, f[0].rule], ['src/app.py', 7, 'error', 'python.lang.eval']);
});

test('regex parser with named groups', () => {
  const f = p.regex('src/a.c:4:2: warning: unused variable', { pattern: '^(?<file>.+?):(?<line>\\d+):(?<column>\\d+): (?<severity>\\w+): (?<message>.*)$' });
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, 'warning');
});

test('garbage input never throws', () => {
  for (const name of ['eslint', 'ruff', 'pyright', 'shellcheck', 'sarif', 'tsc', 'mypy', 'maven', 'yamllint']) {
    assert.deepEqual(p[name]('not json, not a finding'), []);
    assert.deepEqual(p[name](''), []);
  }
});
