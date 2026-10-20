'use strict';
/**
 * The numbers behind the Fleet panel: how full is an agent's context window, what is it doing (running, waiting for you, stale),
 * how many tokens did it use, and what would that cost. Everything here is pure; the panel only draws it.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/** Share of the context window used by the last request (0..1+), or null when the window or the usage is unknown. */
function contextPct(inputTokens, contextTokens) {
  const i = Number(inputTokens); const c = Number(contextTokens);
  if (!Number.isFinite(i) || !Number.isFinite(c) || c <= 0 || i <= 0) return null;
  return i / c;
}

/** ok < 70%, warn from 70%, full from 90% (the model starts to forget its instructions: older messages are cut off). */
const contextLevel = (pct) => (pct === null ? 'unknown' : pct >= 0.9 ? 'full' : pct >= 0.7 ? 'warn' : 'ok');

const OVERFLOW_RE = /context (length|window)|too long|exceed|maximum context|num_ctx|prompt is too|truncat/i;
/** A model-server error that means "the conversation no longer fits". */
const isOverflowError = (msg) => OVERFLOW_RE.test(String(msg || ''));

/**
 * @param {{ exited?: boolean, prompt?: boolean, idleAt?: number, lastActivity?: number, startedAt?: number }} t
 * @returns {'exited'|'waiting'|'idle'|'stale'|'running'}
 *   waiting = asks for permission; idle = went quiet and told Bazinga (waiting for your next message); stale = supposed to be working but nothing
 *   has happened for staleMs (no output, no model request).
 */
function stateOf(t, now = Date.now(), staleMs = 5 * 60000) {
  if (t.exited) return 'exited';
  if (t.prompt) return 'waiting';
  const last = Math.max(t.lastActivity || 0, t.startedAt || 0);
  if (t.idleAt && t.idleAt >= (t.lastActivity || 0)) return 'idle';
  if (last && now - last > staleMs) return 'stale';
  return 'running';
}

/**
 * Token numbers of a cloud Claude Code session. Claude Code's own telemetry (OpenTelemetry) wins when it arrived; the transcript file is the fallback.
 * Both are shaped like transcriptUsage's result (+ costUsd when Claude Code reported the cost itself).
 */
function cloudOf(f) {
  const o = f && f.otel;
  if (o && (o.requests || o.input || o.output)) return { input: o.input, output: o.output, cacheRead: o.cacheRead, cacheCreate: o.cacheCreation, messages: o.requests, lastContext: o.lastContext, model: o.model, costUsd: o.costUsd > 0 ? o.costUsd : null, source: 'telemetry' };
  return (f && f.cloud) || null;
}

/** A row of the panel from what the window knows about one agent terminal. */
function row(t, now = Date.now(), { staleMs } = {}) {
  const f = t.fleet || {};
  const pct = contextPct(f.lastInput, t.context);
  // a helper agent that is still working counts as activity: the main agent is quiet while it waits for it
  const subRunning = (t.subagents || []).some((a) => !a.endedAt);
  const state = stateOf({ exited: t.exited, prompt: !!t.prompt, idleAt: t.idleAt, lastActivity: subRunning ? now : Math.max(t.lastData || 0, f.lastRequestAt || 0), startedAt: t.startedAt }, now, staleMs);
  const blowout = pct !== null && pct >= 0.9 || !!f.overflow;
  return {
    key: t.key, runId: t.runId || null, label: t.label || t.title || 'Agent', model: f.model || t.model || '', state, pct, level: contextLevel(pct), blowout,
    context: t.context || 0, input: f.totalInput || 0, output: f.totalOutput || 0, requests: f.requests || 0,
    cloud: cloudOf(f), errors: f.errors || (f.otel && f.otel.errors) || 0, lastError: f.lastError || (f.otel && f.otel.lastError) || '',
    subagents: (t.subagents || []).slice(-20).map((a) => ({ id: a.id, type: a.type, startedAt: a.startedAt, endedAt: a.endedAt || 0, text: a.text || '' })),
    elapsedMs: t.startedAt ? Math.max(0, (t.exited ? (t.exitedAt || now) : now) - t.startedAt) : 0,
    quietMs: Math.max(0, now - Math.max(t.lastData || 0, f.lastRequestAt || 0, t.startedAt || 0)),
  };
}

