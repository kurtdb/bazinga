'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const M = require('../src/core/mcpserver');
const agentprep = require('../src/core/agentprep');
const agentmemory = require('../src/core/agentmemory');

async function setup(handlers) {
  const mcp = new M.BazingaMcp({ handlers });
  const base = await mcp.start(); const token = M.newToken(); mcp.bind(token, 5);
  const client = new Client({ name: 't', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp/${token}`)));
  return { mcp, base, token, client };
}
const json = (r) => JSON.parse(r.content[0].text);

test('an MCP client sees the three tools and gets the answers of the handlers (with the caller identified)', async () => {
  const calls = [];
  const { mcp, client } = await setup({
    listRuns: async (c) => { calls.push(['list', c]); return [{ id: 'r1', name: 'backend', state: 'running' }]; },
    runStatus: async (c, id) => (id === 'r1' ? { id, state: 'running', files: 3 } : { error: `No run ${id}` }),
    startRun: async (c, a) => ({ id: 'r2', started: a.task }),
  });
  const tools = (await client.listTools()).tools.map((t) => t.name).sort();
  assert.deepStrictEqual(tools, ['list_runs', 'recall', 'remember', 'run_status', 'start_run']);
  assert.deepStrictEqual(json(await client.callTool({ name: 'list_runs', arguments: {} })), [{ id: 'r1', name: 'backend', state: 'running' }]);
  assert.deepStrictEqual(calls, [['list', 5]]);
  assert.strictEqual(json(await client.callTool({ name: 'run_status', arguments: { id: 'r1' } })).files, 3);
  const missing = await client.callTool({ name: 'run_status', arguments: { id: 'zz' } });
  assert.strictEqual(missing.isError, true); assert.match(missing.content[0].text, /No run zz/);
  assert.strictEqual(json(await client.callTool({ name: 'start_run', arguments: { task: 'write the tests for X' } })).started, 'write the tests for X');
  await client.close(); mcp.close();
});

test('start_run: a task that is too short is refused by the schema; one agent may ask for at most five runs; handler errors become tool errors', async () => {
  let n = 0;
  const { mcp, client } = await setup({ listRuns: async () => [], runStatus: async () => ({}), startRun: async () => { n++; if (n === 2) throw new Error('declined by the user'); return { id: `r${n}` }; } });
  const short = await client.callTool({ name: 'start_run', arguments: { task: 'x' } }).catch((e) => ({ isError: true, content: [{ text: String(e.message) }] }));
  assert.strictEqual(short.isError, true); assert.strictEqual(n, 0);
  const results = [];
  for (let i = 0; i < 7; i++) results.push(await client.callTool({ name: 'start_run', arguments: { task: `task number ${i}` } }));
  assert.strictEqual(n, M.MAX_STARTS);
  assert.strictEqual(results[1].isError, true); assert.match(results[1].content[0].text, /declined by the user/);
  assert.strictEqual(results[5].isError, true); assert.match(results[5].content[0].text, /ask the user/);
  await client.close(); mcp.close();
});

test('recall/remember: a client can save a fact through the handlers and look it up again; empty text is a tool error, not a throw', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-'));
  const file = agentmemory.fileFor(dir, '/proj/a');
  const { mcp, client } = await setup({
    recall: async (caller, args) => ({ results: agentmemory.recall(agentmemory.readAll(file), args) }),
    remember: async (caller, { text, files }) => (agentmemory.append(file, { text, files }) ? { ok: true } : { error: 'Nothing to remember (text was empty).' }),
  });
  assert.deepStrictEqual(json(await client.callTool({ name: 'remember', arguments: { text: 'retry swallows ECONNRESET', files: ['src/core/toolproxy.js'] } })), { ok: true });
  const found = json(await client.callTool({ name: 'recall', arguments: { query: 'retry' } }));
  assert.strictEqual(found.results.length, 1);
  assert.strictEqual(found.results[0].text, 'retry swallows ECONNRESET');
  assert.strictEqual(json(await client.callTool({ name: 'recall', arguments: { query: 'nope' } })).results.length, 0);
  const schemaRejected = await client.callTool({ name: 'remember', arguments: { text: 'x' } }).catch((e) => ({ isError: true, content: [{ text: String(e.message) }] }));
  assert.strictEqual(schemaRejected.isError, true); // below the 3-char minimum
  await client.close(); mcp.close(); fs.rmSync(dir, { recursive: true, force: true });
});

test('access: unknown agent, wrong host, browser origin, GET and bad JSON are refused', async () => {
  const { mcp, base, token, client } = await setup({ listRuns: async () => [] });
  const url = `${base}/mcp/${token}`;
  const post = (u, headers = {}, body = '{}') => fetch(u, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers }, body });
  assert.strictEqual((await post(`${base}/mcp/${M.newToken()}`)).status, 401);
  assert.strictEqual((await post(`${base}/mcp/nothex`)).status, 404);
  assert.strictEqual((await post(url, { origin: 'https://evil.example' })).status, 403);
  assert.strictEqual((await fetch(url)).status, 405);
  assert.strictEqual((await post(url, {}, '{nope')).status, 400);
  mcp.unbind(5);
  assert.strictEqual((await post(url)).status, 401, 'an agent that has exited is gone');
  await client.close().catch(() => {}); mcp.close();
});

test('the config file for Claude Code and the command injection', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-'));
  const file = M.writeConfig(dir, 'http://127.0.0.1:1234', 'a'.repeat(24));
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { mcpServers: { bazinga: { type: 'http', url: `http://127.0.0.1:1234/mcp/${'a'.repeat(24)}` } } });
  assert.strictEqual(M.injectConfig('claude --x', '/f.json'), 'claude --x --mcp-config "/f.json"');
  assert.strictEqual(M.injectConfig('claude --mcp-config mine.json', '/f.json'), 'claude --mcp-config mine.json');
  assert.strictEqual(M.injectConfig('aider', '/f.json'), 'aider');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('prepare adds the MCP config to a cloud Claude command only, and only when asked', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-'));
  const mcp = new M.BazingaMcp({ handlers: {} });
  const opts = { root: dir, hintDir: path.join(dir, 'h'), config: {}, mcp: { server: mcp, dir: path.join(dir, 'm') } };
  const out = await agentprep.prepare({ name: 'C', command: 'claude' }, opts);
  assert.match(out.command, /--mcp-config ".*\.json"$/); assert.ok(out.mcp.token);
  assert.strictEqual((await agentprep.prepare({ name: 'C', command: 'claude' }, { ...opts, mcp: null })).mcp, undefined);
  assert.strictEqual((await agentprep.prepare({ name: 'A', command: 'aider' }, opts)).mcp, undefined);
  mcp.close(); fs.rmSync(dir, { recursive: true, force: true });
});

test('prepare folds a project\'s remembered facts into the hint file when memory is given, and leaves them out otherwise', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-'));
  const memDir = path.join(dir, 'agent-memory');
  agentmemory.append(agentmemory.fileFor(memDir, dir), { text: 'the retry logic swallows ECONNRESET', files: ['src/core/toolproxy.js'] });
  const base = { name: 'C', command: 'claude' };
  const withMemory = await agentprep.prepare(base, { root: dir, hintDir: path.join(dir, 'h'), config: {}, memory: { dir: memDir } });
  assert.match(fs.readFileSync(withMemory.hintFile, 'utf8'), /the retry logic swallows ECONNRESET/);
  const withoutMemory = await agentprep.prepare(base, { root: dir, hintDir: path.join(dir, 'h'), config: {}, memory: null });
  assert.ok(!withoutMemory.hintFile || !fs.readFileSync(withoutMemory.hintFile, 'utf8').includes('ECONNRESET'));
  const noEntries = await agentprep.prepare(base, { root: path.join(dir, 'other'), hintDir: path.join(dir, 'h'), config: {}, memory: { dir: memDir } });
  assert.ok(!noEntries.hintFile || !fs.readFileSync(noEntries.hintFile, 'utf8').includes('Things agents have already learned'));
  fs.rmSync(dir, { recursive: true, force: true });
});
