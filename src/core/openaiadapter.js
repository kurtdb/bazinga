'use strict';
// Claude Code speaks Anthropic's Messages API. LM Studio, llama.cpp, vLLM and most gateways speak OpenAI's Chat Completions API.
// This module translates in both directions, including streaming and tool calls. The tool-call helper (toolproxy.js) puts it between
// Claude Code and the server; what comes out is a normal Anthropic reply, so the usual repairs still apply on top of it.
const { Transform } = require('node:stream');
const crypto = require('node:crypto');

const text = (v) => (typeof v === 'string' ? v : Array.isArray(v) ? v.map((b) => (b && typeof b.text === 'string' ? b.text : '')).filter(Boolean).join('\n') : '');
const newId = (p) => `${p}_${crypto.randomBytes(9).toString('hex')}`;

/** Where the chat endpoint lives for a server address. "http://host:1234", "http://host:1234/v1" and "http://host/api/v1/" all work. */
function chatPath(upstreamPathname) {
  const base = String(upstreamPathname || '').replace(/\/+$/, '').replace(/\/v1$/, '');
  return `${base}/v1/chat/completions`;
}

function imageUrl(src) {
  if (!src || typeof src !== 'object') return null;
  if (src.type === 'base64' && src.data) return `data:${src.media_type || 'image/png'};base64,${src.data}`;
  if (src.type === 'url' && src.url) return src.url;
  return null;
}

function toolResultText(c) {
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return c == null ? '' : JSON.stringify(c);
  return c.map((b) => (b && b.type === 'text' ? b.text : b && b.type === 'image' ? '[image]' : '')).filter(Boolean).join('\n');
}

/** An Anthropic Messages request -> an OpenAI Chat Completions request. */
function toOpenAI(req, { maxTokensField = 'max_tokens' } = {}) {
  const messages = [];
  const sys = text(req.system);
  if (sys) messages.push({ role: 'system', content: sys });
  for (const m of Array.isArray(req.messages) ? req.messages : []) {
    if (!m) continue;
    const blocks = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : Array.isArray(m.content) ? m.content : [];
    if (m.role === 'assistant') {
      const out = { role: 'assistant', content: blocks.filter((b) => b && b.type === 'text').map((b) => b.text).join('') || null };
      const calls = blocks.filter((b) => b && b.type === 'tool_use').map((b) => ({ id: b.id || newId('call'), type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input === undefined ? {} : b.input) } }));
      if (calls.length) out.tool_calls = calls;
      if (out.content === null && !calls.length) continue;
      messages.push(out);
    } else {
      // tool results must directly follow the assistant message that asked for them, so they come first
      for (const b of blocks) if (b && b.type === 'tool_result') messages.push({ role: 'tool', tool_call_id: b.tool_use_id, content: (b.is_error ? 'Error: ' : '') + toolResultText(b.content) });
      const parts = [];
      for (const b of blocks) {
        if (!b) continue;
        if (b.type === 'text' && b.text) parts.push({ type: 'text', text: b.text });
        else if (b.type === 'image') { const u = imageUrl(b.source); if (u) parts.push({ type: 'image_url', image_url: { url: u } }); }
      }
      if (parts.length) messages.push({ role: 'user', content: parts.every((p) => p.type === 'text') ? parts.map((p) => p.text).join('\n') : parts });
    }
  }
  const out = { model: req.model, messages };
  const tools = (Array.isArray(req.tools) ? req.tools : []).filter((t) => t && t.name && (t.input_schema || !t.type || t.type === 'custom'));
  if (tools.length) {
    out.tools = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description || '', parameters: t.input_schema || { type: 'object', properties: {} } } }));
    const tc = req.tool_choice;
    if (tc && typeof tc === 'object') {
      if (tc.type === 'auto') out.tool_choice = 'auto';
      else if (tc.type === 'any') out.tool_choice = 'required';
      else if (tc.type === 'none') out.tool_choice = 'none';
      else if (tc.type === 'tool' && tc.name) out.tool_choice = { type: 'function', function: { name: tc.name } };
      if (tc.disable_parallel_tool_use) out.parallel_tool_calls = false;
    }
  }
  if (req.max_tokens) out[maxTokensField] = req.max_tokens;
  if (typeof req.temperature === 'number') out.temperature = req.temperature;
  if (typeof req.top_p === 'number') out.top_p = req.top_p;
  if (Array.isArray(req.stop_sequences) && req.stop_sequences.length) out.stop = req.stop_sequences.slice(0, 4);
  if (req.stream) { out.stream = true; out.stream_options = { include_usage: true }; }
  return out;
}

