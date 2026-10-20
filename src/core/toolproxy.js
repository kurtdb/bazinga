'use strict';
// A small proxy between Claude Code and a model server (Ollama). Claude Code talks to it instead of to Ollama, and it
//  1. records what really goes over the wire (how big the prompt is, what the model answered) so a failure can be explained,
//  2. repairs what small models get wrong: a tool call printed as text, wrong argument names, relative paths, wrong types,
//  3. optionally slims the prompt: Claude Code sends tens of thousands of characters of instructions per request, which
//     a 14B model on a laptop has to read again every time.
// It speaks the Anthropic Messages API (what Ollama offers at /v1/messages), streaming (SSE) and not. For servers that only
// speak OpenAI's Chat Completions API (LM Studio, llama.cpp, vLLM, gateways) it translates both ways: format 'openai'.
const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const folderroles = require('./folderroles');
const adapter = require('./openaiadapter');

const MAX_BODY = 256 * 1024 * 1024;
const nk = (k) => String(k).toLowerCase().replace(/[_\-\s]/g, '');
const short = (t, n = 120) => { const x = String(t == null ? '' : t).replace(/\s+/g, ' ').trim(); return x.length > n ? `${x.slice(0, n)}…` : x; };
// A long temp-dir prefix (macOS's /private/var/folders/.../T/ is much longer than Linux's /tmp) can otherwise land the
// cut mid-filename (".../output.t…" instead of ".../output.txt"); keep the basename intact and trim the middle instead.
const shortPath = (t, n = 90) => {
  const x = String(t == null ? '' : t).replace(/\s+/g, ' ').trim();
  if (x.length <= n) return x;
  const slash = Math.max(x.lastIndexOf('/'), x.lastIndexOf('\\'));
  const base = slash > -1 ? x.slice(slash) : '';
  if (base && base.length <= n - 4) return `${x.slice(0, n - base.length - 1)}…${base}`;
  return `${x.slice(0, n)}…`;
};
const num = (n) => Number(n || 0).toLocaleString('en');

// ---------------------------------------------------------------------------------------------------- tools and arguments
function indexTools(tools) {
  const m = new Map();
  for (const t of Array.isArray(tools) ? tools : []) if (t && typeof t.name === 'string') m.set(t.name.toLowerCase(), t);
  return m;
}
const TOOL_ALIASES = {
  write_file: 'write', create_file: 'write', file_write: 'write', writefile: 'write', save_file: 'write', write_to_file: 'write',
  read_file: 'read', readfile: 'read', view: 'read', cat: 'read', open_file: 'read', view_file: 'read',
  edit_file: 'edit', str_replace: 'edit', str_replace_editor: 'edit', replace_in_file: 'edit',
  run_command: 'bash', execute: 'bash', execute_command: 'bash', shell: 'bash', terminal: 'bash', run: 'bash', sh: 'bash', run_shell_command: 'bash',
  find_files: 'glob', list_files: 'glob', search: 'grep', search_files: 'grep', grep_search: 'grep',
};
function resolveTool(name, index) {
  const n = String(name || '').trim().toLowerCase().replace(/^functions?[.:]/, '');
  if (!n) return null;
  if (index.has(n)) return index.get(n);
  const a = TOOL_ALIASES[n];
  return a && index.has(a) ? index.get(a) : null;
}

// wrong key -> right key, for the arguments small models mix up
const KEY_ALIASES = {
  file_path: ['path', 'file', 'filename', 'file_name', 'target_file', 'absolute_path', 'file_to_write', 'file_to_read', 'pathname', 'filepath'],
  content: ['text', 'contents', 'file_content', 'file_text', 'data', 'code', 'body'],
  old_string: ['old_str', 'old', 'old_text', 'original', 'find', 'search'],
  new_string: ['new_str', 'new', 'new_text', 'replacement', 'replace'],
  command: ['cmd', 'script', 'shell_command', 'bash_command', 'code'],
  pattern: ['regex', 'query', 'search', 'expression', 'glob_pattern', 'regexp', 'search_pattern'],
  path: ['dir', 'directory', 'folder', 'root'],
};

function absolutize(p, cwd) {
  if (!cwd || typeof p !== 'string' || !p) return p;
  const win = /^[A-Za-z]:[\\/]/.test(cwd) || cwd.startsWith('\\\\');
  const P = win ? path.win32 : path.posix;
  if (P.isAbsolute(p) || p.startsWith('~')) return p;
  return P.join(cwd, p);
}

