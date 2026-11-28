'use strict';
/**
 * Scorecard: what happened to the runs of each agent, per kind of task. One record is written when a run ends (merged or
 * discarded); nothing here guesses, it only counts what you did with the results. Stored per user, across projects.
 *
 *   win     merged, and the agent that started it did the work alone
 *   helped  merged, but a stronger agent had to take over (escalation): the first agent did not manage it
 *   lost    thrown away because another run of the same task was kept (best-of)
 *   failed  discarded
 */
const fs = require('node:fs');
const path = require('node:path');

const KINDS = ['tests', 'bugfix', 'refactor', 'feature', 'docs', 'review', 'other'];
const LABELS = { tests: 'Tests', bugfix: 'Bug fix', refactor: 'Refactor', feature: 'New feature', docs: 'Docs', review: 'Review / explain', other: 'Other' };
const REASONS = ['wrong', 'broken', 'incomplete', 'style', 'superseded', 'other'];
const REASON_LABELS = { wrong: 'Wrong approach', broken: "Didn't work (build or tests failed)", incomplete: 'Incomplete', style: "Worked, but not how I'd do it", superseded: 'Superseded by a better run', other: 'Other' };
const MAX_RECORDS = 500;
const MIN_RUNS = 3; // below this a number is an anecdote
// a "compared" run (best-of: the same task given to several agents at once) tells you who is actually better at this
// kind of task; a plain solo run only tells you who got lucky with which tasks ended up on their desk. Count a
// compared run's result this many times as much as a solo run's when ranking agents, instead of ignoring solo
// runs entirely (there usually aren't enough compared ones alone to say anything).
const COMPARED_WEIGHT = 3;

// first match wins, so the more specific kinds come first
const RULES = [
  ['review', /\b(review|explain|summari[sz]e|walk me through|what does|why does|audit|analy[sz]e)\b|\b(uitleg|leg uit|bekijk)\b/i],
  ['tests', /\b(unit ?tests?|tests?|testcases?|test cases?|coverage|junit|pytest|mockito|jest|vitest|spec)\b|\b(schrijf tests?|testen)\b/i],
  ['bugfix', /\b(fix|bug|bugs|broken|crash(es)?|exception|error|fails?|failing|regression|npe|nullpointer|stack ?trace)\b|\b(oplossen|probleem|fout)\b/i],
  ['refactor', /\b(refactor|rename|clean ?up|simplif(y|ication)|extract|deduplicate|dedupe|reorgani[sz]e|restructure|migrate|upgrade|move)\b/i],
  ['docs', /\b(docs?|documentation|readme|javadoc|docstrings?|comments?|changelog)\b|\b(documenteer)\b/i],
  ['feature', /\b(add|implement|create|build|new|support|endpoint|feature|introduce|integrate|voeg|maak)\b/i],
];

/** The kind of a task text. Deliberately simple: the user can see and trust a keyword rule, not a classifier. */
function kindOf(task) {
  const t = String(task || '').slice(0, 2000);
  for (const [kind, re] of RULES) if (re.test(t)) return kind;
  return 'other';
}

const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);

/** A clean record from whatever the caller knows. */
function makeRecord(o = {}) {
  const outcome = ['merged', 'discarded', 'lost'].includes(o.outcome) ? o.outcome : 'discarded';
  const escalated = !!o.escalatedTo;
  return {
    at: num(o.at) || Date.now(),
    agent: String(o.agent || 'agent').slice(0, 80),
    model: String(o.model || '').slice(0, 80),
    local: !!o.local,
    kind: KINDS.includes(o.kind) ? o.kind : kindOf(o.task),
    outcome,
    result: outcome === 'merged' ? (escalated ? 'helped' : 'win') : outcome === 'lost' ? 'lost' : 'failed',
    escalatedTo: escalated ? String(o.escalatedTo).slice(0, 80) : '',
    fixRounds: num(o.fixRounds),
    fixLoop: !!o.fixLoop,
    activeMs: num(o.activeMs),
    files: num(o.files),
    costUsd: o.local ? 0 : num(o.costUsd),
    tokens: num(o.tokens),
    compared: !!o.compared, // part of a best-of group: this task was given to more than one agent at once
    reason: REASONS.includes(o.reason) ? o.reason : '', // only meaningful for a plain discard; '' means not given
  };
}

function load(file) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(j.records) ? j.records.filter((r) => r && typeof r === 'object' && r.agent && r.kind) : [];
  } catch { return []; }
}

function add(file, record) {
  const records = load(file);
  records.push(makeRecord(record));
  const kept = records.slice(-MAX_RECORDS);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, records: kept }));
    fs.renameSync(tmp, file);
  } catch { /* the scorecard is nice to have: it never blocks a merge */ }
  return kept.length;
}

const median = (xs) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };

/** Counts per (agent, kind). `since` (ms epoch) limits it to recent records. */
function summarize(records, { since = 0 } = {}) {
  const cells = new Map();
  for (const r of records || []) {
    if (since && r.at < since) continue;
    const key = `${r.agent}\u0000${r.kind}`;
    if (!cells.has(key)) cells.set(key, { agent: r.agent, kind: r.kind, local: !!r.local, runs: 0, win: 0, helped: 0, lost: 0, failed: 0, firstPass: 0, loopRuns: 0, rounds: [], times: [], last: 0, cost: 0, costRuns: 0, tokens: 0, comparedRuns: 0, comparedWin: 0, reasons: {} });
    const c = cells.get(key);
    c.runs++; c[r.result === 'win' || r.result === 'helped' || r.result === 'lost' || r.result === 'failed' ? r.result : 'failed']++;
    c.local = !!r.local;
    if (r.fixLoop) { c.loopRuns++; if (!r.fixRounds && r.result !== 'failed') c.firstPass++; c.rounds.push(r.fixRounds || 0); }
    if (r.activeMs) c.times.push(r.activeMs);
    if (r.costUsd > 0) { c.cost += r.costUsd; c.costRuns++; }
    c.tokens += r.tokens || 0;
    c.last = Math.max(c.last, r.at || 0);
    if (r.compared) { c.comparedRuns++; if (r.result === 'win') c.comparedWin++; }
    if (r.reason) c.reasons[r.reason] = (c.reasons[r.reason] || 0) + 1;
  }
  return [...cells.values()].map((c) => ({
    agent: c.agent, kind: c.kind, local: c.local, runs: c.runs, win: c.win, helped: c.helped, lost: c.lost, failed: c.failed,
    winRate: c.runs ? c.win / c.runs : 0,
    firstPass: c.firstPass, loopRuns: c.loopRuns,
    avgRounds: c.rounds.length ? c.rounds.reduce((a, b) => a + b, 0) / c.rounds.length : null,
    medianMs: median(c.times), last: c.last, enough: c.runs >= MIN_RUNS,
    costUsd: c.cost, tokens: c.tokens,
    // what one merged result cost, failed attempts included. Local models are free; a cloud agent without numbers is unknown (null), not free.
    costPerMerged: c.local ? 0 : (c.costRuns && (c.win + c.helped) ? c.cost / (c.win + c.helped) : null),
    // head-to-head only: this task was also given to other agents at the same time, so the result isn't confounded by task mix.
    comparedRuns: c.comparedRuns, comparedWin: c.comparedWin,
    comparedWinRate: c.comparedRuns ? c.comparedWin / c.comparedRuns : null,
    reasons: c.reasons, // why a plain discard happened, by REASONS key, where given
  })).sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || b.winRate - a.winRate || b.runs - a.runs);
}

/**
 * The agent the numbers favour for a kind of task, or null when there is not enough to say. Ranked by how often it did the
 * task alone and got merged; ties go to fewer fix rounds, then to the faster one. A local agent wins an exact tie (it is free).
 * Returns { agent, cell, runnerUp, text }.
 */
function recommend(rows, kind, { minRuns = MIN_RUNS } = {}) {
  const pool = (rows || []).filter((r) => r.kind === kind && r.runs >= minRuns);
  if (!pool.length) return null;
  // compared (best-of) evidence counts COMPARED_WEIGHT times as much as a solo run's: it compares agents on the
  // identical task, so it can't be explained away by "they just got the easier tasks". Falls back to the plain
  // win rate when there is no compared evidence at all (most of today's history).
  const weighted = (r) => {
    const wins = r.win + (COMPARED_WEIGHT - 1) * r.comparedWin;
    const runs = r.runs + (COMPARED_WEIGHT - 1) * r.comparedRuns;
    return runs ? wins / runs : 0;
  };
  const rank = [...pool].sort((a, b) => weighted(b) - weighted(a) || (a.avgRounds === null ? 9 : a.avgRounds) - (b.avgRounds === null ? 9 : b.avgRounds) || (a.medianMs || 9e12) - (b.medianMs || 9e12) || (b.local ? 1 : 0) - (a.local ? 1 : 0));
  const best = rank[0];
  const cell = `${best.win} of ${best.runs} merged without help${best.comparedRuns ? `, ${best.comparedWin} of ${best.comparedRuns} head-to-head` : ''}`;
  const second = rank[1];
  return { agent: best.agent, cell: best, runnerUp: second || null, text: `${best.agent}: ${cell}${second ? ` (next: ${second.agent}, ${second.win} of ${second.runs})` : ''}` };
}

/** "$0.42", "free", or "?" */
function formatCost(v) {
  if (v === 0) return 'free';
  if (v === null || v === undefined || !Number.isFinite(v)) return '?';
  return v < 0.01 ? '<$0.01' : `$${v.toFixed(v < 10 ? 2 : 1)}`;
}

module.exports = { formatCost, KINDS, LABELS, REASONS, REASON_LABELS, COMPARED_WEIGHT, MIN_RUNS, MAX_RECORDS, kindOf, makeRecord, load, add, summarize, recommend };