const FILTERS = ['all', 'running', 'waiting', 'stale', 'blowouts'];
function filterRows(rows, filter = 'all', text = '') {
  const q = String(text || '').trim().toLowerCase();
  return rows.filter((r) => {
    if (filter === 'running' && r.state !== 'running') return false;
    if (filter === 'waiting' && r.state !== 'waiting') return false;
    if (filter === 'stale' && r.state !== 'stale') return false;
    if (filter === 'blowouts' && !r.blowout) return false;
    return !q || `${r.label} ${r.model}`.toLowerCase().includes(q);
  });
}

const STATE_ORDER = { waiting: 0, stale: 1, running: 2, idle: 3, exited: 4 };
const SORTS = ['status', 'context', 'tokens', 'time'];
function sortRows(rows, sort = 'status') {
  const by = {
    status: (a, b) => (STATE_ORDER[a.state] - STATE_ORDER[b.state]) || (Number(b.blowout) - Number(a.blowout)),
    context: (a, b) => (b.pct || 0) - (a.pct || 0),
    tokens: (a, b) => (b.input + b.output) - (a.input + a.output),
    time: (a, b) => b.elapsedMs - a.elapsedMs,
  }[sort] || (() => 0);
  return rows.slice().sort(by);
}

/** The strip above the list. */
function summarize(rows) {
  const s = { live: 0, running: 0, waiting: 0, stale: 0, idle: 0, blowouts: 0, input: 0, output: 0, requests: 0 };
  for (const r of rows) {
    if (r.state !== 'exited') s.live++;
    if (s[r.state] !== undefined) s[r.state]++;
    if (r.blowout && r.state !== 'exited') s.blowouts++;
    s.input += r.input; s.output += r.output; s.requests += r.requests;
  }
  return s;
}

function fmtTokens(n) {
  const v = Number(n) || 0;
  if (v < 1000) return String(v);
  if (v < 1e6) return `${(v / 1000).toFixed(v < 10000 ? 1 : 0)}k`;
  return `${(v / 1e6).toFixed(v < 1e7 ? 2 : 1)}M`;
}

