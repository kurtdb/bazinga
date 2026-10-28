'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeVerdict } = require('../src/core/verdict');

const blockedGuard = { ok: false, clean: false, blockers: 1, warnings: 0, items: [{ id: 'errors', level: 'block' }] };
const warnGuard = { ok: true, clean: false, blockers: 0, warnings: 1, items: [{ id: 'scope', level: 'warn' }] };
const cleanGuard = { ok: true, clean: true, blockers: 0, warnings: 0, items: [] };
const strongRow = { agent: 'Claude', kind: 'bugfix', runs: 10, win: 9, winRate: 0.9, enough: true };
const thinRow = { agent: 'Claude', kind: 'bugfix', runs: 2, win: 2, winRate: 1, enough: false };

test('a guard with blockers is "blocked", whatever the scorecard says', () => {
  const r = mergeVerdict({ guard: blockedGuard, scorecardRows: [strongRow], agent: 'Claude', kind: 'bugfix' });
  assert.equal(r.level, 'blocked');
  assert.equal(r.autoMergeEligible, false);
});

test('a guard with only warnings is "caution", not blocked', () => {
  const r = mergeVerdict({ guard: warnGuard, scorecardRows: [strongRow], agent: 'Claude', kind: 'bugfix' });
  assert.equal(r.level, 'caution');
  assert.equal(r.autoMergeEligible, false);
});

test('clean guard but not enough scorecard history is "caution" too, with the real reason spelled out - not hidden behind "auto-merge is off"', () => {
  const r = mergeVerdict({ guard: cleanGuard, scorecardRows: [thinRow], agent: 'Claude', kind: 'bugfix' });
  assert.equal(r.level, 'caution');
  assert.match(r.detail, /not enough history/);
});

test('clean guard + a proven track record is "ready", and this holds even when the project\'s own auto-merge is off', () => {
  const r = mergeVerdict({ guard: cleanGuard, scorecardRows: [strongRow], agent: 'Claude', kind: 'bugfix', autoMergeCfg: { enabled: false } });
  assert.equal(r.level, 'ready');
  assert.equal(r.autoMergeEligible, true);
  assert.match(r.detail, /Claude wins 90% of bugfix tasks/);
});

test('respects a project-level minWinRate when deciding readiness', () => {
  const weakRow = { agent: 'Claude', kind: 'bugfix', runs: 10, win: 6, winRate: 0.6, enough: true };
  const r = mergeVerdict({ guard: cleanGuard, scorecardRows: [weakRow], agent: 'Claude', kind: 'bugfix', autoMergeCfg: { minWinRate: 0.8 } });
  assert.equal(r.level, 'caution');
  assert.match(r.detail, /win rate too low/);
});
