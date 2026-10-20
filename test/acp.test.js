'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const A = require('../src/core/acp');

const EXAMPLE = path.join(__dirname, '..', 'node_modules', '@agentclientprotocol', 'sdk', 'dist', 'examples', 'agent.js');
const FS_AGENT = path.join(__dirname, 'fixtures', 'acp-fs-agent.mjs');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'acp-'));

function run(agentFile, { cwd, policy = 'ask', onEvent } = {}) {
  const events = [];
  const r = new A.AcpRun({ command: process.execPath, args: [agentFile], cwd, policy, onEvent: (e) => { events.push(e); if (onEvent) onEvent(e, r); } });
  return { r, events };
}
const until = (events, type, ms = 20000) => new Promise((resolve, reject) => {
  const t0 = Date.now();
  (function poll() { const e = events.find((x) => x.type === type); if (e) return resolve(e); if (Date.now() - t0 > ms) return reject(new Error(`no ${type} event; got ${events.map((x) => x.type).join(',')}`)); setTimeout(poll, 25); }());
});

test('splitCommand keeps quoted arguments together', () => {
  assert.deepStrictEqual(A.splitCommand('pool acp'), ['pool', 'acp']);
  assert.deepStrictEqual(A.splitCommand('node "my agent.js" --mode \'a b\' ""'), ['node', 'my agent.js', '--mode', 'a b', '']);
  assert.deepStrictEqual(A.splitCommand('  '), []);
});

test('pickOption: policy chooses allow or reject, never a made-up id; ask means the user decides', () => {
  const o = [{ optionId: 'a', kind: 'allow_always' }, { optionId: 'b', kind: 'allow_once' }, { optionId: 'c', kind: 'reject_once' }];
  assert.strictEqual(A.pickOption(o, 'allow'), 'b'); assert.strictEqual(A.pickOption(o, 'reject'), 'c'); assert.strictEqual(A.pickOption(o, 'ask'), null);
  assert.strictEqual(A.pickOption([{ optionId: 'a', kind: 'allow_always' }], 'allow'), 'a');
  assert.strictEqual(A.pickOption([{ optionId: 'a', kind: 'allow_once' }], 'reject'), null);
});

test('insideRoot: inside the folder yes; outside, via .., through a symbolic link, or into .git no', () => {
  const root = tmp(); const outside = tmp();
  fs.mkdirSync(path.join(root, 'a')); fs.writeFileSync(path.join(root, 'a', 'f.txt'), 'x'); fs.mkdirSync(path.join(root, '.git')); fs.symlinkSync(outside, path.join(root, 'link'));
  assert.ok(A.insideRoot(root, path.join(root, 'a', 'f.txt')));
  assert.ok(A.insideRoot(root, 'a/f.txt'), 'relative paths are relative to the run');
  assert.ok(A.insideRoot(root, path.join(root, 'new', 'deep', 'x.txt'), { forWrite: true }));
  assert.strictEqual(A.insideRoot(root, path.join(root, '..', 'x')), null);
  assert.strictEqual(A.insideRoot(root, '/etc/hostname'), null);
  assert.strictEqual(A.insideRoot(root, path.join(root, 'link', 'x.txt'), { forWrite: true }), null);
  assert.strictEqual(A.insideRoot(root, path.join(root, '.git', 'config'), { forWrite: true }), null);
  fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true });
});

test('a full turn with an ACP agent: text, tool calls, a permission question that waits for the user, then the end of the turn', async () => {
  const cwd = tmp();
  const { r, events } = run(EXAMPLE, { cwd, policy: 'ask' });
  const ready = await r.open();
  assert.ok(ready.sessionId);
  r.send('please do the thing');
  const q = await until(events, 'permission');
  assert.match(q.title, /critical configuration file/); assert.deepStrictEqual(q.options.map((o) => o.kind), ['allow_once', 'reject_once']);
  assert.ok(!events.some((e) => e.type === 'stop'), 'the turn waits for the answer');
  assert.strictEqual(r.answer(q.id, 'allow'), true); assert.strictEqual(r.answer(q.id, 'allow'), false, 'answered once');
  const stop = await until(events, 'stop');
  assert.strictEqual(stop.reason, 'end_turn');
  const kinds = events.map((e) => e.type);
  assert.ok(kinds.includes('text') && kinds.includes('tool') && kinds.includes('tool_update'));
  assert.ok(events.some((e) => e.type === 'text' && /successfully updated/.test(e.text)), 'the agent saw the approval');
  r.close(); fs.rmSync(cwd, { recursive: true, force: true });
});

