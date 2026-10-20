'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DebugLog, clip } = require('../src/core/debuglog');
const { createProxy } = require('../src/core/toolproxy');

test('ring buffer keeps only the newest entries and numbers keep counting', () => {
  const d = new DebugLog({ max: 3 });
  for (let i = 1; i <= 5; i++) d.add('workflow', `m${i}`);
  assert.deepStrictEqual(d.all().map((e) => e.text), ['m3', 'm4', 'm5']);
  assert.strictEqual(d.all()[2].n, 5);
});
test('since returns only newer entries; clear empties but numbering goes on', () => {
  const d = new DebugLog();
  d.add('idle', 'a'); const b = d.add('idle', 'b'); d.add('idle', 'c');
  assert.deepStrictEqual(d.since(b.n).map((e) => e.text), ['c']);
  d.clear(); assert.strictEqual(d.all().length, 0);
  assert.strictEqual(d.add('idle', 'x').n, 4);
});
test('long and multi-line text is clipped to one line; unknown sources become app', () => {
  const d = new DebugLog();
  const e = d.add('nonsense', `line1\nline2 ${'x'.repeat(2000)}`);
  assert.strictEqual(e.source, 'app'); assert.ok(e.text.length <= 601); assert.ok(!e.text.includes('\n'));
  assert.strictEqual(clip('a  b\n c', 50), 'a b c');
});
test('text() can be limited to one source and has a clock prefix', () => {
  const d = new DebugLog({ now: () => new Date(2026, 0, 1, 9, 8, 7, 6).getTime() });
  d.add('workflow', 'one'); d.add('model', 'two');
  assert.strictEqual(d.text('model'), '09:08:07.006 [model] two');
  assert.strictEqual(d.text().split('\n').length, 2);
});
test('file output rotates and a broken file path never throws', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbg-'));
  const file = path.join(dir, 'debug.log');
  const d = new DebugLog({ file, maxFileBytes: 200 });
  for (let i = 0; i < 20; i++) d.add('agent', `line number ${i}`);
  assert.ok(fs.existsSync(file) && fs.existsSync(`${file}.1`));
  const bad = new DebugLog({ file: path.join(dir, 'nope', 'x', 'debug.log') });
  assert.doesNotThrow(() => bad.add('agent', 'still fine'));
  assert.strictEqual(bad.all().length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});
test('the proxy reports each finished request once through onLog', async () => {
  const http = require('node:http');
  const up = http.createServer((req, res) => { req.resume(); req.on('end', () => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'x', content: [{ type: 'text', text: 'hi' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } })); }); });
  await new Promise((r) => up.listen(0, '127.0.0.1', r));
  const lines = [];
  const p = await createProxy({ upstream: `http://127.0.0.1:${up.address().port}`, onLog: (l) => lines.push(l) });
  const r = await fetch(`${p.url}/v1/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'x', max_tokens: 5, messages: [{ role: 'user', content: 'hello' }] }) });
  await r.text();
  await new Promise((r2) => setTimeout(r2, 100));
  assert.strictEqual(lines.length, 1);
  assert.ok(lines[0].length > 0);
  await (p.close ? p.close() : Promise.resolve()); up.close();
});
