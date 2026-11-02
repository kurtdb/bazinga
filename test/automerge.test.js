'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { autoMergeEligible } = require('../src/core/automerge');

const cleanGuard = { ok: true, clean: true, blockers: 0, warnings: 0, items: [] };
const dirtyGuard = { ok: true, clean: false, blockers: 0, warnings: 1, items: [{ id: 'scope', level: 'warn' }] };
const strongRow = { agent: 'Claude', kind: 'bugfix', runs: 10, win: 9, winRate: 0.9, enough: true };
const thinRow = { agent: 'Claude', kind: 'bugfix', runs: 2, win: 2, winRate: 1, enough: false };
const weakRow = { agent: 'Claude', kind: 'bugfix', runs: 10, win: 6, winRate: 0.6, enough: true };

test('off by default: no cfg or cfg.enabled false is never eligible, whatever the guard and track record say', () => {
  assert.equal(autoMergeEligible({ guard: cleanGuard, scorecardRows: [strongRow], agent: 'Claude', kind: 'bugfix' }).eligible, false);
  assert.equal(autoMergeEligible({ guard: cleanGuard, scorecardRows: [strongRow], agent: 'Claude', kind: 'bugfix', cfg: { enabled: false } }).eligible, false);
});

test('a guard that is ok but not fully clean blocks auto-merge', () => {
  const r = autoMergeEligible({ guard: dirtyGuard, scorecardRows: [strongRow], agent: 'Claude', kind: 'bugfix', cfg: { enabled: true } });
  assert.equal(r.eligible, false);
  assert.match(r.reason, /guard/i);
});

test('no guard result at all blocks auto-merge', () => {
  assert.equal(autoMergeEligible({ guard: null, scorecardRows: [strongRow], agent: 'Claude', kind: 'bugfix', cfg: { enabled: true } }).eligible, false);
});

test('not enough runs for this agent+kind blocks it, even at 100% win rate', () => {
  const r = autoMergeEligible({ guard: cleanGuard, scorecardRows: [thinRow], agent: 'Claude', kind: 'bugfix', cfg: { enabled: true } });
  assert.equal(r.eligible, false);
  assert.match(r.reason, /not enough history/);
});

test('no record at all for this agent+kind blocks it', () => {
  const r = autoMergeEligible({ guard: cleanGuard, scorecardRows: [strongRow], agent: 'Claude', kind: 'docs', cfg: { enabled: true } });
  assert.equal(r.eligible, false);
});

test('a win rate under the threshold blocks it', () => {
  const r = autoMergeEligible({ guard: cleanGuard, scorecardRows: [weakRow], agent: 'Claude', kind: 'bugfix', cfg: { enabled: true, minWinRate: 0.8 } });
  assert.equal(r.eligible, false);
  assert.match(r.reason, /win rate too low/);
});

test('clean guard + enough runs + high enough win rate is eligible, with the reason spelled out', () => {
  const r = autoMergeEligible({ guard: cleanGuard, scorecardRows: [strongRow], agent: 'Claude', kind: 'bugfix', cfg: { enabled: true, minWinRate: 0.8 } });
  assert.equal(r.eligible, true);
  assert.match(r.reason, /Claude wins 90% of bugfix tasks \(10 runs\)/);
});

test('minWinRate defaults to 0.8 when the config omits it', () => {
  const r = autoMergeEligible({ guard: cleanGuard, scorecardRows: [strongRow], agent: 'Claude', kind: 'bugfix', cfg: { enabled: true } });
  assert.equal(r.eligible, true);
});

test('kinds: a kind not in the allow-list is never eligible, even with a clean guard and a strong record', () => {
  const r = autoMergeEligible({ guard: cleanGuard, scorecardRows: [strongRow], agent: 'Claude', kind: 'bugfix', cfg: { enabled: true, kinds: ['docs', 'tests'] } });
  assert.equal(r.eligible, false);
  assert.match(r.reason, /off for "bugfix" tasks/);
});

test('kinds: a kind in the allow-list is unaffected', () => {
  const r = autoMergeEligible({ guard: cleanGuard, scorecardRows: [strongRow], agent: 'Claude', kind: 'bugfix', cfg: { enabled: true, kinds: ['bugfix'] } });
  assert.equal(r.eligible, true);
});

test('kinds: null or an empty list means every kind is allowed, same as today', () => {
  assert.equal(autoMergeEligible({ guard: cleanGuard, scorecardRows: [strongRow], agent: 'Claude', kind: 'bugfix', cfg: { enabled: true, kinds: null } }).eligible, true);
  assert.equal(autoMergeEligible({ guard: cleanGuard, scorecardRows: [strongRow], agent: 'Claude', kind: 'bugfix', cfg: { enabled: true, kinds: [] } }).eligible, true);
});
