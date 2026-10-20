'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const C = require('../src/core/capture');
const { HookServer, newToken } = require('../src/core/hooks');
const { OtelReceiver } = require('../src/core/otel');
const tp = require('../src/core/toolproxy');
const A = require('../src/core/acp');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bz-cap-'));
const text = (v) => JSON.stringify(v);

test('sanitize: no readable text survives, the shape does', () => {
  const secret = 'SECRET-CODE: password=hunter2 /home/kurt/projects/market-mole/src/Main.java';
  const out = C.sanitize({
    hook_event_name: 'Stop', session_id: 'abc-123-def', cwd: '/home/kurt/projects/x', transcript_path: '/home/kurt/.claude/projects/x.jsonl',
    last_assistant_message: secret, stop_hook_active: false, count: 3,
    messages: [{ role: 'user', content: secret }, { role: 'assistant', content: [{ type: 'text', text: secret }, { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: '/home/kurt/a.txt' } }] }],
  });
  const s = text(out);
  for (const bad of ['hunter2', 'SECRET-CODE', '/home/kurt', 'abc-123-def', 'market-mole', 'toolu_1']) assert.ok(!s.includes(bad), `leaked ${bad}`);
  assert.equal(out.hook_event_name, 'Stop');
  assert.equal(out.stop_hook_active, false); assert.equal(out.count, 3);
  assert.equal(out.last_assistant_message, `<str:${secret.length}>`);
  assert.equal(out.messages[1].content[0].type, 'text');
  assert.equal(out.messages[1].content[1].name, 'Read', 'a tool is named in content blocks');
  assert.deepEqual(Object.keys(out.messages[1].content[1].input), ['file_path']);
});

