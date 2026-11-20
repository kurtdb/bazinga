'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const path = require('node:path');
const { Agentd, MAX_RING_BYTES } = require('../src/daemon/agentd');
const { tmpdir } = require('./helpers');

let ptyAvailable = true;
try { require('node-pty'); } catch { ptyAvailable = false; }
const skip = !ptyAvailable || process.platform === 'win32';

const wait = async (cond, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (cond()) return true; await new Promise((r) => setTimeout(r, 25)); } return false; };

/** A minimal line-framed client for exercising a live Agentd without going through agentdClient.js (kept separate so a bug in one doesn't mask a bug in the other). */
function rawClient(socketPath) {
  const sock = net.connect(socketPath);
  const events = [];
  const pending = new Map();
  let seq = 0;
  let buf = '';
  sock.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      if (msg.type === 'res') { const p = pending.get(msg.id); if (p) { pending.delete(msg.id); p(msg); } }
      else events.push(msg);
    }
  });
  const call = (op, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); sock.write(`${JSON.stringify({ op, id, ...params })}\n`); });
  const ready = new Promise((resolve) => sock.once('connect', resolve));
  return { sock, events, call, ready, close: () => sock.end() };
}

test('ping reports this process; list is empty with nothing running', async (t) => {
  const d = new Agentd();
  const sockPath = path.join(tmpdir(), 'a.sock');
  const server = await d.listen(sockPath);
  t.after(() => { d.shutdown(); server.close(); });
  const c = rawClient(sockPath);
  await c.ready;
  const pong = await c.call('ping');
  assert.equal(pong.ok, true);
  assert.equal(pong.result.pid, process.pid);
  const list = await c.call('list');
  assert.deepEqual(list.result, []);
  c.close();
});

test('create + write + subscribe: a run\'s output reaches a subscriber, and a late subscriber replays the ring buffer', { skip }, async (t) => {
  const d = new Agentd();
  const sockPath = path.join(tmpdir(), 'a.sock');
  const server = await d.listen(sockPath);
  t.after(() => { d.shutdown(); server.close(); });
  const c = rawClient(sockPath);
  await c.ready;

  const created = await c.call('create', { runId: 'run-1', cwd: tmpdir(), config: { shell: '/bin/sh', shellArgs: [] } });
  assert.equal(created.ok, true);
  assert.equal(created.result.reattached, false);

  const sub = await c.call('subscribe', { runId: 'run-1' });
  assert.equal(sub.result.alive, true);
  assert.equal(sub.result.replay, ''); // nothing written yet

  await c.call('write', { runId: 'run-1', data: 'echo HELLO_MARK\r' });
  assert.ok(await wait(() => c.events.some((e) => e.kind === 'data' && /HELLO_MARK/.test(e.data))), 'the echoed output reached the subscriber');

  // a second, later subscriber still sees it via ring-buffer replay, without having been subscribed when it happened
  const c2 = rawClient(sockPath);
  await c2.ready;
  const sub2 = await c2.call('subscribe', { runId: 'run-1' });
  assert.match(sub2.result.replay, /HELLO_MARK/);
  c2.close();
  c.close();
});

test('create is idempotent for a live run: a second create for the same runId reattaches instead of spawning twice', { skip }, async (t) => {
  const d = new Agentd();
  const sockPath = path.join(tmpdir(), 'a.sock');
  const server = await d.listen(sockPath);
  t.after(() => { d.shutdown(); server.close(); });
  const c = rawClient(sockPath);
  await c.ready;
  const first = await c.call('create', { runId: 'run-2', cwd: tmpdir(), config: { shell: '/bin/sh', shellArgs: [] } });
  assert.equal(first.result.reattached, false);
  const second = await c.call('create', { runId: 'run-2', cwd: tmpdir(), config: { shell: '/bin/sh', shellArgs: [] } });
  assert.equal(second.result.reattached, true);
  assert.equal(d.byRunId.size, 1, 'still exactly one pty for run-2, not two');
  c.close();
});

