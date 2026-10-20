'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sc = require('../src/core/scorecard');

test('kindOf: what a task text is about (specific kinds before general ones)', () => {
  const k = sc.kindOf;
  assert.equal(k('Write unit tests for the OrderService'), 'tests');
  assert.equal(k('Add JUnit coverage for AddressForm'), 'tests');
  assert.equal(k('Fix the NullPointerException in PaymentController'), 'bugfix');
  assert.equal(k('Fix the failing test in billing'), 'tests', 'a failing test is test work');
  assert.equal(k('Refactor the currency formatter into one util'), 'refactor');
  assert.equal(k('Rename UserDto to AccountDto everywhere'), 'refactor');
  assert.equal(k('Implement a new endpoint for postcode validation'), 'feature');
  assert.equal(k('Update the README with install steps'), 'docs');
  assert.equal(k('Explain how the retry logic works'), 'review');
  assert.equal(k('Review this diff for security problems'), 'review');
  assert.equal(k('tidy up'), 'other');
  assert.equal(k(''), 'other');
  assert.equal(k(null), 'other');
});

test('makeRecord: outcome and escalation decide the result; junk is cleaned', () => {
  const m = (o) => sc.makeRecord({ agent: 'qwen', task: 'write tests', ...o });
  assert.equal(m({ outcome: 'merged' }).result, 'win');
  assert.equal(m({ outcome: 'merged', escalatedTo: 'Claude' }).result, 'helped');
  assert.equal(m({ outcome: 'lost' }).result, 'lost');
  assert.equal(m({ outcome: 'discarded' }).result, 'failed');
  assert.equal(m({ outcome: 'whatever' }).result, 'failed');
  assert.equal(m({}).kind, 'tests');
  assert.equal(m({ kind: 'nonsense' }).kind, 'tests');
  assert.equal(m({ fixRounds: -3, activeMs: 'x', files: NaN }).fixRounds, 0);
  assert.equal(m({ agent: 'x'.repeat(500) }).agent.length, 80);
});

test('add/load: records are kept in order, capped, and a broken file reads as empty', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bz-sc-'));
  const file = path.join(dir, 'sub', 'scorecard.json');
  assert.deepEqual(sc.load(file), []);
  for (let i = 0; i < sc.MAX_RECORDS + 5; i++) sc.add(file, { agent: `a${i}`, outcome: 'merged', task: 'fix bug' });
  const all = sc.load(file);
  assert.equal(all.length, sc.MAX_RECORDS);
  assert.equal(all[0].agent, 'a5');
  assert.equal(all.at(-1).agent, `a${sc.MAX_RECORDS + 4}`);
  fs.writeFileSync(file, '{not json');
  assert.deepEqual(sc.load(file), []);
  fs.writeFileSync(file, JSON.stringify({ records: [null, 5, { agent: 'ok', kind: 'tests' }] }));
  assert.equal(sc.load(file).length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

const rec = (agent, kind, result, extra = {}) => ({ at: 1000, agent, kind, result, local: false, fixLoop: true, fixRounds: 0, activeMs: 60000, ...extra });

test('summarize: counts per agent and kind, first-pass only where the fix loop was on', () => {
  const rows = sc.summarize([
    rec('qwen', 'tests', 'win', { local: true }), rec('qwen', 'tests', 'win', { local: true, fixRounds: 2 }), rec('qwen', 'tests', 'helped', { local: true, fixRounds: 3 }), rec('qwen', 'tests', 'failed', { local: true, fixLoop: false }),
    rec('Claude', 'tests', 'win'), rec('Claude', 'bugfix', 'lost'),
  ]);
  const q = rows.find((r) => r.agent === 'qwen' && r.kind === 'tests');
  assert.equal(q.runs, 4); assert.equal(q.win, 2); assert.equal(q.helped, 1); assert.equal(q.failed, 1);
  assert.equal(q.winRate, 0.5);
  assert.equal(q.loopRuns, 3); assert.equal(q.firstPass, 1); // only the first one needed no fix round and was not a failure
  assert.equal(q.avgRounds, (0 + 2 + 3) / 3);
  assert.equal(q.local, true); assert.equal(q.enough, true);
  assert.equal(rows.find((r) => r.agent === 'Claude' && r.kind === 'bugfix').lost, 1);
  assert.equal(rows.find((r) => r.agent === 'Claude' && r.kind === 'tests').enough, false);
  assert.deepEqual(sc.summarize([rec('a', 'tests', 'win', { at: 5 })], { since: 10 }), []);
});

test('recommend: needs enough runs, ranks by working alone, then rounds, then time; says nothing otherwise', () => {
  const many = (agent, kind, wins, fails, extra = {}) => [...Array(wins).fill(0).map(() => rec(agent, kind, 'win', extra)), ...Array(fails).fill(0).map(() => rec(agent, kind, 'failed', extra))];
  const rows = sc.summarize([...many('qwen', 'tests', 4, 1, { local: true }), ...many('Claude', 'tests', 3, 0), ...many('lucky', 'tests', 1, 0)]);
  const r = sc.recommend(rows, 'tests');
  assert.equal(r.agent, 'Claude', '3 of 3 beats 4 of 5; the 1-run agent is an anecdote');
  assert.equal(r.runnerUp.agent, 'qwen');
  assert.match(r.text, /Claude: 3 of 3 merged without help \(next: qwen, 4 of 5\)/);
  assert.equal(sc.recommend(rows, 'docs'), null);
  assert.equal(sc.recommend(sc.summarize(many('x', 'tests', 2, 0)), 'tests'), null);
  // exact tie: fewer fix rounds, then the local (free) one
  const tie = sc.summarize([...many('cloud', 'bugfix', 3, 0, { fixRounds: 1 }), ...many('local', 'bugfix', 3, 0, { fixRounds: 1, local: true })]);
  assert.equal(sc.recommend(tie, 'bugfix').agent, 'local');
  const fewer = sc.summarize([...many('cloud', 'bugfix', 3, 0, { fixRounds: 0 }), ...many('local', 'bugfix', 3, 0, { fixRounds: 2, local: true })]);
  assert.equal(sc.recommend(fewer, 'bugfix').agent, 'cloud');
});

test('cost per merged run: failed attempts count, local is free, no numbers is unknown (not free)', () => {
  const mk = (o) => sc.makeRecord({ agent: 'Cloud', model: 'sonnet', task: 'fix a bug', ...o });
  const rows = sc.summarize([
    mk({ outcome: 'merged', costUsd: 0.4 }), mk({ outcome: 'merged', costUsd: 0.2 }), mk({ outcome: 'discarded', costUsd: 0.6 }),
    mk({ agent: 'Local', local: true, outcome: 'merged', costUsd: 5 }),
    mk({ agent: 'NoData', outcome: 'merged' }),
  ]);
  const by = (a) => rows.find((r) => r.agent === a);
  assert.equal(by('Cloud').costPerMerged.toFixed(2), '0.60'); // 1.2 / 2 merged
  assert.equal(by('Local').costPerMerged, 0); assert.equal(by('Local').costUsd, 0, 'a local model never has a price');
  assert.equal(by('NoData').costPerMerged, null);
  assert.deepEqual([sc.formatCost(0), sc.formatCost(null), sc.formatCost(0.004), sc.formatCost(0.6), sc.formatCost(12.34)], ['free', '?', '<$0.01', '$0.60', '$12.3']);
});
