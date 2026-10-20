'use strict';
/**
 * Capture of real traffic, for turning "unverified" into test fixtures. When switched on, what Claude Code, a model server or an
 * ACP agent really sends to Bazinga is written to files in a folder you can look at: hook payloads, telemetry, model requests and
 * replies, ACP messages, transcript lines. The user sends the folder; the shapes become fixtures.
 *
 * Nothing readable is kept. Every text value is replaced by its length (`<str:132>`), only names of things that describe the
 * *shape* stay (event, tool and model names, types, reasons). Keys are kept, numbers and booleans are kept. Authorization headers,
 * prompts, code, file contents, paths and ids never reach the files.
 */
const fs = require('node:fs');
const path = require('node:path');

// string values that are safe because they name a kind of thing, not content
const KEEP_KEYS = new Set([
  'type', 'role', 'event', 'hook_event_name', 'hookEventName', 'notification_type', 'sessionUpdate', 'kind', 'status', 'model', 'stop_reason',
  'finish_reason', 'stopReason', 'object', 'tool_name', 'agent_type', 'method', 'jsonrpc', 'level', 'unit', 'temporality', 'decision', 'optionId', 'protocolVersion',
  'permission_mode', 'source', 'reason', 'tool', 'function_name', 'originalModel', 'speed', 'service_tier', 'event.name', 'metric.name', 'success', 'tool_use_name',
  'dir', 'signal', 'contentType', 'encoding', 'format', 'event_name',
]);
// a tool or metric called "name" is kept only when it sits in one of these, so a user-chosen file or run name is not
const NAME_PARENTS = new Set(['function', 'tool', 'content_block', 'tools', 'metrics', 'toolCall', 'update', 'scopeMetrics', 'scope', 'agentInfo', 'clientInfo', 'content', 'tool_calls', 'message']);
// telemetry attributes whose value is a plain category
const SAFE_ATTRS = new Set(['event.name', 'model', 'tool_name', 'tool', 'decision', 'source', 'success', 'type', 'speed', 'query_source', 'language', 'terminal.type', 'service.name', 'service.version', 'os.type', 'host.arch', 'error', 'status_code', 'decision_source', 'decision_type']);

const MAX_STRING_KEEP = 80;
const MAX_ITEMS = 20;
const MAX_DEPTH = 14;