/** Makes a tool's input fit the tool's schema as far as that can be done safely. Returns { input, fixes, missing }. */
function fixInput(tool, raw, cwd, opts = {}) {
  const fixes = [];
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
  const schema = (tool && tool.input_schema) || {};
  const props = schema.properties && typeof schema.properties === 'object' ? schema.properties : null;
  const required = Array.isArray(schema.required) ? schema.required : [];
  if (props) {
    // same key, other spelling (filePath, File-Path)
    const byNorm = new Map(Object.keys(props).map((k) => [nk(k), k]));
    for (const k of Object.keys(input)) {
      if (k in props) continue;
      const target = byNorm.get(nk(k));
      if (target && !(target in input)) { input[target] = input[k]; delete input[k]; fixes.push(`${k} → ${target}`); }
    }
    // a different word for the same thing (path -> file_path, text -> content)
    for (const want of Object.keys(props)) {
      if (want in input || !KEY_ALIASES[want]) continue;
      const found = Object.keys(input).find((k) => !(k in props) && KEY_ALIASES[want].some((a) => nk(a) === nk(k)));
      if (found) { input[want] = input[found]; delete input[found]; fixes.push(`${found} → ${want}`); }
    }
    // one unknown key and one missing required string argument: they are meant for each other
    const missingReq = required.filter((k) => !(k in input));
    const unknown = Object.keys(input).filter((k) => !(k in props));
    if (missingReq.length === 1 && unknown.length === 1 && props[missingReq[0]] && props[missingReq[0]].type === 'string' && typeof input[unknown[0]] === 'string') {
      input[missingReq[0]] = input[unknown[0]]; fixes.push(`${unknown[0]} → ${missingReq[0]}`); delete input[unknown[0]];
    }
    for (const k of Object.keys(input)) if (!(k in props)) { delete input[k]; fixes.push(`dropped unknown argument ${k}`); }
    for (const [k, def] of Object.entries(props)) {
      if (!(k in input)) continue;
      const v = input[k]; const t = def && def.type;
      if ((v === null || v === undefined) && !required.includes(k)) { delete input[k]; fixes.push(`dropped empty ${k}`); continue; }
      if (t === 'string' && typeof v !== 'string' && v !== null && v !== undefined) { input[k] = typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v); fixes.push(`${k} converted to text`); }
      else if ((t === 'number' || t === 'integer') && typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) { input[k] = Number(v); fixes.push(`${k} converted to a number`); }
      else if (t === 'boolean' && typeof v === 'string' && /^(true|false)$/i.test(v)) { input[k] = /^true$/i.test(v); fixes.push(`${k} converted to true/false`); }
    }
  }
  // the folders the user marked know where a file lives: pipeline.py -> edgy/pipeline.py, a new test_x.py -> the test folder
  if (opts && typeof opts.resolve === 'function' && typeof input.file_path === 'string') {
    const r = opts.resolve(input.file_path, tool && tool.name);
    if (r) { fixes.push(`file_path ${input.file_path} → ${r.path} (${r.note})`); input.file_path = r.path; }
  }
  // Claude Code's file tools want absolute paths; a small model often gives the name only
  for (const k of ['file_path', 'notebook_path']) {
    if (typeof input[k] === 'string') { const abs = absolutize(input[k], cwd); if (abs !== input[k]) { input[k] = abs; fixes.push(`${k} made absolute`); } }
  }
  const missing = required.filter((k) => input[k] === undefined || input[k] === null);
  return { input, fixes, missing };
}

// ---------------------------------------------------------------------------------------------------- tool calls written as text
function matchEnd(s, i) {
  let depth = 0; let inStr = false; let esc = false;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; continue; }
    if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') { depth--; if (depth === 0) return j; }
  }
  return -1;
}
/** Raw line breaks and tabs inside JSON strings (models do that) -> escaped, so the JSON parses. */
function escapeControls(s) {
  let out = ''; let inStr = false; let esc = false;
  for (const c of s) {
    if (inStr) {
      if (esc) { esc = false; out += c; } else if (c === '\\') { esc = true; out += c; } else if (c === '"') { inStr = false; out += c; }
      else if (c === '\n') out += '\\n'; else if (c === '\r') out += '\\r'; else if (c === '\t') out += '\\t'; else out += c;
    } else { if (c === '"') inStr = true; out += c; }
  }
  return out;
}
function lenientParse(s) {
  try { return JSON.parse(s); } catch { /* try the forgiving way */ }
  try { return JSON.parse(escapeControls(s)); } catch { return undefined; }
}
function jsonValues(s) {
  const out = []; let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '{' || c === '[') {
      const end = matchEnd(s, i);
      if (end < 0) break; // cut off: not a complete call
      const v = lenientParse(s.slice(i, end + 1));
      if (v !== undefined) { out.push(v); i = end + 1; continue; }
    }
    i++;
  }
  return out;
}
/** <function=Write><parameter=file_path>…</parameter></function> (the XML style of some Qwen models). */
function xmlCalls(s) {
  const calls = [];
  const re = /<function=([\w.\-]+)>([\s\S]*?)(?:<\/function>|$)/g;
  let m;
  while ((m = re.exec(s))) {
    const args = {}; const pr = /<parameter=([\w.\-]+)>\n?([\s\S]*?)\n?<\/parameter>/g; let p;
    while ((p = pr.exec(m[2]))) args[p[1]] = p[2];
    calls.push({ name: m[1], args });
  }
  return calls;
}

function callParts(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const fn = obj.function && typeof obj.function === 'object' ? obj.function : null;
  let name = obj.name || obj.tool || obj.tool_name || obj.function_name || obj.action || (fn && fn.name) || (typeof obj.function === 'string' ? obj.function : '');
  if (name && typeof name === 'object') name = name.name;
  let args = obj.arguments !== undefined ? obj.arguments : obj.parameters !== undefined ? obj.parameters : obj.input !== undefined ? obj.input : obj.args !== undefined ? obj.args : obj.params !== undefined ? obj.params : obj.tool_input !== undefined ? obj.tool_input : obj.action_input !== undefined ? obj.action_input : fn ? fn.arguments : undefined;
  if (typeof args === 'string') args = lenientParse(args);
  return { name: typeof name === 'string' ? name : '', args: args && typeof args === 'object' ? args : undefined };
}

