'use strict';
// The whole chain, with fakes at both ends: a Claude-Code-like client -> Bazinga's proxy -> a model server whose model
// prints its tool calls as text (what qwen2.5-coder did on a real laptop). The model self-test judges the result on disk.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const tp = require('../src/core/toolproxy');
const modeltest = require('../src/core/modeltest');
const agentprep = require('../src/core/agentprep');

const client = path.join(__dirname, 'fixtures', 'fakeclaude-http.js');
const ev = (type, o) => `event: ${type}\ndata: ${JSON.stringify({ type, ...o })}\n\n`;
const textReply = (res, text, stop = 'end_turn') => {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.write(ev('message_start', { message: { id: 'm', role: 'assistant', content: [] } }) + ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }));
  for (let i = 0; i < text.length; i += 23) res.write(ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: text.slice(i, i + 23) } }));
  res.end(ev('content_block_stop', { index: 0 }) + ev('message_delta', { delta: { stop_reason: stop } }) + ev('message_stop', {}));
};
const toolReply = (res, name, input) => {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const json = JSON.stringify(input);
  res.write(ev('message_start', { message: { id: 'm', role: 'assistant', content: [] } }) + ev('content_block_start', { index: 0, content_block: { type: 'tool_use', id: 'toolu_x', name, input: {} } }));
  res.write(ev('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: json.slice(0, 9) } }) + ev('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: json.slice(9) } }));
  res.end(ev('content_block_stop', { index: 0 }) + ev('message_delta', { delta: { stop_reason: 'tool_use' } }) + ev('message_stop', {}));
};

/** A "model" that follows the conversation: how it formats its tool calls is the variable. */
function modelServer(style) {
  const seen = [];
  const server = http.createServer((req, res) => {
    const parts = []; req.on('data', (c) => parts.push(c));
    req.on('end', () => {
      if (!req.url.startsWith('/v1/messages')) { res.writeHead(404); res.end('{}'); return; }
      const body = JSON.parse(Buffer.concat(parts).toString('utf8'));
      seen.push(body);
      const last = body.messages[body.messages.length - 1];
      const flat = JSON.stringify(last.content);
      const visible = typeof last.content === 'string' ? last.content : last.content.map((c) => (typeof c.content === 'string' ? c.content : '')).join('\n'); // what the model can read: not the ids
      const word = (/bz[0-9a-f]{8}/.exec(visible) || [])[0];
      const call = (name, input) => {
        if (style === 'text') return textReply(res, `\`\`\`json\n${JSON.stringify({ name: name === 'Write' ? 'write_file' : 'read_file', arguments: input })}\n\`\`\``);
        if (style === 'real') return toolReply(res, name, input);
        if (style === 'real-bad') return toolReply(res, name, input);
        return textReply(res, 'I cannot do that.');
      };
      if (typeof last.content === 'string') {
        if (last.content.includes('@input.txt')) return textReply(res, word || 'unknown'); // the file came with the prompt
        return call('Read', style === 'text' || style === 'real-bad' ? { path: 'input.txt' } : { file_path: 'input.txt' }); // relative: a small model's habit
      }
      if (/tool_result/.test(flat) && /File created/.test(flat)) return textReply(res, 'Done, output.txt now contains the secret word.');
      if (/tool_result/.test(flat) && word) return call('Write', style === 'real-bad' ? { file: 'output.txt', text: word } : { path: 'output.txt', text: word, file_path: undefined });
      return textReply(res, 'Something went wrong: ' + short(flat));
    });
  });
  const short = (t) => String(t).slice(0, 200);
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ seen, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => { server.closeAllConnections(); server.close(r); }) })));
}

const step = (r, id) => r.steps.find((s) => s.id === id);
async function runChain(style, proxyOpts) {
  const model = await modelServer(style);
  const proxy = await tp.createProxy({ upstream: model.url, ...proxyOpts });
  try {
    const r = await modeltest.start({ command: `node "${client}"`, env: { ...process.env, ANTHROPIC_BASE_URL: proxy.url }, timeoutMs: 30000, proxy }).promise;
    return { r, proxy, model };
  } finally { await proxy.close(); await model.close(); }
}

test('a model that prints its tool calls as text: with the helper the file is really sent, read and written', async () => {
  const { r } = await runChain('text', { lean: true, repair: true });
  assert.equal(r.ok, true, JSON.stringify(r.steps));
  assert.equal(step(r, 'attach').ok, true);
  assert.equal(step(r, 'write').ok, true);
  assert.equal(step(r, 'read').ok, true);
  assert.match(step(r, 'write').detail, /Bazinga had to repair its tool call/);
  assert.ok(r.repairs.some((x) => /wrote the (Read|Write) call as text/.test(x)));
  assert.ok(r.repairs.some((x) => /path → file_path/.test(x)));
  assert.ok(r.repairs.some((x) => /file_path made absolute/.test(x)));
  const wire = r.wire.join('\n');
  assert.match(wire, /tool call Write\(.*output\.txt\) \(written as text by the model\)/);
  assert.match(wire, /slim prompt/);
});

test('the same model without the helper: nothing is written, and the test says the model printed it as text', async () => {
  const { r } = await runChain('text', { lean: false, repair: false });
  assert.equal(r.ok, false);
  assert.equal(step(r, 'write').ok, false);
  assert.match(r.advice.join(' '), /plain text instead of making it|looks like a tool call/);
  assert.deepEqual(r.repairs, []);
});

