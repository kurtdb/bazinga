'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const R = require('../src/core/runs');
const G = require('../src/core/git');

const sh = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' });
const write = (root, rel, t) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), t); };

function repo(files = { 'a.txt': 'one\n' }) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'bazinga-r-'));
  const root = path.join(parent, 'proj');
  fs.mkdirSync(root);
  sh(root, 'init', '-q', '-b', 'main'); sh(root, 'config', 'user.email', 't@t'); sh(root, 'config', 'user.name', 't');
  for (const [k, v] of Object.entries(files)) write(root, k, v);
  sh(root, 'add', '.'); sh(root, 'commit', '-q', '-m', 'init');
  return fs.realpathSync(root);
}

test('createRun makes a worktree on agent/<slug> outside the repo, copies .ide, lists it', async () => {
  const root = repo();
  write(root, '.ide/config.json', '{"autoCheck":true}');
  const run = await R.createRun(root, { name: 'Fix the Button!', task: 'make it blue', agent: 'Claude' });
  assert.equal(run.branch, 'agent/fix-the-button');
  assert.ok(run.root.startsWith(path.join(path.dirname(root), 'proj.worktrees')));
  assert.ok(fs.existsSync(path.join(run.root, 'a.txt')));
  assert.equal(fs.readFileSync(path.join(run.root, '.ide/config.json'), 'utf8'), '{"autoCheck":true}');
  assert.equal(sh(root, 'status', '--porcelain').includes('worktrees'), false);
  const second = await R.createRun(root, { name: 'Fix the Button' });
  assert.equal(second.branch, 'agent/fix-the-button-2');
  const { main, runs } = await R.listRuns(run.root); // works when asked from inside a worktree too
  assert.equal(main.root, root);
  assert.deepEqual(runs.map((r) => r.id).sort(), ['fix-the-button', 'fix-the-button-2']);
  assert.equal(runs.find((r) => r.id === run.id).task, 'make it blue');
});

test('changes in a run are isolated; prepareReview folds the agent’s own commits into staged changes', async () => {
  const root = repo();
  const run = await R.createRun(root, { name: 'edit' });
  write(run.root, 'a.txt', 'two\n');
  sh(run.root, 'add', '-A'); sh(run.root, 'commit', '-q', '-m', 'agent commit');
  write(run.root, 'new.txt', 'x\n');
  assert.equal(fs.readFileSync(path.join(root, 'a.txt'), 'utf8'), 'one\n');
  assert.equal((await G.changedFiles(run.root)).length, 1); // only new.txt: a.txt is already committed
  const res = await R.prepareReview(root, run.id);
  assert.equal(res.folded, 1);
  const files = (await G.changedFiles(run.root)).map((f) => f.path).sort();
  assert.deepEqual(files, ['a.txt', 'new.txt']);
  assert.equal((await R.listRuns(root)).runs[0].commits, 0);
});

test('mergeRun squashes into the main branch, removes worktree and branch', async () => {
  const root = repo();
  const run = await R.createRun(root, { name: 'feature' });
  write(run.root, 'a.txt', 'two\n'); write(run.root, 'b.txt', 'b\n');
  const res = await R.mergeRun(root, run.id, { message: 'Add feature' });
  assert.equal(res.merged, 'agent/feature'); assert.equal(res.into, 'main');
  assert.equal(fs.readFileSync(path.join(root, 'a.txt'), 'utf8'), 'two\n');
  assert.equal(sh(root, 'log', '-1', '--format=%s').trim(), 'Add feature');
  assert.equal(sh(root, 'status', '--porcelain').trim(), '');
  assert.ok(!fs.existsSync(run.top));
  assert.equal(sh(root, 'branch', '--list', 'agent/*').trim(), '');
  assert.deepEqual((await R.listRuns(root)).runs, []);
});

test('mergeRun refuses a dirty main tree, and rolls back on conflicts', async () => {
  const root = repo();
  const run = await R.createRun(root, { name: 'conflict' });
  write(run.root, 'a.txt', 'agent\n');
  write(root, 'dirty.txt', 'x\n');
  await assert.rejects(() => R.mergeRun(root, run.id, {}), /uncommitted changes/);
  fs.unlinkSync(path.join(root, 'dirty.txt'));
  write(root, 'a.txt', 'main\n'); sh(root, 'commit', '-qam', 'main moves on');
  await assert.rejects(() => R.mergeRun(root, run.id, {}), (e) => { assert.deepEqual(e.conflicts, ['a.txt']); return true; });
  assert.equal(fs.readFileSync(path.join(root, 'a.txt'), 'utf8'), 'main\n');
  assert.equal(sh(root, 'status', '--porcelain').trim(), '');
  assert.equal((await R.listRuns(root)).runs.length, 1); // still there, nothing lost
});

test('removeRun discards worktree and branch; needs a commit to start', async () => {
  const root = repo();
  const run = await R.createRun(root, { name: 'throwaway' });
  write(run.root, 'junk.txt', 'x');
  await R.removeRun(root, run.id);
  assert.ok(!fs.existsSync(run.top));
  assert.equal(sh(root, 'branch', '--list', 'agent/*').trim(), '');
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'bazinga-r-'));
  sh(empty, 'init', '-q');
  await assert.rejects(() => R.createRun(empty, { name: 'x' }), /at least one commit/);
});

test('repositories opened in a sub-folder get the same sub-folder inside the worktree', async () => {
  const root = repo({ 'svc/app.js': 'x\n', 'svc/.ide/config.json': '{}' });
  const sub = path.join(root, 'svc');
  const run = await R.createRun(sub, { name: 'sub' });
  assert.equal(run.root, path.join(run.top, 'svc'));
  assert.ok(fs.existsSync(path.join(run.root, 'app.js')));
  const list = await R.listRuns(sub);
  assert.equal(list.runs[0].root, run.root);
  assert.equal(list.main.root, sub);
});

test('starting a run while inside another run still branches from the main checkout', async () => {
  const root = repo();
  const first = await R.createRun(root, { name: 'first' });
  write(first.root, 'x.txt', 'x'); sh(first.root, 'add', '-A'); sh(first.root, 'commit', '-q', '-m', 'agent work');
  const second = await R.createRun(first.root, { name: 'second' }); // asked from inside the first run's worktree
  assert.equal(second.baseBranch, 'main');
  assert.equal(second.baseCommit, sh(root, 'rev-parse', 'HEAD').trim());
  assert.ok(!fs.existsSync(path.join(second.root, 'x.txt')));
});

test('recordMeta adds facts to a run (who took over) without losing the rest, and says false outside a run', async () => {
  const root = repo();
  const run = await R.createRun(root, { name: 'meta', task: 't', agent: 'qwen' });
  assert.equal(await R.recordMeta(run.root, { escalatedTo: 'Claude' }), true);
  const { run: again } = await R.findRun(root, run.id);
  assert.equal(again.escalatedTo, 'Claude');
  assert.equal(again.agent, 'qwen'); assert.equal(again.task, 't');
  assert.equal(await R.recordMeta(root, { escalatedTo: 'x' }), false);
  await R.removeRun(root, run.id);
});
