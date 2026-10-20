'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { LocalHistory } = require('../src/core/localhistory');
const { tmpdir } = require('./helpers');

const make = (opts) => { let t = 1_700_000_000_000; const lh = new LocalHistory(tmpdir('bazinga-lh-'), { now: () => t, ...opts }); return { lh, tick: (ms) => { t += ms; }, root: '/work/proj' }; };

test('records changes newest first, skips identical content, remembers labels', () => {
  const { lh, tick, root } = make();
  assert.equal(lh.record(root, 'src/A.java', 'v1', { label: 'saved in IDE' }).saved, true);
  tick(1000);
  assert.deepEqual(lh.record(root, 'src/A.java', 'v1'), { saved: false, reason: 'unchanged' });
  assert.equal(lh.record(root, 'src/A.java', 'v2', { label: 'changed on disk' }).saved, true);
  const list = lh.list(root, 'src/A.java');
  assert.deepEqual(list.map((e) => [e.label, e.size]), [['changed on disk', 2], ['saved in IDE', 2]]);
  assert.equal(lh.read(root, 'src/A.java', list[1].id), 'v1');
  // going back to an earlier content is a change again (it is not the newest snapshot)
  assert.equal(lh.record(root, 'src/A.java', 'v1').saved, true);
  assert.equal(lh.list(root, 'src/A.java').length, 3);
});

test('files and projects are kept apart; path separators do not matter', () => {
  const { lh } = make();
  lh.record('/a', 'x.txt', '1'); lh.record('/b', 'x.txt', '2'); lh.record('/a', 'dir\\y.txt', '3');
  assert.equal(lh.read('/a', 'x.txt', lh.list('/a', 'x.txt')[0].id), '1');
  assert.equal(lh.read('/b', 'x.txt', lh.list('/b', 'x.txt')[0].id), '2');
  assert.equal(lh.list('/a', 'dir/y.txt').length, 1);
  assert.equal(lh.has('/a', 'nothing.txt'), false);
});

test('binary and large files are not stored', () => {
  const { lh, root } = make({ maxFileBytes: 100 });
  assert.deepEqual(lh.record(root, 'b.bin', 'a\0b'), { saved: false, reason: 'binary' });
  assert.deepEqual(lh.record(root, 'big.txt', 'x'.repeat(101)), { saved: false, reason: 'too large' });
  assert.equal(lh.has(root, 'b.bin'), false);
});

test('ids stay ordered even when the clock does not move', () => {
  const { lh, root } = make();
  for (const v of ['a', 'b', 'c', 'd']) lh.record(root, 'f.txt', v);
  const list = lh.list(root, 'f.txt');
  assert.equal(list.length, 4);
  assert.deepEqual(list.map((e) => lh.read(root, 'f.txt', e.id)), ['d', 'c', 'b', 'a']);
});

test('per-file count and age limits; the newest snapshot always survives', () => {
  const { lh, tick, root } = make({ maxPerFile: 3, maxAgeDays: 1 });
  for (let i = 0; i < 6; i++) { lh.record(root, 'f.txt', `v${i}`); tick(1000); }
  assert.deepEqual(lh.list(root, 'f.txt').map((e) => lh.read(root, 'f.txt', e.id)), ['v5', 'v4', 'v3']);
  tick(10 * 86400000); // everything is older than a day now
  lh.prune(root, 'f.txt');
  assert.deepEqual(lh.list(root, 'f.txt').map((e) => lh.read(root, 'f.txt', e.id)), ['v5']);
});

test('total size limit removes the oldest snapshots first', () => {
  const { lh, tick, root } = make({ maxTotalBytes: 25 });
  lh.record(root, 'a.txt', 'a'.repeat(10)); tick(1000);
  lh.record(root, 'b.txt', 'b'.repeat(10)); tick(1000);
  lh.record(root, 'c.txt', 'c'.repeat(10));
  assert.equal(lh.pruneTotal(), 1);
  assert.equal(lh.has(root, 'a.txt'), false); assert.equal(lh.has(root, 'b.txt'), true); assert.equal(lh.has(root, 'c.txt'), true);
  assert.equal(lh.pruneTotal(), 0);
});

test('read refuses ids that are not snapshot ids (no path traversal)', () => {
  const { lh, root } = make();
  lh.record(root, 'f.txt', 'x');
  for (const bad of ['../../etc/passwd', '..', '', undefined, '1700000000000-zzzzzzzz', '1700000000000-abcdef12/../..']) assert.throws(() => lh.read(root, 'f.txt', bad), /Invalid history entry/, String(bad));
  assert.throws(() => lh.read(root, 'f.txt', '1700000000000-abcdef12'), /ENOENT/);
});

test('a damaged meta file or foreign files in the folder do not break listing', () => {
  const { lh, root } = make();
  lh.record(root, 'f.txt', 'x');
  const folder = lh.folder(root, 'f.txt');
  fs.writeFileSync(path.join(folder, 'meta.json'), '{ broken');
  fs.writeFileSync(path.join(folder, 'notes.txt'), 'hi');
  fs.writeFileSync(path.join(folder, 'junk.snap'), 'hi');
  assert.equal(lh.list(root, 'f.txt').length, 1);
  assert.equal(lh.record(root, 'f.txt', 'y').saved, true, 'recording survives a broken meta file');
});
