'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { PtyManager } = require('../src/main/pty');
const { tmpdir } = require('./helpers');

let ptyAvailable = true;
try { require('node-pty'); } catch { ptyAvailable = false; }
const posix = process.platform !== 'win32';
const skip = !ptyAvailable || !posix;

const wait = async (cond, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (cond()) return true; await new Promise((r) => setTimeout(r, 25)); } return false; };
function manager(opts) {
  const events = [];
  const m = new PtyManager((ch, ...a) => events.push([ch, ...a]), opts);
  const text = (id) => events.filter((e) => e[0] === 'pty:data' && e[1] === id).map((e) => e[2]).join('');
  return { m, events, text };
}
const SH = { shell: '/bin/sh', shellArgs: [] };

test('defaultShell: configured shell wins, else the platform default', () => {
  assert.deepEqual(PtyManager.defaultShell({ shell: 'zsh', shellArgs: ['-f'] }), { shell: 'zsh', args: ['-f'] });
  assert.deepEqual(PtyManager.defaultShell({ shell: 'zsh' }), { shell: 'zsh', args: [] });
  const d = PtyManager.defaultShell({});
  if (process.platform === 'win32') assert.deepEqual(d, { shell: 'powershell.exe', args: ['-NoLogo'] });
  else assert.deepEqual(d.args, ['-l']);
});

test('a missing node-pty module is reported as a readable error, not a crash', () => {
  const orig = Module._load;
  Module._load = function (request, ...rest) { if (request === 'node-pty') throw new Error('boom: binary missing'); return orig.call(this, request, ...rest); };
  try {
    const { m } = manager();
    const res = m.create({ cwd: process.cwd() });
    assert.match(res.error, /Could not load node-pty: boom: binary missing/);
    assert.match(res.error, /npm install/);
  } finally { Module._load = orig; }
});

test('runs a command, streams its output in batches and reports the exit code', { skip }, async () => {
  const { m, events, text } = manager();
  const res = m.create({ cwd: tmpdir(), config: SH, initialInput: 'echo HELLO_$((20+22)); exit 3\r' });
  assert.ok(res.id > 0); assert.equal(res.shell, '/bin/sh');
  assert.ok(await wait(() => events.some((e) => e[0] === 'pty:exit')), 'exit event');
  assert.match(text(res.id), /HELLO_42/);
  const exit = events.find((e) => e[0] === 'pty:exit');
  assert.deepEqual(exit.slice(1), [res.id, 3]);
  assert.equal(m.sessions.size, 0, 'finished sessions are forgotten');
});

test('starts in the requested folder and passes extra environment variables (and forces TERM)', { skip }, async () => {
  const dir = tmpdir();
  const { m, text } = manager();
  const res = m.create({ cwd: dir, config: SH, env: { BAZINGA_X: 'v1', TERM: 'dumb' }, initialInput: 'pwd; echo X=$BAZINGA_X T=$TERM\r' });
  assert.ok(await wait(() => /T=xterm-256color/.test(text(res.id))));
  assert.ok(text(res.id).includes(dir));
  assert.match(text(res.id), /X=v1/);
  m.killAll();
});

test('write, resize and kill; unknown ids are ignored', { skip }, async () => {
  const { m, events, text } = manager();
  const res = m.create({ cwd: tmpdir(), config: SH, cols: 5, rows: 1 }); // tiny sizes are raised to a sane minimum
  m.write(res.id, 'echo TYPED_OK\r');
  assert.ok(await wait(() => /TYPED_OK/.test(text(res.id))));
  m.resize(res.id, 120, 40); m.resize(res.id, 0, 0); // zero is ignored
  m.write(9999, 'x'); m.resize(9999, 10, 10); m.kill(9999); // no throw
  m.kill(res.id);
  assert.equal(m.sessions.size, 0);
  assert.ok(await wait(() => events.some((e) => e[0] === 'pty:exit')), 'killed process reports its exit');
  m.kill(res.id); // twice is fine
});

test('killAll ends every terminal', { skip }, async () => {
  const { m } = manager();
  const a = m.create({ cwd: tmpdir(), config: SH }); const b = m.create({ cwd: tmpdir(), config: SH });
  assert.equal(m.sessions.size, 2); assert.notEqual(a.id, b.id);
  m.killAll();
  assert.equal(m.sessions.size, 0);
});

test('an unusable shell gives an error, not an exception', { skip }, () => {
  const { m } = manager();
  const res = m.create({ cwd: '/definitely/not/a/folder', config: SH });
  assert.ok(res.error || res.id, 'either a readable error or a session that exits');
  if (res.id) m.killAll();
});

test('watch: output followed by silence calls onIdle once with the busy time; typing resets it', { skip }, async () => {
  const idle = [];
  const { m } = manager({ onIdle: (id, ms) => idle.push([id, ms]) });
  const res = m.create({ cwd: tmpdir(), config: SH, watch: true, idleMs: 600 });
  m.write(res.id, `i=0; while [ $i -lt 60 ]; do echo "line $i padding padding padding padding"; i=$((i+1)); done\r`);
  assert.ok(await wait(() => idle.length === 1, 10000), 'idle reported');
  assert.equal(idle[0][0], res.id);
  assert.ok(idle[0][1] >= 0);
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(idle.length, 1, 'reported once per busy period, not repeatedly');
  m.killAll();
});

