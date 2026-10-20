'use strict';
/**
 * Run journal: an append-only, human-readable timeline of what happened in an agent run
 * (started, went quiet, asked for permission, fix-loop rounds, guard result, merged ...).
 * One JSON object per line, kept in the repository's git dir so it survives merging or discarding the worktree.
 */
const fs = require('node:fs');
const path = require('node:path');

const MAX_TEXT = 300;
const MAX_EVENTS = 2000;
const safeId = (id) => String(id || '').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80);
const fileFor = (dir, runId) => path.join(dir, `${safeId(runId)}.jsonl`);

function clean(event) {
  const e = { t: Number.isFinite(event.t) ? event.t : Date.now(), kind: String(event.kind || 'note').slice(0, 40) };
  if (event.text) e.text = String(event.text).replace(/[\u0000-\u0008\u000b-\u001f]/g, ' ').slice(0, MAX_TEXT);
  if (event.data && typeof event.data === 'object') e.data = event.data;
  return e;
}

function append(dir, runId, event) {
  if (!safeId(runId)) return false;
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(fileFor(dir, runId), JSON.stringify(clean(event)) + '\n');
    return true;
  } catch { return false; }
}

function read(dir, runId) {
  let text = '';
  try { text = fs.readFileSync(fileFor(dir, runId), 'utf8'); } catch { return []; }
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { const o = JSON.parse(line); if (o && typeof o === 'object') out.push(o); } catch { /* torn line */ }
  }
  return out.slice(-MAX_EVENTS);
}

const pad = (n) => String(n).padStart(2, '0');
const stamp = (t) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };

/** Plain-text rendering, one line per event. */
const format = (events) => (events || []).map((e) => `${stamp(e.t)}  ${e.kind}${e.text ? `  ${e.text}` : ''}`).join('\n');

/** Ids of all runs that have a journal (also runs that were merged or discarded). */
function listIds(dir) {
  try { return fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => f.slice(0, -6)); } catch { return []; }
}

module.exports = { append, read, format, fileFor, clean, listIds };
