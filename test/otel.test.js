'use strict';
const test = require('node:test');
const assert = require('node:assert');
const O = require('../src/core/otel');
const F = require('../src/core/fleet');
const agentprep = require('../src/core/agentprep');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const kv = (o) => Object.entries(o).map(([key, v]) => ({ key, value: typeof v === 'number' ? (Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v }) : typeof v === 'boolean' ? { boolValue: v } : { stringValue: String(v) } }));
const metric = (name, points, cumulative = false) => ({ resourceMetrics: [{ scopeMetrics: [{ metrics: [{ name, sum: { aggregationTemporality: cumulative ? 2 : 1, dataPoints: points.map(([value, a]) => ({ asInt: String(value), attributes: kv(a) })) } }] }] }] });
const logs = (...recs) => ({ resourceLogs: [{ scopeLogs: [{ logRecords: recs.map((a) => ({ body: { stringValue: a['event.name'] }, attributes: kv(a) })) }] }] });

test('environment: JSON over http to this agent\'s own address; the user\'s own telemetry settings are left alone', () => {
  const e = O.envFor('http://127.0.0.1:5000', 'a'.repeat(24));
  assert.strictEqual(e.OTEL_EXPORTER_OTLP_PROTOCOL, 'http/json'); assert.strictEqual(e.OTEL_EXPORTER_OTLP_ENDPOINT, `http://127.0.0.1:5000/t/${'a'.repeat(24)}`); assert.strictEqual(e.CLAUDE_CODE_ENABLE_TELEMETRY, '1');
  assert.strictEqual(O.alreadyConfigured({}, {}), false);
  assert.strictEqual(O.alreadyConfigured({ OTEL_EXPORTER_OTLP_ENDPOINT: 'https://corp' }, {}), true);
  assert.strictEqual(O.alreadyConfigured({}, { CLAUDE_CODE_ENABLE_TELEMETRY: '1' }), true);
});

test('request events add up exactly; the last request gives the context; errors and tools are counted', () => {
  const t = new O.Totals();
  t.applyLogs(O.decodeLogs(logs(
    { 'event.name': 'claude_code.api_request', model: 'claude-sonnet-x', input_tokens: 10, output_tokens: 200, cache_read_tokens: 5000, cache_creation_tokens: 300, cost_usd: 0.021, duration_ms: 2400 },
    { 'event.name': 'claude_code.api_request', model: 'claude-sonnet-x', input_tokens: 4, output_tokens: 50, cache_read_tokens: 5300, cache_creation_tokens: 0, cost_usd: 0.004 },
    { 'event.name': 'claude_code.tool_result', tool_name: 'Bash', success: true, duration_ms: 120 },
    { 'event.name': 'claude_code.tool_result', tool_name: 'Edit', success: false },
    { 'event.name': 'claude_code.api_error', model: 'claude-sonnet-x', status_code: 429, error: 'rate limited' },
    { 'event.name': 'claude_code.user_prompt', prompt_length: 40, prompt: 'SECRET PROMPT' },
  )));
  const s = t.snapshot();
  assert.deepStrictEqual([s.input, s.output, s.cacheRead, s.cacheCreation, s.requests, s.errors, s.tools, s.toolFailures, s.lastContext, s.model, s.source], [14, 250, 10300, 300, 2, 1, 2, 1, 5304, 'claude-sonnet-x', 'events']);
  assert.ok(Math.abs(s.costUsd - 0.025) < 1e-9);
  const a = t.take();
  assert.ok(a.some((x) => x.kind === 'tool' && /Edit failed/.test(x.text)) && a.some((x) => x.kind === 'error' && /429/.test(x.text)));
  assert.ok(!JSON.stringify(a).includes('SECRET PROMPT'), 'prompt text is never kept');
  assert.deepStrictEqual(t.take(), [], 'taken once');
});

test('metrics are the fallback until a request event arrives; cumulative counters are turned into steps', () => {
  const t = new O.Totals();
  const m = (v) => O.decodeMetrics(metric('claude_code.token.usage', [[v, { type: 'input', model: 'm' }]], true));
  t.applyMetrics(m(100)); t.applyMetrics(m(250)); t.applyMetrics(m(40)); // 100, +150, then the counter started over: +40
  t.applyMetrics(O.decodeMetrics(metric('claude_code.cost.usage', [[0, { model: 'm' }]])));
  assert.strictEqual(t.snapshot().input, 290); assert.strictEqual(t.snapshot().source, 'metrics');
  const d = new O.Totals(); // delta temporality: every export is a step
  d.applyMetrics(O.decodeMetrics(metric('claude_code.token.usage', [[10, { type: 'output' }], [3, { type: 'cacheRead' }]])));
  d.applyMetrics(O.decodeMetrics(metric('claude_code.token.usage', [[5, { type: 'output' }]])));
  assert.deepStrictEqual([d.snapshot().output, d.snapshot().cacheRead], [15, 3]);
  t.applyLogs(O.decodeLogs(logs({ 'event.name': 'claude_code.api_request', input_tokens: 1, output_tokens: 1 })));
  assert.strictEqual(t.snapshot().source, 'events');
});

