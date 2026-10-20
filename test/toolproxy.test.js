'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const tp = require('../src/core/toolproxy');

// the six tools of the local preset, with Claude Code's argument names
const TOOLS = [
  { name: 'Read', description: 'Reads a file. '.repeat(400), input_schema: { type: 'object', properties: { file_path: { type: 'string', description: 'x'.repeat(500) }, offset: { type: 'number' }, limit: { type: 'number' } }, required: ['file_path'] } },
  { name: 'Write', description: 'Writes a file. '.repeat(400), input_schema: { type: 'object', properties: { file_path: { type: 'string' }, content: { type: 'string' } }, required: ['file_path', 'content'] } },
  { name: 'Edit', description: 'Edits.', input_schema: { type: 'object', properties: { file_path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' } }, required: ['file_path', 'old_string', 'new_string'] } },
  { name: 'Bash', description: 'Runs. '.repeat(900), input_schema: { type: 'object', properties: { command: { type: 'string' }, timeout: { type: 'number' } }, required: ['command'] } },
  { name: 'Grep', description: 'Searches.', input_schema: { type: 'object', properties: { pattern: { type: 'string' }, path: { type: 'string' } }, required: ['pattern'] } },
];
const ctx = (extra = {}) => ({ tools: tp.indexTools(TOOLS), cwd: '/work/proj', repair: true, ...extra });
const toolOf = (n) => TOOLS.find((t) => t.name === n);

// ---------------------------------------------------------------------------------------------------- reading text as a tool call
test('classify: JSON and tags are held back, ordinary words and code answers are not', () => {
  assert.equal(tp.classify(''), 'unknown');
  assert.equal(tp.classify('  \n'), 'unknown');
  assert.equal(tp.classify('{"name": "Write"'), 'call');
  assert.equal(tp.classify('\n```json\n{"name"'), 'call');
  assert.equal(tp.classify('```json'), 'unknown');
  assert.equal(tp.classify('```python\nimport os'), 'text');
  assert.equal(tp.classify('<tool'), 'unknown');
  assert.equal(tp.classify('<tool_call>\n{'), 'call');
  assert.equal(tp.classify('<div>hello</div>'), 'text');
  assert.equal(tp.classify('I will write the file now.'), 'text');
  assert.equal(tp.classify('[1] first item'), 'text');
});

test('extractCalls: {"name","arguments"} becomes a Write call with the right argument names', () => {
  const calls = tp.extractCalls('{"name": "Write", "arguments": {"file_path": "/work/proj/test_a.py", "content": "print(1)\\n"}}', ctx());
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'Write');
  assert.deepEqual(calls[0].input, { file_path: '/work/proj/test_a.py', content: 'print(1)\n' });
  assert.deepEqual(calls[0].missing, []);
});

test('extractCalls: the exact thing a local model printed (path, text) is corrected and made absolute', () => {
  const calls = tp.extractCalls('```json\n{"name": "write_file", "parameters": {"path": "tests/test_pipeline.py", "text": "import pytest"}}\n```', ctx());
  assert.equal(calls[0].name, 'Write');
  assert.deepEqual(calls[0].input, { file_path: '/work/proj/tests/test_pipeline.py', content: 'import pytest' });
  assert.ok(calls[0].fixes.some((f) => /path → file_path/.test(f)));
  assert.ok(calls[0].fixes.some((f) => /text → content/.test(f)));
});

test('extractCalls: <tool_call> tags, OpenAI style, arrays, XML style and raw line breaks inside the content', () => {
  const tag = tp.extractCalls('<tool_call>\n{"name": "Read", "arguments": {"file_path": "/a.py"}}\n</tool_call>', ctx());
  assert.equal(tag[0].name, 'Read');
  const oa = tp.extractCalls('{"tool_calls": [{"type": "function", "function": {"name": "Bash", "arguments": "{\\"command\\": \\"ls\\"}"}}]}', ctx());
  assert.deepEqual(oa[0].input, { command: 'ls' });
  const arr = tp.extractCalls('[{"name": "Read", "arguments": {"file_path": "/a"}}, {"name": "Grep", "arguments": {"pattern": "x"}}]', ctx());
  assert.deepEqual(arr.map((c) => c.name), ['Read', 'Grep']);
  const xml = tp.extractCalls('<function=Write>\n<parameter=file_path>\n/a.txt\n</parameter>\n<parameter=content>\nhi\n</parameter>\n</function>', ctx());
  assert.deepEqual(xml[0].input, { file_path: '/a.txt', content: 'hi' });
  const raw = tp.extractCalls('{"name": "Write", "arguments": {"file_path": "/a.txt", "content": "line one\nline two"}}', ctx());
  assert.equal(raw[0].input.content, 'line one\nline two');
});

test('extractCalls: arguments without a tool name are matched to the one tool that takes them', () => {
  const calls = tp.extractCalls('{"file_path": "/a.txt", "content": "x"}', ctx());
  assert.equal(calls[0].name, 'Write');
});

test('extractCalls: not a call -> null (an unknown tool, plain JSON data, a cut-off call, prose)', () => {
  assert.equal(tp.extractCalls('{"name": "launch_missiles", "arguments": {}}', ctx()), null);
  assert.equal(tp.extractCalls('{"a": 1, "b": 2}', ctx()), null);
  assert.equal(tp.extractCalls('{"name": "Write", "arguments": {"file_path": "/a", "content": "cut off', ctx()), null);
  assert.equal(tp.extractCalls('Here is the answer.', ctx()), null);
});

test('fixInput: names, types, unknown keys, relative paths', () => {
  let f = tp.fixInput(toolOf('Read'), { filePath: 'src/a.py', offset: '10', junk: 1, limit: null }, '/work/proj');
  assert.deepEqual(f.input, { file_path: '/work/proj/src/a.py', offset: 10 });
  assert.deepEqual(f.missing, []);
  f = tp.fixInput(toolOf('Bash'), { cmd: 'ls -la' }, '/work');
  assert.deepEqual(f.input, { command: 'ls -la' });
  f = tp.fixInput(toolOf('Write'), { file_path: '/a', content: { a: 1 } }, '/work');
  assert.equal(f.input.content, '{\n  "a": 1\n}');
  f = tp.fixInput(toolOf('Write'), { file_path: '/a' }, '/work');
  assert.deepEqual(f.missing, ['content']);
  f = tp.fixInput(toolOf('Grep'), { query: 'foo' }, '/work');
  assert.deepEqual(f.input, { pattern: 'foo' });
  // a lone unknown string argument goes to the lone missing required one
  f = tp.fixInput(toolOf('Bash'), { instruction: 'pwd' }, '/work');
  assert.deepEqual(f.input, { command: 'pwd' });
});

test('absolutize: posix and Windows working folders; absolute and ~ paths stay', () => {
  assert.equal(tp.absolutize('a/b.txt', '/w'), '/w/a/b.txt');
  assert.equal(tp.absolutize('a\\b.txt', 'C:\\proj'), 'C:\\proj\\a\\b.txt');
  assert.equal(tp.absolutize('/x/y', '/w'), '/x/y');
  assert.equal(tp.absolutize('~/x', '/w'), '~/x');
  assert.equal(tp.absolutize('a.txt', ''), 'a.txt');
});

// ---------------------------------------------------------------------------------------------------- the streaming repair
const ev = (type, o) => `event: ${type}\ndata: ${JSON.stringify({ type, ...o })}\n\n`;
const textStream = (pieces, extra = {}) => [
  ev('message_start', { message: { id: 'm', role: 'assistant', content: [], model: 'x', usage: { input_tokens: 5, output_tokens: 0 } } }),
  ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }),
  ...pieces.map((p) => ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: p } })),
  ev('content_block_stop', { index: 0 }),
  ev('message_delta', { delta: { stop_reason: extra.stop || 'end_turn' }, usage: { output_tokens: 9 } }),
  ev('message_stop', {}),
].join('');
function parseEvents(chunks) {
  return chunks.join('').split(/\n\n/).filter(Boolean).map((raw) => JSON.parse(raw.split('\n').find((l) => l.startsWith('data:')).slice(5)));
}
function runStream(text, c = ctx(), size = 17) { // cut into small pieces, as a network would
  const sr = new tp.StreamRepair(c);
  const out = [];
  for (let i = 0; i < text.length; i += size) out.push(...sr.push(text.slice(i, i + size)));
  out.push(...sr.end());
  return { events: parseEvents(out), sr, raw: out };
}

