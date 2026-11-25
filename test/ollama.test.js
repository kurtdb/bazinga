'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ollama = require('../src/core/ollama');
const agenthint = require('../src/core/agenthint');
const agentprep = require('../src/core/agentprep');

/** A fake Ollama: installed models, loaded models, and a log of the /api/generate warm-ups. */
function fake({ installed = ['qwen3:8b'], loaded = [], context = 32768 } = {}) {
  const calls = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/api/tags') return res.end(JSON.stringify({ models: installed.map((name) => ({ name, size: 5e9 })) }));
      if (req.url === '/api/ps') return res.end(JSON.stringify({ models: loaded.map((name) => ({ name, context_length: context, size: 9e9, size_vram: 9e9 })) }));
      if (req.url === '/api/generate') {
        const j = JSON.parse(body); calls.push(j);
        const at = loaded.indexOf(j.model);
        if (j.keep_alive === '0') { if (at >= 0) loaded.splice(at, 1); } else if (at < 0) loaded.push(j.model);
        return res.end(JSON.stringify({ done: true }));
      }
      res.statusCode = 404; return res.end('{}');
    });
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({ srv, calls, url: `http://127.0.0.1:${srv.address().port}` })));
}
const agentFor = (url, extra = {}) => ({ name: 'qwen3:8b', command: 'claude --model qwen3:8b', env: { ANTHROPIC_BASE_URL: url }, ...extra });

test('status lists installed and loaded models with their context; no server means running=false', async () => {
  const f = await fake({ loaded: ['qwen3:8b'], context: 4096 });
  try {
    const st = await ollama.status(f.url);
    assert.equal(st.running, true);
    assert.deepEqual(st.installed.map((m) => m.name), ['qwen3:8b']);
    assert.equal(st.loaded[0].context, 4096);
  } finally { f.srv.close(); }
  const down = await ollama.status('http://127.0.0.1:9', 500);
  assert.equal(down.running, false);
});

test('problems: not running, model missing, context too small; a good setup has none', () => {
  assert.equal(ollama.problems({ running: false, installed: [], loaded: [] }, 'qwen3:8b')[0].kind, 'not-running');
  assert.equal(ollama.problems({ running: true, installed: [{ name: 'llama3:8b' }], loaded: [] }, 'qwen3:8b')[0].kind, 'missing-model');
  const small = ollama.problems({ running: true, installed: [{ name: 'qwen3:8b' }], loaded: [{ name: 'qwen3:8b', context: 4096 }] }, 'qwen3:8b');
  assert.equal(small[0].kind, 'small-context');
  assert.match(small[0].text, /OLLAMA_CONTEXT_LENGTH=32768/);
  assert.deepEqual(ollama.problems({ running: true, installed: [{ name: 'qwen3:8b' }], loaded: [{ name: 'qwen3:8b', context: 32768 }] }, 'qwen3:8b'), []);
  assert.deepEqual(ollama.problems({ running: true, installed: [{ name: 'qwen3:latest' }], loaded: [] }, 'qwen3'), [], ':latest is the default tag');
});

test('localTarget recognises agents that talk to a model server, not the paid API', () => {
  assert.deepEqual(ollama.localTarget(agentFor('http://localhost:11434')), { baseUrl: 'http://localhost:11434', model: 'qwen3:8b', remote: false });
  assert.equal(ollama.localTarget(agentFor('https://api.anthropic.com')), null);
  assert.equal(ollama.localTarget({ command: 'claude' }), null);
  assert.equal(ollama.localTarget({ command: 'aider --model ollama_chat/qwen3:8b', env: { OLLAMA_API_BASE: 'http://127.0.0.1:11434' } }).model, 'qwen3:8b');
});

