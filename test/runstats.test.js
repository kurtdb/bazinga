'use strict';
const test = require('node:test');
const assert = require('node:assert');
const R = require('../src/core/runstats');
const { IdleDetector } = require('../src/core/idle');

test('busy periods add up, rounds count, input is never mutated', () => {
  const a = R.addBusy(undefined, 90_000);
  const b = R.addBusy(a, 30_000);
  const c = R.addRound(R.addRound(b));
  assert.deepStrictEqual(a, { activeMs: 90000, busyPeriods: 1, fixRounds: 0, fixLoopRuns: 0, costUsd: 0, tokensIn: 0, tokensOut: 0 });
  assert.deepStrictEqual(c, { activeMs: 120000, busyPeriods: 2, fixRounds: 2, fixLoopRuns: 0, costUsd: 0, tokensIn: 0, tokensOut: 0 });
});

test('garbage in the stored metadata does not break the summary', () => {
  assert.deepStrictEqual(R.normalize({ activeMs: 'x', busyPeriods: -3, fixRounds: NaN }), R.empty());
  assert.strictEqual(R.summarize(null), '');
  assert.strictEqual(R.summarize('nonsense'), '');
});

test('format and summary', () => {
  assert.strictEqual(R.formatDuration(300), '<1s');
  assert.strictEqual(R.formatDuration(45_000), '45s');
  assert.strictEqual(R.formatDuration(12 * 60_000), '12m');
  assert.strictEqual(R.formatDuration(65 * 60_000), '1h 05m');
  assert.strictEqual(R.summarize({ activeMs: 12 * 60_000, busyPeriods: 3, fixRounds: 2 }), 'worked 12m · 2 fix rounds');
  assert.strictEqual(R.summarize({ activeMs: 60_000, busyPeriods: 1, fixRounds: 1 }), 'worked 1m · 1 fix round');
  assert.strictEqual(R.summarize({ activeMs: 5_000, busyPeriods: 1, fixRounds: 0 }), 'worked 5s · no fix rounds');
});

test('idle detector reports how long the busy period lasted (output start to last output)', () => {
  let t = 1000;
  const d = new IdleDetector({ idleMs: 100, minBytes: 10, now: () => t });
  d.feed('x'.repeat(20)); // starts at 1000
  t = 6000; d.feed('y'); // last output at 6000
  t = 6200;
  assert.strictEqual(d.poll(), true);
  assert.strictEqual(d.lastBusyMs, 5000);
  // next period starts fresh, not from the old start
  t = 9000; d.feed('z'.repeat(20)); t = 9500; d.feed('z'); t = 9700;
  assert.strictEqual(d.poll(), true);
  assert.strictEqual(d.lastBusyMs, 500);
});

test('typing resets the busy period start', () => {
  let t = 0;
  const d = new IdleDetector({ idleMs: 10, minBytes: 5, now: () => t });
  d.feed('abc'); t = 100; d.input();
  t = 200; d.feed('x'.repeat(10)); t = 250; d.feed('y'); t = 300;
  assert.strictEqual(d.poll(), true);
  assert.strictEqual(d.lastBusyMs, 50);
});

test('recordStats writes into the run metadata and listRuns shows it; non-run folders are ignored', async () => {
  const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
  const { execFileSync } = require('node:child_process');
  const runs = require('../src/core/runs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bazinga-rs-'));
  const g = (...a) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd: dir, stdio: 'ignore' });
  g('init', '-q'); fs.writeFileSync(path.join(dir, 'a.txt'), 'x'); g('add', '.'); g('commit', '-q', '-m', 'i');
  const run = await runs.createRun(dir, { name: 'stats', task: 't' });
  assert.strictEqual(await runs.recordStats(dir, (s) => R.addBusy(s, 1000)), false, 'main checkout is not a run');
  assert.strictEqual(await runs.recordStats(run.root, (s) => R.addBusy(s, 125_000)), true);
  assert.strictEqual(await runs.recordStats(run.root, R.addRound), true);
  const { runs: list } = await runs.listRuns(dir);
  assert.strictEqual(list[0].statsText, 'worked 2m · 1 fix round');
  assert.strictEqual(await runs.recordStats(path.join(os.tmpdir(), 'definitely-not-there'), R.addRound), false);
});

test('setUsage only grows: a restarted counter does not lower what was recorded', () => {
  const rs = require('../src/core/runstats');
  let s = rs.setUsage(rs.empty(), { costUsd: 1.5, input: 100, output: 10 });
  s = rs.setUsage(s, { costUsd: 0.2, input: 50, output: 40 });
  assert.deepEqual([s.costUsd, s.tokensIn, s.tokensOut], [1.5, 100, 40]);
  assert.equal(rs.normalize({ costUsd: 'x', tokensIn: -3 }).costUsd, 0);
});