test('stream: a tool call written as text comes out as a real tool_use block, and the stop reason follows', () => {
  const call = JSON.stringify({ name: 'Write', arguments: { path: 'out.txt', content: 'bz1234' } });
  const { events, sr } = runStream(textStream([call.slice(0, 20), call.slice(20, 50), call.slice(50)]));
  const types = events.map((e) => e.type);
  assert.deepEqual(types, ['message_start', 'content_block_start', 'content_block_delta', 'content_block_stop', 'message_delta', 'message_stop']);
  const start = events[1].content_block;
  assert.equal(start.type, 'tool_use'); assert.equal(start.name, 'Write'); assert.match(start.id, /^toolu_/);
  assert.deepEqual(JSON.parse(events[2].delta.partial_json), { file_path: '/work/proj/out.txt', content: 'bz1234' });
  assert.equal(events[4].delta.stop_reason, 'tool_use');
  assert.ok(sr.summary.fixes.some((f) => /written the Write call as text|wrote the Write call as text/.test(f)));
});

test('stream: ordinary text passes at once, piece by piece (nothing held back)', () => {
  const sr = new tp.StreamRepair(ctx());
  const first = sr.push(ev('message_start', { message: {} }) + ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }) + ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'Hello ' } }));
  assert.equal(parseEvents(first).filter((e) => e.type === 'content_block_delta').length, 1);
  const more = sr.push(ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'world' } }));
  assert.equal(parseEvents(more)[0].delta.text, 'world');
});