test('prepare: loads an unloaded model with the keep-alive, reports its context, and warns about a small one', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bz-prep-'));
  const f = await fake();
  try {
    const r = await agentprep.prepare(agentFor(f.url), { root: dir, hintDir: path.join(dir, 'h'), config: { ollama: { keepAlive: '20m' } } });
    assert.equal(f.calls.length, 1, 'the model was loaded once');
    assert.equal(f.calls[0].keep_alive, '20m');
    assert.equal(f.calls[0].model, 'qwen3:8b');
    assert.equal(r.local.contextLabel, '32k');
    assert.deepEqual(r.local.problems, []);
  } finally { f.srv.close(); }
  const g = await fake({ loaded: ['qwen3:8b'], context: 4096 });
  try {
    const r = await agentprep.prepare(agentFor(g.url), { root: dir, hintDir: path.join(dir, 'h') });
    assert.equal(g.calls.length, 0, 'an already loaded model is not loaded again');
    assert.equal(r.local.problems[0].kind, 'small-context');
    assert.equal(r.local.contextLabel, '4k');
  } finally { g.srv.close(); }
  const h = await fake({ installed: [] });
  try {
    const r = await agentprep.prepare(agentFor(h.url), { root: dir, hintDir: path.join(dir, 'h') });
    assert.equal(h.calls.length, 0, 'a missing model is not requested');
    assert.equal(r.local.problems[0].kind, 'missing-model');
  } finally { h.srv.close(); }
});

test('prepare: a server that is not running is reported, and the command still comes back', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bz-prep-'));
  const r = await agentprep.prepare(agentFor('http://127.0.0.1:9'), { root: dir, hintDir: path.join(dir, 'h') });
  assert.equal(r.local.running, false);
  assert.equal(r.local.problems[0].kind, 'not-running');
  assert.match(r.command, /^claude --append-system-prompt-file ".*" --model qwen3:8b --tools [A-Za-z,]+ --disable-slash-commands --strict-mcp-config$/, "qwen3 gets its /no_think instructions file even when the server is down");
});

test('standing instructions: agent hint + project .ide/agent-hint.md go into a file given to claude; other agents are untouched', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bz-hint-'));
  fs.mkdirSync(path.join(dir, '.ide'));
  fs.writeFileSync(path.join(dir, '.ide', 'agent-hint.md'), 'Tests live in src/test.\n');
  const r = await agentprep.prepare({ name: 'Claude', command: 'claude', taskCommand: 'claude {task}', hint: 'Be brief.' }, { root: dir, hintDir: path.join(dir, 'my hints') });
  const m = /^claude --append-system-prompt-file "([^"]+)"$/.exec(r.command);
  assert.ok(m, r.command);
  assert.equal(fs.readFileSync(m[1], 'utf8'), 'Be brief.\n\nTests live in src/test.\n');
  assert.match(r.taskCommand, /^claude --append-system-prompt-file ".*" \{task\}$/);
  const other = await agentprep.prepare({ name: 'Copilot', command: 'copilot', hint: 'x' }, { root: dir, hintDir: path.join(dir, 'h2') });
  assert.equal(other.command, 'copilot');
  const same = agenthint.withHintFile('claude --append-system-prompt "mine"', '/x.md');
  assert.equal(same, 'claude --append-system-prompt "mine"', 'a command with its own prompt text is left alone');
  assert.equal(agenthint.withHintFile('C:\\tools\\claude.exe --model a', 'C:\\h.md'), 'C:\\tools\\claude.exe --append-system-prompt-file "C:\\h.md" --model a');
  assert.equal(agenthint.withHintFile('claudette', '/x.md'), 'claudette');
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'bz-hint-'));
  const none = await agentprep.prepare({ name: 'Claude', command: 'claude' }, { root: empty, hintDir: path.join(empty, 'h3') });
  assert.equal(none.command, 'claude', 'no hint: nothing added, no file written');
});

