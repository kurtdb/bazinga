'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const ad = require('../src/core/openaiadapter');
const tp = require('../src/core/toolproxy');
const ollama = require('../src/core/ollama');
const agentprep = require('../src/core/agentprep');

const TOOLS = [{ name: 'Read', description: 'Reads', input_schema: { type: 'object', properties: { file_path: { type: 'string' } }, required: ['file_path'] } }];

test('request: system, text, tool_use and tool_result map to OpenAI messages (results right after the call)', () => {
  const o = ad.toOpenAI({
    model: 'm', max_tokens: 100, temperature: 0.2, stop_sequences: ['X'], stream: true,
    system: [{ type: 'text', text: 'Be brief.' }, { type: 'text', text: 'Be kind.' }],
    tools: TOOLS, tool_choice: { type: 'any', disable_parallel_tool_use: true },
    messages: [
      { role: 'user', content: 'read a.txt' },
      { role: 'assistant', content: [{ type: 'thinking', thinking: 'hm', signature: '' }, { type: 'text', text: 'ok' }, { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: '/a.txt' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: [{ type: 'text', text: 'hello' }] }, { type: 'text', text: 'now summarise' }] },
    ],
  });
  assert.equal(o.model, 'm'); assert.equal(o.max_tokens, 100); assert.equal(o.temperature, 0.2); assert.deepEqual(o.stop, ['X']);
  assert.equal(o.stream, true); assert.deepEqual(o.stream_options, { include_usage: true });
  assert.equal(o.tool_choice, 'required'); assert.equal(o.parallel_tool_calls, false);
  assert.deepEqual(o.tools[0], { type: 'function', function: { name: 'Read', description: 'Reads', parameters: TOOLS[0].input_schema } });
  assert.deepEqual(o.messages.map((m) => m.role), ['system', 'user', 'assistant', 'tool', 'user']);
  assert.equal(o.messages[0].content, 'Be brief.\nBe kind.');
  assert.deepEqual(o.messages[2].tool_calls, [{ id: 'toolu_1', type: 'function', function: { name: 'Read', arguments: '{"file_path":"/a.txt"}' } }]);
  assert.equal(o.messages[2].content, 'ok');
  assert.deepEqual(o.messages[3], { role: 'tool', tool_call_id: 'toolu_1', content: 'hello' });
  assert.equal(o.messages[4].content, 'now summarise');
});

test('request: images, tool errors, tool_choice variants and an assistant that only called a tool', () => {
  const o = ad.toOpenAI({
    model: 'm', tools: TOOLS, tool_choice: { type: 'tool', name: 'Read' },
    messages: [
      { role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAA' } }, { type: 'text', text: 'what is this' }] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't', name: 'Read', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', is_error: true, content: 'nope' }] },
    ],
  });
  assert.deepEqual(o.tool_choice, { type: 'function', function: { name: 'Read' } });
  assert.deepEqual(o.messages[0].content, [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } }, { type: 'text', text: 'what is this' }]);
  assert.equal(o.messages[1].content, null);
  assert.equal(o.messages[2].content, 'Error: nope');
  assert.equal(ad.toOpenAI({ model: 'm', messages: [], tools: [{ type: 'web_search_20250305', name: 'web_search' }] }).tools, undefined);
});

test('reply: text, reasoning and tool calls become an Anthropic message with the right stop reason', () => {
  const m = ad.fromOpenAI({ id: 'x', model: 'm', choices: [{ finish_reason: 'tool_calls', message: { content: 'looking', reasoning_content: 'think', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'Read', arguments: '{"file_path":"/a"}' } }, { id: 'c2', type: 'function', function: { name: 'Read', arguments: 'not json' } }] } }], usage: { prompt_tokens: 12, completion_tokens: 5 } });
  assert.deepEqual(m.content.map((b) => b.type), ['thinking', 'text', 'tool_use', 'tool_use']);
  assert.deepEqual(m.content[2].input, { file_path: '/a' });
  assert.deepEqual(m.content[3].input, {});
  assert.equal(m.stop_reason, 'tool_use');
  assert.deepEqual(m.usage, { input_tokens: 12, output_tokens: 5 });
  assert.equal(ad.fromOpenAI({ choices: [{ finish_reason: 'length', message: { content: 'cut' } }] }).stop_reason, 'max_tokens');
  // some servers say "stop" even when they called a tool
  assert.equal(ad.fromOpenAI({ choices: [{ finish_reason: 'stop', message: { tool_calls: [{ id: 'c', function: { name: 'Read', arguments: '{}' } }] } }] }).stop_reason, 'tool_use');
});

