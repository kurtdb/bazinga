'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const H = require('../src/core/history');

const sh = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();
function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bazinga-hist-'));
  // Windows' git defaults to core.autocrlf=true, which rewrites LF to CRLF on checkout/restore and breaks exact-content
  // assertions; pin it off so this throw-away repo behaves the same on every platform.
  sh(dir, 'init', '-q', '-b', 'main'); sh(dir, 'config', 'user.email', 'kurt@example.com'); sh(dir, 'config', 'user.name', 'Kurt'); sh(dir, 'config', 'core.autocrlf', 'false');
  const w = (f, t) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), t); };
  const commit = (m) => { sh(dir, 'add', '-A'); sh(dir, 'commit', '-q', '-m', m); return sh(dir, 'rev-parse', 'HEAD'); };
  return { dir, w, commit };
}
const C = (sha, ...parents) => ({ sha, parents });

test('layout: a linear history stays in lane 0 with no side lanes', () => {
  const rows = H.layoutGraph([C('c', 'b'), C('b', 'a'), C('a')]);
  assert.deepStrictEqual(rows.map((r) => r.lane), [0, 0, 0]);
  assert.deepStrictEqual(rows.map((r) => r.through), [[], [], []]);
  assert.deepStrictEqual(rows[0].outgoing, [0]);
  assert.deepStrictEqual(rows[2].outgoing, []);
});

test('layout: a feature branch and its merge use two lanes and re-join', () => {
  // m (merge of f2 and b2) ; f2 -> f1 -> base ; b2 -> base
  const rows = H.layoutGraph([C('m', 'b2', 'f2'), C('f2', 'f1'), C('b2', 'base'), C('f1', 'base'), C('base')]);
  assert.strictEqual(rows[0].lane, 0);
  assert.deepStrictEqual(rows[0].outgoing, [0, 1]);        // first parent stays, second parent opens lane 1
  assert.strictEqual(rows[1].lane, 1);                      // f2 sits in the side lane
  assert.deepStrictEqual(rows[1].through, [0]);             // while lane 0 passes by
  assert.strictEqual(rows[2].lane, 0);                      // b2 back in the main lane
  assert.strictEqual(rows[3].lane, 1);
  assert.deepStrictEqual(rows[3].outgoing, [0]);            // f1's edge bends back into lane 0, where base is already waiting
  const base = rows[4];
  assert.strictEqual(base.lane, 0);
  assert.deepStrictEqual(base.incoming, [0]);
  assert.strictEqual(base.lanes, 1);                        // the side lane is gone again
});

test('layout: two unrelated branch tips get their own lanes', () => {
  const rows = H.layoutGraph([C('x2', 'x1'), C('y2', 'y1'), C('x1'), C('y1')]);
  assert.deepStrictEqual(rows.map((r) => r.lane), [0, 1, 0, 1]);
});

test('layout never reuses a lane that is still waiting for a commit', () => {
  const rows = H.layoutGraph([C('m1', 'a', 'b'), C('m2', 'a', 'b'), C('a', 'r'), C('b', 'r'), C('r')]);
  for (const r of rows) assert.strictEqual(new Set(r.outgoing).size, r.outgoing.length);
  assert.ok(rows.every((r) => r.lane >= 0));
});

test('log: returns commits with refs, head flag and parents; layout runs on real data', async () => {
  const { dir, w, commit } = repo();
  w('a.txt', '1\n'); commit('first');
  sh(dir, 'checkout', '-q', '-b', 'feature');
  w('b.txt', '2\n'); commit('on feature');
  sh(dir, 'checkout', '-q', 'main');
  w('c.txt', '3\n'); commit('on main');
  sh(dir, 'merge', '-q', '--no-ff', 'feature', '-m', 'merge feature');
  const commits = await H.log(dir);
  assert.strictEqual(commits.length, 4);
  assert.strictEqual(commits[0].subject, 'merge feature');
  assert.strictEqual(commits[0].parents.length, 2);
  assert.ok(commits[0].head && commits[0].refs.includes('main'));
  assert.ok(commits.some((c) => c.refs.includes('feature')));
  const rows = H.layoutGraph(commits);
  assert.strictEqual(rows.length, 4);
  assert.ok(Math.max(...rows.map((r) => r.lanes)) >= 2);
  assert.deepStrictEqual(await H.log(fs.mkdtempSync(path.join(os.tmpdir(), 'bazinga-empty-'))), []);
});

test('stash: push (with untracked), list, apply, drop; refs are validated', async () => {
  const { dir, w, commit } = repo();
  w('a.txt', '1\n'); commit('first');
  w('a.txt', 'changed\n'); w('new.txt', 'u\n');
  await H.stashPush(dir, 'my stash');
  assert.strictEqual(fs.existsSync(path.join(dir, 'new.txt')), false);
  const list = await H.stashList(dir);
  assert.strictEqual(list.length, 1);
  assert.match(list[0].subject, /my stash/);
  await H.stashApply(dir, 'stash@{0}');
  assert.strictEqual(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8'), 'changed\n');
  await H.stashDrop(dir, 'stash@{0}');
  assert.deepStrictEqual(await H.stashList(dir), []);
  await assert.rejects(() => H.stashDrop(dir, '--all'), /Invalid stash/);
});

test('blame: attributes each line, marks uncommitted lines', async () => {
  const { dir, w, commit } = repo();
  w('a.txt', 'one\ntwo\n'); commit('first');
  w('a.txt', 'one\nTWO\nthree\n'); const second = commit('second');
  w('a.txt', 'one\nTWO\nthree\nfour\n');
  const b = await H.blame(dir, 'a.txt');
  assert.strictEqual(b.length, 4);
  assert.strictEqual(b[0].summary, 'first');
  assert.strictEqual(b[1].sha, second);
  assert.strictEqual(b[1].author, 'Kurt');
  assert.strictEqual(b[3].committed, false);
});

test('commitFiles / commitDiff: statuses, renames, the root commit, and sha validation', async () => {
  const { dir, w, commit } = repo();
  w('a.txt', 'one\n'); const first = commit('first');
  w('a.txt', 'one\ntwo\n'); w('gone.txt', 'x\n'); commit('second');
  sh(dir, 'mv', 'gone.txt', 'moved.txt'); fs.rmSync(path.join(dir, 'a.txt')); const third = commit('third');
  const f3 = await H.commitFiles(dir, third);
  assert.deepStrictEqual(f3.map((f) => f.status).sort(), ['D', 'R']);
  assert.strictEqual(f3.find((f) => f.status === 'R').oldPath, 'gone.txt');
  const d = await H.commitDiff(dir, first, 'a.txt');
  assert.deepStrictEqual(d, { original: '', modified: 'one\n' });
  const del = await H.commitDiff(dir, third, 'a.txt');
  assert.deepStrictEqual(del, { original: 'one\ntwo\n', modified: '' });
  const info = await H.commitInfo(dir, first);
  assert.strictEqual(info.message, 'first'); assert.strictEqual(info.author, 'Kurt');
  await assert.rejects(() => H.commitFiles(dir, '--output=/tmp/x'), /Invalid commit id/);
  await assert.rejects(() => H.commitInfo(dir, 'HEAD; rm -rf'), /Invalid commit id/);
});
