'use strict';
/**
 * Compare two agent runs (typically the same task given to two agents): which files each one changed, which both changed
 * (and whether they ended up with the same content), size of the change, and the gate result.
 * `summarizeRun` talks to git; `compareSummaries` is pure.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { git } = require('./git');
const { toPosix } = require('./util');

const hashOf = (top, rel) => { try { return crypto.createHash('sha1').update(fs.readFileSync(path.join(top, rel))).digest('hex'); } catch { return 'deleted'; } };
const lines = (s) => String(s).split(/\r?\n/).filter(Boolean);

/** Everything the run changed relative to its base commit (committed, staged, unstaged and untracked). */
async function summarizeRun(run) {
  const top = run.top;
  const files = {};
  const base = run.baseCommit || 'HEAD';
  const numstat = await git(top, ['diff', '--numstat', '--no-renames', base]).catch(() => '');
  for (const l of lines(numstat)) {
    const [a, d, ...rest] = l.split('\t');
    const p = toPosix(rest.join('\t'));
    files[p] = { added: a === '-' ? 0 : Number(a), removed: d === '-' ? 0 : Number(d) };
  }
  const untracked = await git(top, ['ls-files', '--others', '--exclude-standard']).catch(() => '');
  for (const p of lines(untracked).map(toPosix)) {
    let n = 0;
    try { n = fs.readFileSync(path.join(top, p), 'utf8').split('\n').length; } catch { /* binary or gone */ }
    files[p] = { added: n, removed: 0 };
  }
  for (const p of Object.keys(files)) { if (p.startsWith('.ide/')) delete files[p]; else files[p].hash = hashOf(top, p); }
  return { id: run.id, name: run.name, agent: run.agent || '', task: run.task || '', statsText: run.statsText || '', files };
}

const totals = (files) => Object.values(files).reduce((t, f) => ({ files: t.files + 1, added: t.added + f.added, removed: t.removed + f.removed }), { files: 0, added: 0, removed: 0 });

/** a, b: summaries (optionally with `gates: {errors, warnings}` and `tests`). */
function compareSummaries(a, b) {
  const pa = Object.keys(a.files); const pb = new Set(Object.keys(b.files));
  const both = pa.filter((p) => pb.has(p)).sort().map((p) => ({ path: p, same: a.files[p].hash === b.files[p].hash, a: { added: a.files[p].added, removed: a.files[p].removed }, b: { added: b.files[p].added, removed: b.files[p].removed } }));
  const onlyA = pa.filter((p) => !pb.has(p)).sort();
  const onlyB = [...pb].filter((p) => !(p in a.files)).sort();
  const side = (s) => ({ id: s.id, name: s.name, agent: s.agent, statsText: s.statsText, gates: s.gates || null, ...totals(s.files) });
  const identical = !onlyA.length && !onlyB.length && both.every((f) => f.same);
  return { a: side(a), b: side(b), onlyA, onlyB, both, identical, differing: both.filter((f) => !f.same).map((f) => f.path) };
}

module.exports = { summarizeRun, compareSummaries };