test('stream: text that starts like a call but is not one is given back unchanged, and kept for display', () => {
  const { events, sr } = runStream(textStream(['{"note": "just some json ', 'data"}']));
  const text = events.filter((e) => e.type === 'content_block_delta').map((e) => e.delta.text).join('');
  assert.equal(text, '{"note": "just some json data"}');
  assert.equal(events.find((e) => e.type === 'message_delta').delta.stop_reason, 'end_turn');
  assert.match(sr.summary.held, /just some json/);
});

test('stream: a real tool_use with wrong argument names is corrected (the "Invalid tool parameters" case)', () => {
  const s = [
    ev('message_start', { message: {} }),
    ev('content_block_start', { index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: 'Read', input: {} } }),
    ev('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: '{"pa' } }),
    ev('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: 'th": "edgy/pipeline.py"}' } }),
    ev('content_block_stop', { index: 0 }),
    ev('message_delta', { delta: { stop_reason: 'tool_use' } }),
    ev('message_stop', {}),
  ].join('');
  const { events, sr } = runStream(s);
  const deltas = events.filter((e) => e.type === 'content_block_delta');
  assert.equal(deltas.length, 1);
  assert.deepEqual(JSON.parse(deltas[0].delta.partial_json), { file_path: '/work/proj/edgy/pipeline.py' });
  assert.equal(events.find((e) => e.type === 'content_block_start').content_block.id, 'toolu_1');
  assert.ok(sr.summary.fixes.some((f) => /path → file_path/.test(f)));
});

test('stream: a tool with an unknown name (write_file) is renamed; an empty argument list stays valid JSON', () => {
  const s = [
    ev('content_block_start', { index: 0, content_block: { type: 'tool_use', id: 'toolu_2', name: 'write_file', input: {} } }),
    ev('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: '{"file_path": "/a", "content": "x"}' } }),
    ev('content_block_stop', { index: 0 }),
    ev('content_block_start', { index: 1, content_block: { type: 'tool_use', id: 'toolu_3', name: 'Bash', input: {} } }),
    ev('content_block_stop', { index: 1 }),
  ].join('');
  const { events } = runStream(s);
  const starts = events.filter((e) => e.type === 'content_block_start');
  assert.equal(starts[0].content_block.name, 'Write');
  assert.deepEqual(starts.map((e) => e.index), [0, 1]);
  const bash = events.filter((e) => e.type === 'content_block_delta' && e.index === 1);
  assert.deepEqual(JSON.parse(bash[0].delta.partial_json), {});
});

test('stream: thinking passes through live, and block numbers stay in order when a text becomes two calls', () => {
  const calls = JSON.stringify([{ name: 'Read', arguments: { file_path: '/a' } }, { name: 'Read', arguments: { file_path: '/b' } }]);
  const s = [
    ev('message_start', { message: {} }),
    ev('content_block_start', { index: 0, content_block: { type: 'thinking', thinking: '' } }),
    ev('content_block_delta', { index: 0, delta: { type: 'thinking_delta', thinking: 'hmm' } }),
    ev('content_block_stop', { index: 0 }),
    ev('content_block_start', { index: 1, content_block: { type: 'text', text: '' } }),
    ev('content_block_delta', { index: 1, delta: { type: 'text_delta', text: calls } }),
    ev('content_block_stop', { index: 1 }),
    ev('message_delta', { delta: { stop_reason: 'end_turn' } }),
    ev('message_stop', {}),
  ].join('');
  const { events } = runStream(s);
  const starts = events.filter((e) => e.type === 'content_block_start');
  assert.deepEqual(starts.map((e) => [e.index, e.content_block.type]), [[0, 'thinking'], [1, 'tool_use'], [2, 'tool_use']]);
  const stops = events.filter((e) => e.type === 'content_block_stop').map((e) => e.index);
  assert.deepEqual(stops, [0, 1, 2]);
  assert.equal(events.find((e) => e.type === 'content_block_delta' && e.index === 0).delta.thinking, 'hmm');
});

test('stream: with repair off the events are not touched (a text that looks like a call stays text)', () => {
  const call = JSON.stringify({ name: 'Write', arguments: { file_path: '/a', content: 'x' } });
  const { events } = runStream(textStream([call]), ctx({ repair: false }));
  assert.equal(events.find((e) => e.type === 'content_block_start').content_block.type, 'text');
  assert.equal(events.find((e) => e.type === 'message_delta').delta.stop_reason, 'end_turn');
});

test('stream: a connection that breaks mid-way still ends every open block', () => {
  const sr = new tp.StreamRepair(ctx());
  sr.push(ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }) + ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: '{"name": "Wr' } }));
  const tail = parseEvents(sr.end());
  assert.deepEqual(tail.map((e) => e.type), ['content_block_start', 'content_block_delta', 'content_block_stop']);
});