test('the receiver: per-agent address, JSON only, unknown tokens dropped, nothing but POST', async () => {
  const seen = [];
  const r = new O.OtelReceiver({ onUpdate: (id, snap, act) => seen.push([id, snap.output, act.length]) });
  const base = await r.start(); const token = O.OtelReceiver.newToken(); r.bind(token, 9);
  const post = (url, body, type = 'application/json') => fetch(`${base}${url}`, { method: 'POST', headers: { 'content-type': type }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  assert.strictEqual((await post(`/t/${token}/v1/logs`, logs({ 'event.name': 'claude_code.api_request', input_tokens: 3, output_tokens: 7 }))).status, 200);
  assert.deepStrictEqual(seen, [[9, 7, 1]]);
  assert.strictEqual((await post(`/t/${token}/v1/metrics`, metric('claude_code.token.usage', [[5, { type: 'output' }]]))).status, 200);
  assert.strictEqual(seen.length, 2); assert.strictEqual(seen[1][1], 7, 'events win once they exist');
  assert.strictEqual((await post(`/t/${token}/v1/logs`, 'binary', 'application/x-protobuf')).status, 415);
  assert.strictEqual((await post(`/t/${token}/v1/logs`, '{nope')).status, 400);
  assert.strictEqual((await post(`/t/${O.OtelReceiver.newToken()}/v1/logs`, logs({ 'event.name': 'claude_code.api_request' }))).status, 200);
  assert.strictEqual((await post(`/t/${token}/v1/traces`, {})).status, 200);
  assert.strictEqual((await post('/v1/logs', {})).status, 404);
  assert.strictEqual((await fetch(`${base}/t/${token}/v1/logs`)).status, 404);
  assert.strictEqual(seen.length, 2);
  r.unbind(9);
  await post(`/t/${token}/v1/logs`, logs({ 'event.name': 'claude_code.api_request', output_tokens: 1 }));
  assert.strictEqual(seen.length, 2);
  r.close();
});

test('prepare points a cloud Claude command at the receiver, but not a local model, not another agent, not an already configured one', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ot-'));
  const receiver = new O.OtelReceiver({});
  const opts = { root: dir, hintDir: path.join(dir, 'h'), config: {}, otel: { server: receiver } };
  const cloud = await agentprep.prepare({ name: 'C', command: 'claude' }, opts);
  assert.match(cloud.envForce.OTEL_EXPORTER_OTLP_ENDPOINT, /^http:\/\/127\.0\.0\.1:\d+\/t\/[0-9a-f]{24}$/); assert.ok(cloud.otel.token); assert.ok(/127\.0\.0\.1/.test(cloud.envForce.NO_PROXY));
  assert.strictEqual((await agentprep.prepare({ name: 'A', command: 'aider' }, opts)).otel, undefined);
  assert.strictEqual((await agentprep.prepare({ name: 'C', command: 'claude', env: { OTEL_EXPORTER_OTLP_ENDPOINT: 'https://corp' } }, opts)).otel, undefined);
  assert.strictEqual((await agentprep.prepare({ name: 'C', command: 'claude' }, { ...opts, otel: null })).otel, undefined);
  receiver.close(); fs.rmSync(dir, { recursive: true, force: true });
});

test('fleet: Claude Code\'s own numbers and cost beat the transcript; without a reported cost the price table is used', () => {
  const now = 7_000_000;
  const base = { startedAt: now - 60000, lastData: now - 1000 };
  const otel = { requests: 3, input: 20, output: 400, cacheRead: 9000, cacheCreation: 100, lastContext: 4000, model: 'claude-sonnet-x', costUsd: 0.5, errors: 1, lastError: 'rate limited' };
  const v = F.view([{ ...base, key: 'a', fleet: { otel, cloud: { input: 1, output: 1, cacheRead: 0, cacheCreate: 0, messages: 1, model: 'x' } } }, { ...base, key: 'b', fleet: { otel: { ...otel, costUsd: 0 } } }], { prices: { sonnet: [3, 15] } }, now);
  const a = v.rows.find((r) => r.key === 'a'); const b = v.rows.find((r) => r.key === 'b');
  assert.strictEqual(a.cost, 0.5); assert.strictEqual(a.costReported, true); assert.strictEqual(a.input, 9120); assert.strictEqual(a.output, 400); assert.strictEqual(a.errors, 1);
  assert.strictEqual(b.costReported, false); assert.ok(b.cost > 0, 'estimated from the price table');
});
