'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const F = require('../src/core/fleet');
const { createProxy, manager, mergeUsage } = require('../src/core/toolproxy');

test('context: percentage of the window, levels, unknown when either number is missing', () => {
  assert.strictEqual(F.contextPct(4096, 8192), 0.5);
  assert.strictEqual(F.contextPct(0, 8192), null); assert.strictEqual(F.contextPct(100, 0), null); assert.strictEqual(F.contextPct('x', 10), null);
  assert.deepStrictEqual([0.2, 0.7, 0.89, 0.9, 1.4, null].map(F.contextLevel), ['ok', 'warn', 'warn', 'full', 'full', 'unknown']);
});

test('overflow errors from model servers are recognised, ordinary errors are not', () => {
  for (const m of ['the prompt is too long: 9000 > 8192', 'context length exceeded', 'input exceeds the maximum context window', 'truncating input prompt limit=4096']) assert.ok(F.isOverflowError(m), m);
  for (const m of ['connection refused', 'model not found', '']) assert.ok(!F.isOverflowError(m), m);
});

test('state: exited > waiting (permission) > idle (told us) > stale (nothing for 5 minutes) > running', () => {
  const now = 1e6; const min = 60000;
  assert.strictEqual(F.stateOf({ exited: true, prompt: true }, now), 'exited');
  assert.strictEqual(F.stateOf({ prompt: true, lastActivity: now }, now), 'waiting');
  assert.strictEqual(F.stateOf({ idleAt: now - 1000, lastActivity: now - 5000, startedAt: now - 10 * min }, now), 'idle');
  assert.strictEqual(F.stateOf({ idleAt: now - 20 * min, lastActivity: now - 2000, startedAt: now - 30 * min }, now), 'running', 'new output after the idle message: working again');
  assert.strictEqual(F.stateOf({ lastActivity: now - 6 * min, startedAt: now - 9 * min }, now), 'stale');
  assert.strictEqual(F.stateOf({ lastActivity: now - 4 * min, startedAt: now - 9 * min }, now), 'running');
  assert.strictEqual(F.stateOf({ lastActivity: now - 4 * min }, now, 3 * min), 'stale', 'the limit is configurable');
  assert.strictEqual(F.stateOf({ startedAt: now - 1000 }, now), 'running');
});

test('row, filter, sort, summary', () => {
  const now = 10_000_000;
  const mk = (key, o) => F.row({ key, label: key, startedAt: now - 600000, lastData: now - 1000, context: 8192, ...o }, now);
  const rows = [
    mk('a', { fleet: { lastInput: 8000, totalInput: 20000, totalOutput: 3000, requests: 5, model: 'qwen3:14b' } }),
    mk('b', { prompt: { text: '?' }, fleet: { lastInput: 1000, totalInput: 1000, totalOutput: 100, requests: 1 } }),
    mk('c', { lastData: now - 9 * 60000, fleet: { overflow: true, totalInput: 5, totalOutput: 5, requests: 1 } }),
    mk('d', { exited: true, exitedAt: now - 1000 }),
  ];
  assert.deepStrictEqual(rows.map((r) => [r.key, r.state, r.blowout]), [['a', 'running', true], ['b', 'waiting', false], ['c', 'stale', true], ['d', 'exited', false]]);
  assert.strictEqual(rows[0].level, 'full');
  assert.deepStrictEqual(F.filterRows(rows, 'blowouts').map((r) => r.key), ['a', 'c']);
  assert.deepStrictEqual(F.filterRows(rows, 'waiting').map((r) => r.key), ['b']);
  assert.deepStrictEqual(F.filterRows(rows, 'all', 'QWEN').map((r) => r.key), ['a']);
  assert.deepStrictEqual(F.sortRows(rows, 'status').map((r) => r.key), ['b', 'c', 'a', 'd']);
  assert.deepStrictEqual(F.sortRows(rows, 'tokens').map((r) => r.key)[0], 'a');
  assert.deepStrictEqual(F.sortRows(rows, 'context').map((r) => r.key)[0], 'a');
  const s = F.summarize(rows);
  assert.deepStrictEqual([s.live, s.running, s.waiting, s.stale, s.blowouts, s.input, s.output], [3, 1, 1, 1, 2, 21005, 3105]);
});

test('formatting of tokens and durations', () => {
  assert.deepStrictEqual([0, 999, 1500, 15000, 1650000, 21660000].map(F.fmtTokens), ['0', '999', '1.5k', '15k', '1.65M', '21.7M']);
  assert.deepStrictEqual([5000, 65000, 3_661_000].map(F.fmtDuration), ['5s', '1m 05s', '1h 01m']);
});

