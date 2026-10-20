'use strict';
/**
 * Board columns for the runs: Running (the agent is working), Needs you (asks for approval, finished its turn, or looks stuck),
 * Ready to review (the agent has stopped). Pure, loaded by the window and by the tests.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.BazingaBoard = factory();
}(typeof self !== 'undefined' ? self : this, () => {
  const COLUMNS = ['backlog', 'running', 'needs', 'review'];
  const TITLES = { backlog: 'Backlog', running: 'Running', needs: 'Needs you', review: 'Ready to review' };
  const WORST = { waiting: 0, stale: 1, idle: 2, running: 3, exited: 4 };

  /** The state of a run = the most urgent state among its terminals. rows: fleet rows (with runId). */
  function stateOfRun(run, rows) {
    let best = null;
    for (const r of rows || []) if (r.runId === run.id && (best === null || WORST[r.state] < WORST[best])) best = r.state;
    return best;
  }

  function columnOf(state) {
    if (state === 'running') return 'running';
    if (state === 'waiting' || state === 'stale' || state === 'idle') return 'needs';
    return 'review'; // exited, or no terminal any more: the work is there to look at
  }

  function build(runs, rows) {
    const cols = { running: [], needs: [], review: [] };
    for (const run of runs || []) {
      const state = stateOfRun(run, rows);
      const row = (rows || []).find((r) => r.runId === run.id && r.state === state) || null;
      cols[columnOf(state)].push({ run, state, row });
    }
    const urgency = (c) => WORST[c.state] ?? 5;
    cols.needs.sort((a, b) => urgency(a) - urgency(b));
    cols.review.sort((a, b) => (b.run.files || 0) - (a.run.files || 0));
    return cols;
  }

  /** Backlog: work items that no run mentions yet (the key is in the run's name, task or branch). */
  function backlog(items, runs) {
    const text = (runs || []).map((r) => `${r.name} ${r.task} ${r.branch}`).join('\n').toLowerCase();
    return (items || []).filter((w) => !text.includes(String(w.ref || w.id).toLowerCase()) && !text.includes(`ab#${String(w.id).toLowerCase()}`));
  }

  return { COLUMNS, TITLES, stateOfRun, columnOf, build, backlog };
}));
