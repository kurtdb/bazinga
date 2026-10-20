'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const A = require('../src/core/awaysummary');
const runs = require('../src/core/runs');

const ev = (t, kind, text) => ({ t, kind, text });
test('away summary: each run lands in exactly one group, by its newest state', () => {
  const journals = {
    a: [ev(10, 'created', 'claude: fix login'), ev(100, 'guard', '2 blocker(s), 0 warning(s): secrets')],
    b: [ev(10, 'created', 'claude: add tests'), ev(120, 'guard', 'clean')],
    c: [ev(10, 'created', 'claude: refactor'), ev(130, 'merged', 'into main')],
    d: [ev(10, 'created', 'claude: spike'), ev(140, 'discarded')],
    e: [ev(10, 'created', 'claude: old'), ev(20, 'merged', 'into main')],
    f: [ev(10, 'created', 'claude: idle'), ev(150, 'agent-started', 'x')],
  };
  const live = [{ id: 'a', name: 'fix login', files: 3, commits: 0 }, { id: 'b', name: 'add tests', files: 2, commits: 1 }, { id: 'f', name: 'idle', files: 0, commits: 0 }];
  const s = A.summarize({ journals, live, since: 50, now: 200 });
  assert.deepEqual(s.groups.needsYou.map((x) => x.id), ['a']);
  assert.deepEqual(s.groups.ready.map((x) => x.id), ['b']);
  assert.deepEqual(s.groups.merged.map((x) => x.id), ['c']);
  assert.deepEqual(s.groups.discarded.map((x) => x.id), ['d']);
  assert.equal(s.total, 4);
  assert.match(A.headline(s), /1 run need.*1 ready to review, 1 merged, 1 thrown away/);
  assert.equal(s.groups.merged[0].name, 'refactor');
});
test('away summary: nothing new is said plainly; a clean guard is not a problem; a fixed run is not "needs you"', () => {
  assert.equal(A.summarize({ journals: { a: [ev(1, 'created', 'x: y')] }, since: 5 }).empty, true);
  assert.match(A.headline(A.summarize({})), /Nothing happened/);
  assert.equal(A.stateOf([ev(100, 'guard', '0 blocker(s), 1 warning(s): x')], 50).state, 'activity');
  assert.equal(A.stateOf([ev(100, 'guard', '1 blocker(s), 0 warning(s): x'), ev(110, 'guard', 'clean')], 50).state, 'activity');
});

// ---- undo a merged run, against a real git repository
const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();
function repo() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'undo-'));
  git(d, 'init', '-q', '-b', 'main'); git(d, 'config', 'user.email', 't@t'); git(d, 'config', 'user.name', 't');
  fs.writeFileSync(path.join(d, 'a.txt'), 'one\n'); git(d, 'add', '-A'); git(d, 'commit', '-q', '-m', 'init');
  return d;
}
test('merging a run remembers the commit, and undo adds a revert commit that restores the files', async () => {
  const d = repo();
  const run = await runs.createRun(d, { name: 'add b', task: 'add b' });
  fs.writeFileSync(path.join(run.root, 'b.txt'), 'new\n');
  const res = await runs.mergeRun(d, run.id, { message: 'Agent run: add b' });
  assert.ok(res.commit);
  assert.ok(fs.existsSync(path.join(d, 'b.txt')));
  const list = await runs.listMerged(d);
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'add b');
  const before = git(d, 'rev-list', '--count', 'HEAD');
  const u = await runs.undoMerged(d, res.commit);
  assert.equal(u.undone, 'add b');
  assert.ok(!fs.existsSync(path.join(d, 'b.txt')));
  assert.equal(Number(git(d, 'rev-list', '--count', 'HEAD')), Number(before) + 1); // history only grew
  assert.equal((await runs.listMerged(d)).length, 0);
  await assert.rejects(() => runs.undoMerged(d, 'deadbeef'), /not in the list/);
});
test('undo refuses on uncommitted changes, and clashing later changes leave everything as it was', async () => {
  const d = repo();
  const run = await runs.createRun(d, { name: 'edit a', task: 'edit a' });
  fs.writeFileSync(path.join(run.root, 'a.txt'), 'agent\n');
  const res = await runs.mergeRun(d, run.id, { message: 'Agent run: edit a' });
  fs.writeFileSync(path.join(d, 'a.txt'), 'dirty\n');
  await assert.rejects(() => runs.undoMerged(d, res.commit), /uncommitted changes/);
  git(d, 'checkout', '--', 'a.txt');
  fs.writeFileSync(path.join(d, 'a.txt'), 'someone else changed it later\n'); git(d, 'commit', '-qam', 'later');
  const head = git(d, 'rev-parse', 'HEAD');
  await assert.rejects(() => runs.undoMerged(d, res.commit), /would clash.*nothing was changed/s);
  assert.equal(git(d, 'rev-parse', 'HEAD'), head);
  assert.equal(git(d, 'status', '--porcelain'), '');
  assert.equal((await runs.listMerged(d)).length, 1); // still undoable by hand
});
