'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const D = require('../src/core/doctor');
const { tmpdir } = require('./helpers');

const posix = process.platform !== 'win32';
const stub = (dir, name, body) => { const f = path.join(dir, name); fs.writeFileSync(f, `#!/bin/sh\n${body}\n`, { mode: 0o755 }); return f; };

test('regression: "Picked up JAVA_TOOL_OPTIONS" lines (proxy settings with an IP address) are not taken for the version', () => {
  const noise = 'Picked up JAVA_TOOL_OPTIONS: -Dhttps.proxyHost=127.0.0.1 -Dhttps.proxyPort=42663\n';
  assert.equal(D.parseVersion(`${noise}openjdk version "21.0.12.1" 2026-08-18`), '21.0.12.1');
  assert.equal(D.parseVersion(`${noise}Apache Maven 3.9.11 (3e54c93)\nPicked up JDK_JAVA_OPTIONS: -Dx=10.1.2.3`), '3.9.11');
  assert.equal(D.parseVersion(noise), '');
});

test('parseVersion picks the first version-looking token from any tool output', () => {
  assert.equal(D.parseVersion('git version 2.43.0'), '2.43.0');
  assert.equal(D.parseVersion('openjdk version "21.0.2" 2024-01-16'), '21.0.2');
  assert.equal(D.parseVersion('v20.11.1'), '20.11.1');
  assert.equal(D.parseVersion('Apache Maven 3.9.6 (bc0240f3c)'), '3.9.6');
  assert.equal(D.parseVersion('no digits here'), '');
  assert.equal(D.parseVersion(undefined), '');
});

test('a missing tool is reported with its hint; a present one with path and version', { skip: !posix }, async () => {
  const dir = tmpdir(); stub(dir, 'fake', 'echo "fake tool 7.8.9"');
  const find = (id) => (id === 'fake' ? path.join(dir, 'fake') : null);
  const ok = await D.checkTool({ id: 'fake', label: 'Fake', args: ['--version'], hint: 'h' }, { find });
  assert.deepEqual([ok.ok, ok.version, ok.path], [true, '7.8.9', path.join(dir, 'fake')]);
  const gone = await D.checkTool({ id: 'nope', label: 'Nope', args: ['-v'], hint: 'install it', required: true }, { find });
  assert.deepEqual([gone.ok, gone.required, gone.hint, gone.path], [false, true, 'install it', null]);
});

test('java prints its version on stderr: still found; a tool that hangs is cut off', { skip: !posix }, async () => {
  const dir = tmpdir(); stub(dir, 'j', 'echo \'openjdk version "17.0.9"\' 1>&2'); stub(dir, 'slow', 'exec sleep 30');
  const j = await D.checkTool({ id: 'j', label: 'J', args: ['-version'] }, { find: () => path.join(dir, 'j') });
  assert.equal(j.version, '17.0.9');
  const t = Date.now();
  const s = await D.checkTool({ id: 'slow', label: 'S', args: ['x'] }, { find: () => path.join(dir, 'slow'), timeoutMs: 300 });
  assert.ok(Date.now() - t < 5000); assert.equal(s.ok, true); assert.equal(s.version, '');
});

test('a too old tool fails with a reason', { skip: !posix }, async () => {
  const dir = tmpdir(); stub(dir, 'old', 'echo v16.1.0');
  const r = await D.checkTool({ id: 'node', label: 'Node', args: ['--version'], minMajor: 18, required: true }, { find: () => path.join(dir, 'old') });
  assert.equal(r.ok, false); assert.match(r.note, /18 or newer/);
});

test('extra checks: terminal engine, shell and git identity', async () => {
  const bad = await D.extraChecks({ shell: '/definitely/not/a/shell', gitIdentity: async () => ({ name: '', email: '' }) });
  assert.equal(bad.find((r) => r.id === 'shell').ok, false);
  const id = bad.find((r) => r.id === 'git-identity');
  assert.deepEqual([id.ok, id.required], [false, false]);
  const good = await D.extraChecks({ shell: process.execPath, gitIdentity: async () => ({ name: 'Kurt', email: 'k@x' }) });
  assert.equal(good.find((r) => r.id === 'shell').ok, true);
  assert.equal(good.find((r) => r.id === 'git-identity').version, 'Kurt <k@x>');
  assert.equal(typeof good.find((r) => r.id === 'node-pty').ok, 'boolean');
});

test('report: required failures flip ok and are named; optional misses do not', () => {
  const mk = (id, ok, required) => ({ id, label: id, ok, required, hint: `hint-${id}`, version: ok ? '1.0' : '', note: '' });
  const results = [mk('git', true, true), mk('gh', false, false)];
  const report = { results, ok: true, missingRequired: [] };
  const text = D.formatReport(report);
  assert.match(text, /OK\s+git 1\.0/); assert.match(text, /miss gh\s+->\s+hint-gh/); assert.match(text, /All required tools are present/);
  const failing = D.formatReport({ results: [mk('git', false, true)], ok: false, missingRequired: ['git'] });
  assert.match(failing, /FAIL git/); assert.match(failing, /Missing or too old \(required\): git/);
});

test('npm run doctor: exit code follows the required tools; --json is valid', { skip: !posix }, () => {
  const empty = tmpdir();
  const bin = path.join(__dirname, '..', 'bin', 'doctor.js');
  const missing = spawnSync(process.execPath, [bin, '--json'], { encoding: 'utf8', env: { ...process.env, PATH: empty } });
  assert.equal(missing.status, 1, missing.stderr);
  const report = JSON.parse(missing.stdout);
  assert.ok(report.missingRequired.includes('git'));
  const real = spawnSync(process.execPath, [bin], { encoding: 'utf8' });
  assert.match(real.stdout, /Git/);
});