test('repairMessage: the same for an answer that is not streamed', () => {
  const msg = { id: 'm', role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: '{"name": "Read", "arguments": {"path": "a.py"}}' }] };
  const { msg: out } = tp.repairMessage(msg, ctx());
  assert.equal(out.content[0].type, 'tool_use');
  assert.deepEqual(out.content[0].input, { file_path: '/work/proj/a.py' });
  assert.equal(out.stop_reason, 'tool_use');
});

// ---------------------------------------------------------------------------------------------------- the slim prompt
test('leanify: the long Claude Code prompt and tool texts shrink, the environment and the standing instructions stay', () => {
  const body = {
    model: 'm', max_tokens: 100,
    system: [{ type: 'text', text: `${'You are Claude Code. '.repeat(2000)}\n# Environment\n - Primary working directory: /work/proj\n - Platform: linux\n - Shell: bash\n\nSTANDING-HINT` }],
    tools: JSON.parse(JSON.stringify(TOOLS)), messages: [{ role: 'user', content: 'hi' }],
  };
  const before = JSON.stringify(body).length;
  tp.leanify(body, 'STANDING-HINT: use file_path');
  const after = JSON.stringify(body).length;
  assert.ok(after < before / 5, `${before} -> ${after}`);
  const sys = body.system[0].text;
  assert.match(sys, /Primary working directory: \/work\/proj/);
  assert.match(sys, /STANDING-HINT: use file_path/);
  assert.doesNotMatch(sys, /You are Claude Code/);
  const write = body.tools.find((t) => t.name === 'Write');
  assert.match(write.description, /file_path/);
  assert.deepEqual(write.input_schema.required, ['file_path', 'content']); // the schema itself is untouched
  assert.ok(body.tools.find((t) => t.name === 'Read').input_schema.properties.file_path.description.length <= 142);
  assert.equal(body.messages[0].content, 'hi');
  assert.equal(tp.workingDir([{ text: 'x\nPrimary working directory: /work/proj\ny' }]), '/work/proj');
});

