'use strict';
const test = require('node:test');
const assert = require('node:assert');
const B = require('../src/core/bestof');
const Board = require('../src/core/board');
const F = require('../src/core/fleet');

const file = (added, removed, hash) => ({ added, removed, hash });
const sum = (name, files, gates) => ({ id: name, name, agent: name, files, gates });

test('plan: copies per agent, unique labels, at most six runs', () => {
  const l = (a) => a.name;
  assert.deepStrictEqual(B.plan([{ agent: { name: 'qwen' }, copies: 1 }, { agent: { name: 'claude' }, copies: 1 }], l).map((p) => p.label), ['qwen', 'claude']);
  assert.deepStrictEqual(B.plan([{ agent: { name: 'qwen' }, copies: 3 }], l).map((p) => p.label), ['qwen 1', 'qwen 2', 'qwen 3']);
  assert.strictEqual(B.plan([{ agent: { name: 'a' }, copies: 3 }, { agent: { name: 'b' }, copies: 3 }, { agent: { name: 'c' }, copies: 3 }], l).length, B.MAX_RUNS);
  assert.deepStrictEqual(B.plan([{ agent: { name: 'a' }, copies: 0 }, { agent: { name: 'b' }, copies: -2 }, { agent: { name: 'c' }, copies: 'x' }], l), []);
});

test('rank: gates first, then the smaller change; runs that changed nothing come last', () => {
  const r = B.rank([
    sum('big-green', { 'a.js': file(100, 10, 'h1') }, { errors: 0, warnings: 0 }),
    sum('small-red', { 'a.js': file(3, 1, 'h2') }, { errors: 2, warnings: 0 }),
    sum('small-green', { 'a.js': file(5, 1, 'h3') }, { errors: 0, warnings: 0 }),
    sum('nothing', {}, { errors: 0, warnings: 0 }),
  ]);
  assert.deepStrictEqual(r.rows.map((x) => x.name), ['small-green', 'big-green', 'small-red', 'nothing']);
  assert.strictEqual(r.best, 'small-green'); assert.strictEqual(r.rows[0].best, true);
  assert.match(r.rows[2].text, /2 gate errors/); assert.match(r.rows[3].text, /changed nothing/); assert.match(r.rows[0].text, /gates green/);
});

test('rank: warnings break ties between green runs, identical results are named, gates not run is said', () => {
  const same = { 'a.js': file(4, 0, 'same') };
  const r = B.rank([sum('x', same, { errors: 0, warnings: 3 }), sum('y', same, { errors: 0, warnings: 1 }), sum('z', { 'b.js': file(1, 0, 'o') }, { error: 'no gates' })]);
  assert.deepStrictEqual(r.rows.map((x) => x.name), ['z', 'y', 'x'], 'unknown gates are not punished: z is smallest');
  assert.match(r.rows.find((x) => x.name === 'x').text, /same result as y/);
  assert.match(r.rows.find((x) => x.name === 'z').text, /gates not run/);
});

test('rank: nobody changed anything -> no suggestion; no gates at all -> the note says the ranking is by size only', () => {
  const none = B.rank([sum('a', {}), sum('b', {})]);
  assert.strictEqual(none.best, null); assert.match(none.note, /None of the runs changed anything/);
  const nogates = B.rank([sum('a', { 'x': file(1, 0, 'h') }), sum('b', { 'x': file(2, 0, 'h2') })]);
  assert.strictEqual(nogates.best, 'a'); assert.match(nogates.note, /Gates were not run/);
  assert.deepStrictEqual(B.rank([]).rows, []);
});

test('finished: every run stopped working (idle, waiting for approval or exited); a run without a terminal counts as stopped', () => {
  assert.strictEqual(B.finished(['a', 'b'], { a: 'idle', b: 'exited' }), true);
  assert.strictEqual(B.finished(['a', 'b'], { a: 'idle', b: 'running' }), false);
  assert.strictEqual(B.finished(['a', 'b'], { a: 'stale', b: 'idle' }), false, 'stale means maybe stuck, not finished');
  assert.strictEqual(B.finished([], {}), false);
});

test('board: running / needs you / review, the most urgent terminal decides, backlog hides items that already have a run', () => {
  const runs = [{ id: 'r1', name: 'one', files: 2 }, { id: 'r2', name: 'two', files: 0 }, { id: 'r3', name: 'three', files: 5 }, { id: 'r4', name: 'AB#12 login', task: 'x', branch: 'agent/ab-12', files: 1 }, { id: 'r5', name: 'five', files: 1 }];
  const rows = [
    { runId: 'r1', state: 'running' }, { runId: 'r1', state: 'waiting' }, { runId: 'r2', state: 'stale' }, { runId: 'r3', state: 'exited' }, { runId: 'r4', state: 'idle' },
  ];
  const cols = Board.build(runs, rows);
  assert.deepStrictEqual(cols.running.map((c) => c.run.id), []);
  assert.deepStrictEqual(cols.needs.map((c) => c.run.id), ['r1', 'r2', 'r4'], 'waiting first, then stale, then idle');
  assert.deepStrictEqual(cols.review.map((c) => c.run.id), ['r3', 'r5'], 'no terminal at all = ready to look at');
  assert.deepStrictEqual(Board.build([{ id: 'x', files: 0 }], [{ runId: 'x', state: 'running' }]).running.length, 1);
  const items = [{ id: '12', title: 'login' }, { id: '13', title: 'logout' }, { id: 'PROJ-7', ref: 'PROJ-7', title: 'j' }];
  assert.deepStrictEqual(Board.backlog(items, [...runs, { id: 'j', name: 'proj-7 fix', task: '', branch: '' }]).map((w) => w.id), ['13']);
  assert.strictEqual(Board.columnOf('exited'), 'review'); assert.strictEqual(Board.columnOf('waiting'), 'needs'); assert.strictEqual(Board.columnOf('running'), 'running');
});

test('fleet: a running subagent keeps the parent from being called stale, and the rows carry the run id and the subagents', () => {
  const now = 9_000_000;
  const quiet = { key: 'k', runId: 'r1', startedAt: now - 20 * 60000, lastData: now - 15 * 60000, context: 8192 };
  assert.strictEqual(F.row(quiet, now).state, 'stale');
  const withSub = F.row({ ...quiet, subagents: [{ id: 'a1', type: 'Explore', startedAt: now - 60000 }] }, now);
  assert.strictEqual(withSub.state, 'running'); assert.strictEqual(withSub.runId, 'r1'); assert.strictEqual(withSub.subagents[0].type, 'Explore');
  assert.strictEqual(F.row({ ...quiet, subagents: [{ id: 'a1', type: 'Explore', startedAt: now - 900000, endedAt: now - 800000 }] }, now).state, 'stale', 'a finished subagent does not count');
});