test('error bodies become Anthropic errors', () => {
  assert.deepEqual(ad.errorFrom(401, '{"error":{"message":"bad key"}}'), { type: 'error', error: { type: 'authentication_error', message: 'bad key' } });
  assert.equal(ad.errorFrom(500, 'boom').error.message, 'boom');
});

const sseOf = (objs) => objs.map((o) => `data: ${typeof o === 'string' ? o : JSON.stringify(o)}\n\n`).join('');
const parseSse = (s) => s.split('\n\n').filter(Boolean).map((f) => JSON.parse(f.split('\n').find((l) => l.startsWith('data:')).slice(5)));

test('stream: text, then a tool call whose arguments arrive in pieces, then usage after the finish; any chunk size works', () => {
  const stream = sseOf([
    { model: 'm', choices: [{ delta: { role: 'assistant', content: '' } }] },
    { choices: [{ delta: { content: 'Let me ' } }] },
    { choices: [{ delta: { content: 'look.' } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_a', type: 'function', function: { name: 'Read', arguments: '' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"file_' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'path":"/a.txt"}' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 1, id: 'call_b', type: 'function', function: { name: 'Read', arguments: '{"file_path":"/b"}' } }] } }] },
    { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    { choices: [], usage: { prompt_tokens: 40, completion_tokens: 9 } },
    '[DONE]',
  ]);
  for (const size of [stream.length, 7, 1]) {
    const t = new ad.StreamTranslator();
    let out = '';
    for (let i = 0; i < stream.length; i += size) out += t.push(stream.slice(i, i + size)).join('');
    out += t.end().join('');
    const ev = parseSse(out);
    assert.deepEqual(ev.map((e) => e.type), ['message_start', 'content_block_start', 'content_block_delta', 'content_block_delta', 'content_block_stop', 'content_block_start', 'content_block_delta', 'content_block_delta', 'content_block_stop', 'content_block_start', 'content_block_delta', 'content_block_stop', 'message_delta', 'message_stop'], `size ${size}`);
    assert.equal(ev[1].content_block.type, 'text');
    assert.equal(ev[5].content_block.type, 'tool_use'); assert.equal(ev[5].content_block.id, 'call_a'); assert.equal(ev[5].content_block.name, 'Read');
    assert.equal(ev[6].delta.partial_json + ev[7].delta.partial_json, '{"file_path":"/a.txt"}');
    assert.equal(ev[9].index, 2);
    const md = ev[12];
    assert.equal(md.delta.stop_reason, 'tool_use'); assert.deepEqual(md.usage, { input_tokens: 40, output_tokens: 9 });
  }
});

test('stream: reasoning comes first as a thinking block, an empty reply is still a valid message, a server error becomes an error event', () => {
  let t = new ad.StreamTranslator('m');
  let out = t.push(sseOf([{ choices: [{ delta: { reasoning_content: 'hmm' } }] }, { choices: [{ delta: { content: 'done' }, finish_reason: 'stop' }] }, '[DONE]'])).join('') + t.end().join('');
  let ev = parseSse(out);
  assert.equal(ev[1].content_block.type, 'thinking'); assert.equal(ev[2].delta.type, 'thinking_delta');
  assert.equal(ev.find((e) => e.type === 'message_delta').delta.stop_reason, 'end_turn');
  t = new ad.StreamTranslator('m');
  ev = parseSse(t.end().join(''));
  assert.deepEqual(ev.map((e) => e.type), ['message_start', 'message_delta', 'message_stop']);
  t = new ad.StreamTranslator('m');
  ev = parseSse(t.push(sseOf([{ error: { message: 'out of memory' } }])).join('') + t.end().join(''));
  assert.equal(ev[ev.length - 1].type, 'error'); assert.equal(ev[ev.length - 1].error.message, 'out of memory');
});