test('policy allow answers by itself, policy reject too (the agent sees the refusal)', async () => {
  for (const [policy, expected] of [['allow', /successfully updated/], ['reject', /skip|declin|reject|not|cancel/i]]) {
    const cwd = tmp();
    const { r, events } = run(EXAMPLE, { cwd, policy });
    await r.open(); r.send('go');
    await until(events, 'stop');
    assert.ok(!events.some((e) => e.type === 'permission'), `${policy}: the user is not asked`);
    if (policy === 'allow') assert.ok(events.some((e) => e.type === 'text' && expected.test(e.text)));
    else assert.ok(!events.some((e) => e.type === 'text' && /successfully updated/.test(e.text)), 'a refused change is not reported as done');
    r.close(); fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('cancel ends the turn with the stop reason cancelled and cancels an open question', async () => {
  const cwd = tmp();
  const { r, events } = run(EXAMPLE, { cwd, policy: 'ask' });
  await r.open(); r.send('go');
  await until(events, 'permission');
  assert.strictEqual(await r.cancel(), true);
  const stop = await until(events, 'stop');
  assert.ok(['cancelled', 'end_turn'].includes(stop.reason), stop.reason);
  r.close(); fs.rmSync(cwd, { recursive: true, force: true });
});

test('files: the agent may read and write inside the run\'s folder, nothing outside it, nothing in .git', async () => {
  const cwd = tmp(); fs.mkdirSync(path.join(cwd, '.git'));
  const { r, events } = run(FS_AGENT, { cwd });
  // the agent uses its own working directory: start it in the run's folder
  const ready = await r.open();
  assert.strictEqual(ready.agent, 'fs-agent 0.1');
  r.send('go');
  const text = await until(events, 'text');
  const res = JSON.parse(text.text);
  assert.strictEqual(res.write, 'ok'); assert.strictEqual(fs.readFileSync(path.join(cwd, 'sub', 'out.txt'), 'utf8'), 'hello');
  assert.strictEqual(res.read, 'ok');
  for (const k of ['escapeWrite', 'gitWrite', 'escapeRead']) assert.match(res[k], /refused/, k);
  assert.ok(!fs.existsSync(path.join(cwd, '..', 'escape.txt')));
  await until(events, 'stop');
  r.close(); fs.rmSync(cwd, { recursive: true, force: true });
});

test('a command that does not exist is reported, not thrown into the app', async () => {
  const cwd = tmp();
  const { r, events } = run(FS_AGENT, { cwd });
  const bad = new A.AcpRun({ command: 'definitely-not-a-real-agent-xyz', cwd, onEvent: (e) => events.push(e) });
  await assert.rejects(bad.open());
  assert.ok(events.some((e) => e.type === 'error' && /Could not start/.test(e.message)));
  r.close(); fs.rmSync(cwd, { recursive: true, force: true });
});

test('an agent that exits at once is reported as an exit, and sending to a closed run is refused', async () => {
  const cwd = tmp();
  const events = [];
  const r = new A.AcpRun({ command: process.execPath, args: ['-e', 'process.exit(3)'], cwd, onEvent: (e) => events.push(e) });
  await assert.rejects(r.open());
  await until(events, 'exit');
  assert.strictEqual(r.send('hi'), false);
  fs.rmSync(cwd, { recursive: true, force: true });
});

test('wire format: a bare JSON-RPC agent (no SDK) can ask for permission and the answer reaches it', async () => {
  for (const [policy, expect] of [['allow', 'chosen y'], ['reject', 'chosen n']]) {
    const cwd = tmp();
    const { r, events } = run(path.join(__dirname, 'fixtures', 'acp-raw-agent.js'), { cwd, policy });
    await r.open(); r.send('go');
    await until(events, 'stop');
    assert.ok(events.some((e) => e.type === 'text' && e.text === expect), `${policy}: ${JSON.stringify(events.filter((e) => e.type === 'text'))}`);
    r.close(); fs.rmSync(cwd, { recursive: true, force: true });
  }
  const cwd = tmp();
  const { r, events } = run(path.join(__dirname, 'fixtures', 'acp-raw-agent.js'), { cwd, policy: 'ask' });
  await r.open(); r.send('go');
  const q = await until(events, 'permission');
  r.answer(q.id, 'n');
  await until(events, 'stop');
  assert.ok(events.some((e) => e.type === 'text' && e.text === 'chosen n'));
  r.close(); fs.rmSync(cwd, { recursive: true, force: true });
});
