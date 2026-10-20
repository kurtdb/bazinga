'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const modeltest = require('../src/core/modeltest');

const fake = path.join(__dirname, 'fixtures', 'fakeclaude.js');
const cmd = (mode) => `node "${fake}" --mode=${mode}`;
const run = (mode, extra = {}) => modeltest.start({ command: cmd(mode), env: process.env, ...extra }).promise;
const step = (r, id) => r.steps.find((s) => s.id === id);

test('a model that sends, reads and writes passes every step', async () => {
  const r = await run('ok');
  assert.equal(r.ok, true);
  assert.deepEqual(r.steps.map((s) => [s.id, s.ok]), [['attach', true], ['write', true], ['read', true]]);
});

test('a model that prints the tool call instead of making it: no file, and it says why', async () => {
  const r = await run('text-call');
  assert.equal(r.ok, false);
  assert.equal(step(r, 'attach').ok, true);
  assert.equal(step(r, 'write').ok, false, 'checked on disk, not by what the model says');
  assert.match(r.advice.join(' '), /plain text instead of making it/);
});

test('invalid tool parameters are recognised', async () => {
  const r = await run('invalid');
  assert.equal(step(r, 'write').ok, false);
  assert.match(r.advice.join(' '), /wrong or missing arguments/);
});

test('a file with the wrong content: written, but not what it read', async () => {
  const r = await run('wrong');
  assert.equal(step(r, 'write').ok, false);
  assert.match(step(r, 'write').detail, /holds “hello” instead of the secret word/);
  assert.equal(step(r, 'read').ok, true, 'the Read tool did return the word');
});

test('your real result: the model reads the file, says it wrote it, but never called Write', async () => {
  const r = await run('claims');
  assert.equal(r.ok, false);
  assert.equal(step(r, 'attach').ok, true);
  assert.equal(step(r, 'read').ok, true, 'it knows the word, which only reading input.txt explains');
  assert.equal(step(r, 'write').ok, false);
  assert.match(step(r, 'write').detail, /never called a write tool/);
  assert.match(r.advice.join(' '), /claimed success without doing it/);
});

test('a write tool that fails shows its own error, and a write to another path is named', async () => {
  const denied = await run('denied');
  assert.match(step(denied, 'write').detail, /the tool failed: Permission to use Write has been denied/);
  assert.match(denied.output, /tool: Write\(.*output\.txt\) → FAILED/);
  const inv = await run('invalid');
  assert.match(step(inv, 'write').detail, /InputValidationError: file_path is required/);
  const el = await run('elsewhere');
  assert.equal(step(el, 'write').ok, false);
  assert.match(step(el, 'write').detail, /no output\.txt appeared in the test folder/);
  assert.match(el.advice.join(' '), /instead of the current folder/);
});

test('stream-json is parsed; warnings and non-JSON lines are kept as notes', () => {
  const p = modeltest.parseStream([
    '⚠ some warning',
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'a', name: 'Read', input: { file_path: '/x/input.txt' } }] } }),
    JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'a', is_error: false, content: [{ type: 'text', text: 'hi' }] }] } }),
    '{ not json',
    JSON.stringify({ type: 'result', result: 'done' }),
  ].join('\n'));
  assert.equal(p.final, 'done');
  assert.deepEqual(p.notes, ['⚠ some warning', '{ not json']);
  assert.deepEqual(modeltest.traceLines(p), ['Read(/x/input.txt) → ok']);
  assert.equal(p.calls[0].result.text, 'hi');
});

test('a model that cannot see the attached file fails the first step only', async () => {
  const r = await run('no-attach');
  assert.equal(step(r, 'attach').ok, false);
  assert.equal(step(r, 'write').ok, true);
});

