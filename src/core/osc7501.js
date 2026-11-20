'use strict';
/**
 * OSC 7501 ("Program Status Protocol", https://superlogical.com/rex/docs/build/program-status): lets a program
 * tell its terminal whether it is idle/working/blocked/done/error, instead of the terminal only guessing from a
 * quiet pty (core/idle.js) or needing a tool-specific hook (Claude Code's own, wired in main.js). A conformant
 * program may probe support first (a "?" query) and expects a capability reply on its stdin before it starts
 * relying on the protocol - capabilityReply() below is that reply; parsePayload()/Osc7501Tracker.feed() are the
 * receiving half. src/main/pty.js wires both into the existing pty data pipe.
 */

// ESC ] 7501 ; <payload> ST, where ST is ESC \ or BEL. Matches only a complete sequence; a half-received one
// (split across two pty data events) is simply not matched yet and is picked up whole on a later feed().
// eslint-disable-next-line no-control-regex
const REPORT_RE = /\x1b]7501;([^\x1b\x07]*?)(?:\x1b\\|\x07)/g;
const MAX_SEQUENCE_BYTES = 4096;

const STATES = new Set(['idle', 'working', 'done', 'blocked', 'error', 'clear']);
const KINDS = new Set(['permission', 'question', 'auth']);
const DEFAULT_CAPS = { states: [...STATES].filter((s) => s !== 'clear'), kinds: [...KINDS] };

const ID_SEGMENT = /^[A-Za-z0-9_.+-]{1,32}$/;
const TOKEN32 = /^[A-Za-z0-9_.+-]{1,32}$/;
const KEY_RE = /^[a-z]+$/;
const VALUE_RE = /^[A-Za-z0-9_.,+/=-]*$/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_RE = /[\x00-\x1f\x7f\x80-\x9f]/;

function validId(id) {
  if (id === undefined) return true;
  if (typeof id !== 'string' || !id || id.length > 128) return false;
  const segs = id.split('/');
  return segs.length <= 8 && segs.every((s) => ID_SEGMENT.test(s));
}

/** Decodes a base64 free-text field (`title`/`msg`), enforcing the spec's encoded/decoded size caps and no-control-characters rule. */
function decodeBase64Text(b64, maxEncoded, maxDecoded) {
  if (typeof b64 !== 'string' || Buffer.byteLength(b64, 'utf8') > maxEncoded) return undefined;
  let text;
  try { text = Buffer.from(b64, 'base64').toString('utf8'); } catch { return undefined; }
  if (Buffer.byteLength(text, 'utf8') > maxDecoded) return undefined;
  if (CONTROL_CHAR_RE.test(text)) return undefined;
  return text;
}

/**
 * Parses one OSC 7501 payload (the bytes between "7501;" and the terminator, not including either).
 * @returns {null | {query:true} | {state, id?, kind?, progress?, app?, title?, msg?}} null for a malformed or rejected report.
 */
function parsePayload(payload) {
  if (payload.trim() === '?') return { query: true };
  const out = {};
  for (const rawPair of payload.split(':')) {
    const pair = rawPair.trim();
    if (!pair) continue;
    const eq = pair.indexOf('=');
    if (eq <= 0) continue; // no "=", or an empty key: skip this pair and keep processing the rest
    const key = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (!KEY_RE.test(key) || key.length > 16 || !VALUE_RE.test(value)) continue; // ignore unknown/malformed pairs
    out[key] = value; // a repeated key: the last occurrence wins
  }
  if (!out.state || !STATES.has(out.state)) return null; // state is required; missing/unknown discards the whole report
  if (!validId(out.id)) return null; // invalid id grammar discards the report rather than falling back to root
  if (out.kind !== undefined && !KINDS.has(out.kind)) delete out.kind; // unrecognized kind: treated as absent, not rejected
  if (out.progress !== undefined) {
    const n = Number(out.progress);
    if (Number.isInteger(n) && n >= 0 && n <= 100) out.progress = n; else delete out.progress;
  }
  if (out.app !== undefined && !TOKEN32.test(out.app)) delete out.app;
  if (out.title !== undefined) {
    const t = decodeBase64Text(out.title, 256, 192);
    if (t === undefined) return null;
    out.title = t;
  }
  if (out.msg !== undefined) {
    const m = decodeBase64Text(out.msg, 2732, 2048);
    if (m === undefined) return null;
    out.msg = m;
  }
  return out;
}

/** The capability reply a terminal sends back on the program's stdin after it sends a "?" query. */
function capabilityReply({ states = DEFAULT_CAPS.states, kinds = DEFAULT_CAPS.kinds } = {}) {
  return `\x1b]7501;?:states=${states.join(',')}:kinds=${kinds.join(',')}\x1b\\`;
}

/**
 * Tracks one terminal's records: the root record plus up to 256 id'd records (replace-entirely on each report,
 * hierarchy-aware `clear`, least-recently-updated eviction once full). Only the root record (no `id`) is surfaced
 * today - src/main/pty.js maps it onto the same onIdle/onPrompt callbacks the quiet-terminal heuristic and Claude
 * Code's hooks already use. Sub-records (e.g. a `build/test` child) are tracked correctly but not yet shown
 * anywhere, since there is no per-terminal UI slot for more than one status today.
 */
class Osc7501Tracker {
  constructor() { this.records = new Map(); }

  _clear(id) {
    if (id === undefined) { this.records.clear(); return; }
    const prefix = `${id}/`;
    for (const key of this.records.keys()) if (key === id || key.startsWith(prefix)) this.records.delete(key);
  }

  /** @returns {Array<{query:true} | {id: string|undefined, cleared: true} | {id: string|undefined, record: object}>} */
  feed(chunk) {
    const text = String(chunk);
    const out = [];
    for (const m of text.matchAll(REPORT_RE)) {
      if (Buffer.byteLength(m[0], 'utf8') > MAX_SEQUENCE_BYTES) continue;
      const parsed = parsePayload(m[1]);
      if (!parsed) continue;
      if (parsed.query) { out.push({ query: true }); continue; }
      const { id } = parsed;
      delete parsed.id;
      if (parsed.state === 'clear') { this._clear(id); out.push({ id, cleared: true }); continue; }
      const key = id || '';
      this.records.delete(key); // delete-then-set moves it to the end: the Map's insertion order gives LRU for free
      this.records.set(key, parsed);
      if (this.records.size > 256) this.records.delete(this.records.keys().next().value);
      out.push({ id, record: { ...parsed } });
    }
    return out;
  }
}

module.exports = { parsePayload, capabilityReply, Osc7501Tracker, STATES, KINDS };
