'use strict';
/**
 * Usage numbers straight from Claude Code. Claude Code can export OpenTelemetry (metrics and events) to an address; Bazinga starts a
 * small receiver on 127.0.0.1 (OTLP over http/json, nothing leaves this machine) and gives every agent its own address prefix
 * /t/<token>, the same way the hooks do. What arrives is Claude Code's own account of tokens, cost and tool use, which is better
 * than reading the transcript file.
 *
 * Names used (from Claude Code's monitoring documentation): metrics claude_code.token.usage (type input|output|cacheRead|cacheCreation,
 * model) and claude_code.cost.usage; events claude_code.api_request (model, cost_usd, duration_ms, input_tokens, output_tokens ...),
 * claude_code.api_error, claude_code.tool_result (tool_name, success, duration_ms). Attribute names beyond those are read when present.
 */
const http = require('node:http');
const crypto = require('node:crypto');

const ENV_KEYS = ['CLAUDE_CODE_ENABLE_TELEMETRY', 'OTEL_METRICS_EXPORTER', 'OTEL_LOGS_EXPORTER', 'OTEL_EXPORTER_OTLP_PROTOCOL', 'OTEL_EXPORTER_OTLP_ENDPOINT', 'OTEL_METRIC_EXPORT_INTERVAL', 'OTEL_LOGS_EXPORT_INTERVAL'];

/** The environment that points one agent's Claude Code at this receiver. */
function envFor(base, token) {
  return {
    CLAUDE_CODE_ENABLE_TELEMETRY: '1', OTEL_METRICS_EXPORTER: 'otlp', OTEL_LOGS_EXPORTER: 'otlp',
    OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json', OTEL_EXPORTER_OTLP_ENDPOINT: `${base}/t/${token}`,
    OTEL_METRIC_EXPORT_INTERVAL: '10000', OTEL_LOGS_EXPORT_INTERVAL: '2000',
  };
}

/** Leave alone what the user (or their company) already configured. */
const alreadyConfigured = (agentEnv = {}, processEnv = process.env) => ENV_KEYS.some((k) => (agentEnv && agentEnv[k]) || processEnv[k]);

// ---- decoding OTLP/JSON
const attrValue = (v) => {
  if (!v || typeof v !== 'object') return undefined;
  if ('stringValue' in v) return v.stringValue;
  if ('intValue' in v) return Number(v.intValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('boolValue' in v) return !!v.boolValue;
  return undefined;
};
const attrs = (list) => { const o = {}; for (const a of list || []) { const v = attrValue(a.value); if (a && a.key && v !== undefined) o[a.key] = v; } return o; };
const num = (p) => (p == null ? 0 : Number(p.asDouble !== undefined ? p.asDouble : p.asInt !== undefined ? p.asInt : 0)) || 0;

/** metrics JSON -> [{ name, value, attrs, cumulative }] */
function decodeMetrics(body) {
  const out = [];
  for (const rm of (body && body.resourceMetrics) || []) {
    for (const sm of rm.scopeMetrics || []) {
      for (const m of sm.metrics || []) {
        const data = m.sum || m.gauge;
        if (!data) continue;
        for (const p of data.dataPoints || []) out.push({ name: m.name, value: num(p), attrs: attrs(p.attributes), cumulative: !!m.sum && m.sum.aggregationTemporality === 2 });
      }
    }
  }
  return out;
}

/** logs JSON -> [{ event, attrs }] (the event name is the `event.name` attribute, or the body) */
function decodeLogs(body) {
  const out = [];
  for (const rl of (body && body.resourceLogs) || []) {
    for (const sl of rl.scopeLogs || []) {
      for (const r of sl.logRecords || []) {
        const a = attrs(r.attributes);
        const event = String(a['event.name'] || attrValue(r.body) || '');
        if (event) out.push({ event: event.replace(/^claude_code\./, ''), attrs: a });
      }
    }
  }
  return out;
}

// ---- per-agent totals
class Totals {
  constructor() {
    this.metrics = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, cost: 0 };
    this.events = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, cost: 0, requests: 0, errors: 0, tools: 0, toolFailures: 0, lastContext: 0, lastError: '' };
    this.model = '';
    this.seen = new Map(); // series key -> last cumulative value
    this.activity = [];    // new timeline entries since the last take()
  }

  _delta(key, value, cumulative) {
    if (!cumulative) return value;
    const prev = this.seen.get(key) || 0;
    this.seen.set(key, value);
    return value >= prev ? value - prev : value; // a smaller number means the counter started over
  }

  applyMetrics(list) {
    for (const m of list) {
      if (m.attrs.model) this.model = String(m.attrs.model);
      const key = `${m.name}|${JSON.stringify(m.attrs)}`;
      if (m.name === 'claude_code.token.usage') {
        const t = String(m.attrs.type || '');
        const k = t === 'input' ? 'input' : t === 'output' ? 'output' : t === 'cacheRead' ? 'cacheRead' : t === 'cacheCreation' ? 'cacheCreation' : null;
        if (k) this.metrics[k] += this._delta(key, m.value, m.cumulative);
      } else if (m.name === 'claude_code.cost.usage') this.metrics.cost += this._delta(key, m.value, m.cumulative);
    }
  }

  applyLogs(list) {
    const e = this.events;
    for (const l of list) {
      const a = l.attrs;
      const model = a.model ? String(a.model) : '';
      if (model) this.model = model;
      if (l.event === 'api_request') {
        e.requests++;
        const inp = Number(a.input_tokens) || 0; const out = Number(a.output_tokens) || 0;
        const cr = Number(a.cache_read_tokens) || 0; const cc = Number(a.cache_creation_tokens) || 0;
        e.input += inp; e.output += out; e.cacheRead += cr; e.cacheCreation += cc; e.cost += Number(a.cost_usd) || 0;
        e.lastContext = inp + cr + cc || e.lastContext;
        this.activity.push({ kind: 'model', text: `model request${model ? ` (${model})` : ''}: ${inp + cr + cc} in / ${out} out${a.duration_ms ? `, ${Math.round(Number(a.duration_ms) / 100) / 10}s` : ''}` });
      } else if (l.event === 'api_error') {
        e.errors++; e.lastError = String(a.error || a.status_code || 'error').slice(0, 200);
        this.activity.push({ kind: 'error', text: `model error${a.status_code ? ` ${a.status_code}` : ''}: ${e.lastError}` });
      } else if (l.event === 'tool_result') {
        e.tools++; if (a.success === false || a.success === 'false') e.toolFailures++;
        this.activity.push({ kind: 'tool', text: `${a.tool_name || 'tool'} ${a.success === false || a.success === 'false' ? 'failed' : 'ok'}${a.duration_ms ? ` (${Math.round(Number(a.duration_ms))} ms)` : ''}` });
      }
      // user_prompt text is never kept: it is redacted by default and not needed here
    }
    if (this.activity.length > 100) this.activity.splice(0, this.activity.length - 100);
  }

  /** Events are exact per request; the metrics are the fallback while no request event has arrived. */
  snapshot() {
    const useEvents = this.events.requests > 0;
    const t = useEvents ? this.events : this.metrics;
    return { input: t.input, output: t.output, cacheRead: t.cacheRead, cacheCreation: t.cacheCreation, costUsd: t.cost, requests: this.events.requests, errors: this.events.errors, lastError: this.events.lastError, tools: this.events.tools, toolFailures: this.events.toolFailures, lastContext: this.events.lastContext, model: this.model, source: useEvents ? 'events' : 'metrics' };
  }

  take() { const a = this.activity; this.activity = []; return a; }
}

