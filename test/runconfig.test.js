'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const RC = require('../src/core/runconfig');
const { tmpdir, write } = require('./helpers');

const base = { name: 'Orders dev', dir: 'orders', profile: 'dev', env: 'DB=x\n# note\nA=1', jvmArgs: '-Xmx512m', debugPort: 5005 };

test('save, list (sorted), replace by name and delete', () => {
  const root = tmpdir();
  assert.deepEqual(RC.loadRunConfigs(root), []);
  RC.saveRunConfig(root, base);
  RC.saveRunConfig(root, { ...base, name: 'A first', profile: '' });
  assert.deepEqual(RC.loadRunConfigs(root).map((c) => c.name), ['A first', 'Orders dev']);
  RC.saveRunConfig(root, { ...base, debugPort: 6006 });
  const list = RC.loadRunConfigs(root);
  assert.equal(list.length, 2); assert.equal(list.find((c) => c.name === 'Orders dev').debugPort, 6006);
  assert.equal(RC.deleteRunConfig(root, 'A first'), 1);
  assert.equal(RC.deleteRunConfig(root, 'nothing'), 0);
  assert.deepEqual(RC.loadRunConfigs(root).map((c) => c.name), ['Orders dev']);
  assert.ok(!fs.existsSync(path.join(root, '.ide', 'run.json.tmp')), 'no temp file left behind');
});

test('the file is plain JSON that can be committed and edited by hand', () => {
  const root = tmpdir();
  RC.saveRunConfig(root, base);
  const raw = JSON.parse(fs.readFileSync(path.join(root, '.ide', 'run.json'), 'utf8'));
  assert.equal(raw.configs[0].jvmArgs, '-Xmx512m');
});

test('invalid input is rejected before it is stored', () => {
  const root = tmpdir();
  const bad = [
    [{ ...base, name: '' }, /needs a name/], [{ ...base, name: 'x'.repeat(61) }, /needs a name/],
    [{ ...base, dir: '../outside' }, /inside the project/], [{ ...base, dir: '/etc' }, /inside the project/],
    [{ ...base, profile: 'dev; rm' }, /Spring profile/], [{ ...base, env: '1BAD=x' }, /environment variable/],
    [{ ...base, jvmArgs: '-Dx=$(id)' }, /JVM arguments/], [{ ...base, debugPort: 22 }, /Debug port/], [null, /Not a run configuration/],
  ];
  for (const [cfg, re] of bad) assert.throws(() => RC.saveRunConfig(root, cfg), re);
  assert.deepEqual(RC.loadRunConfigs(root), []);
});

test('hand-edited bad entries or a broken file are skipped, not fatal', () => {
  const root = tmpdir();
  write(root, '.ide/run.json', JSON.stringify({ configs: [base, { name: 'evil', dir: '..', profile: 'x' }, 'text', null] }));
  assert.deepEqual(RC.loadRunConfigs(root).map((c) => c.name), ['Orders dev']);
  write(root, '.ide/run.json', '{ not json');
  assert.deepEqual(RC.loadRunConfigs(root), []);
  write(root, '.ide/run.json', '{"configs": 5}');
  assert.deepEqual(RC.loadRunConfigs(root), []);
});

test('module folder is normalised', () => {
  assert.equal(RC.validate({ ...base, dir: './orders/' }).dir, 'orders');
  assert.equal(RC.validate({ ...base, dir: 'a\\b' }).dir, 'a/b');
  assert.equal(RC.validate({ ...base, dir: '' }).dir, '');
});
