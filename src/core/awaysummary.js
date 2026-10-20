'use strict';
/**
 * "While you were away": what happened to agent runs since the user last looked. Pure: gets the journals and the live runs.
 * Groups, in the order the person should care about: needs you (guard found problems / gate failed), ready to review,
 * merged, thrown away. A run appears in exactly one group (its newest state).
 */
const failing = (text) => {
  const t = String(text || '');
  if (/^clean/.test(t)) return false;
  const m = /^(\d+) blocker/.exec(t);
  return m ? Number(m[1]) > 0 : /failed/.test(t);
};

function stateOf(events, since) {
  const recent = events.filter((e) => e.t > since);
  if (!recent.length) return null;
  const last = [...events].reverse().find((e) => ['merged', 'discarded'].includes(e.kind));
  if (last && last.t > since && events[events.length - 1].t === last.t) return { state: last.kind, at: last.t };
  const checks = events.filter((e) => e.kind === 'guard' || e.kind === 'workflow-gate');
  const lastCheck = checks[checks.length - 1];
  if (lastCheck && lastCheck.t > since && failing(lastCheck.text)) return { state: 'needs-you', at: lastCheck.t, why: lastCheck.text };
  return { state: 'activity', at: recent[recent.length - 1].t };
}

/**
 * @param journals {[runId]: events[]}  all journals of the repository
 * @param live     [{id,name,files,commits}]  runs whose worktree still exists
 * @param meta     {[runId]: {name?:string, task?:string}}  names for runs that are gone
 */
function summarize({ journals = {}, live = [], meta = {}, since = 0, now = Date.now() } = {}) {
  const liveById = new Map(live.map((r) => [r.id, r]));
  const groups = { needsYou: [], ready: [], merged: [], discarded: [] };
  for (const [id, events] of Object.entries(journals)) {
    if (!Array.isArray(events) || !events.length) continue;
    const st = stateOf(events, since);
    if (!st) continue;
    const l = liveById.get(id);
    const created = events.find((e) => e.kind === 'created');
    const name = (l && l.name) || (meta[id] && meta[id].name) || (created && created.text ? created.text.replace(/^[^:]*:\s*/, '').slice(0, 60) : id);
    const item = { id, name, at: st.at, why: st.why || '', files: l ? l.files : 0, live: !!l };
    if (st.state === 'merged') groups.merged.push(item);
    else if (st.state === 'discarded') groups.discarded.push(item);
    else if (st.state === 'needs-you' && l) groups.needsYou.push(item);
    else if (l && (l.files > 0 || l.commits > 0)) groups.ready.push(item);
  }
  for (const k of Object.keys(groups)) groups[k].sort((a, b) => b.at - a.at);
  const total = Object.values(groups).reduce((n, g) => n + g.length, 0);
  return { groups, total, since, now, empty: total === 0 };
}

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
function headline(s) {
  if (s.empty) return 'Nothing happened to your agent runs since you last looked.';
  const g = s.groups; const parts = [];
  if (g.needsYou.length) parts.push(`${plural(g.needsYou.length, 'run')} need${g.needsYou.length === 1 ? 's' : ''} you`);
  if (g.ready.length) parts.push(`${g.ready.length} ready to review`);
  if (g.merged.length) parts.push(`${g.merged.length} merged`);
  if (g.discarded.length) parts.push(`${g.discarded.length} thrown away`);
  return parts.join(', ') + '.';
}

module.exports = { summarize, headline, stateOf };
