'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/core/externaleditor');
const T = require('../src/core/testcmd');

test('VS Code and IntelliJ commands put the file at the right line', () => {
  const v = E.command('vscode', { bin: '/usr/bin/code' }, { root: '/p', rel: 'a/B.java', line: 12, column: 3 });
  assert.deepEqual(v.args, ['--reuse-window', '-g', '/p/a/B.java:12:3'].map((x) => x.replace(/\//g, require('node:path').sep === '\\' ? '\\' : '/')));
  const i = E.command('idea', { bin: 'idea' }, { root: '/p', rel: 'a/B.java', line: 0, column: -4 });
  assert.equal(i.args[0], '/p');
  assert.equal(i.args[1], '--line');
  assert.equal(i.args[2], '1');
  assert.equal(i.args[4], '1');
});
test('a missing editor gives a how-to-fix sentence, an unknown one an error', () => {
  assert.match(E.command('vscode', null, { root: '/p', rel: 'x' }).error, /Shell Command: Install ‘code’/);
  assert.match(E.command('idea', null, { root: '/p', rel: 'x' }).error, /Create Command-line Launcher/);
  assert.ok(E.command('emacs', { bin: 'e' }, { root: '/p', rel: 'x' }).error);
});
test('editor choice: explicit setting wins; Java builds prefer IntelliJ, but only what is installed is chosen', () => {
  assert.equal(E.pick('vscode', { hasJavaBuild: true, available: ['idea'] }), 'vscode');
  assert.equal(E.pick('auto', { hasJavaBuild: true, available: ['idea', 'vscode'] }), 'idea');
  assert.equal(E.pick('auto', { hasJavaBuild: true, available: ['vscode'] }), 'vscode');
  assert.equal(E.pick('auto', { hasJavaBuild: false, available: ['idea', 'vscode'] }), 'vscode');
  assert.equal(E.pick(undefined, { hasJavaBuild: false, available: [] }), 'vscode');
});
test('debug commands: pytest --pdb, JUnit waits on 5005, node:test inspects; Vitest/Jest offer nothing instead of guessing', () => {
  const os = require('node:os'); const fs = require('node:fs'); const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbg-'));
  fs.writeFileSync(path.join(dir, 'pom.xml'), '<project/>');
  fs.writeFileSync(path.join(dir, 'package.json'), '{}');
  const py = T.debugCommand(dir, 'tests/test_x.py', { name: 'test_a', kind: 'test' }, { content: 'def test_a(): pass' });
  assert.match(py.command, /pytest.*test_x\.py::test_a.* --pdb -s$/);
  assert.match(py.note, /pdb|terminal/);
  const java = T.debugCommand(dir, 'src/test/FooTest.java', { name: 'works', kind: 'test', suite: 'FooTest' }, {});
  assert.match(java.command, /-Dmaven\.surefire\.debug/);
  assert.match(java.note, /5005/);
  const node = T.debugCommand(dir, 'test/a.test.js', { name: 'adds', kind: 'test' }, { content: "require('node:test')" });
  assert.match(node.command, /node --inspect-brk --test /);
  assert.equal(T.debugCommand(dir, 'test/a.test.js', { name: 'adds', kind: 'test' }, { content: "import {it} from 'vitest'" }), null);
  assert.equal(T.canDebug('a.test.ts', "import {it} from 'vitest'"), false);
  assert.equal(T.canDebug('a.py', ''), true);
});
test('"What\'s new" can find its file in a packaged app, and the lens/commands exist', () => {
  const fs = require('node:fs'); const path = require('node:path');
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
  assert.ok(pkg.build.files.includes('CHANGELOG.md'));
  const app = fs.readFileSync(path.join(__dirname, '../src/renderer/app.js'), 'utf8');
  for (const s of ['bazinga.debugTest', 'openWhatsNew', 'bazinga.openVsCode', "openInOtherEditor('idea')"]) assert.ok(app.includes(s), s);
});
