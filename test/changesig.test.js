'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { signature } = require('../src/core/changesig');
const { repo, write } = require('./helpers');

const bump = (file) => { const t = new Date(Date.now() + 5000); fs.utimesSync(file, t, t); };

test('signature: stable when nothing changes, different after an edit, a second edit, a new file and a delete', async () => {
  const root = repo({ 'a.txt': 'one\n', 'b.txt': 'b\n' });
  const clean = await signature(root);
  assert.equal(clean, '');
  assert.equal(await signature(root), clean);
  write(root, 'a.txt', 'two\n');
  const s1 = await signature(root);
  assert.notEqual(s1, clean);
  assert.equal(await signature(root), s1, 'unchanged between polls');
  write(root, 'a.txt', 'three three\n'); // already modified: git status looks the same, content does not
  const s2 = await signature(root);
  assert.notEqual(s2, s1, 'a second edit of an already-changed file is seen');
  write(root, 'new.txt', 'n\n');
  const s3 = await signature(root);
  assert.notEqual(s3, s2);
  fs.rmSync(path.join(root, 'b.txt'));
  assert.notEqual(await signature(root), s3);
});

test('signature: same size, new mtime still counts', async () => {
  const root = repo({ 'a.txt': 'one\n' });
  write(root, 'a.txt', 'two\n');
  const s1 = await signature(root);
  bump(path.join(root, 'a.txt'));
  assert.notEqual(await signature(root), s1);
});

test('signature: not a repository gives an empty fingerprint, no throw', async () => {
  assert.equal(await signature(require('node:os').tmpdir() + '/__not_a_repo__'), '');
});

test('signature: a folder without git is fingerprinted too (regression: the poller was blind without a repo)', async () => {
  const os = require('node:os');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bz-nogit-'));
  fs.writeFileSync(path.join(root, 'a.txt'), 'one\n');
  const s0 = await signature(root);
  assert.notEqual(s0, '');
  assert.equal(await signature(root), s0);
  fs.writeFileSync(path.join(root, 'a.txt'), 'two two\n');
  const s1 = await signature(root);
  assert.notEqual(s1, s0);
  fs.mkdirSync(path.join(root, 'sub'));
  fs.writeFileSync(path.join(root, 'sub', 'b.txt'), 'b\n');
  assert.notEqual(await signature(root), s1);
  fs.mkdirSync(path.join(root, 'node_modules'));
  const s2 = await signature(root);
  fs.writeFileSync(path.join(root, 'node_modules', 'x.js'), 'x');
  assert.equal(await signature(root), s2, 'ignored folders do not count');
});

test('signature: git failing is "unknown" (null), not "nothing changed" (regression: the Changes list emptied itself)', async () => {
  const root = repo({ 'a.txt': 'one\n' });
  write(root, 'a.txt', 'two\n');
  assert.notEqual(await signature(root), null);
  fs.writeFileSync(path.join(root, '.git', 'index'), 'garbage'); // git status now fails
  assert.equal(await signature(root), null);
});

test('changedFiles: a stale index.lock does not blind the read-only status', async () => {
  const { changedFiles, changedFilesStrict } = require('../src/core/git');
  const root = repo({ 'a.txt': 'one\n' });
  write(root, 'a.txt', 'two\n');
  fs.writeFileSync(path.join(root, '.git', 'index.lock'), '');
  const files = await changedFiles(root);
  assert.deepEqual(files.map((f) => f.path), ['a.txt']);
  fs.writeFileSync(path.join(root, '.git', 'index'), 'garbage');
  fs.rmSync(path.join(root, '.git', 'index.lock'));
  await assert.rejects(() => changedFilesStrict(root));
  assert.deepEqual(await changedFiles(root), [], 'the lenient variant still reports nothing');
});
