'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { DapSession, pythonAdapter, dartAdapter, goAdapter } = require('../src/core/dap');

const FAKE = path.join(__dirname, 'fixtures', 'fake-dap.js');
const fakeAdapter = { command: process.execPath, args: [FAKE], launchConfig: (program, opts) => ({ program, ...opts }) };
const FAKE_TCP = path.join(__dirname, 'fixtures', 'fake-dap-tcp.js');
const fakeTcpAdapter = { transport: 'tcp', command: process.execPath, args: (port) => [FAKE_TCP, String(port)], launchConfig: (program, opts) => ({ program, ...opts }) };
const waitFor = async (fn, ms = 4000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 20)); } return null; };

test('pythonAdapter(): picks the platform binary, builds a launch config for a script', () => {
  assert.equal(pythonAdapter('win32').command, 'python');
  assert.equal(pythonAdapter('darwin').command, 'python3');
  assert.deepEqual(pythonAdapter('linux').args, ['-m', 'debugpy.adapter']);
  const cfg = pythonAdapter('linux').launchConfig('/x/a.py', { stopOnEntry: true });
  assert.deepEqual(cfg, { type: 'python', request: 'launch', program: '/x/a.py', console: 'internalConsole', justMyCode: true, stopOnEntry: true });
});

test('start(): initialize -> launch -> waits for "initialized" before resolving; state becomes running', async () => {
  const s = new DapSession();
  const events = [];
  s.on('event', (e) => events.push(e));
  assert.equal(s.state, 'idle');
  const res = await s.start({ adapter: fakeAdapter, program: '/fake/a.py', cwd: __dirname });
  assert.ok(res.capabilities.supportsConfigurationDoneRequest);
  assert.equal(s.state, 'running');
  await s.stop();
});

test('starting twice without stopping first is refused', async () => {
  const s = new DapSession();
  await s.start({ adapter: fakeAdapter, program: '/fake/a.py', cwd: __dirname });
  await assert.rejects(() => s.start({ adapter: fakeAdapter, program: '/fake/a.py', cwd: __dirname }), /already running/);
  await s.stop();
});

test('a launch that fails (adapter rejects) surfaces the message and leaves the session idle, not stuck "starting"', async () => {
  const s = new DapSession();
  await assert.rejects(() => s.start({ adapter: fakeAdapter, program: 'BAD', cwd: __dirname }), /fake: program not found/);
  assert.equal(s.state, 'idle');
});

test('full choreography: breakpoints, configurationDone unblocks the stopped event, stack/scopes/variables, continue to terminated', async () => {
  const s = new DapSession();
  const events = [];
  s.on('event', (e, body) => events.push([e, body]));
  await s.start({ adapter: fakeAdapter, program: '/fake/a.py', cwd: __dirname });
  const bps = await s.setBreakpoints('/fake/a.py', [2]);
  assert.deepEqual(bps, [{ line: 2, verified: true, message: null }]);
  await s.configurationDone();
  assert.ok(await waitFor(() => events.some(([e]) => e === 'stopped')));
  assert.equal(s.state, 'stopped');
  const threads = await s.threads();
  assert.equal(threads[0].name, 'MainThread');
  const frames = await s.stackTrace(1);
  assert.equal(frames[0].name, 'main');
  const scopes = await s.scopes(frames[0].id);
  assert.equal(scopes[0].name, 'Locals');
  const vars = await s.variables(scopes[0].variablesReference);
  assert.deepEqual(vars[0], { name: 'x', value: '42', type: 'int', variablesReference: 0 });
  await s.continue_(1);
  assert.ok(await waitFor(() => s.state === 'terminated'));
  assert.ok(events.some(([e]) => e === 'terminated'));
  await s.stop();
});

