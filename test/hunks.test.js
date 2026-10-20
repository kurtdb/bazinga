'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const G = require('../src/core/git');

const sh = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' });
const nums = (n, f = (i) => `line ${i}`) => Array.from({ length: n }, (_, i) => f(i + 1)).join('\n') + '\n';
function repo(sub) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bazinga-hunk-'));
  sh(dir, 'init', '-q', '-b', 'main'); sh(dir, 'config', 'user.email', 't@t'); sh(dir, 'config', 'user.name', 't');
  const root = sub ? path.join(dir, sub) : dir;
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'f.txt'), nums(40));
  sh(dir, 'add', '-A'); sh(dir, 'commit', '-q', '-m', 'init');
  return { dir, root };
}
const edit = (root, map) => fs.writeFileSync(path.join(root, 'f.txt'), nums(40, (i) => map[i] ?? `line ${i}`));

test('fileHunks splits separated edits the way git does', async () => {
  const { root } = repo();
  edit(root, { 3: 'THREE', 30: 'THIRTY' });
  const { hunks } = await G.fileHunks(root, 'f.txt');
  assert.strictEqual(hunks.length, 2);
  assert.deepStrictEqual(hunks.map((h) => h.newStart), [3, 30]);
});

test('stageHunk stages only the change at the cursor line and leaves the working tree alone', async () => {
  const { dir, root } = repo();
  edit(root, { 3: 'THREE', 30: 'THIRTY' });
  const before = fs.readFileSync(path.join(root, 'f.txt'), 'utf8');
  const res = await G.stageHunk(root, 'f.txt', 30);
  assert.strictEqual(res.staged, 'hunk');
  const cached = sh(dir, 'diff', '--cached', '-U0');
  assert.match(cached, /\+THIRTY/); assert.doesNotMatch(cached, /THREE/);
  const unstaged = sh(dir, 'diff', '-U0');
  assert.match(unstaged, /\+THREE/); assert.doesNotMatch(unstaged, /THIRTY/);
  assert.strictEqual(fs.readFileSync(path.join(root, 'f.txt'), 'utf8'), before);
});

test('staging the second hunk after the first keeps line numbers right (index vs working tree)', async () => {
  const { dir, root } = repo();
  edit(root, { 3: 'THREE', 30: 'THIRTY' });
  await G.stageHunk(root, 'f.txt', 3);
  await G.stageHunk(root, 'f.txt', 30);
  assert.strictEqual(sh(dir, 'diff', '-U0').trim(), '');
  assert.match(sh(dir, 'diff', '--cached', '-U0'), /THREE[\s\S]*THIRTY/);
});

test('works for insertions and deletions, and from a sub-directory of the repository', async () => {
  const { dir, root } = repo('app');
  const lines = nums(40).split('\n'); lines.splice(9, 1); lines.splice(24, 0, 'inserted');
  fs.writeFileSync(path.join(root, 'f.txt'), lines.join('\n'));
  await G.stageHunk(root, 'f.txt', 10); // the deletion of "line 10": new-side line 10 is the one after the gap
  const cached = sh(dir, 'diff', '--cached', '-U0');
  assert.match(cached, /-line 10/); assert.doesNotMatch(cached, /inserted/);
});

test('unstageHunk takes one change back out of the index only', async () => {
  const { dir, root } = repo();
  edit(root, { 3: 'THREE', 30: 'THIRTY' });
  await G.stage(root, ['f.txt']);
  await G.unstageHunk(root, 'f.txt', 3);
  assert.match(sh(dir, 'diff', '--cached', '-U0'), /THIRTY/);
  assert.doesNotMatch(sh(dir, 'diff', '--cached', '-U0'), /THREE/);
  assert.match(sh(dir, 'diff', '-U0'), /\+THREE/);
});

test('untracked files are staged whole; a file without changes gives a clear error', async () => {
  const { dir, root } = repo();
  fs.writeFileSync(path.join(root, 'new.txt'), 'x\n');
  assert.strictEqual((await G.stageHunk(root, 'new.txt', 1)).staged, 'file');
  assert.match(sh(dir, 'status', '--porcelain'), /A  new.txt/);
  await assert.rejects(() => G.stageHunk(root, 'f.txt', 1), /no unstaged change/);
});

test('hunkAtLine picks the containing hunk, else the nearest', () => {
  const hunks = [{ index: 0, newStart: 3, newLines: 1 }, { index: 1, newStart: 30, newLines: 4 }, { index: 2, newStart: 50, newLines: 0 }];
  assert.strictEqual(G.hunkAtLine(hunks, 32).index, 1);
  assert.strictEqual(G.hunkAtLine(hunks, 10).index, 0);
  assert.strictEqual(G.hunkAtLine(hunks, 51).index, 2);
  assert.strictEqual(G.hunkAtLine([], 1), null);
});
