'use strict';
/**
 * Auto-merge: should this run be merged without asking? Pure policy, same shape as guard.js - the caller supplies
 * the guard result (see guardForRun()'s `unattended` mode) and the scorecard rows (see scorecard.summarize()).
 * Deliberately conservative: off unless the config opts in, the guard is fully clean (not just "no blockers"), and
 * this exact (agent, kind) pairing has enough history at a high enough win rate.
 */

/**
 * @param {object} p
 * @param {object} p.guard        evaluateMerge() output (see guard.js); must be .clean, not just .ok
 * @param {object[]} p.scorecardRows  scorecard.summarize() rows
 * @param {string} p.agent
 * @param {string} p.kind
 * @param {object} [p.cfg]        withDefaults(cfg, 'autoMerge') shape: { enabled, minWinRate }
 * @returns {{ eligible: boolean, reason: string }}
 */
function autoMergeEligible({ guard, scorecardRows, agent, kind, cfg } = {}) {
  if (!cfg || !cfg.enabled) return { eligible: false, reason: 'auto-merge is off' };
  if (Array.isArray(cfg.kinds) && cfg.kinds.length && !cfg.kinds.includes(kind)) return { eligible: false, reason: `auto-merge is off for "${kind}" tasks` };
  if (!guard || !guard.clean) return { eligible: false, reason: 'the merge guard has something to say' };
  const rec = (scorecardRows || []).find((r) => r.agent === agent && r.kind === kind);
  if (!rec || !rec.enough) return { eligible: false, reason: 'not enough history for this agent and kind of task yet' };
  const minWinRate = cfg.minWinRate ?? 0.8;
  if (rec.winRate < minWinRate) return { eligible: false, reason: `win rate too low (${Math.round(rec.winRate * 100)}%, needs ${Math.round(minWinRate * 100)}%)` };
  return { eligible: true, reason: `${agent} wins ${Math.round(rec.winRate * 100)}% of ${rec.kind} tasks (${rec.runs} runs)` };
}

module.exports = { autoMergeEligible };