test('kill removes the run; a subsequent create starts fresh with no leftover ring buffer', { skip }, async (t) => {
  const d = new Agentd();
  const sockPath = path.join(tmpdir(), 'a.sock');
  const server = await d.listen(sockPath);
  t.after(() => { d.shutdown(); server.close(); });
  const c = rawClient(sockPath);
  await c.ready;
  await c.call('create', { runId: 'run-3', cwd: tmpdir(), config: { shell: '/bin/sh', shellArgs: [] } });
  await c.call('subscribe', { runId: 'run-3' });
  await c.call('write', { runId: 'run-3', data: 'echo BEFORE_KILL\r' });
  assert.ok(await wait(() => c.events.some((e) => /BEFORE_KILL/.test(e.data || ''))));
  const killed = await c.call('kill', { runId: 'run-3' });
  assert.equal(killed.ok, true);
  assert.equal(d.byRunId.has('run-3'), false);
  await c.call('create', { runId: 'run-3', cwd: tmpdir(), config: { shell: '/bin/sh', shellArgs: [] } });
  const sub = await c.call('subscribe', { runId: 'run-3' });
  assert.equal(sub.result.replay, '', 'the old ring buffer is gone once the run was explicitly killed and recreated');
  c.close();
});

test('exit: the ring buffer and a late subscribe survive the agent process exiting on its own', { skip }, async (t) => {
  const d = new Agentd();
  const sockPath = path.join(tmpdir(), 'a.sock');
  const server = await d.listen(sockPath);
  t.after(() => { d.shutdown(); server.close(); });
  const c = rawClient(sockPath);
  await c.ready;
  await c.call('create', { runId: 'run-4', cwd: tmpdir(), config: { shell: '/bin/sh', shellArgs: [] } });
  await c.call('subscribe', { runId: 'run-4' });
  await c.call('write', { runId: 'run-4', data: 'echo DONE_MARK; exit 0\r' });
  assert.ok(await wait(() => c.events.some((e) => e.kind === 'exit')), 'the exit event arrived');
  assert.equal(d.byRunId.has('run-4'), false, 'no longer tracked as alive');
  const sub = await c.call('subscribe', { runId: 'run-4' });
  assert.equal(sub.result.alive, false);
  assert.match(sub.result.replay, /DONE_MARK/, 'but a late reattach can still see the final output');
  c.close();
});

test('unknown op is a clean error, not a crash; a malformed line is dropped, not fatal', async (t) => {
  const d = new Agentd();
  const sockPath = path.join(tmpdir(), 'a.sock');
  const server = await d.listen(sockPath);
  t.after(() => { d.shutdown(); server.close(); });
  const c = rawClient(sockPath);
  await c.ready;
  const res = await c.call('bogus-op');
  assert.equal(res.ok, false);
  assert.match(res.error, /unknown op/);
  c.sock.write('not even json\n');
  const pong = await c.call('ping'); // the connection is still alive and answers normally afterward
  assert.equal(pong.ok, true);
  c.close();
});

test('the ring buffer is capped: it never grows past MAX_RING_BYTES', { skip }, async (t) => {
  const d = new Agentd();
  const sockPath = path.join(tmpdir(), 'a.sock');
  const server = await d.listen(sockPath);
  t.after(() => { d.shutdown(); server.close(); });
  const c = rawClient(sockPath);
  await c.ready;
  await c.call('create', { runId: 'run-5', cwd: tmpdir(), config: { shell: '/bin/sh', shellArgs: [] } });
  // feed a comfortably-over-the-cap amount of output and let the detached process pipe it through
  const line = 'x'.repeat(4000);
  for (let i = 0; i < 700; i++) await c.call('write', { runId: 'run-5', data: `echo ${line}\r` });
  assert.ok(await wait(() => (d.ring.get('run-5') || { bytes: 0 }).bytes > 0, 15000));
  await wait(() => true, 500); // let the batcher flush the last few writes
  assert.ok(d.ring.get('run-5').bytes <= MAX_RING_BYTES);
  c.close();
});
