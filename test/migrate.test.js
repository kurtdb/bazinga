'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { migrateUserData } = require('../src/core/migrate');
const { repo, sh, tmpdir } = require('./helpers');
const git = require('../src/core/git');

test('migrateUserData: copies settings from the old profile once, never overwrites', () => {
  const appData = tmpdir();
  fs.mkdirSync(path.join(appData, 'lite-ide', 'localhistory'), { recursive: true });
  fs.writeFileSync(path.join(appData, 'lite-ide', 'settings.json'), '{"theme":"dark"}');
  fs.writeFileSync(path.join(appData, 'lite-ide', 'localhistory', 'x'), '1');
  const dir = path.join(appData, 'bazinga');
  assert.ok(migrateUserData(dir, appData));
  assert.strictEqual(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'), '{"theme":"dark"}');
  assert.ok(fs.existsSync(path.join(dir, 'localhistory', 'x')));
  fs.writeFileSync(path.join(dir, 'settings.json'), '{"theme":"light"}');
  assert.strictEqual(migrateUserData(dir, appData), null);
  assert.strictEqual(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'), '{"theme":"light"}');
  assert.strictEqual(migrateUserData(path.join(appData, 'other'), tmpdir()), null);
});

test('legacy checkpoints under the old ref name are moved and still listed', async () => {
  const root = repo();
  const head = sh(root, 'rev-parse', 'HEAD').trim();
  sh(root, 'update-ref', 'refs/lite-ide/checkpoints/old1', head);
  const list = await git.listCheckpoints(root);
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].id, 'old1');
  assert.strictEqual(sh(root, 'for-each-ref', 'refs/lite-ide').trim(), '');
});