// ---------------------------------------------------------------------------------------------------- over real HTTP
function fakeOllama(handler) {
  const seen = [];
  const server = http.createServer((req, res) => {
    const parts = []; req.on('data', (c) => parts.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(parts).toString('utf8');
      let body = null; try { body = JSON.parse(raw); } catch { /* not json */ }
      seen.push({ url: req.url, method: req.method, body, headers: req.headers });
      handler(req, res, body, seen);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, seen, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => { server.closeAllConnections(); server.close(r); }) })));
}
function post(url, pathname, body, { onData } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(pathname, url); const payload = JSON.stringify(body);
    const req = http.request(u, { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } }, (res) => {
      const parts = []; res.on('data', (c) => { parts.push(c); if (onData) onData(c); });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(parts).toString('utf8') }));
    });
    req.on('error', reject); req.end(payload);
  });
}
const REQUEST = () => ({
  model: 'qwen2.5-coder:14b', max_tokens: 1000, stream: true, messages: [{ role: 'user', content: 'write a test' }],
  system: [{ type: 'text', text: `${'Long instructions. '.repeat(1500)}\n - Primary working directory: /work/proj\n - Platform: linux` }],
  tools: JSON.parse(JSON.stringify(TOOLS)),
});

test('proxy: end to end - Claude Code asks, the model prints a Write call as text, Claude Code gets a real tool call; the trace says so', async () => {
  const call = JSON.stringify({ name: 'Write', arguments: { path: 'output.txt', content: 'bz99' } });
  const up = await fakeOllama((req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(textStream([call.slice(0, 30)]).split('\n\n').slice(0, 3).join('\n\n') + '\n\n');
    setTimeout(() => { res.write(ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: call.slice(30) } }) + ev('content_block_stop', { index: 0 }) + ev('message_delta', { delta: { stop_reason: 'end_turn' } }) + ev('message_stop', {})); res.end(); }, 20);
  });
  const proxy = await tp.createProxy({ upstream: up.url, lean: true, repair: true, hint: 'MY-HINT' });
  try {
    const mark = proxy.trace.mark();
    const r = await post(proxy.url, '/v1/messages?beta=true', REQUEST());
    assert.equal(r.status, 200);
    assert.match(r.headers['content-type'], /event-stream/);
    const events = parseEvents([r.text]);
    const start = events.find((e) => e.type === 'content_block_start');
    assert.equal(start.content_block.type, 'tool_use');
    assert.deepEqual(JSON.parse(events.find((e) => e.type === 'content_block_delta').delta.partial_json), { file_path: '/work/proj/output.txt', content: 'bz99' });
    assert.equal(events.find((e) => e.type === 'message_delta').delta.stop_reason, 'tool_use');
    // what the model server received: the slim prompt with the standing instructions, the same tools
    const sent = up.seen[0];
    assert.equal(sent.url, '/v1/messages?beta=true');
    assert.ok(JSON.stringify(sent.body).length < 4000, 'slim request');
    assert.match(sent.body.system[0].text, /MY-HINT/);
    assert.equal(sent.body.tools.length, 5);
    assert.equal(sent.headers['accept-encoding'], 'identity');
    // the trace
    const lines = proxy.lines(mark).join('\n');
    assert.match(lines, /request 1: 5 tools, 1 messages, prompt [\d,]+ characters → [\d,]+ \(slim prompt\)/);
    assert.match(lines, /tool call Write\(\/work\/proj\/output\.txt\) \(written as text by the model\)/);
    assert.match(lines, /repaired: path → file_path/);
    assert.ok(proxy.fixes(mark).length >= 2);
  } finally { await proxy.close(); await up.close(); }
});