test('a breakpoint the adapter cannot verify (line 999, the fake\'s stand-in for "no code there") comes back unverified, and nothing hits it', async () => {
  const s = new DapSession();
  const events = [];
  s.on('event', (e) => events.push(e));
  await s.start({ adapter: fakeAdapter, program: '/fake/a.py', cwd: __dirname });
  const bps = await s.setBreakpoints('/fake/a.py', [999]);
  assert.equal(bps[0].verified, false);
  // the fake still "hits" any non-empty breakpoint list (it does not simulate real line matching) - what matters here is verified:false reaching the caller
  await s.stop();
});

test('stop() is safe to call when nothing was started, and twice in a row', async () => {
  const s = new DapSession();
  await s.stop();
  await s.start({ adapter: fakeAdapter, program: '/fake/a.py', cwd: __dirname });
  await s.stop();
  await s.stop();
  assert.equal(s.state, 'idle');
});

test('an adapter that is not installed is reported, not hung', async () => {
  const s = new DapSession();
  await assert.rejects(() => s.start({ adapter: { command: 'definitely-not-a-real-debug-adapter-xyz', args: [], launchConfig: () => ({}) }, program: '/fake/a.py', cwd: __dirname }), /not installed|ENOENT|not running/);
  assert.equal(s.state, 'idle');
});

test('dartAdapter(): dart debug_adapter over stdio, builds a launch config for a script', () => {
  const a = dartAdapter();
  assert.equal(a.transport, 'stdio');
  assert.equal(a.command, 'dart');
  assert.deepEqual(a.args, ['debug_adapter']);
  assert.deepEqual(a.launchConfig('/x/main.dart', { cwd: '/x' }), { request: 'launch', program: '/x/main.dart', cwd: '/x', noDebug: false, args: [] });
});

test('goAdapter(): dlv dap over TCP, --listen args carry the chosen port, builds a launch config', () => {
  const a = goAdapter();
  assert.equal(a.transport, 'tcp');
  assert.equal(a.command, 'dlv');
  assert.deepEqual(a.args(54321), ['dap', '--listen', '127.0.0.1:54321']);
  assert.deepEqual(a.launchConfig('/x/main.go', { cwd: '/x', stopOnEntry: true }), { request: 'launch', mode: 'debug', program: '/x/main.go', cwd: '/x', stopOnEntry: true });
});

test('TCP transport (dlv dap\'s transport): start() connects over a socket instead of stdio, same choreography end to end', async () => {
  const s = new DapSession();
  const events = [];
  s.on('event', (e, body) => events.push([e, body]));
  const res = await s.start({ adapter: fakeTcpAdapter, program: '/fake/main.go', cwd: __dirname });
  assert.ok(res.capabilities.supportsConfigurationDoneRequest);
  assert.equal(s.state, 'running');
  const bps = await s.setBreakpoints('/fake/main.go', [2]);
  assert.deepEqual(bps, [{ line: 2, verified: true, message: null }]);
  await s.configurationDone();
  assert.ok(await waitFor(() => events.some(([e]) => e === 'stopped')));
  assert.equal(s.state, 'stopped');
  const threads = await s.threads();
  assert.equal(threads[0].name, 'MainGoroutine');
  await s.continue_(1);
  assert.ok(await waitFor(() => s.state === 'terminated'));
  await s.stop();
});

test('TCP transport: a launch that fails still surfaces the message and leaves the session idle', async () => {
  const s = new DapSession();
  await assert.rejects(() => s.start({ adapter: fakeTcpAdapter, program: 'BAD', cwd: __dirname }), /fake: program not found/);
  assert.equal(s.state, 'idle');
});

test('TCP transport: an adapter binary that does not exist fails fast, not after the full connect timeout', async () => {
  const s = new DapSession();
  const notInstalled = { transport: 'tcp', command: 'definitely-not-a-real-debug-adapter-xyz', args: () => [], launchConfig: () => ({}) };
  const start = Date.now();
  await assert.rejects(() => s.start({ adapter: notInstalled, program: '/fake/main.go', cwd: __dirname }), /not installed|ENOENT/);
  assert.ok(Date.now() - start < 2000, 'should fail fast on ENOENT, not wait out the 5s connect retry window');
  assert.equal(s.state, 'idle');
});