test('cost estimate: first matching price pattern, cache prices, unknown model = null (never a made-up number)', () => {
  const prices = { sonnet: [3, 15] };
  assert.strictEqual(F.estimateCost({ input: 1_000_000, output: 100_000 }, 'claude-sonnet-x', prices), 3 + 1.5);
  assert.ok(Math.abs(F.estimateCost({ cacheRead: 1_000_000, cacheCreate: 1_000_000 }, 'Sonnet', prices) - (0.3 + 3.75)) < 1e-9);
  assert.strictEqual(F.estimateCost({ input: 5 }, 'qwen3:14b', prices), null);
  assert.strictEqual(F.estimateCost({ input: 5 }, 'sonnet', {}), null);
  assert.strictEqual(F.estimateCost({ input: 5 }, 'sonnet', { sonnet: ['x', 1] }), null);
});

test('transcript usage: sums replies once each, last reply gives the context, bad lines are skipped', () => {
  const line = (id, u, extra = {}) => JSON.stringify({ type: 'assistant', uuid: `u-${id}`, message: { id, model: 'claude-sonnet-x', usage: u, ...extra } });
  const text = [
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' } }),
    line('m1', { input_tokens: 10, output_tokens: 20, cache_creation_input_tokens: 1000, cache_read_input_tokens: 0 }),
    line('m1', { input_tokens: 10, output_tokens: 20, cache_creation_input_tokens: 1000, cache_read_input_tokens: 0 }), // same reply, second content block
    'not json "usage"',
    line('m2', { input_tokens: 5, output_tokens: 40, cache_read_input_tokens: 1010 }),
    '{"type":"assistant","message":{"usage":{"input_tokens":1',
  ].join('\n');
  const u = F.transcriptUsage(text);
  assert.deepStrictEqual([u.input, u.output, u.cacheRead, u.cacheCreate, u.messages, u.lastContext, u.model], [15, 60, 1010, 1000, 2, 1015, 'claude-sonnet-x']);
  assert.strictEqual(F.transcriptUsage('').messages, 0);
});

test('a hook-reported transcript path is only read inside the Claude folder and only as .jsonl (no arbitrary files)', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fl-'));
  const dir = path.join(home, 'projects', 'p'); fs.mkdirSync(dir, { recursive: true });
  const good = path.join(dir, 's.jsonl'); fs.writeFileSync(good, '{}\n');
  const secret = path.join(os.tmpdir(), 'fl-secret.jsonl'); fs.writeFileSync(secret, 'x');
  const link = path.join(dir, 'link.jsonl'); fs.symlinkSync(secret, link);
  assert.strictEqual(F.safeTranscriptPath(good, [home]), fs.realpathSync(good));
  assert.strictEqual(F.safeTranscriptPath(secret, [home]), null, 'outside the folder');
  assert.strictEqual(F.safeTranscriptPath(link, [home]), null, 'a link out of the folder');
  assert.strictEqual(F.safeTranscriptPath(path.join(dir, 'x.txt'), [home]), null);
  assert.strictEqual(F.safeTranscriptPath('s.jsonl', [home]), null);
  assert.strictEqual(F.safeTranscriptPath(path.join(home, 'projects', '..', '..', 'etc', 'passwd.jsonl'), [home]), null);
  fs.writeFileSync(good, 'a\n'.repeat(10));
  const tail = F.readTail(good, 7).split('\n').filter(Boolean);
  assert.ok(tail.length >= 1 && tail.length <= 3 && tail.every((l) => l === 'a'), 'only whole lines of the tail');
  fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(secret, { force: true });
});

test('usage: later numbers win; the stream gives input first, output at the end', () => {
  assert.deepStrictEqual(mergeUsage(null, { input_tokens: 1200, output_tokens: 1 }), { input: 1200, output: 1 });
  assert.deepStrictEqual(mergeUsage({ input: 1200, output: 1 }, { output_tokens: 75 }), { input: 1200, output: 75 });
  assert.deepStrictEqual(mergeUsage({ input: 1200, output: 75 }, { input_tokens: 0 }), { input: 1200, output: 75 });
  assert.deepStrictEqual(mergeUsage(null, {}), { input: 0, output: 0 });
});