test('proxy: a plain answer is relayed as it comes, and with lean off the request is forwarded as sent', async () => {
  const up = await fakeOllama((req, res) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end(textStream(['It is ', 'bz42.'])); });
  const proxy = await tp.createProxy({ upstream: up.url, lean: false, repair: true });
  try {
    const body = REQUEST();
    const r = await post(proxy.url, '/v1/messages', body);
    const text = parseEvents([r.text]).filter((e) => e.type === 'content_block_delta').map((e) => e.delta.text).join('');
    assert.equal(text, 'It is bz42.');
    assert.deepEqual(up.seen[0].body, body);
    assert.match(proxy.lines(0).join('\n'), /reply after [\d.]+s: text, 11 characters: “It is bz42\.”/);
  } finally { await proxy.close(); await up.close(); }
});

test('proxy: a non-streaming request is repaired too, and other paths are passed through untouched', async () => {
  const up = await fakeOllama((req, res, body) => {
    if (req.url.startsWith('/v1/messages/count_tokens')) { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{"error":"nope"}'); return; }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: '{"name":"Bash","arguments":{"cmd":"ls"}}' }] }));
  });
  const proxy = await tp.createProxy({ upstream: up.url });
  try {
    const r = await post(proxy.url, '/v1/messages', { ...REQUEST(), stream: false });
    const msg = JSON.parse(r.text);
    assert.deepEqual(msg.content, [{ type: 'tool_use', id: msg.content[0].id, name: 'Bash', input: { command: 'ls' } }]);
    assert.equal(msg.stop_reason, 'tool_use');
    const c = await post(proxy.url, '/v1/messages/count_tokens', REQUEST());
    assert.equal(c.status, 404);
    assert.equal(c.text, '{"error":"nope"}');
    assert.doesNotMatch(proxy.lines(0).join('\n'), /request 2/); // not a chat request: not in the trace
  } finally { await proxy.close(); await up.close(); }
});

test('proxy: the model server is not there -> a clear error for Claude Code, and the trace says it', async () => {
  const up = await fakeOllama(() => {});
  const url = up.url; await up.close();
  const proxy = await tp.createProxy({ upstream: url });
  try {
    const r = await post(proxy.url, '/v1/messages', REQUEST());
    assert.equal(r.status, 502);
    assert.match(JSON.parse(r.text).error.message, /could not reach the model server/);
    assert.match(proxy.lines(0).join('\n'), /failed after [\d.]+s: connect ECONNREFUSED/);
  } finally { await proxy.close(); }
});

test('proxy: when Claude Code goes away the model server is told to stop (no model left generating)', async () => {
  let closed = false;
  const up = await fakeOllama((req, res) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(ev('message_start', { message: {} })); req.socket.on('close', () => { closed = true; }); res.on('close', () => { closed = true; }); });
  const proxy = await tp.createProxy({ upstream: up.url });
  try {
    const u = new URL('/v1/messages', proxy.url); const payload = JSON.stringify(REQUEST());
    const req = http.request(u, { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } });
    req.on('error', () => {});
    const got = new Promise((r) => req.on('response', (res) => { res.on('data', () => r()); res.on('error', () => {}); }));
    req.end(payload);
    await got; req.destroy();
    for (let i = 0; i < 50 && !closed; i++) await new Promise((r) => setTimeout(r, 20));
    assert.equal(closed, true);
    assert.match(proxy.lines(0).join('\n'), /Claude Code closed the connection/);
  } finally { await proxy.close(); await up.close(); }
});