test('a server on the network: recognised, and the problems say where to fix them', () => {
  const t = ollama.localTarget({ command: 'claude --model qwen3:14b', env: { ANTHROPIC_BASE_URL: 'http://gpu-box:11434' } });
  assert.deepEqual(t, { baseUrl: 'http://gpu-box:11434', model: 'qwen3:14b', remote: true });
  assert.equal(ollama.localTarget(agentFor('http://127.0.0.1:11434')).remote, false);
  assert.equal(ollama.localTarget({ command: 'claude', env: { ANTHROPIC_BASE_URL: 'https://api.anthropic.com' } }), null, 'the paid API is never treated as a model server');
  assert.equal(ollama.localTarget({ command: 'claude', env: { ANTHROPIC_BASE_URL: 'https://litellm.corp.example.com' } }), null, 'a public gateway on another port is not probed as Ollama');
  const down = ollama.problems({ running: false, installed: [], loaded: [] }, 'x', 'linux', t)[0];
  assert.match(down.text, /http:\/\/gpu-box:11434/);
  assert.match(down.text, /OLLAMA_HOST=0\.0\.0\.0/);
  const miss = ollama.problems({ running: true, installed: [], loaded: [] }, 'qwen3:14b', 'linux', t)[0];
  assert.match(miss.text, /on the server/);
  const small = ollama.problems({ running: true, installed: [{ name: 'qwen3:14b' }], loaded: [{ name: 'qwen3:14b', context: 4096 }] }, 'qwen3:14b', 'linux', t)[0];
  assert.match(small.text, /on that machine/);
});

test('prepare against a server: the remote flag reaches the renderer', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bz-prep-'));
  const fakeApi = { ...ollama, status: async () => ({ running: true, installed: [], loaded: [] }), warm: async () => ({}) };
  const r = await agentprep.prepare({ name: 'm', command: 'claude --model qwen3:14b', env: { ANTHROPIC_BASE_URL: 'http://gpu-box:11434' } }, { root: dir, hintDir: path.join(dir, 'h'), api: fakeApi });
  assert.equal(r.local.remote, true);
  assert.equal(r.local.problems[0].kind, 'missing-model');
});

test('Claude Code on a model server gets the settings that make it behave; the agent\'s own env is untouched; other agents get none', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bz-env-'));
  const f = await fake();
  try {
    const r = await agentprep.prepare(agentFor(f.url, { command: 'claude --model qwen3:8b' }), { root: dir, hintDir: path.join(dir, 'h') });
    const e = r.env;
    assert.equal(e.ANTHROPIC_DEFAULT_HAIKU_MODEL, 'qwen3:8b', 'background calls use the local model, not a haiku the server lacks');
    assert.equal(e.ANTHROPIC_DEFAULT_SONNET_MODEL, 'qwen3:8b');
    assert.equal(e.ANTHROPIC_DEFAULT_OPUS_MODEL, 'qwen3:8b');
    assert.equal(e.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, '1');
    assert.equal(e.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS, '1');
    assert.equal(e.CLAUDE_CODE_ATTRIBUTION_HEADER, '0', 'a stable prompt start lets the server reuse its cache');
    assert.equal(e.CLAUDE_CODE_MAX_CONTEXT_TOKENS, '32768', 'the real context window, so it compacts in time');
    assert.ok(Number(e.API_TIMEOUT_MS) >= 1200000);
    assert.equal(Object.keys(e).every((k) => /^[A-Z_]+$/.test(k) && typeof e[k] === 'string'), true);
    const aider = await agentprep.prepare({ name: 'a', command: 'aider --model ollama_chat/qwen3:8b', env: { OLLAMA_API_BASE: f.url } }, { root: dir, hintDir: path.join(dir, 'h') });
    assert.equal(aider.env, undefined, 'only Claude Code understands these variables');
    const cloud = await agentprep.prepare({ name: 'c', command: 'claude', env: { ANTHROPIC_BASE_URL: 'https://api.anthropic.com' } }, { root: dir, hintDir: path.join(dir, 'h') });
    assert.equal(cloud.env, undefined);
    assert.equal(cloud.local, null);
  } finally { f.srv.close(); }
  assert.equal(ollama.claudeEnv('x; rm -rf ~', 0).ANTHROPIC_DEFAULT_HAIKU_MODEL, undefined, 'an odd model name is not put in variables');
  assert.equal(ollama.claudeEnv('m', 65536).CLAUDE_CODE_MAX_CONTEXT_TOKENS, '65536');
  assert.equal(ollama.claudeEnv('m', 4096).CLAUDE_CODE_MAX_CONTEXT_TOKENS, '32768', 'never claims less than the minimum');
});

