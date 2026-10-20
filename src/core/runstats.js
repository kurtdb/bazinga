'use strict';
/**
 * Per agent run: how long the agent actually worked and how many fix-loop rounds it needed.
 * "Worked" is the time the terminal was producing output before it went quiet (see core/idle.js), summed over all busy
 * periods, so the time you spent reading and thinking is not counted. Stored in the run's metadata.
 */
const empty = () => ({ activeMs: 0, busyPeriods: 0, fixRounds: 0, fixLoopRuns: 0, costUsd: 0, tokensIn: 0, tokensOut: 0 });
const num = (v) => (Number.isFinite(v) && v > 0 ? v : 0);

function normalize(s) {
  const e = empty();
  if (!s || typeof s !== 'object') return e;
  return { activeMs: num(s.activeMs), busyPeriods: num(s.busyPeriods), fixRounds: num(s.fixRounds), fixLoopRuns: num(s.fixLoopRuns), costUsd: num(s.costUsd), tokensIn: num(s.tokensIn), tokensOut: num(s.tokensOut) };
}

/** A busy period ended (the agent went idle). */
function addBusy(stats, ms) {
  const s = normalize(stats);
  s.activeMs += num(ms);
  s.busyPeriods += 1;
  return s;
}

/** The fix loop pasted findings back to the agent (one round). */
function addRound(stats) {
  const s = normalize(stats);
  s.fixRounds += 1;
  return s;
}

/** What the agent used so far (from its telemetry). A total only grows: a restarted counter never lowers what was recorded. */
function setUsage(stats, u = {}) {
  const s = normalize(stats);
  s.costUsd = Math.max(s.costUsd, num(u.costUsd));
  s.tokensIn = Math.max(s.tokensIn, num(u.input));
  s.tokensOut = Math.max(s.tokensOut, num(u.output));
  return s;
}

function formatDuration(ms) {
  if (num(ms) < 1000) return '<1s';
  const sec = Math.round(num(ms) / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  return `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`;
}

/** Short text for the run card, or '' when nothing was recorded yet. */
function summarize(stats) {
  const s = normalize(stats);
  if (!s.busyPeriods && !s.fixRounds) return '';
  const parts = [];
  if (s.busyPeriods) parts.push(`worked ${formatDuration(s.activeMs)}`);
  parts.push(s.fixRounds ? `${s.fixRounds} fix round${s.fixRounds === 1 ? '' : 's'}` : 'no fix rounds');
  return parts.join(' · ');
}

module.exports = { empty, normalize, addBusy, addRound, setUsage, formatDuration, summarize };
