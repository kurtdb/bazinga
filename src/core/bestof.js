'use strict';
/**
 * Best of N: the same task for several agents (or the same agent several times), each in its own worktree, then a ranking.
 * Pure (no node modules), so the window loads this file directly and the tests load it the same way.
 * The ranking is a suggestion built from facts (did the gates pass, how big is the change); the human still reads the diff.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.BazingaBestOf = factory();
}(typeof self !== 'undefined' ? self : this, () => {
  const MAX_RUNS = 6;

  /** wanted: [{ agent: <agent object or name>, copies: n }] -> a flat list of launches, at most MAX_RUNS, with unique labels ("qwen", "qwen 2"). */
  function plan(wanted, labelOf = (a) => (a && a.name) || String(a)) {
    const out = [];
    const seen = new Map();
    for (const w of wanted || []) {
      const n = Math.max(0, Math.min(MAX_RUNS, Math.floor(Number(w.copies) || 0)));
      for (let i = 0; i < n && out.length < MAX_RUNS; i++) {
        const base = labelOf(w.agent);
        const k = (seen.get(base) || 0) + 1; seen.set(base, k);
        out.push({ agent: w.agent, label: k === 1 ? base : `${base} ${k}` });
      }
    }
    // the first of a repeated agent gets its number too ("qwen 1", "qwen 2") so the names read evenly
    const counts = new Map(); for (const o of out) counts.set(String(labelOf(o.agent)), (counts.get(String(labelOf(o.agent))) || 0) + 1);
    for (const o of out) if (counts.get(String(labelOf(o.agent))) > 1 && o.label === labelOf(o.agent)) o.label = `${o.label} 1`;
    return out;
  }

  const signature = (files) => Object.keys(files || {}).sort().map((p) => `${p}:${files[p].hash}`).join('|');
  const gateErrors = (g) => (g && !g.error && Number.isFinite(g.errors) ? g.errors : null);

  /**
   * sums: [{ id, name, agent, files: {path: {added, removed, hash}}, gates?: {errors, warnings} | {error} }]
   * Order: runs that changed something first; fewer gate errors; fewer warnings; smaller change. Identical results are grouped.
   */
  function rank(sums) {
    const rows = (sums || []).map((s) => {
      const list = Object.values(s.files || {});
      const added = list.reduce((t, f) => t + (f.added || 0), 0); const removed = list.reduce((t, f) => t + (f.removed || 0), 0);
      return { id: s.id, name: s.name, agent: s.agent || '', files: list.length, added, removed, size: added + removed, gates: s.gates || null, errors: gateErrors(s.gates), warnings: s.gates && !s.gates.error ? (s.gates.warnings || 0) : null, sig: signature(s.files) };
    });
    const key = (r) => [r.files === 0 ? 1 : 0, r.errors === null ? 0 : r.errors, r.warnings === null ? 0 : r.warnings, r.size];
    rows.sort((a, b) => { const ka = key(a); const kb = key(b); for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i]; return String(a.name).localeCompare(String(b.name)); });
    const firstOf = new Map();
    rows.forEach((r, i) => {
      r.place = i + 1;
      if (r.files && firstOf.has(r.sig)) r.sameAs = firstOf.get(r.sig); else if (r.files) firstOf.set(r.sig, r.name);
      const bits = [];
      if (!r.files) bits.push('changed nothing');
      else bits.push(`${r.files} file${r.files === 1 ? '' : 's'}, +${r.added} −${r.removed}`);
      if (r.gates && r.gates.error) bits.push('gates not run');
      else if (r.errors !== null) bits.push(r.errors ? `${r.errors} gate error${r.errors === 1 ? '' : 's'}` : 'gates green');
      if (r.sameAs) bits.push(`same result as ${r.sameAs}`);
      r.text = bits.join(' · ');
    });
    const best = rows[0] && rows[0].files ? rows[0] : null;
    if (best) best.best = true;
    const gatesKnown = rows.some((r) => r.errors !== null);
    return { rows, best: best ? best.id : null, note: !best ? 'None of the runs changed anything.' : gatesKnown ? 'Ranked by: changed something, fewer gate errors, fewer warnings, smaller change. Read the diff before you keep one.' : 'Gates were not run, so the ranking is only by size of the change. Read the diff before you keep one.' };
  }

  /** Is the group finished? Every run has stopped working (exited, or waiting for you). states: map runId -> fleet state. */
  function finished(runIds, states) {
    if (!runIds.length) return false;
    return runIds.every((id) => { const s = states[id]; return s === undefined || s === 'idle' || s === 'exited' || s === 'waiting'; });
  }

  return { plan, rank, finished, MAX_RUNS };
}));