test('a hanging model is stopped at the time limit, and cancelling stops the test', async () => {
  const r = await run('hang', { timeoutMs: 400 });
  assert.equal(r.ok, false);
  assert.match(step(r, 'attach').detail, /produced nothing in 1 seconds|produced nothing in 0|produced nothing in \d+ seconds/);
  const job = modeltest.start({ command: cmd('hang'), env: process.env, timeoutMs: 20000 });
  setTimeout(() => job.cancel(), 200);
  const c = await job.promise;
  assert.equal(c.cancelled, true);
});

test('diagnose: connection and model-name problems', () => {
  assert.match(modeltest.diagnose('Error: connect ECONNREFUSED 127.0.0.1:11434').join(' '), /could not reach the model server/);
  assert.match(modeltest.diagnose('404 model "x" not found').join(' '), /does not know this model name/);
  assert.deepEqual(modeltest.diagnose('all fine'), []);
});

test('the throw-away folder is removed afterwards', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bz-mt-'));
  await run('ok', { tmpBase: base });
  assert.deepEqual(fs.readdirSync(base), []);
});

test('progress is reported as each check starts and ends', async () => {
  const ev = [];
  await modeltest.start({ command: cmd('ok'), env: process.env, onProgress: (p) => ev.push(`${p.id}:${p.state}${p.state === 'done' ? (p.ok ? ':ok' : ':bad') : ''}`) }).promise;
  assert.deepEqual(ev, ['attach:running', 'attach:done:ok', 'write:running', 'write:done:ok', 'read:done:ok']);
  const ev2 = [];
  await modeltest.start({ command: cmd('text-call'), env: process.env, onProgress: (p) => ev2.push(`${p.id}:${p.state}${p.state === 'done' ? (p.ok ? ':ok' : ':bad') : ''}`) }).promise;
  assert.deepEqual(ev2, ['attach:running', 'attach:done:ok', 'write:running', 'write:done:bad', 'read:done:ok']);
});

test('when the time runs out, the test says what the model was doing (from the partial messages)', () => {
  const act = modeltest.createActivity();
  act.feed({ type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'thinking' } } });
  act.feed({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'Okay, so the user wants me to write a file. Let me think about that again and again' } } });
  assert.match(act.summary(), /thinking… \(\d+ characters so far\)/);
  assert.match(modeltest.stalledDetail(act, 600000), /After 10 minutes the model was still thinking.*again and again/);
  const tool = modeltest.createActivity();
  tool.feed({ type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'tool_use', name: 'Write' } } });
  tool.feed({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"file_path": "/x' } } });
  assert.match(modeltest.stalledDetail(tool, 300000), /still building a tool call/);
  assert.equal(modeltest.createActivity().summary().startsWith('waiting'), true);
  assert.match(modeltest.stalledDetail(null, 600000), /produced nothing in 10 minutes/);
});

test('a model that reads, then thinks forever: the write step names it', async () => {
  const r = await run('think-forever', { timeoutMs: 1500 });
  const w = step(r, 'write');
  assert.equal(w.ok, false);
  assert.match(w.detail, /It called Read and then stopped\. After 2 seconds the model was still thinking/);
  assert.match(r.advice.join(' '), /stuck “thinking”.*\/no_think/);
  assert.equal(step(r, 'read').ok, true, 'the Read result did come back');
});

test('a timed-out or cancelled test kills claude itself, not only the shell around it', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const marker = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bz-kill-')), 'alive');
  const script = path.join(__dirname, 'fixtures', 'heartbeat.js');
  const job = modeltest.start({ command: `node "${script}" "${marker}"`, env: process.env, timeoutMs: 800 });
  await job.promise;
  await new Promise((r) => setTimeout(r, 300));
  const a = fs.existsSync(marker) ? fs.statSync(marker).mtimeMs : 0;
  await new Promise((r) => setTimeout(r, 700));
  const b = fs.existsSync(marker) ? fs.statSync(marker).mtimeMs : 0;
  assert.ok(a > 0, 'the process did start');
  assert.equal(b, a, 'and it stopped writing once the test timed out');
});