test('a laptop holds one model: others are unloaded first, except those of terminals still open and on a remote server', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bz-unload-'));
  const run = async (opts, loaded) => {
    const f = await fake({ installed: ['qwen3:8b', 'qwen3:14b', 'other:7b'], loaded });
    try {
      const r = await agentprep.prepare(agentFor(f.url), { root: dir, hintDir: path.join(dir, 'h'), ...opts });
      return { r, calls: f.calls.map((c) => `${c.model}:${c.keep_alive}`) };
    } finally { f.srv.close(); }
  };
  let x = await run({}, ['qwen3:14b', 'other:7b']);
  assert.deepEqual(x.calls, ['qwen3:14b:0', 'other:7b:0', 'qwen3:8b:15m']);
  assert.deepEqual(x.r.unloaded, ['qwen3:14b', 'other:7b']);
  x = await run({ inUse: ['qwen3:14b'] }, ['qwen3:14b', 'other:7b']);
  assert.deepEqual(x.calls, ['other:7b:0', 'qwen3:8b:15m'], 'the model of an open terminal stays');
  x = await run({ config: { ollama: { unloadOthers: false } } }, ['other:7b']);
  assert.deepEqual(x.calls, ['qwen3:8b:15m'], 'can be switched off');
  assert.match(x.r.local.notes.join(' '), /Also loaded in Ollama: other:7b/);
  // a model that is already loaded is left alone and nothing else is touched
  x = await run({}, ['qwen3:8b', 'other:7b']);
  assert.deepEqual(x.calls, []);
  // remote servers are shared: never unload there
  const remoteApi = { ...ollama, status: async () => ({ running: true, installed: [{ name: 'qwen3:8b' }], loaded: [{ name: 'other:7b', context: 32768 }] }) };
  const calls = [];
  remoteApi.warm = async (u, m, k) => { calls.push(`${m}:${k}`); };
  await agentprep.prepare({ name: 'm', command: 'claude --model qwen3:8b', env: { ANTHROPIC_BASE_URL: 'http://gpu-box:11434' } }, { root: dir, hintDir: path.join(dir, 'h'), api: remoteApi });
  assert.deepEqual(calls, ['qwen3:8b:15m']);
});

