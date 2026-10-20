'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { UsageTally } = require('../src/core/usagetally');
const runstats = require('../src/core/runstats');

const R = path.join(path.sep, 'w', 'run1');
const snap = (o) => ({ costUsd: 0, input: 0, output: 0, cacheRead: 0, cacheCreation: 0, model: 'sonnet', ...o });

test('a run adds up its terminals (a hand-over starts a second agent in the same folder)', () => {
  const t = new UsageTally();
  t.update(1, R, snap({ costUsd: 0.5, input: 100, output: 10, cacheRead: 50 }));
  t.update(2, R, snap({ costUsd: 0.25, input: 10, output: 5 }));
  t.update(3, path.join(path.sep, 'w', 'other'), snap({ costUsd: 9 }));
  assert.deepEqual(t.sumFor(R), { costUsd: 0.75, input: 160, output: 15 });
  t.update(1, R, snap({ costUsd: 0.6, input: 120, output: 12, cacheRead: 50 })); // running totals replace, they do not add
  assert.equal(t.sumFor(R).costUsd.toFixed(2), '0.85');
});

test('a terminal in a sub-folder of the run counts, a sibling with a similar name does not', () => {
  const t = new UsageTally();
  t.update(1, path.join(R, 'sub'), snap({ costUsd: 1 }));
  t.update(2, `${R}2`, snap({ costUsd: 5 }));
  assert.equal(t.sumFor(R).costUsd, 1);
});

test('without a reported cost the estimate from the prices is used; no estimate means 0, not a crash', () => {
  const t = new UsageTally({ estimate: (s) => (s.model === 'sonnet' ? 0.3 : null) });
  t.update(1, R, snap({ input: 10 }));
  t.update(2, R, snap({ model: 'unknown', input: 10 }));
  assert.equal(t.sumFor(R).costUsd, 0.3);
});

test('saving to the run is throttled, and the newest numbers are still folded in when the run ends', () => {
  let clock = 1_000_000; const saved = [];
  const t = new UsageTally({ every: 15000, now: () => clock, save: (root, sum) => saved.push(sum.costUsd) });
  t.update(1, R, snap({ costUsd: 1 }));
  clock += 5000; t.update(1, R, snap({ costUsd: 2 }));
  clock += 5000; t.update(1, R, snap({ costUsd: 3 }));
  assert.deepEqual(saved, [1], 'one write in the first 15 s');
  clock += 20000; t.update(1, R, snap({ costUsd: 4 }));
  assert.deepEqual(saved, [1, 4]);
  t.update(1, R, snap({ costUsd: 5 })); // not saved yet ...
  const stats = t.fold(runstats.setUsage(runstats.empty(), { costUsd: 4 }), R);
  assert.equal(stats.costUsd, 5, '... but the outcome still sees it');
});

test('bad input is ignored', () => {
  const t = new UsageTally();
  assert.equal(t.update(1, '', snap({})), false);
  assert.equal(t.update(1, R, null), false);
  assert.deepEqual(t.sumFor(R), { costUsd: 0, input: 0, output: 0 });
});