test('sanitize: tool arguments travel as JSON in a string: the shape is kept, the values are not; fragments are only lengths', () => {
  const out = C.sanitize({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_9', type: 'function', function: { name: 'Write', arguments: '{"file_path":"/x/a.py","content":"print(1)"}' } }] } }] });
  const fn = out.choices[0].delta.tool_calls[0].function;
  assert.equal(fn.name, 'Write');
  assert.deepEqual(fn.arguments, { $json: { file_path: '<str:7>', content: '<str:8>' } });
  const frag = C.sanitize({ function: { arguments: '{"file_' } });
  assert.equal(frag.function.arguments, '<str:7>');
  assert.equal(C.sanitize({ function: { arguments: '' } }).function.arguments, '<str:0>', 'an empty first chunk stays visible');
});

test('sanitize: telemetry attributes keep category values and mask the rest; names only where they are names of things', () => {
  const out = C.sanitize({ attributes: [{ key: 'event.name', value: { stringValue: 'claude_code.api_request' } }, { key: 'model', value: { stringValue: 'claude-sonnet-4' } }, { key: 'prompt', value: { stringValue: 'my secret prompt' } }, { key: 'input_tokens', value: { intValue: '12' } }, { key: 'user.email', value: { stringValue: 'kurt@example.com' } }] });
  const a = out.attributes;
  assert.equal(a[0].value.stringValue, 'claude_code.api_request'); assert.equal(a[1].value.stringValue, 'claude-sonnet-4');
  assert.equal(a[2].value.stringValue, '<str:16>'); assert.equal(a[4].value.stringValue, '<str:16>');
  assert.ok(!text(out).includes('kurt@example.com'));
  const o2 = C.sanitize({ run: { name: 'my private run' }, tools: [{ name: 'Bash' }], metrics: [{ name: 'claude_code.token.usage' }] });
  assert.equal(o2.run.name, '<str:14>'); assert.equal(o2.tools[0].name, 'Bash'); assert.equal(o2.metrics[0].name, 'claude_code.token.usage');
});

test('sanitize: keys that are paths or sentences, long arrays, deep nesting and odd values are handled', () => {
  const out = C.sanitize({ '/home/kurt/secret.txt': 1, ['a'.repeat(80)]: 2, list: Array.from({ length: 50 }, (_, i) => i), f() {}, n: null, u: undefined, big: 10n });
  assert.ok(!text(out).includes('kurt'));
  assert.ok(Object.keys(out).some((k) => /^<key:\d+>$/.test(k)));
  assert.equal(out.list.length, 21); assert.equal(out.list[20], '<+30 more>');
  assert.equal(out.n, null); assert.equal(out.big, 10);
  let deep = {}; const root = deep; for (let i = 0; i < 40; i++) { deep.x = {}; deep = deep.x; }
  assert.ok(text(C.sanitize(root)).includes('<too deep>'));
  assert.equal(C.sanitize('plain'), '<str:5>');
  assert.equal(C.sanitize({ model: 'ollama/qwen3:14b' }).model, 'ollama/qwen3:14b', 'a model name with a slash is a name, not a path');
  assert.equal(C.sanitize({ model: '/etc/passwd' }).model, '<str:11>');
});

test('sanitizeSse keeps the chunking visible and every text masked', () => {
  const raw = 'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hello secret"}}\n\ndata: {"choices":[{"delta":{"content":"more secret"},"finish_reason":null}]}\n\ndata: [DONE]\n\n';
  const frames = C.sanitizeSse(raw);
  assert.equal(frames.length, 3);
  assert.equal(frames[0].event, 'content_block_delta'); assert.equal(frames[0].data.delta.type, 'text_delta'); assert.equal(frames[0].data.delta.text, '<str:12>');
  assert.equal(frames[2].data, '[DONE]');
  assert.ok(!text(frames).includes('secret'));
  assert.equal(C.sanitizeSse('data: {broken\n\n')[0].data, '<str:7>');
  assert.equal(C.sanitizeSse(Array(100).fill('data: {"a":1}\n\n').join('')).at(-1), '<more frames>');
});

test('Capture: does nothing while off, writes while on, stops at its limits, bundles and clears', () => {
  const dir = path.join(tmp(), 'capture'); let on = false;
  const cap = new C.Capture({ dir, enabled: () => on, info: () => ({ app: 'x' }) });
  assert.equal(cap.record('hook', { hook_event_name: 'Stop' }), false);
  assert.equal(fs.existsSync(dir), false, 'not even a folder while off');
  on = true;
  assert.equal(cap.record('hook', { hook_event_name: 'Stop', last_assistant_message: 'private' }, { event: 'stop' }), true);
  assert.equal(cap.record('nonsense', {}), false);
  const line = JSON.parse(fs.readFileSync(path.join(dir, 'hook.jsonl'), 'utf8').trim());
  assert.equal(line.kind, 'hook'); assert.equal(line.data.hook_event_name, 'Stop'); assert.equal(line.data.last_assistant_message, '<str:7>'); assert.equal(line.meta.event, 'stop');
  for (let i = 0; i < C.MAX_RECORDS + 20; i++) cap.record('acp', { jsonrpc: '2.0', method: 'session/update', id: i });
  assert.equal(cap.status().kinds.acp, C.MAX_RECORDS);
  assert.equal(cap.record('model-response', { text: 'x'.repeat(2000000) }), true, 'a huge text is only its length');
  assert.ok(fs.statSync(path.join(dir, 'model-response.jsonl')).size < 1000);
  const file = cap.bundle();
  const b = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(b.hook.length, 1); assert.equal(b.acp.length, C.MAX_RECORDS); assert.equal(b.info.app, 'x'); assert.ok(!JSON.stringify(b).includes('private'));
  assert.equal(cap.status().total, 1 + C.MAX_RECORDS + 1);
  assert.equal(cap.record('acp', {}), false, 'a full kind takes no more');
  cap.clear();
  assert.equal(cap.status().total, 0); assert.equal(cap.bundle(), null);
  assert.equal(cap.record('hook', { a: 1 }), true, 'after clearing it records again');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('presanitized records are not sanitized twice (a mask would be masked again)', () => {
  const dir = tmp(); const cap = new C.Capture({ dir, enabled: () => true });
  cap.record('model-response', { frames: C.sanitizeSse('data: {"x":"hello"}\n\n') }, {}, true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'model-response.jsonl'), 'utf8')).data.frames[0].data.x, '<str:5>');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a failing disk never breaks the caller', () => {
  const file = path.join(tmp(), 'blocker'); fs.writeFileSync(file, 'x');
  const cap = new C.Capture({ dir: path.join(file, 'sub'), enabled: () => true });
  assert.equal(cap.record('hook', {}), false);
  assert.equal(cap.status().total, 0);
});

// ---------------------------------------------------------------------------------------------------- the taps in the real servers
const postJson = (url, body, headers = {}) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });

test('hook server: every valid report is passed to onRaw, also from a terminal that is not bound; a throwing tap changes nothing', async () => {
  const raw = []; const events = [];
  const srv = new HookServer({ onEvent: (id, ev) => events.push(ev), onRaw: (ev, p, m) => { raw.push([ev, p, m]); throw new Error('tap broke'); } });
  const base = await srv.start(); const t = newToken(); srv.bind(t, 1);
  assert.equal((await postJson(`${base}/hook/${t}/substart`, { agent_id: 'a1', agent_type: 'Explore' })).status, 200);
  assert.equal((await postJson(`${base}/hook/${newToken()}/stop`, { hook_event_name: 'Stop' })).status, 200);
  assert.deepEqual(events, ['substart'], 'the event still arrived');
  assert.deepEqual(raw.map((r) => [r[0], r[2].bound]), [['substart', true], ['stop', false]]);
  assert.equal(raw[0][1].agent_type, 'Explore');
  srv.close();
});