test('unwatched terminals never report idle and no polling timer is left behind', { skip }, async () => {
  const idle = [];
  const { m } = manager({ onIdle: (id) => idle.push(id) });
  const res = m.create({ cwd: tmpdir(), config: SH });
  m.write(res.id, 'echo hi\r');
  await new Promise((r) => setTimeout(r, 1500));
  assert.deepEqual(idle, []);
  assert.equal(m.idleTimer, null);
  m.killAll();
});

test('a watched terminal that asks for permission is reported, and the idle callback is told so the fix loop stays out', { skip }, async () => {
  const prompts = []; const idles = [];
  const { m } = manager({ onPrompt: (id, p) => prompts.push([id, p]), onIdle: (id, busy, info) => idles.push([id, busy, info]), promptQuietMs: 300 });
  const r = m.create({ cwd: tmpdir(), config: SH, watch: true, idleMs: 2000, initialInput: "printf 'working %.0s\\n' $(seq 1 80); printf 'Do you want to proceed? [y/N] '\n" });
  assert.ok(await wait(() => prompts.length === 1, 6000), 'prompt reported');
  assert.match(prompts[0][1].text, /proceed/);
  assert.ok(await wait(() => idles.length === 1, 8000), 'idle reported');
  assert.equal(idles[0][2].prompt, true, 'idle knows a question is pending');
  m.write(r.id, 'n\n'); // answering resets the watcher
  m.killAll();
});

test('regression: an idle terminal without a question is not flagged as a prompt', { skip }, async () => {
  const idles = []; const prompts = [];
  const { m } = manager({ onPrompt: (id) => prompts.push(id), onIdle: (id, busy, info) => idles.push(info), promptQuietMs: 300 });
  m.create({ cwd: tmpdir(), config: SH, watch: true, idleMs: 2000, initialInput: "printf 'build line %.0s\\n' $(seq 1 80); echo finished\n" });
  assert.ok(await wait(() => idles.length === 1, 8000));
  assert.equal(idles[0].prompt, false);
  assert.equal(prompts.length, 0);
  m.killAll();
});

test('regression: the terminal\'s own replies (focus in/out, cursor position) do not restart the idle count, typing does', () => {
  const { IdleDetector, isTerminalReply } = require('../src/core/idle');
  for (const d of ['\x1b[I', '\x1b[O', '\x1b[12;40R', '\x1b[?1;2c', '\x1b[<0;10;5M', '\x1b[I\x1b[O']) assert.equal(isTerminalReply(d), true, JSON.stringify(d));
  for (const d of ['a', '\r', '\x1b[A', 'hello\x1b[I', '\x1b[200~paste\x1b[201~', '', 'y\r']) assert.equal(isTerminalReply(d), false, JSON.stringify(d));
  // what happened: the agent worked, then the user clicked elsewhere in the IDE (focus-out is sent to the pty), and the agent was never seen as finished
  let t = 100;
  const det = new IdleDetector({ idleMs: 1000, minBytes: 100, now: () => t });
  det.feed('x'.repeat(500)); t = 600;
  const write = (d) => { if (!isTerminalReply(d)) det.input(); }; // what PtyManager.write does
  write('\x1b[O');
  t = 2000;
  assert.equal(det.poll(), true, 'idle is still reported after a focus change');
  det.feed('y'.repeat(500)); t = 2500; write('\r'); t = 4000;
  assert.equal(det.poll(), false, 'real typing still restarts the count');
});

test('PtyManager.write: a focus report does not reset the idle detector, typed text does', { skip }, async () => {
  const { m } = manager({ onIdle: () => {} });
  const dir = tmpdir();
  const res = m.create({ cwd: dir, config: SH, watch: true });
  const id = res.id;
  const s = m.sessions.get(id);
  s.idle.feed('x'.repeat(900));
  m.write(id, '\x1b[O');
  assert.equal(s.idle.bytes, 900);
  m.write(id, 'ls\r');
  assert.equal(s.idle.bytes, 0);
  m.killAll();
});

test('regression: the IDE is told the agent went idle even when the fix loop throws (a workflow waits for exactly that message and stalled)', async () => {
  const { afterIdle } = require('../src/core/idle');
  const mk = (fix, prompt = false) => { const sent = []; const told = []; return { sent, told, run: () => afterIdle({ prompt, fix, send: () => sent.push('idle'), notify: (t, b) => told.push([t, b]), label: 'Qwen' }) }; };
  const boom = mk(async () => { throw new Error('mvn not found'); });
  assert.equal((await boom.run()).action, 'error');
  assert.deepEqual(boom.sent, ['idle']);
  assert.match(boom.told[0][1], /mvn not found/);
  const off = mk(async () => ({ action: 'disabled' }));
  await off.run();
  assert.deepEqual(off.sent, ['idle']);
  assert.match(off.told[0][0], /Qwen is waiting for you/);
  const fixing = mk(async () => ({ action: 'fix' }));
  await fixing.run();
  assert.deepEqual([fixing.sent, fixing.told], [['idle'], []]);
  let called = false;
  const asking = mk(async () => { called = true; return {}; }, true);
  assert.equal((await asking.run()).action, 'prompt');
  assert.deepEqual(asking.sent, ['idle']);
  assert.equal(called, false, 'no fix prompt is pasted into a permission question');
});