const STOP = { stop: 'end_turn', length: 'max_tokens', tool_calls: 'tool_use', function_call: 'tool_use', content_filter: 'end_turn' };
const stopReason = (finish, hadTools) => (hadTools && (!finish || finish === 'stop') ? 'tool_use' : STOP[finish] || 'end_turn');

function parseArgs(s) {
  if (s && typeof s === 'object') return s;
  try { const v = JSON.parse(s || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}

/** An OpenAI chat completion -> an Anthropic message. */
function fromOpenAI(resp) {
  const choice = (resp && resp.choices && resp.choices[0]) || {};
  const msg = choice.message || {};
  const content = [];
  const reasoning = msg.reasoning_content || msg.reasoning;
  if (typeof reasoning === 'string' && reasoning) content.push({ type: 'thinking', thinking: reasoning, signature: '' });
  if (typeof msg.content === 'string' && msg.content) content.push({ type: 'text', text: msg.content });
  const calls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
  for (const c of calls) content.push({ type: 'tool_use', id: c.id || newId('toolu'), name: (c.function && c.function.name) || '', input: parseArgs(c.function && c.function.arguments) });
  if (!content.length) content.push({ type: 'text', text: '' });
  const u = (resp && resp.usage) || {};
  return { id: (resp && resp.id) || newId('msg'), type: 'message', role: 'assistant', model: (resp && resp.model) || '', content, stop_reason: stopReason(choice.finish_reason, calls.length > 0), stop_sequence: null, usage: { input_tokens: u.prompt_tokens || 0, output_tokens: u.completion_tokens || 0 } };
}

/** An OpenAI error body -> Anthropic's error shape. */
function errorFrom(status, raw) {
  let message = String(raw || '').slice(0, 500);
  try { const j = JSON.parse(raw); const e = j && (j.error || j); message = (e && (e.message || (typeof e === 'string' ? e : ''))) || message; } catch { /* plain text */ }
  const type = status === 401 || status === 403 ? 'authentication_error' : status === 404 ? 'not_found_error' : status === 429 ? 'rate_limit_error' : status >= 500 ? 'api_error' : 'invalid_request_error';
  return { type: 'error', error: { type, message: message || `HTTP ${status}` } };
}

const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;

/** OpenAI streaming chunks in, Anthropic events out. Text in, text out: feed it with push(chunk) and end(). */
class StreamTranslator {
  constructor(model = '') {
    this.buf = ''; this.model = model; this.started = false; this.finished = false;
    this.index = -1; this.open = null; // the block being written: { kind: 'thinking'|'text'|'tool', n }
    this.tools = new Map(); // OpenAI tool-call index -> Anthropic block index
    this.finish = ''; this.usage = null; this.hadTools = false; this.id = newId('msg');
  }

  _start(out) {
    if (this.started) return;
    this.started = true;
    out.push(ev('message_start', { message: { id: this.id, type: 'message', role: 'assistant', model: this.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } }));
  }

  _close(out) {
    if (!this.open) return;
    out.push(ev('content_block_stop', { index: this.index }));
    this.open = null;
  }

  _begin(out, kind, block, key) {
    this._close(out);
    this.index++;
    this.open = { kind, key };
    out.push(ev('content_block_start', { index: this.index, content_block: block }));
  }

  push(chunk) {
    this.buf += chunk;
    const out = [];
    for (;;) {
      const m = /\r?\n\r?\n/.exec(this.buf);
      if (!m) break;
      const frame = this.buf.slice(0, m.index); this.buf = this.buf.slice(m.index + m[0].length);
      for (const line of frame.split(/\r?\n/)) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data) continue;
        if (data === '[DONE]') { this.finished = true; continue; }
        let j; try { j = JSON.parse(data); } catch { continue; }
        this._chunk(j, out);
      }
    }
    return out;
  }

  _chunk(j, out) {
    if (j.error) { this._start(out); this._close(out); out.push(ev('error', { error: { type: 'api_error', message: String(j.error.message || j.error) } })); this.failed = true; return; }
    if (j.model && !this.model) this.model = j.model;
    if (j.usage) this.usage = j.usage;
    this._start(out);
    const c = j.choices && j.choices[0];
    if (!c) return;
    const d = c.delta || {};
    const reasoning = d.reasoning_content || d.reasoning;
    if (typeof reasoning === 'string' && reasoning) {
      if (!this.open || this.open.kind !== 'thinking') this._begin(out, 'thinking', { type: 'thinking', thinking: '', signature: '' });
      out.push(ev('content_block_delta', { index: this.index, delta: { type: 'thinking_delta', thinking: reasoning } }));
    }
    if (typeof d.content === 'string' && d.content) {
      if (!this.open || this.open.kind !== 'text') this._begin(out, 'text', { type: 'text', text: '' });
      out.push(ev('content_block_delta', { index: this.index, delta: { type: 'text_delta', text: d.content } }));
    }
    for (const tc of Array.isArray(d.tool_calls) ? d.tool_calls : []) {
      const key = tc.index === undefined ? (tc.id || 0) : tc.index;
      const fn = tc.function || {};
      if (!this.open || this.open.kind !== 'tool' || this.open.key !== key) {
        if (this.tools.has(key) && !tc.id) { /* late fragment of an earlier call: keep it with the current one, nothing sane to do */ }
        this.hadTools = true;
        this._begin(out, 'tool', { type: 'tool_use', id: tc.id || newId('toolu'), name: fn.name || '', input: {} }, key);
        this.tools.set(key, this.index);
      }
      if (typeof fn.arguments === 'string' && fn.arguments) out.push(ev('content_block_delta', { index: this.index, delta: { type: 'input_json_delta', partial_json: fn.arguments } }));
    }
    if (c.finish_reason) this.finish = c.finish_reason;
  }

  end() {
    const out = [];
    if (this.failed) return out;
    if (this.buf.trim()) { this.buf += '\n\n'; out.push(...this.push('')); }
    this._start(out);
    this._close(out);
    const u = this.usage || {};
    out.push(ev('message_delta', { delta: { stop_reason: stopReason(this.finish, this.hadTools), stop_sequence: null }, usage: { input_tokens: u.prompt_tokens || 0, output_tokens: u.completion_tokens || 0 } }));
    out.push(ev('message_stop', {}));
    return out;
  }
}