test('chatPath: the address may or may not end in /v1', () => {
  assert.equal(ad.chatPath('/'), '/v1/chat/completions');
  assert.equal(ad.chatPath(''), '/v1/chat/completions');
  assert.equal(ad.chatPath('/v1'), '/v1/chat/completions');
  assert.equal(ad.chatPath('/api/v1/'), '/api/v1/chat/completions');
});

// ---------------------------------------------------------------------------------------------------- through the real helper
function fakeOpenAI(handler) {
  const seen = [];
  const server = http.createServer((req, res) => {
    const chunks = []; req.on('data', (c) => chunks.push(c));
    req.on('end', () => { const body = Buffer.concat(chunks).toString('utf8'); seen.push({ url: req.url, headers: req.headers, body: body ? JSON.parse(body) : null }); handler(req, res, seen[seen.length - 1]); });
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, seen, url: `http://127.0.0.1:${server.address().port}` })));
}
function post(url, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url); const data = JSON.stringify(body);
    const req = http.request({ hostname: u.hostname, port: u.port, path, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), ...headers } }, (res) => { const p = []; res.on('data', (c) => p.push(c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(p).toString('utf8') })); });
    req.on('error', reject); req.end(data);
  });
}

test('helper in openai mode: Claude Code asks in Anthropic format, the server gets Chat Completions with the key, the answer streams back and a printed tool call is still repaired', async () => {
  const fake = await fakeOpenAI((req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    // a small model that prints its tool call as text instead of using the tool-call field
    const text = '{"name": "read_file", "arguments": {"path": "a.txt"}}';
    res.write(sseOf([{ model: 'm', choices: [{ delta: { content: text.slice(0, 20) } }] }, { choices: [{ delta: { content: text.slice(20) }, finish_reason: 'stop' }] }, { choices: [], usage: { prompt_tokens: 30, completion_tokens: 12 } }, '[DONE]']));
    res.end();
  });
  const usage = [];
  const proxy = await tp.createProxy({ upstream: fake.url, lean: false, repair: true, format: 'openai', onUsage: (u) => usage.push(u) });
  try {
    const r = await post(proxy.url, '/t/abcdef0123456789/v1/messages', { model: 'm', max_tokens: 50, stream: true, system: 'Working directory: /work/proj', tools: TOOLS, messages: [{ role: 'user', content: 'read a.txt' }] }, { 'x-api-key': 'sk-test', 'anthropic-version': '2023-06-01' });
    assert.equal(r.status, 200);
    assert.match(r.headers['content-type'], /event-stream/);
    const ev = parseSse(r.text);
    const tool = ev.find((e) => e.type === 'content_block_start' && e.content_block.type === 'tool_use');
    assert.ok(tool, r.text);
    assert.equal(tool.content_block.name, 'Read');
    const args = ev.filter((e) => e.delta && e.delta.type === 'input_json_delta').map((e) => e.delta.partial_json).join('');
    assert.deepEqual(JSON.parse(args), { file_path: '/work/proj/a.txt' });
    assert.equal(ev.find((e) => e.type === 'message_delta').delta.stop_reason, 'tool_use');
    const got = fake.seen[0];
    assert.equal(got.url, '/v1/chat/completions');
    assert.equal(got.headers.authorization, 'Bearer sk-test');
    assert.equal(got.headers['x-api-key'], undefined);
    assert.equal(got.headers['anthropic-version'], undefined);
    assert.equal(got.body.messages[0].role, 'system');
    assert.equal(got.body.tools[0].function.name, 'Read');
    assert.equal(got.body.stream_options.include_usage, true);
    await new Promise((r2) => setTimeout(r2, 50));
    assert.equal(usage.length, 1); assert.equal(usage[0].input, 30); assert.equal(usage[0].output, 12); assert.equal(usage[0].token, 'abcdef0123456789');
  } finally { await proxy.close(); fake.server.close(); }
});

