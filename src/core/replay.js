'use strict';
/**
 * Session replay: one timeline for an agent run, merging its journal (always kept, survives review/merge/discard)
 * with the commits it made before prepareReview() folded them into staged changes. Pure merge/sort; the data
 * (journal events, commits) comes from the caller - see core/runs.js readJournal() and runCommits().
 */

/** @param {object} p
 * @param {Array<{t:number,kind:string,text?:string}>} p.events  journal events (t: ms epoch)
 * @param {Array<{sha:string,subject:string,time:number}>} p.commits  run commits, oldest first (time: unix seconds)
 * @returns {Array<{t:number,type:'event'|'commit',kind?:string,text?:string,sha?:string,subject?:string}>} oldest first
 */
function buildTimeline({ events = [], commits = [] } = {}) {
  const steps = [
    ...events.map((e) => ({ t: e.t, type: 'event', kind: e.kind, text: e.text || '' })),
    ...commits.map((c) => ({ t: c.time * 1000, type: 'commit', sha: c.sha, subject: c.subject })),
  ];
  steps.sort((a, b) => a.t - b.t);
  return steps;
}

module.exports = { buildTimeline };