/** A stream transformer for a response: server-sent chunks from the model server in, Anthropic server-sent events out. */
function streamTransform(model) {
  const tr = new StreamTranslator(model);
  return new Transform({
    decodeStrings: false,
    transform(chunk, _enc, cb) { for (const o of tr.push(chunk.toString('utf8'))) this.push(o); cb(); },
    flush(cb) { for (const o of tr.end()) this.push(o); cb(); },
  });
}

/** A transformer for a reply that is not streamed: it collects the whole JSON and gives back the Anthropic message. */
function jsonTransform() {
  const parts = [];
  return new Transform({
    transform(chunk, _enc, cb) { parts.push(chunk); cb(); },
    flush(cb) {
      const raw = Buffer.concat(parts).toString('utf8');
      let out;
      try { out = JSON.stringify(fromOpenAI(JSON.parse(raw))); } catch { out = JSON.stringify(errorFrom(502, raw)); }
      this.push(out); cb();
    },
  });
}

/** A rough token count for /v1/messages/count_tokens, which OpenAI servers do not have. */
function estimateTokens(req) {
  let n = 0;
  try { n = JSON.stringify({ s: req.system, m: req.messages, t: req.tools }).length; } catch { /* nothing to count */ }
  return Math.ceil(n / 3.5);
}

/** Is an OpenAI-style server there, and which models does it list? (GET /v1/models) */
function status(baseUrl, { apiKey = '', timeoutMs = 3000 } = {}) {
  const http = require('node:http'); const https = require('node:https');
  return new Promise((resolve) => {
    let u;
    try { u = new URL(baseUrl); } catch (e) { resolve({ running: false, models: [], error: e.message }); return; }
    const p = `${u.pathname.replace(/\/+$/, '').replace(/\/v1$/, '')}/v1/models`;
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request({ protocol: u.protocol, hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: p, method: 'GET', headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {}, timeout: timeoutMs }, (res) => {
      const parts = []; res.on('data', (c) => parts.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(parts).toString('utf8');
        if (res.statusCode === 401 || res.statusCode === 403) { resolve({ running: true, auth: false, models: [], error: `The server refused the API key (HTTP ${res.statusCode}).` }); return; }
        if (res.statusCode >= 400) { resolve({ running: true, models: [], unlisted: true, error: `HTTP ${res.statusCode}` }); return; } // some servers have no list: not fatal
        try { const j = JSON.parse(raw); resolve({ running: true, auth: true, models: (Array.isArray(j.data) ? j.data : []).map((m) => m && m.id).filter(Boolean) }); } catch { resolve({ running: true, auth: true, models: [], unlisted: true }); }
      });
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', (e) => resolve({ running: false, models: [], error: e.message }));
    req.end();
  });
}

module.exports = { status, toOpenAI, fromOpenAI, errorFrom, chatPath, StreamTranslator, streamTransform, jsonTransform, estimateTokens, stopReason };