test('telemetry receiver: JSON bodies and the content type of everything it has to refuse (protobuf!) reach onRaw', async () => {
  const raw = [];
  const r = new OtelReceiver({ onRaw: (i) => raw.push(i) });
  const base = await r.start(); const token = OtelReceiver.newToken(); r.bind(token, 1);
  await postJson(`${base}/t/${token}/v1/logs`, { resourceLogs: [] });
  const res = await fetch(`${base}/t/${token}/v1/metrics`, { method: 'POST', headers: { 'content-type': 'application/x-protobuf', 'content-encoding': 'gzip', 'content-length': '5' }, body: 'abcde' });
  assert.equal(res.status, 415);
  assert.equal(raw[0].signal, 'logs'); assert.deepEqual(raw[0].body, { resourceLogs: [] });
  assert.deepEqual([raw[1].signal, raw[1].contentType, raw[1].encoding, raw[1].rejected], ['metrics', 'application/x-protobuf', 'gzip', true]);
  assert.equal(raw[1].body, undefined);
  r.close();
});

function fakeModel(handler) {
  const server = http.createServer((req, res) => { const p = []; req.on('data', (c) => p.push(c)); req.on('end', () => handler(req, res, Buffer.concat(p).toString('utf8'))); });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, url: `http://127.0.0.1:${server.address().port}` })));
}

test('tool-call helper: the request as Claude Code sent it and the raw reply of the server (before any translation) reach onCapture; auth is never part of it', async () => {
  const fake = await fakeModel((req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: {"model":"m","choices":[{"delta":{"content":"top secret answer"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'); res.end();
  });
  const got = [];
  const proxy = await tp.createProxy({ upstream: fake.url, lean: false, format: 'openai', onCapture: (kind, data, meta) => got.push([kind, data, meta]) });
  try {
    const r = await postJson(`${proxy.url}/t/abcdef0123456789/v1/messages`, { model: 'm', max_tokens: 5, stream: true, system: 'private system prompt', messages: [{ role: 'user', content: 'private question' }] }, { 'x-api-key': 'sk-very-secret' });
    await r.text();
    await new Promise((x) => setTimeout(x, 80));
    const req = got.find((g) => g[0] === 'model-request'); const resp = got.find((g) => g[0] === 'model-response');
    assert.ok(req && resp);
    assert.equal(req[1].messages[0].content, 'private question', 'raw to the callback: masking happens in Capture');
    assert.equal(req[2].format, 'openai');
    assert.equal(resp[1].status, 200); assert.equal(resp[1].contentType, 'text/event-stream');
    assert.match(resp[1].raw, /top secret answer/);
    assert.ok(!JSON.stringify(got).includes('sk-very-secret'), 'the key is not passed on');
    // through Capture the same material is shapes only
    const dir = tmp(); const cap = new C.Capture({ dir, enabled: () => true });
    cap.record('model-request', req[1], req[2]);
    cap.record('model-response', { status: 200, contentType: 'text/event-stream', frames: C.sanitizeSse(resp[1].raw) }, resp[2], true);
    const all = fs.readFileSync(path.join(dir, 'model-request.jsonl'), 'utf8') + fs.readFileSync(path.join(dir, 'model-response.jsonl'), 'utf8');
    for (const bad of ['private', 'secret', 'sk-']) assert.ok(!all.includes(bad), `leaked ${bad}`);
    assert.match(all, /finish_reason/);
    fs.rmSync(dir, { recursive: true, force: true });
  } finally { await proxy.close(); fake.server.close(); }
});

test('ACP: every JSON-RPC line in both directions reaches onWire, and the protocol still works', async () => {
  const wire = []; const events = [];
  const cwd = tmp();
  const r = new A.AcpRun({ command: process.execPath, args: [path.join(__dirname, 'fixtures', 'acp-raw-agent.js')], cwd, policy: 'allow', onEvent: (e) => events.push(e), onWire: (dir, msg) => wire.push([dir, msg]) });
  await r.open(); r.send('go');
  await new Promise((res, rej) => { const t0 = Date.now(); (function poll() { if (events.some((e) => e.type === 'stop')) return res(); if (Date.now() - t0 > 15000) return rej(new Error('no stop')); setTimeout(poll, 25); }()); });
  r.close();
  const methods = wire.map(([d, m]) => `${d === 'client→agent' ? '>' : '<'}${m.method || 'result'}`);
  assert.ok(methods.includes('>initialize') && methods.includes('>session/prompt') && methods.includes('<session/update') && methods.includes('<session/request_permission'), methods.join(' '));
  assert.ok(wire.some(([d, m]) => d === 'client→agent' && m.result && m.result.outcome), 'the answer to the permission request');
  const dir = tmp(); const cap = new C.Capture({ dir, enabled: () => true });
  for (const [d, m] of wire) cap.record('acp', m, { dir: d });
  const all = fs.readFileSync(path.join(dir, 'acp.jsonl'), 'utf8');
  assert.ok(!all.includes('working on it') && !all.includes('Edit a.txt'), 'texts are masked');
  assert.match(all, /sessionUpdate/); assert.match(all, /agent_message_chunk/);
  fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(cwd, { recursive: true, force: true });
});