test('proxy live state follows a tool call being built (for the stall message)', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const up = await fakeOllama(async (req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(ev('content_block_start', { index: 0, content_block: { type: 'tool_use', id: 't', name: 'Write', input: {} } }) + ev('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: '{"file_path": "/a", "content": "import ' } }));
    await gate;
    res.end(ev('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: 'os"}' } }) + ev('content_block_stop', { index: 0 }));
  });
  const proxy = await tp.createProxy({ upstream: up.url });
  try {
    const p = post(proxy.url, '/v1/messages', REQUEST());
    for (let i = 0; i < 50 && proxy.live().chars === 0; i++) await new Promise((r) => setTimeout(r, 20));
    assert.equal(proxy.live().kind, 'tool');
    assert.ok(proxy.live().chars > 20);
    assert.match(proxy.live().tail, /import/);
    assert.match(proxy.lines(0).join('\n'), /waiting for the model/);
    release(); await p;
  } finally { await proxy.close(); await up.close(); }
});

test('manager: the same settings share one proxy, other settings get their own, closeAll ends them', async () => {
  const up = await fakeOllama((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); });
  const m = tp.manager();
  try {
    const a = await m.ensure({ upstream: up.url, hint: 'h1' });
    const b = await m.ensure({ upstream: up.url, hint: 'h1' });
    const c = await m.ensure({ upstream: up.url, hint: 'h2' });
    assert.equal(a.url, b.url);
    assert.notEqual(a.url, c.url);
    assert.equal(m.byUrl(c.url), c);
    await m.closeAll();
    await assert.rejects(post(a.url, '/v1/messages', REQUEST()));
  } finally { await m.closeAll(); await up.close(); }
});

// ---------------------------------------------------------------------------------------------------- file names from the marked folders
test('fixInput with a resolver: the model\'s bare file name becomes the real path, and the fix is reported', () => {
  const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bz-resolve-'));
  fs.mkdirSync(path.join(root, 'edgy')); fs.mkdirSync(path.join(root, 'tests')); fs.mkdirSync(path.join(root, '.ide'));
  fs.writeFileSync(path.join(root, 'edgy', 'pipeline.py'), 'x = 1\n');
  const folderroles = require('../src/core/folderroles');
  const marks = { source: ['edgy'], tests: ['tests'] };
  const c = { ...ctx({ cwd: root }), resolve: (p, tool) => folderroles.resolvePath(root, marks, p, tool) };
  const read = tp.fixInput(toolOf('Read'), { path: 'pipeline.py' }, root, c);
  assert.equal(read.input.file_path, path.join(root, 'edgy', 'pipeline.py'));
  assert.ok(read.fixes.some((f) => /file_path pipeline\.py → edgy\/pipeline\.py \(found in a marked folder\)/.test(f)));
  const write = tp.fixInput(toolOf('Write'), { file_path: 'test_pipeline.py', content: 'x' }, root, c);
  assert.equal(write.input.file_path, path.join(root, 'tests', 'test_pipeline.py'));
  const calls = tp.extractCalls('{"name": "Read", "arguments": {"file_path": "pipeline.py"}}', c);
  assert.equal(calls[0].input.file_path, path.join(root, 'edgy', 'pipeline.py'));
  const none = tp.fixInput(toolOf('Read'), { file_path: 'pipeline.py' }, root, ctx());
  assert.equal(none.input.file_path, path.join(root, 'pipeline.py'), 'without marks: only made absolute');
  fs.rmSync(root, { recursive: true, force: true });
});

test('proxy: the marks are read from the working folder\'s .ide/config.json on every request (changed marks apply at once)', async () => {
  const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bz-live-'));
  fs.mkdirSync(path.join(root, 'edgy')); fs.mkdirSync(path.join(root, '.ide'));
  fs.writeFileSync(path.join(root, 'edgy', 'pipeline.py'), 'x = 1\n');
  const up = await fakeOllama((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'pipeline.py' } }] }));
  });
  const proxy = await tp.createProxy({ upstream: up.url, lean: false });
  const req = () => ({ ...REQUEST(), stream: false, system: [{ type: 'text', text: `x\n - Primary working directory: ${root}\n` }] });
  try {
    const before = JSON.parse((await post(proxy.url, '/v1/messages', req())).text);
    assert.equal(before.content[0].input.file_path, path.join(root, 'pipeline.py'), 'no marks yet');
    fs.writeFileSync(path.join(root, '.ide', 'config.json'), JSON.stringify({ folders: { source: ['edgy'] } }));
    const after = JSON.parse((await post(proxy.url, '/v1/messages', req())).text);
    assert.equal(after.content[0].input.file_path, path.join(root, 'edgy', 'pipeline.py'));
    assert.match(proxy.lines(0).join('\n'), /repaired: Read: file_path pipeline\.py → edgy\/pipeline\.py/);
  } finally { await proxy.close(); await up.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('the slim prompt tells the model to do the work and ask only when it cannot continue', () => {
  assert.match(tp.LEAN_BASE, /Do the work yourself with your tools/);
  assert.match(tp.LEAN_BASE, /ask a question only when you cannot continue/);
});
