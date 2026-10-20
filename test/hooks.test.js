'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { HookServer, settingsFor, writeSettings, injectSettings, newToken } = require('../src/core/hooks');
const agentprep = require('../src/core/agentprep');
const { PtyManager } = require('../src/main/pty');
const { IdleDetector } = require('../src/core/idle');

const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });

test('settings hold one http hook per event, pointing at the token', () => {
  const s = settingsFor('http://127.0.0.1:1234', 'a'.repeat(24));
  assert.deepStrictEqual(Object.keys(s.hooks).sort(), ['Notification', 'Stop', 'SubagentStart', 'SubagentStop', 'UserPromptSubmit']);
  assert.strictEqual(s.hooks.Stop[0].hooks[0].type, 'http');
  assert.strictEqual(s.hooks.Stop[0].hooks[0].url, `http://127.0.0.1:1234/hook/${'a'.repeat(24)}/stop`);
});

test('injectSettings only touches Claude Code commands without their own --settings', () => {
  assert.strictEqual(injectSettings('claude --tools Read', '/x/s.json'), 'claude --tools Read --settings "/x/s.json"');
  assert.strictEqual(injectSettings('claude "$BAZINGA_TASK"', 'C:\\a b\\s.json'), 'claude "$BAZINGA_TASK" --settings "C:\\a b\\s.json"');
  assert.strictEqual(injectSettings('aider --model x', '/x/s.json'), 'aider --model x');
  assert.strictEqual(injectSettings('claude --settings mine.json', '/x/s.json'), 'claude --settings mine.json');
});

test('the server reports events of a bound token and ignores everything else', async () => {
  const seen = []; const logs = [];
  const srv = new HookServer({ onEvent: (id, ev, p) => seen.push([id, ev, p]), log: (t) => logs.push(t) });
  const base = await srv.start();
  const token = newToken();
  srv.bind(token, 7);
  assert.strictEqual((await post(`${base}/hook/${token}/stop`, { hook_event_name: 'Stop', last_assistant_message: 'done' })).status, 200);
  assert.strictEqual((await post(`${base}/hook/${token}/notification`, { notification_type: 'permission_prompt', message: 'May I?' })).status, 200);
  assert.strictEqual((await post(`${base}/hook/${token}/start`, 'not json')).status, 200);
  assert.deepStrictEqual(seen.map((x) => [x[0], x[1]]), [[7, 'stop'], [7, 'notification'], [7, 'start']]);
  assert.strictEqual(seen[0][2].last_assistant_message, 'done');
  assert.strictEqual((await post(`${base}/hook/${newToken()}/stop`, {})).status, 200); // unknown token: accepted, not reported
  assert.strictEqual(seen.length, 3); assert.ok(logs.length === 1);
  assert.strictEqual((await post(`${base}/hook/${token}/explode`, {})).status, 404);
  assert.strictEqual((await fetch(`${base}/hook/${token}/stop`)).status, 404); // GET is not an event
  srv.unbind(7);
  await post(`${base}/hook/${token}/stop`, {});
  assert.strictEqual(seen.length, 3);
  srv.close();
});

test('subagent events are reported with their fields', async () => {
  const seen = [];
  const srv = new HookServer({ onEvent: (id, ev, p) => seen.push([id, ev, p]) });
  const base = await srv.start(); const t = newToken(); srv.bind(t, 3);
  assert.strictEqual((await post(`${base}/hook/${t}/substart`, { agent_id: 'a1', agent_type: 'Explore' })).status, 200);
  assert.strictEqual((await post(`${base}/hook/${t}/substop`, { agent_id: 'a1', agent_type: 'Explore', last_assistant_message: 'found it' })).status, 200);
  assert.deepStrictEqual(seen.map((x) => [x[0], x[1], x[2].agent_id]), [[3, 'substart', 'a1'], [3, 'substop', 'a1']]);
  assert.strictEqual(settingsFor('http://h', 'b'.repeat(24)).hooks.SubagentStop[0].hooks[0].url, `http://h/hook/${'b'.repeat(24)}/substop`);
  srv.close();
});

test('a handler that throws does not break the answer', async () => {
  const srv = new HookServer({ onEvent: () => { throw new Error('boom'); } });
  const base = await srv.start(); const t = newToken(); srv.bind(t, 1);
  assert.strictEqual((await post(`${base}/hook/${t}/stop`, {})).status, 200);
  srv.close();
});

test('prepare gives a Claude command a settings file and the proxy bypass; other agents are untouched', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hk-'));
  const server = new HookServer({});
  const out = await agentprep.prepare({ name: 'C', command: 'claude' }, { root: dir, hintDir: path.join(dir, 'h'), config: {}, hooks: { server, dir: path.join(dir, 'hs') } });
  assert.match(out.command, /^claude --settings ".*\.json"$/);
  assert.ok(out.hook && /^[0-9a-f]{24}$/.test(out.hook.token));
  const file = /--settings "(.*)"/.exec(out.command)[1];
  assert.match(JSON.parse(fs.readFileSync(file, 'utf8')).hooks.Stop[0].hooks[0].url, new RegExp(`/hook/${out.hook.token}/stop$`));
  assert.match(out.envForce.NO_PROXY, /127\.0\.0\.1/);
  const other = await agentprep.prepare({ name: 'A', command: 'aider' }, { root: dir, hintDir: path.join(dir, 'h'), config: {}, hooks: { server, dir: path.join(dir, 'hs') } });
  assert.strictEqual(other.command, 'aider'); assert.ok(!other.hook);
  const off = await agentprep.prepare({ name: 'C', command: 'claude' }, { root: dir, hintDir: path.join(dir, 'h'), config: {} });
  assert.strictEqual(off.command, 'claude');
  server.close(); fs.rmSync(dir, { recursive: true, force: true });
});

test('writeSettings removes day-old files and keeps the new one', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hk-'));
  const old = path.join(dir, 'old.json'); fs.writeFileSync(old, '{}'); const t = Date.now() / 1000 - 3 * 86400; fs.utimesSync(old, t, t);
  const f = writeSettings(dir, 'http://127.0.0.1:1', 'b'.repeat(24));
  assert.ok(!fs.existsSync(old)); assert.ok(fs.existsSync(f));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('hookIdle reports at once, resets the guess and makes it wait much longer', () => {
  const calls = [];
  const m = new PtyManager(() => {}, { onIdle: (id, ms, info) => calls.push([id, ms, info]), onPrompt: (id, p) => calls.push(['prompt', id, p]) });
  let t = 100; const idle = new IdleDetector({ now: () => t });
  idle.feed('x'.repeat(500)); t = 5100;
  m.sessions.set(3, { idle, prompt: null });
  assert.strictEqual(m.hookIdle(3), true);
  assert.strictEqual(calls[0][0], 3); assert.strictEqual(calls[0][2].hook, true);
  assert.strictEqual(idle.bytes, 0); assert.ok(idle.idleMs >= 60000);
  assert.strictEqual(m.hookIdle(99), false);
  assert.strictEqual(m.hookPrompt(3, 'Allow?'), true);
  assert.strictEqual(calls[1][0], 'prompt'); assert.strictEqual(calls[1][2].text, 'Allow?');
});