// a model server that answers like Ollama's Anthropic API (a stream, and plain JSON)
function fakeModel() {
  return new Promise((resolve) => {
    const seen = [];
    const server = http.createServer((req, res) => {
      let data = ''; req.on('data', (c) => { data += c; });
      req.on('end', () => {
        seen.push(req.url);
        const body = data ? JSON.parse(data) : {};
        if (body.max_tokens === 1) { res.writeHead(400, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: { message: 'the prompt is too long' } })); }
        if (body.stream) {
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          const ev = (o) => `event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`;
          res.write(ev({ type: 'message_start', message: { id: 'm', role: 'assistant', content: [], usage: { input_tokens: 4321, output_tokens: 1 } } }));
          res.write(ev({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }));
          res.write(ev({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hello' } }));
          res.write(ev({ type: 'content_block_stop', index: 0 }));
          res.write(ev({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 77 } }));
          res.end(ev({ type: 'message_stop' }));
        } else {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'x', content: [{ type: 'text', text: 'hi' }], stop_reason: 'end_turn', usage: { input_tokens: 900, output_tokens: 12 } }));
        }
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, seen, url: `http://127.0.0.1:${server.address().port}` }));
  });
}
const send = (base, path_, body) => fetch(`${base}${path_}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.text());

test('the proxy reports tokens per agent (stream and JSON), strips the /t/<token> prefix, reports overflow errors', async () => {
  const m = await fakeModel();
  const got = [];
  const p = await createProxy({ upstream: m.url, onUsage: (u) => got.push(u) });
  const tok = 'abcdef0123456789';
  await send(p.url, `/t/${tok}/v1/messages`, { model: 'qwen3:14b', max_tokens: 50, stream: true, messages: [{ role: 'user', content: 'x' }] });
  await send(p.url, `/t/${tok}/v1/messages`, { model: 'qwen3:14b', max_tokens: 50, messages: [{ role: 'user', content: 'x' }] });
  await send(p.url, '/v1/messages', { model: 'qwen3:14b', max_tokens: 1, messages: [{ role: 'user', content: 'x' }] });
  await new Promise((r) => setTimeout(r, 100));
  assert.deepStrictEqual(m.seen, ['/v1/messages', '/v1/messages', '/v1/messages'], 'the model server never sees the prefix');
  assert.deepStrictEqual(got.map((u) => [u.token, u.input, u.output, !!u.error]), [[tok, 4321, 77, false], [tok, 900, 12, false], ['', 0, 0, true]]);
  assert.match(got[2].error, /too long|400/);
  assert.strictEqual(got[0].model, 'qwen3:14b');
  await p.close(); m.server.close();
});

test('regression: the manager hands onLog and onUsage to the proxy it creates (they were dropped, so the debug log never showed model requests)', async () => {
  const m = await fakeModel();
  const lines = []; const usage = [];
  const mgr = manager();
  const p = await mgr.ensure({ upstream: m.url, onLog: (l) => lines.push(l), onUsage: (u) => usage.push(u) });
  await send(p.url, '/t/0123456789abcdef/v1/messages', { model: 'x', max_tokens: 5, messages: [{ role: 'user', content: 'hello' }] });
  await new Promise((r) => setTimeout(r, 100));
  assert.strictEqual(lines.length, 1); assert.strictEqual(usage.length, 1); assert.strictEqual(usage[0].input, 900);
  await p.close(); m.server.close();
});

test('view: cloud sessions use the transcript numbers and the price table, local ones cost nothing', () => {
  const now = 5_000_000;
  const t = (o) => ({ startedAt: now - 120000, lastData: now - 1000, ...o });
  const v = F.view([
    t({ key: 'cloud', label: 'Claude', fleet: { cloud: { input: 10, output: 500, cacheRead: 100000, cacheCreate: 2000, messages: 4, lastContext: 102010, model: 'claude-sonnet-x' } } }),
    t({ key: 'local', label: 'Qwen', context: 8192, fleet: { lastInput: 7900, totalInput: 30000, totalOutput: 900, requests: 6, model: 'qwen3:14b' } }),
    t({ key: 'gone', exited: true, exitedAt: now }),
  ], { prices: { sonnet: [3, 15] }, sort: 'tokens' }, now);
  assert.deepStrictEqual(v.rows.map((r) => r.key), ['cloud', 'local', 'gone']);
  assert.ok(v.rows[0].cost > 0 && v.rows[0].local === false);
  assert.strictEqual(v.rows[1].cost, null); assert.strictEqual(v.rows[1].local, true); assert.strictEqual(v.rows[1].level, 'full');
  assert.strictEqual(v.summary.live, 2); assert.strictEqual(v.summary.blowouts, 1); assert.strictEqual(v.summary.cost, v.rows[0].cost);
  assert.match(v.rows[1].tokensText, /30k in \/ 900 out/);
  assert.strictEqual(F.view([], {}, now).summary.cost, null);
  assert.strictEqual(F.view([t({ key: 'a', startedAt: now - 9 * 60000, lastData: now - 4 * 60000 })], { staleMinutes: 3 }, now).rows[0].state, 'stale');
  assert.strictEqual(F.view([t({ key: 'a' })], { filter: 'bogus', sort: 'bogus' }, now).rows.length, 1, 'unknown filter or sort falls back');
});