/** Arguments with no tool name: which single tool takes exactly these keys? */
function inferTool(args, index) {
  const keys = Object.keys(args);
  const hits = [...index.values()].filter((t) => {
    const props = (t.input_schema && t.input_schema.properties) || {};
    const req = (t.input_schema && t.input_schema.required) || [];
    return req.length > 0 && req.every((k) => k in args) && keys.every((k) => k in props);
  });
  return hits.length === 1 ? hits[0] : null;
}

/**
 * The text of a model message -> the tool calls it contains, or null when it is not (only) tool calls.
 * Understands JSON ({"name": …, "arguments": …}, also OpenAI style and arrays), <tool_call> tags and Qwen's XML style.
 */
function extractCalls(text, ctx) {
  const s = String(text || '');
  const raws = [];
  for (const c of xmlCalls(s)) raws.push({ name: c.name, args: c.args });
  if (!raws.length) {
    for (const v of jsonValues(s)) {
      const list = Array.isArray(v) ? v : Array.isArray(v && v.tool_calls) ? v.tool_calls : [v];
      for (const o of list) {
        const p = callParts(o);
        if (!p) return null;
        if (!p.name && o && typeof o === 'object' && !Array.isArray(o)) { const t = inferTool(o, ctx.tools); if (!t) return null; raws.push({ tool: t, args: o }); continue; }
        raws.push({ name: p.name, args: p.args || {} });
      }
    }
  }
  if (!raws.length) return null;
  const calls = [];
  for (const r of raws) {
    const tool = r.tool || resolveTool(r.name, ctx.tools);
    if (!tool) return null; // names a tool this session does not have: leave it as text
    const fixed = fixInput(tool, r.args, ctx.cwd, ctx);
    calls.push({ tool, name: tool.name, input: fixed.input, fixes: fixed.fixes, missing: fixed.missing });
  }
  return calls;
}

