'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { summarizeRun, compareSummaries } = require('../src/core/compare');
const runs = require('../src/core/runs');
const { repo, write, sh } = require('./helpers');

test('two runs of the same task: shared, unique and differing files; identical content detected', async () => {
  const root = repo({ 'src/a.txt': 'one\ntwo\n', 'src/b.txt': 'x\n' });
  const r1 = await runs.createRun(root, { name: 'alpha', task: 'do it', agent: 'Claude' });
  const r2 = await runs.createRun(root, { name: 'beta', task: 'do it', agent: 'Copilot' });
  write(r1.top, 'src/a.txt', 'one\nTWO\nthree\n');   // both change a.txt, differently
  write(r2.top, 'src/a.txt', 'one\ntwo\nfour\n');
  write(r1.top, 'src/new1.txt', 'only in 1\n');       // untracked, only 1
  write(r2.top, 'src/b.txt', 'y\n');                  // only 2
  write(r1.top, 'src/same.txt', 'same\n'); write(r2.top, 'src/same.txt', 'same\n'); // both, identical
  write(r1.top, '.ide/config.json', '{}');            // ignored
  sh(r2.top, 'add', '-A'); sh(r2.top, '-c', 'user.name=a', '-c', 'user.email=a@a', 'commit', '-qm', 'c2'); // committed work counts too
  const { runs: list } = await runs.listRuns(root);
  const [s1, s2] = await Promise.all(['alpha', 'beta'].map((id) => summarizeRun(list.find((x) => x.id === id))));
  const c = compareSummaries(s1, s2);
  assert.deepStrictEqual(c.onlyA, ['src/new1.txt']);
  assert.deepStrictEqual(c.onlyB, ['src/b.txt']);
  assert.deepStrictEqual(c.both.map((f) => [f.path, f.same]), [['src/a.txt', false], ['src/same.txt', true]]);
  assert.deepStrictEqual(c.differing, ['src/a.txt']);
  assert.strictEqual(c.identical, false);
  assert.strictEqual(c.a.agent, 'Claude'); assert.strictEqual(c.b.agent, 'Copilot');
  assert.ok(c.a.added >= 3 && c.a.files === 3);
  assert.ok(!Object.keys(s1.files).some((p) => p.startsWith('.ide/')));
});

test('identical results are reported as identical; empty runs compare fine', () => {
  const f = { 'a.txt': { added: 1, removed: 0, hash: 'h' } };
  assert.strictEqual(compareSummaries({ id: 'x', files: f }, { id: 'y', files: { ...f } }).identical, true);
  const e = compareSummaries({ id: 'x', files: {} }, { id: 'y', files: {} });
  assert.strictEqual(e.identical, true); assert.strictEqual(e.a.files, 0);
});