class OtelReceiver {
  /** onUpdate(terminalId, snapshot, newActivity) */
  constructor({ onUpdate, onRaw, log = () => {} } = {}) {
    this.onUpdate = onUpdate || (() => {});
    this.onRaw = onRaw || (() => {}); // what really arrived: path, content type, size and (JSON only) the body (capture)
    this.log = log;
    this.server = null; this.port = 0;
    this.tokens = new Map(); // token -> { id, totals }
  }

  get base() { return `http://127.0.0.1:${this.port}`; }
  static newToken() { return crypto.randomBytes(12).toString('hex'); }

  async start() {
    if (this.server) return this.base;
    this.server = http.createServer((req, res) => this._handle(req, res));
    await new Promise((resolve, reject) => { this.server.once('error', reject); this.server.listen(0, '127.0.0.1', resolve); });
    this.port = this.server.address().port;
    if (this.server.unref) this.server.unref();
    return this.base;
  }

  bind(token, id) { if (/^[0-9a-f]{24}$/.test(String(token))) this.tokens.set(String(token), { id, totals: new Totals() }); }
  unbind(id) { for (const [t, v] of this.tokens) if (v.id === id) this.tokens.delete(t); }

  _handle(req, res) {
    const m = /^\/t\/([0-9a-f]{24})\/v1\/(metrics|logs|traces)$/.exec(String(req.url || '').split('?')[0]);
    const done = (code, body = '{}') => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(body); };
    if (req.method !== 'POST' || !m) { req.resume(); return done(404); }
    if (!/json/i.test(String(req.headers['content-type'] || ''))) { try { this.onRaw({ signal: m[2], contentType: String(req.headers['content-type'] || ''), encoding: String(req.headers['content-encoding'] || ''), length: Number(req.headers['content-length']) || 0, rejected: true }); } catch { /* capture */ } req.resume(); this.log(`telemetry in a format other than JSON (${req.headers['content-type'] || 'no type'}): ignored`); return done(415); }
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 8e6) req.destroy(); });
    req.on('end', () => {
      const entry = this.tokens.get(m[1]);
      if (!entry) return done(200); // not bound (yet) or gone: accepted, dropped
      let body;
      try { body = JSON.parse(data || '{}'); } catch { return done(400); }
      try { this.onRaw({ signal: m[2], contentType: String(req.headers['content-type'] || ''), encoding: String(req.headers['content-encoding'] || ''), length: data.length, body }); } catch { /* capture */ }
      try {
        if (m[2] === 'metrics') entry.totals.applyMetrics(decodeMetrics(body));
        else if (m[2] === 'logs') entry.totals.applyLogs(decodeLogs(body));
        if (m[2] !== 'traces') this.onUpdate(entry.id, entry.totals.snapshot(), entry.totals.take());
      } catch (err) { this.log(`telemetry ${m[2]}: ${err.message}`); }
      done(200);
    });
  }

  close() { if (this.server) { try { this.server.close(); } catch { /* closed */ } this.server = null; } }
}

module.exports = { OtelReceiver, Totals, envFor, alreadyConfigured, decodeMetrics, decodeLogs, ENV_KEYS };