function fmtDuration(ms) {
  const s = Math.floor((Number(ms) || 0) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, '0')}m`;
}

/**
 * An estimate, never a bill: tokens x the price per million tokens of the first pattern that matches the model name.
 * prices: { "sonnet": [inputPerMillion, outputPerMillion], ... }  (configure in .ide/config.json "fleet": { "prices": ... }). Unknown model: null.
 */
function estimateCost({ input = 0, output = 0, cacheRead = 0, cacheCreate = 0 } = {}, model = '', prices = {}) {
  const key = Object.keys(prices || {}).find((k) => String(model).toLowerCase().includes(k.toLowerCase()));
  if (!key) return null;
  const [pin, pout] = prices[key].map(Number);
  if (!Number.isFinite(pin) || !Number.isFinite(pout)) return null;
  // cache reads are billed at a tenth, cache writes at 1.25 x the input price
  return ((input * pin) + (cacheRead * pin * 0.1) + (cacheCreate * pin * 1.25) + (output * pout)) / 1e6;
}

/**
 * Token use of a Claude Code session, from its transcript (JSON lines; assistant messages carry message.usage).
 * Not a documented format: unknown lines are skipped, and a transcript with no usage gives zeros.
 */
function transcriptUsage(text) {
  const t = { input: 0, output: 0, cacheRead: 0, cacheCreate: 0, messages: 0, lastContext: 0, model: '' };
  const seen = new Set();
  for (const line of String(text || '').split('\n')) {
    if (!line.includes('"usage"')) continue;
    let j; try { j = JSON.parse(line); } catch { continue; } // a half-written last line
    const m = j && j.message;
    const u = m && m.usage;
    if (!u || typeof u !== 'object') continue;
    const id = (m && m.id) || j.uuid;
    if (id && seen.has(id)) continue; // one reply is written once per content block: count it once
    if (id) seen.add(id);
    const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    t.input += n(u.input_tokens); t.output += n(u.output_tokens); t.cacheRead += n(u.cache_read_input_tokens); t.cacheCreate += n(u.cache_creation_input_tokens);
    t.messages++;
    t.lastContext = n(u.input_tokens) + n(u.cache_read_input_tokens) + n(u.cache_creation_input_tokens);
    if (m.model) t.model = String(m.model);
  }
  return t;
}

/** A transcript path a hook reported is only read when it is a .jsonl file inside the Claude Code folder of the user (never an arbitrary file). */
function safeTranscriptPath(p, homes = [path.join(os.homedir(), '.claude'), process.env.CLAUDE_CONFIG_DIR].filter(Boolean)) {
  const s = String(p || '');
  if (!path.isAbsolute(s) || !/\.jsonl$/i.test(s)) return null;
  let real;
  try { real = fs.realpathSync(s); } catch { return null; }
  for (const h of homes) {
    let base; try { base = fs.realpathSync(h); } catch { continue; }
    const rel = path.relative(base, real);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return real;
  }
  return null;
}

/** The last `max` bytes of a file as text (a long session's transcript can be big; the newest lines are what matter for the context). */
function readTail(file, max = 8 * 1024 * 1024) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, max);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    const text = buf.toString('utf8');
    return size > max ? text.slice(text.indexOf('\n') + 1) : text; // drop the cut first line
  } finally { fs.closeSync(fd); }
}

/**
 * Everything the panel draws, computed in one place (the window has no access to this module, it asks the main process).
 * terms: snapshots of the agent terminals; cloud sessions carry fleet.cloud = transcriptUsage(...), local ones have fleet.* from the proxy.
 */
function view(terms, { filter = 'all', sort = 'status', text = '', staleMinutes = 5, prices = {} } = {}, now = Date.now()) {
  const staleMs = Math.max(1, Number(staleMinutes) || 5) * 60000;
  const all = (terms || []).map((t) => {
    const r = row(t, now, { staleMs });
    const c = r.cloud;
    if (c) { r.input = c.input + c.cacheRead + c.cacheCreate; r.output = c.output; r.requests = c.messages; r.model = r.model || c.model; }
    if (c && !t.context && c.lastContext) r.cloudContext = c.lastContext;
    r.local = !c;
    r.cost = c ? (c.costUsd != null ? c.costUsd : estimateCost(c, r.model, prices)) : null;
    r.costReported = !!(c && c.costUsd != null);
    r.tokensText = `${fmtTokens(r.input)} in / ${fmtTokens(r.output)} out`;
    r.elapsedText = fmtDuration(r.elapsedMs);
    r.quietText = fmtDuration(r.quietMs);
    r.events = (t.events || []).slice(-40);
    return r;
  });
  const rows = sortRows(filterRows(all, FILTERS.includes(filter) ? filter : 'all', text), SORTS.includes(sort) ? sort : 'status');
  const summary = summarize(all);
  const costs = all.map((r) => r.cost).filter((x) => x !== null);
  summary.cost = costs.length ? costs.reduce((a, b) => a + b, 0) : null;
  summary.tokensText = `${fmtTokens(summary.input)} in / ${fmtTokens(summary.output)} out`;
  return { rows, summary, total: all.length };
}

module.exports = { view, contextPct, contextLevel, isOverflowError, stateOf, row, filterRows, sortRows, summarize, fmtTokens, fmtDuration, estimateCost, transcriptUsage, safeTranscriptPath, readTail, FILTERS, SORTS };