test('helper in openai mode: not streamed, count_tokens answered locally, server errors in Anthropic shape, prefix paths kept', async () => {
  let mode = 'ok';
  const fake = await fakeOpenAI((req, res) => {
    if (mode === 'err') { res.writeHead(401, { 'content-type': 'application/json' }); res.end('{"error":{"message":"bad key"}}'); return; }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'r', model: 'm', choices: [{ finish_reason: 'stop', message: { content: 'hello there' } }], usage: { prompt_tokens: 3, completion_tokens: 2 } }));
  });
  const proxy = await tp.createProxy({ upstream: `${fake.url}/api/v1`, lean: false, format: 'openai' });
  try {
    let r = await post(proxy.url, '/v1/messages', { model: 'm', max_tokens: 5, messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(r.status, 200);
    const j = JSON.parse(r.text);
    assert.equal(j.type, 'message'); assert.equal(j.content[0].text, 'hello there'); assert.equal(j.stop_reason, 'end_turn'); assert.equal(j.usage.output_tokens, 2);
    assert.equal(fake.seen[0].url, '/api/v1/chat/completions');
    r = await post(proxy.url, '/v1/messages/count_tokens', { model: 'm', messages: [{ role: 'user', content: 'hello world, this is a test' }] });
    assert.equal(r.status, 200); assert.ok(JSON.parse(r.text).input_tokens > 0);
    assert.equal(fake.seen.length, 1, 'count_tokens never reaches the server');
    mode = 'err';
    r = await post(proxy.url, '/v1/messages', { model: 'm', max_tokens: 5, stream: true, messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(r.status, 401);
    assert.deepEqual(JSON.parse(r.text), { type: 'error', error: { type: 'authentication_error', message: 'bad key' } });
  } finally { await proxy.close(); fake.server.close(); }
});

test('agent setting api: "openai" makes any address a model server and keeps its path; Anthropic itself never', () => {
  const agent = { command: 'claude --model qwen2.5-coder', api: 'openai', env: { ANTHROPIC_BASE_URL: 'https://gw.example.com/api/v1/' } };
  assert.deepEqual(ollama.localTarget(agent), { baseUrl: 'https://gw.example.com/api/v1', model: 'qwen2.5-coder', remote: true, openai: true });
  assert.equal(ollama.localTarget({ ...agent, env: { ANTHROPIC_BASE_URL: 'https://api.anthropic.com' } }), null);
  assert.equal(ollama.localTarget({ ...agent, api: undefined }), null);
});

test('prepare: an OpenAI-style agent gets the translating helper, its key is not needed to list models, and a missing model is reported', async () => {
  const fake = await fakeOpenAI((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data: [{ id: 'qwen2.5-coder' }, { id: 'other' }] })); });
  const proxies = tp.manager();
  try {
    const agent = { name: 'LM', command: 'claude --model qwen2.5-coder', api: 'openai', context: 65536, env: { ANTHROPIC_BASE_URL: `${fake.url}/v1`, ANTHROPIC_AUTH_TOKEN: 'lm-studio' } };
    const out = await agentprep.prepare(agent, { root: '', config: {}, proxies, hintDir: require('node:os').tmpdir() });
    assert.equal(out.local.problems.length, 0);
    assert.equal(out.local.proxy.format, 'openai');
    assert.match(out.envForce.ANTHROPIC_BASE_URL, /^http:\/\/127\.0\.0\.1:\d+\/t\/[0-9a-f]{16}$/);
    assert.equal(out.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS, '65536');
    assert.equal(out.local.contextLabel, '64k');
    assert.equal(fake.seen[0].url, '/v1/models');
    assert.equal(fake.seen[0].headers.authorization, 'Bearer lm-studio');
    const miss = await agentprep.prepare({ ...agent, command: 'claude --model nope' }, { root: '', config: {}, proxies, hintDir: require('node:os').tmpdir() });
    assert.equal(miss.local.problems[0].kind, 'missing-model');
  } finally { await proxies.closeAll(); fake.server.close(); }
});