test('real tool calls with the wrong argument names or relative paths: repaired, so they succeed', async () => {
  const { r } = await runChain('real-bad', { lean: true, repair: true });
  assert.equal(r.ok, true, JSON.stringify(r.steps));
  assert.ok(r.repairs.some((x) => /Write: file → file_path/.test(x)), r.repairs.join(' | '));
  assert.ok(r.repairs.some((x) => /text → content/.test(x)));
  const off = await runChain('real-bad', { lean: false, repair: false });
  assert.equal(off.r.ok, false, 'without the repair Claude Code rejects these calls');
  assert.equal(step(off.r, 'write').ok, false);
  assert.match(off.r.advice.join(' '), /wrong or missing arguments|without file_path/);
});

test('a model that makes real tool calls passes, and the slim request keeps the working folder', async () => {
  const { r, model } = await runChain('real', { lean: true, repair: true });
  assert.equal(r.ok, true, JSON.stringify(r.steps));
  assert.ok(r.repairs.every((x) => /made absolute|path → file_path|text → content/.test(x)), r.repairs.join(' | ')); // the relative paths it still got wrong
  assert.ok(JSON.stringify(model.seen[0].system).length < 600);
  assert.match(model.seen[0].system[0].text, /Primary working directory: /);
});

test('agentprep: a local Claude agent is pointed at the helper (the address wins over the agent\'s own), others are not', async () => {
  const calls = [];
  const proxies = { ensure: async (o) => { calls.push(o); return { url: 'http://127.0.0.1:5555' }; } };
  const api = {
    localTarget: () => ({ baseUrl: 'http://localhost:11434', model: 'qwen3:14b', remote: false }), isClaudeCommand: (c) => /^claude/.test(c),
    status: async () => ({ running: true, installed: [{ name: 'qwen3:14b' }], loaded: [{ name: 'qwen3:14b', context: 32768 }] }), warm: async () => {}, sameModel: (a, b) => a === b,
    problems: () => [], notes: () => [], contextLabel: () => '32k', claudeEnv: () => ({ A: '1' }),
  };
  const agent = { name: 'x', command: 'claude --model qwen3:14b', hint: 'RULES', env: { ANTHROPIC_BASE_URL: 'http://localhost:11434' } };
  const fs = require('node:fs'); const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bz-prep-'));
  const prep = await agentprep.prepare(agent, { root: null, hintDir: dir, config: { ollama: {} }, api, proxies });
  assert.match(prep.envForce.ANTHROPIC_BASE_URL, /^http:\/\/127\.0\.0\.1:5555\/t\/[0-9a-f]{16}$/, 'each agent has its own address prefix');
  assert.deepEqual(Object.keys(prep.envForce), ['ANTHROPIC_BASE_URL']);
  assert.deepEqual({ ...prep.local.proxy, token: undefined }, { url: 'http://127.0.0.1:5555', lean: true, repair: true, token: undefined });
  assert.ok(prep.envForce.ANTHROPIC_BASE_URL.endsWith(prep.local.proxy.token));
  assert.equal(calls[0].upstream, 'http://localhost:11434');
  assert.match(calls[0].hint, /RULES/); // the standing instructions are what the slim prompt keeps
  const off = await agentprep.prepare(agent, { root: null, hintDir: dir, config: { ollama: { proxy: false } }, api, proxies });
  assert.equal(off.envForce, undefined);
  const plain = await agentprep.prepare({ ...agent, command: 'aider --model x' }, { root: null, hintDir: dir, config: { ollama: {} }, api, proxies });
  assert.equal(plain.envForce, undefined);
  const lean = await agentprep.prepare(agent, { root: null, hintDir: dir, config: { ollama: { lean: false, repair: false } }, api, proxies });
  assert.deepEqual({ ...lean.local.proxy, token: undefined }, { url: 'http://127.0.0.1:5555', lean: false, repair: false, token: undefined });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('regression: Claude Code on a local model gets only the file tools, no skills and no MCP servers (it started the "simplify" skill and four subagents of its own)', async () => {
  const fs = require('node:fs'); const os = require('node:os');
  const api = {
    localTarget: () => ({ baseUrl: 'http://localhost:11434', model: 'qwen3:14b', remote: false }), isClaudeCommand: (c) => /^claude/.test(c),
    status: async () => ({ running: true, installed: [{ name: 'qwen3:14b' }], loaded: [{ name: 'qwen3:14b', context: 32768 }] }), warm: async () => {}, sameModel: (a, b) => a === b,
    problems: () => [], notes: () => [], contextLabel: () => '32k', claudeEnv: () => ({}),
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bz-prep-'));
  const old = { name: 'x', command: 'claude --model qwen3:14b --disallowedTools WebSearch', taskCommand: 'claude --model qwen3:14b {task}' }; // an older saved button
  const p = await agentprep.prepare(old, { root: null, hintDir: dir, config: { ollama: {} }, api });
  for (const c of [p.command, p.taskCommand]) {
    assert.match(c, / --tools Read,Write,Edit,Bash,Glob,Grep/);
    assert.match(c, / --disable-slash-commands/);
    assert.match(c, / --strict-mcp-config/);
  }
  assert.match(p.command, /--disallowedTools WebSearch/, 'the button\'s own flags stay');
  assert.equal(p.local.restricted, true);
  // idempotent, and the user's own --tools wins
  assert.equal(agentprep.restrictClaude(agentprep.restrictClaude('claude --model m')), agentprep.restrictClaude('claude --model m'));
  assert.equal(agentprep.restrictClaude('claude --tools Read --model m'), 'claude --tools Read --model m --disable-slash-commands --strict-mcp-config');
  // off switch, and other agents are left alone
  const off = await agentprep.prepare(old, { root: null, hintDir: dir, config: { ollama: { restrictTools: false } }, api });
  assert.doesNotMatch(off.command, /--tools|--disable-slash-commands/);
  assert.equal(agentprep.restrictClaude('aider --model x'), 'aider --model x');
  fs.rmSync(dir, { recursive: true, force: true });
});