/** Does this start of a message look like a tool call? 'call' | 'text' | 'unknown' (cannot tell yet). */
function classify(prefix) {
  const t = String(prefix || '').replace(/^\s+/, '');
  if (!t) return 'unknown';
  if (t.startsWith('{') || t.startsWith('[{') || t === '[') return 'call';
  if (t.startsWith('```')) {
    const m = /^```[A-Za-z_-]*\s*/.exec(t);
    const rest = t.slice(m[0].length);
    if (!rest) return t.length < 40 ? 'unknown' : 'text';
    return rest[0] === '{' || rest[0] === '[' || rest.startsWith('<tool_call') ? 'call' : 'text';
  }
  if (t[0] === '<') {
    for (const m of ['<tool_call', '<function_call', '<function=', '<tools>']) {
      if (t.startsWith(m)) return 'call';
      if (m.startsWith(t)) return 'unknown';
    }
  }
  return 'text';
}

const callLabel = (name, input) => {
  const i = input || {};
  const target = i.file_path || i.command || i.pattern || i.path || '';
  return `${name}(${shortPath(target, 90)})`;
};
const callId = () => `toolu_bz${crypto.randomBytes(8).toString('hex')}`;

// ---------------------------------------------------------------------------------------------------- the streaming repair
const sse = (ev) => `event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`;

/**
 * Takes the server-sent events of a model reply and gives back events for Claude Code. Thinking and ordinary text pass
 * through at once; a text that starts like a tool call is held back and turned into a real tool call; tool-call
 * arguments are collected and corrected. ctx = { tools: Map, cwd, repair, onLive }.
 */
class StreamRepair {
  constructor(ctx) {
    this.ctx = ctx; this.buf = ''; this.next = 0; this.map = new Map(); this.blocks = new Map(); this.converted = false;
    this.summary = { blocks: [], fixes: [], notes: [], stop: '', held: '', usage: null };
  }

  push(chunk) {
    this.buf += chunk;
    const out = [];
    for (;;) {
      const m = /\r?\n\r?\n/.exec(this.buf);
      if (!m) break;
      const raw = this.buf.slice(0, m.index);
      this.buf = this.buf.slice(m.index + m[0].length);
      out.push(...this.event(raw));
    }
    return out;
  }

  end() {
    const out = [];
    if (this.buf.trim()) out.push(...this.event(this.buf));
    this.buf = '';
    for (const [u, b] of this.blocks) if (!b.done) out.push(...this.close(u, b));
    return out;
  }

  live(kind, chars, tail) { if (this.ctx.onLive) this.ctx.onLive({ kind, chars, tail }); }

  event(raw) {
    const data = [];
    for (const line of raw.split(/\r?\n/)) if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    if (!data.length) return [`${raw}\n\n`];
    let ev;
    try { ev = JSON.parse(data.join('\n')); } catch { return [`${raw}\n\n`]; }
    if (!ev || typeof ev !== 'object') return [`${raw}\n\n`];
    if (ev.type === 'message_start' && ev.message && ev.message.usage) this.summary.usage = mergeUsage(this.summary.usage, ev.message.usage);
    if (ev.type === 'message_delta' && ev.usage) this.summary.usage = mergeUsage(this.summary.usage, ev.usage);
    const u = ev.index;
    if (ev.type === 'content_block_start') return this.start(ev, u);
    if (ev.type === 'content_block_delta') return this.delta(ev, u);
    if (ev.type === 'content_block_stop') { const b = this.blocks.get(u); return b ? this.close(u, b) : []; }
    if (ev.type === 'message_delta' && ev.delta) {
      if (this.converted && ev.delta.stop_reason === 'end_turn') ev.delta.stop_reason = 'tool_use';
      this.summary.stop = ev.delta.stop_reason || '';
    }
    return [sse(ev)];
  }

  start(ev, u) {
    const cb = ev.content_block || {};
    const b = { kind: 'pass', type: cb.type, cb, chars: 0, done: false, idx: null, text: '', json: '', state: 'pass', name: cb.name || '', tool: null };
    this.blocks.set(u, b);
    if (cb.type === 'text') { b.kind = 'text'; b.state = 'unknown'; b.text = cb.text || ''; return this.decide(b, u); }
    if (cb.type === 'tool_use') {
      b.kind = 'tool';
      b.tool = this.ctx.tools.get(String(cb.name || '').toLowerCase()) || null;
      if (b.tool || !this.ctx.repair) return this.open(b, u, { ...cb, input: {} }); // known tool: announce it right away
      b.held = true; // unknown name (write_file…): wait, it may be renamed
      return [];
    }
    return this.open(b, u, cb);
  }

  /** Gives the block its number towards Claude Code and sends its start. */
  open(b, u, cb) {
    b.idx = this.next++; this.map.set(u, b.idx);
    return [sse({ type: 'content_block_start', index: b.idx, content_block: cb })];
  }

  decide(b, u) {
    if (!this.ctx.repair) b.state = 'pass';
    else { const c = classify(b.text); b.state = c === 'call' ? 'hold' : c === 'text' ? 'pass' : 'unknown'; }
    if (b.state !== 'pass') return [];
    const out = this.open(b, u, { type: 'text', text: '' });
    if (b.text) out.push(sse({ type: 'content_block_delta', index: b.idx, delta: { type: 'text_delta', text: b.text } }));
    return out;
  }

  delta(ev, u) {
    const b = this.blocks.get(u);
    if (!b) return [sse(ev)];
    const d = ev.delta || {};
    if (b.kind === 'tool' && d.type === 'input_json_delta') {
      b.json += d.partial_json || '';
      this.live('tool', b.json.length, `${b.name} ${b.json}`.slice(-300));
      return [];
    }
    if (b.kind === 'text' && d.type === 'text_delta') {
      b.chars += (d.text || '').length;
      this.live('text', b.chars, (b.text + (d.text || '')).slice(-300));
      if (b.state === 'pass') { b.text += d.text || ''; return [sse({ ...ev, index: b.idx })]; }
      b.text += d.text || '';
      return b.state === 'unknown' ? this.decide(b, u) : [];
    }
    if (b.idx === null) return [];
    if (d.type === 'thinking_delta') { b.chars += (d.thinking || '').length; this.live('thinking', b.chars, ''); }
    return [sse({ ...ev, index: b.idx })];
  }

  close(u, b) {
    b.done = true;
    const out = [];
    if (b.kind === 'text') {
      if (b.state === 'hold') return this.closeHeld(b, u);
      if (b.state === 'unknown') { out.push(...this.open(b, u, { type: 'text', text: '' })); if (b.text) out.push(sse({ type: 'content_block_delta', index: b.idx, delta: { type: 'text_delta', text: b.text } })); }
      this.summary.blocks.push({ type: 'text', chars: b.text.length, preview: short(b.text, 100) });
      out.push(sse({ type: 'content_block_stop', index: b.idx }));
      return out;
    }
    if (b.kind === 'tool') return this.closeTool(b, u);
    if (b.idx !== null) {
      this.summary.blocks.push({ type: b.type, chars: b.chars });
      out.push(sse({ type: 'content_block_stop', index: b.idx }));
    }
    return out;
  }

  closeHeld(b, u) {
    const calls = extractCalls(b.text, this.ctx);
    const out = [];
    if (calls && calls.length) {
      this.converted = true;
      for (const c of calls) {
        const idx = this.next++; if (c === calls[0]) this.map.set(u, idx);
        out.push(sse({ type: 'content_block_start', index: idx, content_block: { type: 'tool_use', id: callId(), name: c.name, input: {} } }));
        out.push(sse({ type: 'content_block_delta', index: idx, delta: { type: 'input_json_delta', partial_json: JSON.stringify(c.input) } }));
        out.push(sse({ type: 'content_block_stop', index: idx }));
        this.summary.blocks.push({ type: 'tool_use', name: c.name, label: callLabel(c.name, c.input), fromText: true, missing: c.missing });
        this.summary.fixes.push(`The model wrote the ${c.name} call as text; Bazinga turned it into a real tool call`, ...c.fixes);
        if (c.missing.length) this.summary.notes.push(`${c.name} is still missing: ${c.missing.join(', ')}`);
      }
      return out;
    }
    // it only looked like a tool call: give it back unchanged, and keep what the model wrote so it can be shown
    this.summary.held = short(b.text, 600);
    this.summary.notes.push('The model started its reply like a tool call, but it could not be read as one (see what it wrote)');
    out.push(...this.open(b, u, { type: 'text', text: '' }));
    out.push(sse({ type: 'content_block_delta', index: b.idx, delta: { type: 'text_delta', text: b.text } }));
    out.push(sse({ type: 'content_block_stop', index: b.idx }));
    this.summary.blocks.push({ type: 'text', chars: b.text.length, preview: short(b.text, 100) });
    return out;
  }

  closeTool(b, u) {
    const out = [];
    let json = b.json;
    let name = b.name;
    let fixes = []; let missing = [];
    if (this.ctx.repair) {
      let parsed = b.json.trim() === '' ? {} : lenientParse(b.json);
      if (parsed === undefined) { this.summary.notes.push(`The arguments of ${b.name} were not valid JSON and could not be repaired`); }
      else {
        let tool = b.tool;
        if (!tool) { tool = resolveTool(b.name, this.ctx.tools); if (tool) { this.summary.fixes.push(`tool name ${b.name} → ${tool.name}`); name = tool.name; } }
        if (tool) { const f = fixInput(tool, parsed, this.ctx.cwd, this.ctx); parsed = f.input; fixes = f.fixes; missing = f.missing; }
        json = JSON.stringify(parsed);
        for (const f of fixes) this.summary.fixes.push(`${name}: ${f}`);
        if (missing.length) this.summary.notes.push(`${name} is missing: ${missing.join(', ')}`);
      }
    }
    if (b.idx === null) out.push(...this.open(b, u, { type: 'tool_use', id: b.cb.id || callId(), name, input: {} }));
    if (json !== '') out.push(sse({ type: 'content_block_delta', index: b.idx, delta: { type: 'input_json_delta', partial_json: json } }));
    out.push(sse({ type: 'content_block_stop', index: b.idx }));
    let shown = {};
    try { shown = JSON.parse(json || '{}'); } catch { shown = {}; }
    this.summary.blocks.push({ type: 'tool_use', name, label: callLabel(name, shown), missing });
    return out;
  }
}

/** The same repairs for an answer that is not streamed (a whole message as JSON). */
/** Token counts from a message's `usage`: the later numbers win (a stream reports the input first and the output at the end). */
function mergeUsage(prev, u) {
  const n = (v) => (v !== null && v !== '' && v !== undefined && Number.isFinite(Number(v)) ? Number(v) : null);
  const out = { input: prev ? prev.input : 0, output: prev ? prev.output : 0 };
  const i = n(u && u.input_tokens); const o = n(u && u.output_tokens);
  if (i !== null && i > 0) out.input = i;
  if (o !== null) out.output = o;
  return out;
}

function repairMessage(msg, ctx) {
  const summary = { blocks: [], fixes: [], notes: [], stop: msg && msg.stop_reason || '', held: '', usage: msg && msg.usage ? mergeUsage(null, msg.usage) : null };
  if (!msg || !Array.isArray(msg.content) || !ctx.repair) return { msg, summary };
  const out = []; let converted = false;
  for (const c of msg.content) {
    if (c && c.type === 'text' && classify(c.text) === 'call') {
      const calls = extractCalls(c.text, ctx);
      if (calls && calls.length) {
        converted = true;
        for (const k of calls) {
          out.push({ type: 'tool_use', id: callId(), name: k.name, input: k.input });
          summary.blocks.push({ type: 'tool_use', name: k.name, label: callLabel(k.name, k.input), fromText: true, missing: k.missing });
          summary.fixes.push(`The model wrote the ${k.name} call as text; Bazinga turned it into a real tool call`, ...k.fixes);
        }
        continue;
      }
      summary.held = short(c.text, 600);
    }
    if (c && c.type === 'tool_use') {
      const tool = resolveTool(c.name, ctx.tools);
      if (tool) {
        const f = fixInput(tool, c.input, ctx.cwd, ctx);
        summary.fixes.push(...f.fixes.map((x) => `${tool.name}: ${x}`));
        summary.blocks.push({ type: 'tool_use', name: tool.name, label: callLabel(tool.name, f.input), missing: f.missing });
        out.push({ ...c, name: tool.name, input: f.input });
        continue;
      }
    }
    if (c && c.type === 'text') summary.blocks.push({ type: 'text', chars: (c.text || '').length, preview: short(c.text, 100) });
    out.push(c);
  }
  const res = { ...msg, content: out };
  if (converted && res.stop_reason === 'end_turn') res.stop_reason = 'tool_use';
  summary.stop = res.stop_reason || '';
  return { msg: res, summary };
}

// ---------------------------------------------------------------------------------------------------- a slimmer prompt
const LEAN_BASE = 'You are a coding assistant working inside the user\'s project, with tools to read and change files. Always use a tool to read or change a file: never print code or a tool call as text and then say it is done. Do the work yourself with your tools instead of describing what could be done, and ask a question only when you cannot continue without the answer. Keep answers short.';
const LEAN_TOOLS = {
  Read: 'Read a file. Argument file_path (absolute path). Optional offset and limit (line numbers) for big files.',
  Write: 'Create or overwrite a file. Arguments: file_path (absolute path) and content (the complete text of the file). Read an existing file first.',
  Edit: 'Replace text in a file. Arguments: file_path (absolute path), old_string (exact text to find, must occur once), new_string. Read the file first.',
  Bash: 'Run a shell command in the working directory and return its output. Argument command.',
  Glob: 'Find files by name pattern, for example **/*.py. Argument pattern, optional path.',
  Grep: 'Search file contents with a regular expression. Argument pattern, optional path and glob.',
};
const systemText = (s) => (typeof s === 'string' ? s : Array.isArray(s) ? s.map((b) => (b && b.text) || '').join('\n') : '');
const sizeOf = (v) => { try { return JSON.stringify(v === undefined ? '' : v).length; } catch { return 0; } };

function workingDir(system) {
  const m = /Primary working directory:\s*(.+)/i.exec(systemText(system)) || /Working directory:\s*(.+)/i.exec(systemText(system));
  return m ? m[1].trim() : '';
}

/** Replaces the long system prompt and tool descriptions by short ones (in place). The hint (standing instructions) is kept. */
function leanify(body, hint) {
  const text = systemText(body.system);
  const keep = ['Primary working directory', 'Platform', 'OS Version', 'Shell', 'Today\'s date', 'Is a git repository']
    .map((k) => new RegExp(`^\\s*[-*]?\\s*(${k}:.*)$`, 'mi').exec(text)).filter(Boolean).map((m) => m[1].trim());
  const lean = [LEAN_BASE, keep.length ? `Environment:\n${keep.join('\n')}` : '', hint || ''].filter(Boolean).join('\n\n');
  body.system = Array.isArray(body.system) ? [{ type: 'text', text: lean }] : lean;
  if (Array.isArray(body.tools)) {
    body.tools = body.tools.map((t) => {
      if (!t || typeof t !== 'object') return t;
      const copy = { ...t, description: LEAN_TOOLS[t.name] || short(String(t.description || '').split(/\n\s*\n/)[0], 300) };
      const props = t.input_schema && t.input_schema.properties;
      if (props) {
        copy.input_schema = { ...t.input_schema, properties: Object.fromEntries(Object.entries(props).map(([k, v]) => [k, v && typeof v === 'object' && v.description ? { ...v, description: short(v.description, 140) } : v])) };
      }
      return copy;
    });
  }
  return body;
}

// ---------------------------------------------------------------------------------------------------- what was seen
function createTrace(limit = 80) {
  const items = []; let n = 0;
  return {
    begin() { const rec = { n: ++n, at: Date.now(), model: '', stream: false, request: null, summary: null, status: 0, error: '', ms: 0, done: false }; items.push(rec); if (items.length > limit) items.shift(); return rec; },
    mark: () => n,
    all: () => items.slice(),
    since: (mark) => items.filter((r) => r.n > mark),
  };
}

/** One record -> human-readable lines. */
function describe(rec, now = Date.now()) {
  const lines = [];
  const rq = rec.request;
  if (rq) {
    const slim = rq.lean ? ` → ${num(rq.promptAfter)} (slim prompt)` : '';
    lines.push(`request ${rec.n}: ${rq.tools} tools, ${rq.messages} messages, prompt ${num(rq.promptBefore)} characters${slim}`);
  } else lines.push(`request ${rec.n}: not a chat request`);
  if (!rec.done) { lines.push(`  waiting for the model… (${Math.round((now - rec.at) / 1000)}s)`); return lines; }
  const secs = `${Math.round(rec.ms / 100) / 10}s`;
  if (rec.error) { lines.push(`  failed after ${secs}: ${rec.error}`); return lines; }
  if (rec.status && rec.status !== 200) lines.push(`  the server answered HTTP ${rec.status} after ${secs}`);
  const s = rec.summary;
  if (s) {
    const parts = s.blocks.map((b) => (b.type === 'tool_use' ? `tool call ${b.label}${b.fromText ? ' (written as text by the model)' : ''}` : b.type === 'text' ? `text, ${num(b.chars)} characters${b.preview ? `: “${b.preview}”` : ''}` : `${b.type}, ${num(b.chars || 0)} characters`));
    lines.push(`  reply after ${secs}: ${parts.length ? parts.join('; ') : 'nothing'}${s.stop ? ` (stop: ${s.stop})` : ''}`);
    for (const f of s.fixes) lines.push(`  repaired: ${f}`);
    for (const note of s.notes) lines.push(`  note: ${note}`);
    if (s.held) lines.push(`  the model wrote: ${s.held}`);
  }
  return lines;
}

// ---------------------------------------------------------------------------------------------------- the server
/** The folders marked as source / tests, read fresh from the working folder's .ide/config.json (a run's worktree has its own copy), else from the project's. */
function markedFolders(cwd, root) {
  for (const base of [cwd, root]) {
    if (!base) continue;
    try { const f = folderroles.fromConfig(JSON.parse(fs.readFileSync(path.join(base, '.ide', 'config.json'), 'utf8'))); if (!folderroles.isEmpty(f)) return f; } catch { /* none here */ }
  }
  return { source: [], tests: [] };
}

function createProxy({ upstream, lean = true, repair = true, hint = '', root = '', onLog = null, onUsage = null, onCapture = null, format = 'anthropic', port = 0 } = {}) {
  const target = new URL(upstream);
  const openai = format === 'openai'; // the server speaks OpenAI's Chat Completions API: translate (core/openaiadapter.js)
  const lib = target.protocol === 'https:' ? https : http;
  const trace = createTrace();
  const logged = new Set(); // the debug log gets one line per finished request
  const flush = (rec) => {
    if (!rec.done || logged.has(rec.n)) return;
    logged.add(rec.n);
    if (onLog) { try { onLog(describe(rec).join(' | ')); } catch { /* logging never breaks a request */ } }
    if (onUsage && rec.request) {
      const u = rec.summary && rec.summary.usage;
      try { onUsage({ token: rec.agent || '', model: rec.model || '', input: u ? u.input : 0, output: u ? u.output : 0, ms: rec.ms, error: rec.error || (rec.status && rec.status !== 200 ? `HTTP ${rec.status}` : ''), at: Date.now() }); } catch { /* the meter never breaks a request */ }
    }
  };
  const liveNow = { kind: null, chars: 0, tail: '', at: 0 };
  let active = 0;

  const server = http.createServer((req, res) => {
    active++;
    res.on('close', () => { active--; });
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { req.destroy(); return; } chunks.push(c); });
    req.on('end', () => handle(req, res, Buffer.concat(chunks)));
    req.on('error', () => { try { res.destroy(); } catch { /* gone */ } });
  });
  server.requestTimeout = 0; server.headersTimeout = 0; server.keepAliveTimeout = 60000;

  function handle(req, res, buf) {
    let parsed = null;
    // each agent gets its own address prefix (/t/<token>), so the usage of one agent can be told from another's; the model server never sees it
    let agent = '';
    const pre = /^\/t\/([0-9a-f]{8,32})(\/.*)?$/.exec(req.url);
    if (pre) { agent = pre[1]; req.url = pre[2] || '/'; }
    if (req.method === 'POST' && /^\/v1\/messages(\?|$)/.test(req.url)) { try { parsed = JSON.parse(buf.toString('utf8')); } catch { parsed = null; } }
    const rec = trace.begin();
    rec.agent = agent;
    if (onCapture && parsed) { try { onCapture('model-request', parsed, { format, path: req.url }); } catch { /* capture */ } }
    if (openai && req.method === 'POST' && /^\/v1\/messages\/count_tokens(\?|$)/.test(req.url)) { // OpenAI servers have no such call: a rough count keeps Claude Code going
      let n = 0; try { n = adapter.estimateTokens(JSON.parse(buf.toString('utf8'))); } catch { /* empty */ }
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ input_tokens: n }));
      return;
    }
    let body = buf;
    const ctx = { tools: new Map(), cwd: '', repair, onLive: (l) => { Object.assign(liveNow, l, { at: Date.now() }); } };
    if (parsed && typeof parsed === 'object') {
      const before = sizeOf(parsed.system) + sizeOf(parsed.tools);
      ctx.cwd = workingDir(parsed.system);
      ctx.resolve = (p, toolName) => folderroles.resolvePath(ctx.cwd, markedFolders(ctx.cwd, root), p, toolName);
      if (lean) leanify(parsed, hint);
      ctx.tools = indexTools(parsed.tools);
      rec.model = parsed.model || ''; rec.stream = !!parsed.stream;
      rec.request = { tools: Array.isArray(parsed.tools) ? parsed.tools.length : 0, messages: Array.isArray(parsed.messages) ? parsed.messages.length : 0, promptBefore: before, promptAfter: sizeOf(parsed.system) + sizeOf(parsed.tools), lean };
      body = Buffer.from(JSON.stringify(openai ? adapter.toOpenAI(parsed) : parsed));
    }
    let gone = false;
    const translate = openai && !!parsed;
    const headers = { ...req.headers, host: target.host, 'accept-encoding': 'identity', 'content-length': String(body.length) };
    delete headers.connection;
    let upPath = req.url;
    if (translate) {
      upPath = adapter.chatPath(target.pathname);
      const key = req.headers['x-api-key'] || String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      for (const h of Object.keys(headers)) if (/^(x-api-key|anthropic-|x-stainless-)/i.test(h)) delete headers[h];
      delete headers.authorization;
      if (key) headers.authorization = `Bearer ${key}`;
      headers['content-type'] = 'application/json';
    }
    const up = lib.request({ protocol: target.protocol, hostname: target.hostname, port: target.port || (target.protocol === 'https:' ? 443 : 80), method: req.method, path: upPath, headers }, (ures0) => {
      let ures = ures0;
      if (onCapture && parsed) { // the model server's own reply, before any translation or repair
        let raw = ''; const ct0 = String(ures0.headers['content-type'] || '');
        ures0.on('data', (c) => { if (raw.length < 200000) raw += c.toString('utf8'); });
        ures0.on('end', () => { try { onCapture('model-response', { status: ures0.statusCode, contentType: ct0.split(';')[0], raw }, { format, stream: !!parsed.stream }); } catch { /* capture */ } });
      }
      if (translate) {
        if (ures0.statusCode === 200) {
          const tr = parsed.stream ? adapter.streamTransform(parsed.model) : adapter.jsonTransform();
          tr.statusCode = 200; tr.headers = { 'content-type': parsed.stream ? 'text/event-stream' : 'application/json' };
          ures0.on('error', (e) => tr.destroy(e));
          ures0.pipe(tr);
          ures = tr;
        } else { // an error from the server, in Anthropic's shape
          const parts = []; ures0.on('data', (c) => parts.push(c));
          ures0.on('end', () => {
            const out = JSON.stringify(adapter.errorFrom(ures0.statusCode, Buffer.concat(parts).toString('utf8')));
            rec.status = ures0.statusCode; rec.error = short(out, 300); rec.ms = Date.now() - rec.at; rec.done = true; flush(rec);
            res.writeHead(ures0.statusCode, { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(out)) }); res.end(out);
          });
          return;
        }
      }
      rec.status = ures.statusCode;
      const ct = String(ures.headers['content-type'] || '');
      const fin = () => { rec.ms = Date.now() - rec.at; rec.done = true; flush(rec); };
      const ok = ures.statusCode === 200 && parsed;
      if (ok && /text\/event-stream/.test(ct)) {
        const h = { ...ures.headers }; delete h['content-length']; delete h['content-encoding']; delete h['transfer-encoding'];
        res.writeHead(200, h);
        const sr = new StreamRepair(ctx);
        ures.setEncoding('utf8');
        ures.on('data', (c) => { for (const o of sr.push(c)) res.write(o); });
        ures.on('end', () => { for (const o of sr.end()) res.write(o); rec.summary = sr.summary; fin(); res.end(); });
        ures.on('error', (e) => { rec.error = gone ? 'Claude Code closed the connection' : e.message; fin(); try { res.end(); } catch { /* gone */ } });
      } else if (ok && /json/.test(ct) && !parsed.stream) {
        const parts = []; ures.on('data', (c) => parts.push(c));
        ures.on('end', () => {
          const raw = Buffer.concat(parts).toString('utf8');
          let out = raw;
          try { const r = repairMessage(JSON.parse(raw), ctx); rec.summary = r.summary; out = JSON.stringify(r.msg); } catch { /* not JSON: pass on */ }
          fin();
          const h = { ...ures.headers, 'content-length': String(Buffer.byteLength(out)) }; delete h['content-encoding']; delete h['transfer-encoding'];
          res.writeHead(ures.statusCode, h); res.end(out);
        });
      } else {
        const parts = []; ures.on('data', (c) => { parts.push(c); res.write(c); });
        res.writeHead(ures.statusCode, ures.headers);
        ures.on('end', () => {
          if (parsed) rec.error = ures.statusCode >= 400 ? short(Buffer.concat(parts).toString('utf8'), 300) : '';
          fin(); res.end();
        });
      }
    });
    up.on('error', (e) => {
      rec.error = gone ? 'Claude Code closed the connection' : e.message; rec.ms = Date.now() - rec.at; rec.done = true; flush(rec);
      if (res.destroyed) return;
      const err = { type: 'error', error: { type: 'api_error', message: `Bazinga could not reach the model server at ${upstream}: ${e.message}` } };
      if (!res.headersSent) { res.writeHead(502, { 'content-type': 'application/json' }); res.end(JSON.stringify(err)); }
      else { try { res.write(sse(err)); res.end(); } catch { /* gone */ } }
    });
    res.on('close', () => { if (!res.writableEnded) { gone = true; up.destroy(); if (!rec.done) { rec.done = true; rec.ms = Date.now() - rec.at; rec.error = rec.error || 'Claude Code closed the connection'; flush(rec); } } });
    up.end(body);
  }

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        url: `http://127.0.0.1:${port}`, upstream, lean, repair, format, trace,
        live: () => ({ ...liveNow }), active: () => active,
        lines: (mark) => trace.since(mark).filter((r) => r.request).flatMap((r) => describe(r)),
        fixes: (mark) => trace.since(mark).flatMap((r) => (r.summary ? r.summary.fixes : [])),
        close: () => new Promise((r) => { try { server.closeAllConnections && server.closeAllConnections(); server.close(() => r()); } catch { r(); } }),
      });
    });
  });
}

