'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { load, save, activeVars } = require('../src/core/environments');

const tmpRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bazinga-env-'));

test('load returns no environments and no active one when the file does not exist yet', () => {
  const root = tmpRoot();
  assert.deepEqual(load(root), { environments: [], active: null });
});

test('save then load round-trips environments and the active selection', () => {
  const root = tmpRoot();
  save(root, { environments: [{ name: 'dev', vars: { baseUrl: 'http://localhost:3000' } }, { name: 'prod', vars: { baseUrl: 'https://api.example.com' } }], active: 'dev' });
  const loaded = load(root);
  assert.equal(loaded.environments.length, 2);
  assert.equal(loaded.active, 'dev');
  assert.equal(loaded.environments[0].vars.baseUrl, 'http://localhost:3000');
  assert.ok(fs.existsSync(path.join(root, '.ide', 'environments.yaml')));
});

test('save drops environments with no name and clears active when it no longer names a real environment', () => {
  const root = tmpRoot();
  save(root, { environments: [{ name: 'dev', vars: {} }, { vars: { x: 1 } }], active: 'gone' });
  const loaded = load(root);
  assert.equal(loaded.environments.length, 1);
  assert.equal(loaded.active, null);
});

test('activeVars returns {} when nothing is active, and the right environment once one is', () => {
  const root = tmpRoot();
  assert.deepEqual(activeVars(root), {});
  save(root, { environments: [{ name: 'dev', vars: { token: 'abc123' } }], active: 'dev' });
  assert.deepEqual(activeVars(root), { token: 'abc123' });
});

test('load raises a clear error on invalid YAML rather than a raw parser exception', () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, '.ide'), { recursive: true });
  fs.writeFileSync(path.join(root, '.ide', 'environments.yaml'), 'environments: [this: is: not: valid\n');
  assert.throws(() => load(root), /Invalid YAML/);
});