test('notes: partly on the CPU is called out', () => {
  const st = { running: true, installed: [], loaded: [{ name: 'qwen3:14b', size: 10e9, sizeVram: 6e9 }] };
  assert.match(ollama.notes(st, 'qwen3:14b').join(' '), /partly on the CPU \(60%/);
  assert.deepEqual(ollama.notes({ loaded: [{ name: 'a', size: 5e9, sizeVram: 5e9 }] }, 'a'), []);
});

test('qwen3 gets /no_think in its standing instructions (own switch for thinking); other models and cloud agents do not', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bz-nothink-'));
  const f = await fake({ installed: ['qwen3:14b', 'llama3.1:8b'], loaded: ['qwen3:14b', 'llama3.1:8b'] });
  try {
    const q = await agentprep.prepare({ name: 'q', command: 'claude --model qwen3:14b', hint: 'Be brief.', env: { ANTHROPIC_BASE_URL: f.url } }, { root: dir, hintDir: path.join(dir, 'h') });
    assert.equal(q.local.noThink, true);
    assert.equal(fs.readFileSync(/"([^"]+)"/.exec(q.command)[1], 'utf8'), 'Be brief.\n\n/no_think\n');
    const noHint = await agentprep.prepare({ name: 'q', command: 'claude --model qwen3:14b', env: { ANTHROPIC_BASE_URL: f.url } }, { root: dir, hintDir: path.join(dir, 'h') });
    assert.equal(fs.readFileSync(/"([^"]+)"/.exec(noHint.command)[1], 'utf8'), '/no_think\n', 'even without any other instructions');
    const off = await agentprep.prepare({ name: 'q', command: 'claude --model qwen3:14b', env: { ANTHROPIC_BASE_URL: f.url } }, { root: dir, hintDir: path.join(dir, 'h'), config: { ollama: { noThink: false } } });
    assert.equal(off.command, 'claude --model qwen3:14b --tools Read,Write,Edit,Bash,Glob,Grep --disable-slash-commands --strict-mcp-config', 'can be switched off');
    const l = await agentprep.prepare({ name: 'l', command: 'claude --model llama3.1:8b', env: { ANTHROPIC_BASE_URL: f.url } }, { root: dir, hintDir: path.join(dir, 'h') });
    assert.equal(l.local.noThink, false);
    assert.equal(l.command, 'claude --model llama3.1:8b --tools Read,Write,Edit,Bash,Glob,Grep --disable-slash-commands --strict-mcp-config');
  } finally { f.srv.close(); }
});

// Regression: "Context limit reached" right after reading one 407-line file. For a model name Claude Code does not know it
// reserves 32000 tokens for the reply out of the window; on a 32k window that leaves almost nothing.
test('the reply reserve of a local model is capped, so a 32k window is not eaten by it', () => {
  const env = (ctx, opts) => ollama.claudeEnv('qwen3:14b', ctx, opts);
  assert.equal(env(32768).CLAUDE_CODE_MAX_OUTPUT_TOKENS, '8192');
  assert.ok(Number(env(32768).CLAUDE_CODE_MAX_OUTPUT_TOKENS) <= 32768 / 4, 'at most a quarter of the window');
  assert.ok(Number(env(32768).CLAUDE_CODE_MAX_OUTPUT_TOKENS) < 32000, 'not Claude Code\'s default of 32000 for unknown models');
  assert.equal(env(0).CLAUDE_CODE_MAX_OUTPUT_TOKENS, '8192', 'unknown context: the 32k minimum is assumed');
  assert.equal(env(32768, { maxOutput: 4096 }).CLAUDE_CODE_MAX_OUTPUT_TOKENS, '4096', 'the setting wins');
  assert.equal(env(32768, { maxOutput: 30000 }).CLAUDE_CODE_MAX_OUTPUT_TOKENS, '8192', 'but never more than a quarter of the window');
  assert.equal(env(131072, { maxOutput: 20000 }).CLAUDE_CODE_MAX_OUTPUT_TOKENS, '20000', 'a bigger window allows a longer reply');
  assert.equal(env(32768, { maxOutput: 10 }).CLAUDE_CODE_MAX_OUTPUT_TOKENS, '1024');
  assert.equal(env(32768, { maxOutput: 'lots' }).CLAUDE_CODE_MAX_OUTPUT_TOKENS, '8192');
  assert.equal(ollama.maxOutputTokens(65536), 8192);
  assert.equal(env(32768).CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS, '8192', 'one file read may not fill the window (Claude Code\'s default is 25000 tokens)');
  assert.equal(env(65536).CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS, '16384');
});

