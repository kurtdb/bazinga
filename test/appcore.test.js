'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const A = require('../src/core/appcore');
const { tmpdir, write } = require('./helpers');

test('resolveWithin: inside paths resolve, escapes throw (../, absolute, sibling with the same prefix)', () => {
  const base = path.resolve('/work/proj');
  assert.equal(A.resolveWithin(base, 'src/a.js'), path.join(base, 'src', 'a.js'));
  assert.equal(A.resolveWithin(base, ''), base);
  assert.equal(A.resolveWithin(base, '.'), base);
  assert.equal(A.resolveWithin(base, 'a/../b'), path.join(base, 'b'));
  for (const bad of ['../x', '../proj-evil/x', path.resolve('/etc/passwd'), 'a/../../x']) assert.throws(() => A.resolveWithin(base, bad), /outside the project/, bad);
});

test('shellKindOf: from the configured shell, else the platform default', () => {
  assert.equal(A.shellKindOf({ shell: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe' }), 'powershell');
  assert.equal(A.shellKindOf({ shell: '/usr/bin/pwsh' }), 'powershell');
  assert.equal(A.shellKindOf({ shell: 'cmd.exe' }), 'cmd');
  assert.equal(A.shellKindOf({ shell: '/bin/zsh' }), 'posix');
  assert.equal(A.shellKindOf({}, { platform: 'win32', env: {} }), 'powershell');
  assert.equal(A.shellKindOf(null, { platform: 'linux', env: { SHELL: '/bin/bash' } }), 'posix');
  assert.equal(A.shellKindOf(undefined, { platform: 'darwin', env: {} }), 'posix');
});

test('lspConfigFor: project overrides settings; project-defined servers are flagged for approval', () => {
  const root = tmpdir();
  const settings = { lsp: { enabled: true, servers: { python: { command: 'pyright-langserver', args: ['--stdio'] } } } };
  // no project file: settings only, nothing flagged
  let c = A.lspConfigFor(root, settings);
  assert.equal(c.enabled, true);
  assert.deepEqual(c.servers.python, { command: 'pyright-langserver', args: ['--stdio'] });
  // project disables it explicitly and adds its own server
  write(root, '.ide/config.json', JSON.stringify({ lsp: { enabled: false, servers: { java: { command: './evil.sh' }, python: { args: ['--other'] } } } }));
  c = A.lspConfigFor(root, settings);
  assert.equal(c.enabled, false);
  assert.equal(c.servers.java.fromProject, true);
  assert.deepEqual(c.servers.python, { command: 'pyright-langserver', args: ['--other'], fromProject: true }, 'merged, and flagged because the project changed it');
  // settings are never mutated
  assert.equal(settings.lsp.servers.python.fromProject, undefined);
});

test('lspConfigFor: off by default, broken or missing files are ignored', () => {
  const root = tmpdir();
  assert.deepEqual(A.lspConfigFor(root, {}), { enabled: false, servers: {} });
  assert.deepEqual(A.lspConfigFor(root, undefined), { enabled: false, servers: {} });
  write(root, '.ide/config.json', '{ not json');
  assert.deepEqual(A.lspConfigFor(root, { lsp: { enabled: true } }), { enabled: true, servers: {} });
});

test('withTrusted adds a root once and tolerates missing state', () => {
  assert.deepEqual(A.withTrusted({ lastRoot: 'x', trusted: ['/a'] }, '/b'), { lastRoot: 'x', trusted: ['/a', '/b'] });
  assert.deepEqual(A.withTrusted({ trusted: ['/a'] }, '/a'), { trusted: ['/a'] });
  assert.deepEqual(A.withTrusted(undefined, '/a'), { trusted: ['/a'] });
  assert.deepEqual(A.withTrusted({ trusted: 'oops' }, '/a'), { trusted: ['/a'] });
  const input = { trusted: ['/a'] };
  A.withTrusted(input, '/b');
  assert.deepEqual(input, { trusted: ['/a'] }, 'input is not mutated');
});