const looksLikeJson = (s) => /^\s*[{[]/.test(s) && s.length < 200000;

/** A copy of `value` with every text replaced by its length; see the file header for what stays. */
function sanitize(value, key = '', parent = '', depth = 0) {
  if (value === null || value === undefined) return value === undefined ? null : null;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string') {
    const keep = KEEP_KEYS.has(key) || (key === 'name' && NAME_PARENTS.has(parent));
    if (keep && value.length <= MAX_STRING_KEEP && !/[\\/]/.test(value.replace(/^[\w.-]+\/[\w.:-]+$/, ''))) return value; // "claude-sonnet-4" and "ollama/qwen3" are fine, a path is not
    // tool arguments and similar travel as JSON inside a string: keep their shape
    if (looksLikeJson(value) && depth < MAX_DEPTH) {
      try { return { $json: sanitize(JSON.parse(value), key, parent, depth + 1) }; } catch { /* a fragment: only its length */ }
    }
    return `<str:${value.length}>`;
  }
  if (depth >= MAX_DEPTH) return '<too deep>';
  if (Array.isArray(value)) {
    const out = value.slice(0, MAX_ITEMS).map((v) => sanitize(v, key, key, depth + 1));
    if (value.length > MAX_ITEMS) out.push(`<+${value.length - MAX_ITEMS} more>`);
    return out;
  }
  if (typeof value === 'object') {
    const out = {};
    // OpenTelemetry attributes: { key: 'tool_name', value: { stringValue: 'Read' } }
    if (typeof value.key === 'string' && value.value && typeof value.value === 'object' && Object.keys(value).length <= 3) {
      const safe = SAFE_ATTRS.has(value.key);
      const inner = value.value;
      const k = Object.keys(inner)[0];
      out.key = value.key;
      out.value = k ? { [k]: safe && typeof inner[k] === 'string' && inner[k].length <= MAX_STRING_KEEP && !/[\\/]/.test(inner[k]) ? inner[k] : sanitize(inner[k], '', '', depth + 2) } : {};
      return out;
    }
    let n = 0;
    for (const [k, v] of Object.entries(value)) {
      if (++n > 60) { out['<more keys>'] = Object.keys(value).length - 60; break; }
      const safeKey = k.length > 60 || /[\\/]/.test(k) ? `<key:${k.length}>` : k; // a key that is a path or a sentence is content
      out[safeKey] = sanitize(v, k, key || parent, depth + 1);
    }
    return out;
  }
  return `<${typeof value}>`;
}

const KINDS = ['hook', 'telemetry', 'model-request', 'model-response', 'acp', 'transcript'];
const MAX_RECORDS = 120; // per kind
const MAX_BYTES = 1500000; // per kind

class Capture {
  /** @param {{dir: string, enabled: () => boolean, info?: () => object}} o */
  constructor(o) {
    this.dir = o.dir; this.enabled = o.enabled; this.info = o.info || (() => ({}));
    this.counts = new Map(); this.bytes = new Map();
    this.once = new Set();
  }

  _file(kind) { return path.join(this.dir, `${kind}.jsonl`); }

  /** Writes one sanitized record. Never throws: capturing must not be able to break a hook, a request or a run. */
  record(kind, data, meta = {}, presanitized = false) {
    try {
      if (!KINDS.includes(kind) || !this.enabled()) return false;
      const n = this.counts.get(kind) || 0; const b = this.bytes.get(kind) || 0;
      if (n >= MAX_RECORDS || b >= MAX_BYTES) return false;
      fs.mkdirSync(this.dir, { recursive: true });
      const line = `${JSON.stringify({ at: new Date().toISOString(), kind, meta: sanitize(meta), data: presanitized ? data : sanitize(data) })}\n`;
      fs.appendFileSync(this._file(kind), line);
      this.counts.set(kind, n + 1); this.bytes.set(kind, b + line.length);
      return true;
    } catch { return false; }
  }

  /** Counts per kind from the files on disk (also those of earlier sessions). */
  status() {
    const out = { dir: this.dir, enabled: !!this.enabled(), kinds: {} };
    for (const k of KINDS) {
      try { const t = fs.readFileSync(this._file(k), 'utf8'); out.kinds[k] = t ? t.split('\n').filter(Boolean).length : 0; } catch { out.kinds[k] = 0; }
    }
    out.total = Object.values(out.kinds).reduce((a, b) => a + b, 0);
    return out;
  }

  /** One file with everything captured, easy to send. Returns its path, or null when there is nothing. */
  bundle(file = path.join(this.dir, 'bazinga-capture.json')) {
    const parts = {};
    for (const k of KINDS) {
      try { parts[k] = fs.readFileSync(this._file(k), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { parts[k] = []; }
    }
    if (!Object.values(parts).some((p) => p.length)) return null;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ about: 'Bazinga capture: shapes only, every text is replaced by its length', created: new Date().toISOString(), info: this.info(), ...parts }, null, 1));
    return file;
  }

  clear() {
    for (const k of KINDS) { try { fs.rmSync(this._file(k), { force: true }); } catch { /* gone */ } }
    try { fs.rmSync(path.join(this.dir, 'bazinga-capture.json'), { force: true }); } catch { /* gone */ }
    this.counts.clear(); this.bytes.clear();
  }
}

/** A server-sent-events text (from a model server) as sanitized frames, so the chunking stays visible: [{event, data}] */
function sanitizeSse(text, maxFrames = 60) {
  const frames = [];
  for (const raw of String(text || '').split(/\r?\n\r?\n/)) {
    if (!raw.trim()) continue;
    if (frames.length >= maxFrames) { frames.push('<more frames>'); break; }
    let event = ''; let data = '';
    for (const line of raw.split(/\r?\n/)) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data += line.slice(5).trim();
    }
    let parsed;
    if (data === '[DONE]') parsed = '[DONE]';
    else { try { parsed = sanitize(JSON.parse(data)); } catch { parsed = `<str:${data.length}>`; } }
    frames.push(event ? { event, data: parsed } : { data: parsed });
  }
  return frames;
}

/** The `onCapture` callback for the tool-call helper: a request is sanitized as it is, a reply (raw text) is cut into sanitized frames. */
function modelRecorder(capture) {
  return (kind, data, meta) => {
    if (kind === 'model-request') { capture.record(kind, data, meta); return; }
    const ct = String(data.contentType || '');
    let body;
    if (/event-stream/.test(ct)) body = { status: data.status, contentType: ct, frames: sanitizeSse(data.raw) };
    else { try { body = { status: data.status, contentType: ct, json: sanitize(JSON.parse(data.raw)) }; } catch { body = { status: data.status, contentType: ct, text: `<str:${String(data.raw || '').length}>` }; } }
    capture.record(kind, body, meta, true);
  };
}

module.exports = { modelRecorder, sanitize, sanitizeSse, Capture, KINDS, MAX_RECORDS };