/** One proxy per (server, settings, standing instructions); shared by every terminal that needs the same. */
function manager({ max = 12 } = {}) {
  const byKey = new Map(); const byUrl = new Map();
  return {
    async ensure({ upstream, lean = true, repair = true, hint = '', root = '', onLog = null, onUsage = null, onCapture = null, format = 'anthropic' }) {
      const key = crypto.createHash('sha1').update(JSON.stringify([upstream, !!lean, !!repair, hint, root, format])).digest('hex');
      if (!byKey.has(key)) byKey.set(key, createProxy({ upstream, lean, repair, hint, root, onLog, onUsage, onCapture, format }).then((p) => { byUrl.set(p.url, p); return p; }));
      const p = await byKey.get(key);
      if (byKey.size > max) { // too many: close the oldest idle one
        for (const [k, v] of byKey) { const h = await v; if (h !== p && h.active() === 0) { byKey.delete(k); byUrl.delete(h.url); await h.close(); break; } }
      }
      return p;
    },
    byUrl: (url) => byUrl.get(url) || null,
    async closeAll() { const all = [...byUrl.values()]; byKey.clear(); byUrl.clear(); await Promise.all(all.map((p) => p.close())); },
  };
}

module.exports = { mergeUsage, createProxy, manager, StreamRepair, repairMessage, extractCalls, fixInput, classify, leanify, describe, createTrace, resolveTool, indexTools, workingDir, lenientParse, absolutize, LEAN_BASE };
