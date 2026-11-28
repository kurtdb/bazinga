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

  /** needsApproval: a workflow step on this run already passed its gate and is waiting on you - that always means "needs you", whatever its terminal is doing (often nothing: the agent's turn is long over). */
  function columnOf(state, needsApproval) {
    if (needsApproval) return 'needs';
    if (state === 'running') return 'running';
    if (state === 'waiting' || state === 'stale' || state === 'idle') return 'needs';
    return 'review'; // exited, or no terminal any more: the work is there to look at
  }

  /** approvals: Map<runId, { since }> - since = when Bazinga started checking the step now awaiting your approval (ms epoch). */
  function build(runs, rows, approvals) {
    const cols = { running: [], needs: [], review: [] };
    for (const run of runs || []) {
      const state = stateOfRun(run, rows);
      const row = (rows || []).find((r) => r.runId === run.id && r.state === state) || null;
      const approval = (approvals && approvals.get ? approvals.get(run.id) : null) || null;
      cols[columnOf(state, !!approval)].push({ run, state, row, approval });
    }
    const urgency = (c) => WORST[c.state] ?? 5;
    // an approval checkpoint outranks a plain state (nothing left to compute, just you); among those, longest waiting first.
    cols.needs.sort((a, b) => {
      if (!!a.approval !== !!b.approval) return a.approval ? -1 : 1;
      if (a.approval && b.approval) return a.approval.since - b.approval.since;
      return urgency(a) - urgency(b);
    });
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
