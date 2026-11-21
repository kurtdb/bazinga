'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Agentd } = require('../src/daemon/agentd');
const { connect, probe } = require('../src/daemon/agentdClient');
const { tmpdir, sockFor } = require('./helpers');

let ptyAvailable = true;
try { require('node-pty'); } catch { ptyAvailable = false; }
const skip = !ptyAvailable || process.platform === 'win32';
const wait = async (cond, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (cond()) return true; await new Promise((r) => setTimeout(r, 25)); } return false; };

test('probe: nothing listening yet returns null, not a thrown error', async () => {
  const res = await probe(sockFor('nope'), { timeoutMs: 300 });
  assert.equal(res, null);
});

test('probe: a live daemon answers with its pid, and hands back a connection to reuse', async (t) => {
  const d = new Agentd();
  const sockPath = sockFor('a');
  const server = await d.listen(sockPath);
  t.after(() => { d.shutdown(); server.close(); });
  const res = await probe(sockPath);
  assert.ok(res);
  assert.equal(res.info.pid, process.pid);
  const list = await res.client.request('list');
  assert.deepEqual(list, []);
  res.client.close();
});

test('request: a timeout rejects instead of hanging forever', async (t) => {
  const net = require('node:net');
  const sockPath = sockFor('silent');
  const silent = net.createServer((sock) => sock.on('data', () => {})); // accepts the connection, never answers
  await new Promise((resolve) => silent.listen(sockPath, resolve));
  t.after(() => silent.close());
  const client = await connect(sockPath);
  t.after(() => client.close());
  await assert.rejects(client.request('ping', {}, { timeoutMs: 50 }), /timed out/);
});

test('close: pending requests reject and the "close" event fires, instead of hanging callers forever', async (t) => {
  // a silent (never-answering) server, so the pending request below can only settle via close - never by a real reply racing in first
  const net = require('node:net');
  const sockPath = sockFor('silent2');
  const silent = net.createServer((sock) => sock.on('data', () => {}));
  await new Promise((resolve) => silent.listen(sockPath, resolve));
  t.after(() => silent.close());
  const client = await connect(sockPath);
  let closed = false;
  client.on('close', () => { closed = true; });
  const pending = client.request('ping', {}, { timeoutMs: 20000 });
  client.close();
  await assert.rejects(pending, /closed/);
  assert.equal(closed, true);
});

test('create + subscribe over the real client, mirroring what src/main/pty.js\'s createRemote does', { skip }, async (t) => {
  const d = new Agentd();
  const sockPath = sockFor('a');
  const server = await d.listen(sockPath);
  t.after(() => { d.shutdown(); server.close(); });
  const client = await connect(sockPath);
  t.after(() => client.close());

  const created = await client.request('create', { runId: 'r1', cwd: tmpdir(), config: { shell: '/bin/sh', shellArgs: [] } });
  assert.equal(created.reattached, false);
  const events = [];
  client.on('event', (e) => events.push(e));
  await client.request('subscribe', { runId: 'r1' });
  await client.request('write', { runId: 'r1', data: 'echo CLIENT_MARK\r' });
  assert.ok(await wait(() => events.some((e) => e.kind === 'data' && /CLIENT_MARK/.test(e.data))));
  await client.request('kill', { runId: 'r1' });
  const list = await client.request('list');
  assert.deepEqual(list, []);
});