test('agentprep hands the configured longest reply to the environment, and the test explains "Context limit reached"', async () => {
  const agentprep = require('../src/core/agentprep');
  const seen = [];
  const api = {
    localTarget: () => ({ baseUrl: 'http://localhost:11434', model: 'qwen3:14b', remote: false }), isClaudeCommand: (c) => /^claude/.test(c),
    status: async () => ({ running: true, installed: [{ name: 'qwen3:14b' }], loaded: [{ name: 'qwen3:14b', context: 32768 }] }), warm: async () => {}, sameModel: (a, b) => a === b,
    problems: () => [], notes: () => [], contextLabel: () => '32k', claudeEnv: (m, c, o) => { seen.push(o); return {}; },
  };
  await agentprep.prepare({ name: 'x', command: 'claude --model qwen3:14b' }, { config: { ollama: { maxOutputTokens: 4096 } }, api });
  await agentprep.prepare({ name: 'x', command: 'claude --model qwen3:14b' }, { config: { ollama: {} }, api });
  assert.deepEqual(seen, [{ maxOutput: 4096 }, { maxOutput: undefined }]);
  assert.equal(require('../src/core/config').DEFAULT_CONFIG.ollama.maxOutputTokens, 8192);
  const advice = require('../src/core/modeltest').diagnose('Context limit reached · /compact or /clear to continue').join(' ');
  assert.match(advice, /reserves room for the model's reply/);
});

test('complete(): fill-in-the-middle, prompt and suffix sent as-is, the raw continuation text comes back', async () => {
  const calls = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      calls.push(JSON.parse(body));
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ response: '    return a + b;\n' }));
    });
  });
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${srv.address().port}`;
    const res = await ollama.complete(url, { model: 'qwen2.5-coder', prompt: 'function add(a, b) {\n', suffix: '\n}\n' });
    assert.equal(res.text, '    return a + b;\n');
    assert.equal(calls[0].model, 'qwen2.5-coder');
    assert.equal(calls[0].prompt, 'function add(a, b) {\n');
    assert.equal(calls[0].suffix, '\n}\n');
    assert.equal(calls[0].stream, false);
  } finally { srv.close(); }
});

test('complete(): a non-string/missing response never throws, just gives empty text', async () => {
  const srv = http.createServer((_req, res) => { res.end(JSON.stringify({ done: true })); });
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${srv.address().port}`;
    const res = await ollama.complete(url, { model: 'x', prompt: 'a' });
    assert.equal(res.text, '');
  } finally { srv.close(); }
});

test('completeOpenAI(): fill-in-the-middle over a generic OpenAI-compatible /v1/completions, prompt and suffix sent as-is', async () => {
  const calls = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      calls.push({ path: req.url, body: JSON.parse(body) });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ choices: [{ text: '    return a + b;\n' }] }));
    });
  });
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${srv.address().port}`;
    const res = await ollama.completeOpenAI(url, { model: 'qwen2.5-coder', prompt: 'function add(a, b) {\n', suffix: '\n}\n' });
    assert.equal(res.text, '    return a + b;\n');
    assert.equal(calls[0].path, '/v1/completions');
    assert.equal(calls[0].body.model, 'qwen2.5-coder');
    assert.equal(calls[0].body.suffix, '\n}\n');
    assert.equal(calls[0].body.stream, false);
  } finally { srv.close(); }
});

test('completeOpenAI(): a baseUrl already ending in /v1 (a gateway mounted there) hits /completions, not /v1/v1/completions', async () => {
  const calls = [];
  const srv = http.createServer((req, res) => {
    calls.push(req.url);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ choices: [{ text: 'x' }] }));
  });
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  try {
    await ollama.completeOpenAI(`http://127.0.0.1:${srv.address().port}/v1`, { model: 'x', prompt: 'a' });
    assert.equal(calls[0], '/completions');
  } finally { srv.close(); }
});

test('completeOpenAI(): no choices in the response never throws, just gives empty text', async () => {
  const srv = http.createServer((_req, res) => { res.end(JSON.stringify({})); });
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${srv.address().port}`;
    const res = await ollama.completeOpenAI(url, { model: 'x', prompt: 'a' });
    assert.equal(res.text, '');
  } finally { srv.close(); }
});
