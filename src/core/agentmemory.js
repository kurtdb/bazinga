'use strict';
/**
 * Agent memory: a small, queryable per-project store of concrete facts an agent (via the remember MCP tool)
 * decided were worth keeping about THIS codebase ("gotcha in file X", "this broke before"). Two tiers:
 * buildIndex() is the small always-injected summary (folded into every run's startup hint, like .ide/agent-hint.md);
 * recall() is the larger on-demand lookup an agent can query mid-run via the recall MCP tool. Stored per user,
 * per project (keyed by a hash of the resolved root, like core/localhistory.js's folder()), never committed to the
 * repo - same "per user" precedent as core/scorecard.js and core/guardoverrides.js, just scoped to one project
 * instead of all of them. Not scorecard.js (that's aggregate agent-performance stats) and not in-agent context
 * compaction (that happens one layer below Bazinga, inside the agent's own reasoning loop).
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_TEXT = 500; // one entry's fact, capped (same spirit as journal.js's MAX_TEXT)
const MAX_FILES = 20; // paths listed per entry
const MAX_ENTRIES = 1000; // cap on the whole store (oldest dropped first)
const MAX_INDEX_ENTRIES = 20;
const MAX_INDEX_CHARS = 2000; // keeps the always-injected block cheap

const sha = (s, n = 16) => crypto.createHash('sha1').update(s).digest('hex').slice(0, n);

/** The one file for a project, named by a hash of its resolved root (mirrors core/localhistory.js's folder()). */
function fileFor(dir, root) {
  return path.join(dir, `${sha(path.resolve(String(root || '')))}.jsonl`);
}

// eslint-disable-next-line no-control-regex
const clean = (s, max) => String(s || '').replace(/[\u0000-\u0008\u000b-\u001f]/g, ' ').trim().slice(0, max);
const cleanPath = (p) => String(p || '').replace(/\\/g, '/').trim().slice(0, 300);

/** A clean entry from whatever the remember tool sent. { t, text, files } - deliberately minimal, no tags/categories. */
function makeEntry(o = {}) {
  return {
    t: Number.isFinite(o.t) ? o.t : Date.now(),
    text: clean(o.text, MAX_TEXT),
    files: Array.isArray(o.files) ? [...new Set(o.files.map(cleanPath).filter(Boolean))].slice(0, MAX_FILES) : [],
  };
}

/** Appends one entry (JSONL, one object per line). Returns false (and writes nothing) when there is no text to keep. */
function append(file, entry) {
  const e = makeEntry(entry);
  if (!e.text) return false;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(e) + '\n');
    return true;
  } catch { return false; }
}

/** All entries, most-recent-last, torn lines skipped, capped at MAX_ENTRIES (oldest dropped first). */
function readAll(file) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { const o = JSON.parse(line); if (o && typeof o === 'object' && o.text) out.push(makeEntry(o)); } catch { /* torn line */ }
  }
  return out.slice(-MAX_ENTRIES);
}

/**
 * Simple substring/path filtering - no embeddings, no classifier (same philosophy as scorecard.js's keyword rules:
 * "the user can see and trust a keyword rule"). query: case-insensitive substring match against text. path: a
 * file path (or prefix) that must appear (as a prefix match) in the entry's files. Either or both; most-recent-first.
 */
function recall(entries, { query = '', path: pathFilter = '', limit = 20 } = {}) {
  const q = String(query || '').toLowerCase().trim();
  const p = cleanPath(pathFilter);
  const cap = Math.max(1, Math.min(Number(limit) || 20, 100));
  const matches = entries.filter((e) => (!q || e.text.toLowerCase().includes(q)) && (!p || e.files.some((f) => f.startsWith(p))));
  return matches.slice(-cap).reverse();
}

/** The small, always-injected summary text. Most-recent-first, capped on both count and total characters. */
function buildIndex(entries, { maxEntries = MAX_INDEX_ENTRIES, maxChars = MAX_INDEX_CHARS } = {}) {
  if (!entries.length) return '';
  const picked = [...entries].reverse().slice(0, maxEntries);
  const lines = ['Things agents have already learned about this codebase (most recent first):'];
  for (const e of picked) {
    const files = e.files.length ? ` [${e.files.slice(0, 3).join(', ')}${e.files.length > 3 ? ', …' : ''}]` : '';
    lines.push(`- ${e.text}${files}`);
  }
  let out = lines.join('\n');
  if (out.length > maxChars) out = `${out.slice(0, maxChars - 1)}…`;
  return out;
}

module.exports = { fileFor, append, readAll, recall, buildIndex, makeEntry, MAX_TEXT, MAX_FILES, MAX_ENTRIES };
