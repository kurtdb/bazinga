'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { formatDropPaths, displayPath, saveImage } = require('../src/core/dropinsert');
const { tmpdir } = require('./helpers');

test('paths inside the project become relative with forward slashes; others stay absolute', () => {
  const root = path.join(path.sep, 'work', 'proj');
  assert.equal(displayPath(path.join(root, 'src', 'a.js'), root), 'src/a.js');
  assert.equal(displayPath(path.join(path.sep, 'other', 'x.png'), root), path.join(path.sep, 'other', 'x.png'));
  assert.equal(displayPath(path.join(root, '..', 'proj2', 'f'), root), path.join(path.sep, 'work', 'proj2', 'f'));
  assert.equal(displayPath('src/rel.txt', root), 'src/rel.txt');
  assert.equal(displayPath('', root), '');
});

test('agent prompt: plain paths, quotes only when there is whitespace; trailing space', () => {
  const root = path.join(path.sep, 'p');
  assert.equal(formatDropPaths([path.join(root, 'a.js'), path.join(root, 'my file.png')], { root, agent: true }), 'a.js "my file.png" ');
});

test('shell terminal: quoted for the shell in use', () => {
  assert.equal(formatDropPaths(['a b.txt'], { shellKind: 'posix' }), "'a b.txt' ");
  assert.equal(formatDropPaths(["it's.txt"], { shellKind: 'posix' }), "'it'\\''s.txt' ");
  assert.equal(formatDropPaths(["it's.txt"], { shellKind: 'powershell' }), "'it''s.txt' ");
  assert.equal(formatDropPaths(['a b.txt'], { shellKind: 'cmd' }), '"a b.txt" ');
});

test('control characters in a file name cannot inject keystrokes; empty and oversized lists are handled', () => {
  const out = formatDropPaths(['evil\r\nrm -rf x\u001b[201~.txt'], { agent: true });
  assert.ok(!/[\u0000-\u001f]/.test(out.trimEnd()));
  assert.equal(formatDropPaths([], {}), '');
  assert.equal(formatDropPaths(null, {}), '');
  assert.equal(formatDropPaths(Array.from({ length: 200 }, (_, i) => `f${i}`), { agent: true }).trim().split(' ').length, 50);
});

test('pasted images are saved with a safe name; bad types, empty and huge images are refused; old pastes are pruned', () => {
  const dir = path.join(tmpdir(), 'pasted');
  const png = Buffer.from('89504e470d0a1a0a', 'hex').toString('base64');
  const f = saveImage(dir, png, 'png');
  assert.ok(f.startsWith(dir) && /paste-\d+-[0-9a-f]{6}\.png$/.test(f));
  assert.equal(fs.readFileSync(f).length, 8);
  assert.match(saveImage(dir, png, '.JPEG'), /\.jpg$/);
  assert.throws(() => saveImage(dir, png, 'exe'), /Only png/);
  assert.throws(() => saveImage(dir, png, '../../x'), /Only png/);
  assert.throws(() => saveImage(dir, '', 'png'), /empty/);
  assert.throws(() => saveImage(dir, Buffer.alloc(21 * 1024 * 1024).toString('base64'), 'png'), /20 MB/);
  const old = path.join(dir, 'paste-1-abcdef.png'); fs.writeFileSync(old, 'x'); fs.utimesSync(old, new Date(2020, 0, 1), new Date(2020, 0, 1));
  const keep = path.join(dir, 'notes.txt'); fs.writeFileSync(keep, 'x'); fs.utimesSync(keep, new Date(2020, 0, 1), new Date(2020, 0, 1));
  saveImage(dir, png, 'gif');
  assert.ok(!fs.existsSync(old), 'old paste pruned');
  assert.ok(fs.existsSync(keep), 'unrelated files untouched');
});

test('Claude Code gets @path for dropped files (content goes into the prompt), but not for images, names with spaces or shells', () => {
  const root = path.join(path.sep, 'proj');
  const f = (paths, o) => formatDropPaths(paths, { root, ...o });
  assert.equal(f([path.join(root, 'src', 'pipeline.py')], { agent: true, at: true }), '@src/pipeline.py ');
  assert.equal(f([path.join(root, 'a.py'), path.join(root, 'shot.png')], { agent: true, at: true }), '@a.py shot.png ');
  assert.equal(f([path.join(root, 'my file.py')], { agent: true, at: true }), '"my file.py" ');
  assert.equal(f([path.join(root, 'a.py')], { agent: true }), 'a.py ', 'other agents: plain path');
  assert.doesNotMatch(f([path.join(root, 'a.py')], { at: true }), /@/, 'a plain shell never gets @');
});
