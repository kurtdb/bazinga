'use strict';
/**
 * "Is this run safe to merge?" - the same judgment auto-merge uses (automerge.autoMergeEligible), surfaced for a
 * human to read even when auto-merge never fires or is off for this project. Pure fusion of three things that
 * already exist on their own: the merge guard, the scorecard's track record for this (agent, kind), and the
 * auto-merge policy's win-rate bar - shown as one line next to the guard box, not a new scoring system.
 */
const automerge = require('./automerge');

/**
 * @param {object} p
 * @param {object} p.guard            guard.js evaluateMerge() output
 * @param {object[]} p.scorecardRows  scorecard.summarize() rows
 * @param {string} p.agent
 * @param {string} p.kind
 * @param {object} [p.autoMergeCfg]   withDefaults(cfg, 'autoMerge') shape: { enabled, minWinRate }
 * @returns {{ level: 'blocked'|'caution'|'ready', label: string, detail: string, autoMergeEligible: boolean }}
 */
function mergeVerdict({ guard, scorecardRows, agent, kind, autoMergeCfg } = {}) {
  // the project's own enabled/off flag does not change whether the guard+scorecard reasoning is worth showing -
  // force it on just to get autoMergeEligible's real reason instead of the "auto-merge is off" short-circuit.
  const cfg = { minWinRate: 0.8, ...(autoMergeCfg || {}), enabled: true };
  const elig = automerge.autoMergeEligible({ guard, scorecardRows, agent, kind, cfg });
  if (!guard || !guard.ok) return { level: 'blocked', label: 'Blocked', detail: 'The merge guard has blockers.', autoMergeEligible: false };
  if (!guard.clean) return { level: 'caution', label: 'Needs a look', detail: 'The merge guard allows it, but has warnings.', autoMergeEligible: false };
  if (elig.eligible) return { level: 'ready', label: 'Safe to merge', detail: elig.reason, autoMergeEligible: true };
  return { level: 'caution', label: 'Gates clean', detail: elig.reason, autoMergeEligible: false };
}

module.exports = { mergeVerdict };
