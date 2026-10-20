'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const { spawnSync } = require('node:child_process');
const prc = require('../src/core/prcomment');
const hook = require('../src/core/githook');
const proxycli = require('../src/core/proxycli');
const { repo, write, sh } = require('./helpers');

const BIN = path.join(__dirname, '..', 'bin', 'bazinga.js');
const cli = (args, opts = {}) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', timeout: 60000, ...opts });

const res = (items) => ({ guard: { clean: !items.length, blockers: items.filter((i) => i.level === 'block').length, warnings: items.filter((i) => i.level !== 'block').length, items }, files: ['a', 'b'], base: 'origin/main' });

test('bazinga: help, version, unknown command', () => {
  assert.equal(cli([]).status, 2);
  assert.match(cli(['help']).stdout, /bazinga guard/);
  assert.match(cli(['version']).stdout, /^\d+\.\d+/);
  const bad = cli(['nope']);
  assert.equal(bad.status, 2); assert.match(bad.stderr, /Unknown command/);
});

test('bazinga guard works through the unified command and blocks with exit 1', () => {
  const root = repo({ 'a.txt': 'x\n' });
  sh(root, 'checkout', '-q', '-b', 'feature');
  write(root, '.env', 'S=1\n'); sh(root, 'add', '-A'); sh(root, 'commit', '-q', '-m', 'env');
  const r = cli(['guard', '--root', root, '--base', 'main']);
  assert.equal(r.status, 1); assert.match(r.stdout, /BLOCK/);
});

test('prcomment.markdown carries the marker, the verdict and the files', () => {
  const md = prc.markdown(res([{ id: 'protectedPaths', level: 'block', text: 'protected', files: ['.env'] }]));
  assert.ok(md.includes(prc.MARK)); assert.match(md, /1 blocker/); assert.match(md, /\.env/);
  assert.match(prc.markdown(res([])), /clean/);
});

test('prcomment.detect: Azure DevOps, GitHub, neither', () => {
  const az = prc.detect({ SYSTEM_PULLREQUEST_PULLREQUESTID: '7', SYSTEM_COLLECTIONURI: 'https://dev.azure.com/org', SYSTEM_TEAMPROJECT: 'My Proj', BUILD_REPOSITORY_ID: 'abc', SYSTEM_ACCESSTOKEN: 't' });
  assert.equal(az.kind, 'azure'); assert.equal(az.base, 'https://dev.azure.com/org/My%20Proj/_apis/git/repositories/abc/pullRequests/7');
  const gh = prc.detect({ GITHUB_REF: 'refs/pull/12/merge', GITHUB_REPOSITORY: 'o/r', GITHUB_TOKEN: 't' });
  assert.equal(gh.kind, 'github'); assert.match(gh.base, /repos\/o\/r\/issues\/12$/);
  assert.equal(prc.detect({}), null);
});

test('prcomment.post: no token or no pull request means a reason, never an error', async () => {
  assert.equal((await prc.post(res([]), { env: {} })).posted, false);
  const r = await prc.post(res([]), { env: { SYSTEM_PULLREQUEST_PULLREQUESTID: '1', SYSTEM_COLLECTIONURI: 'https://x/', SYSTEM_TEAMPROJECT: 'p', BUILD_REPOSITORY_ID: 'r' } });
  assert.equal(r.posted, false); assert.match(r.reason, /SYSTEM_ACCESSTOKEN/);
});

test('prcomment.post (Azure): adds a thread the first time, updates the same comment the second time', async () => {
  const env = { SYSTEM_PULLREQUEST_PULLREQUESTID: '7', SYSTEM_COLLECTIONURI: 'https://x/', SYSTEM_TEAMPROJECT: 'p', BUILD_REPOSITORY_ID: 'r', SYSTEM_ACCESSTOKEN: 't' };
  const calls = [];
  const first = await prc.post(res([{ id: 'a', level: 'block', text: 't' }]), { env, request: async (m, u, t, k, b) => { calls.push([m, u, b]); return m === 'GET' ? { value: [] } : {}; } });
  assert.deepEqual([first.posted, first.updated], [true, false]);
  assert.equal(calls[1][0], 'POST'); assert.equal(calls[1][2].status, 'active');
  calls.length = 0;
  const second = await prc.post(res([]), { env, request: async (m, u, t, k, b) => { calls.push([m, u, b]); return m === 'GET' ? { value: [{ id: 5, comments: [{ id: 1, content: `${prc.MARK} old` }] }] } : {}; } });
  assert.deepEqual([second.posted, second.updated], [true, true]);
  assert.ok(calls.some(([m, u]) => m === 'PATCH' && /threads\/5\/comments\/1/.test(u)));
  assert.ok(calls.some(([m, u, b]) => m === 'PATCH' && b && b.status === 'closed'), 'a clean result closes the thread');
});

test('prcomment.post (GitHub): updates the existing comment, a failing request is reported not thrown', async () => {
  const env = { GITHUB_REF: 'refs/pull/3/merge', GITHUB_REPOSITORY: 'o/r', GITHUB_TOKEN: 't' };
  const calls = [];
  const r = await prc.post(res([]), { env, request: async (m, u) => { calls.push([m, u]); return m === 'GET' ? [{ id: 9, body: `${prc.MARK} x` }] : {}; } });
  assert.equal(r.updated, true); assert.match(calls[1][1], /issues\/comments\/9$/);
  const bad = await prc.post(res([]), { env, request: async () => { throw new Error('HTTP 403'); } });
  assert.equal(bad.posted, false); assert.match(bad.reason, /403/);
});

test('git hook: installs, never overwrites a hook of yours, uninstalls, and blocks a bad push', async () => {
  const root = repo({ 'a.txt': 'x\n' });
  const r = await hook.install(root, { cliPath: BIN, base: 'main' });
  assert.deepEqual(r.installed, ['pre-push']);
  const file = path.join(r.dir, 'pre-push');
  assert.ok(fs.readFileSync(file, 'utf8').includes(hook.MARK));
  assert.deepEqual((await hook.uninstall(root)).removed, ['pre-push']);
  fs.writeFileSync(file, '#!/bin/sh\necho mine\n');
  const again = await hook.install(root, { cliPath: BIN, base: 'main' });
  assert.deepEqual(again.installed, []); assert.equal(again.skipped.length, 1);
  assert.match(fs.readFileSync(file, 'utf8'), /mine/);
  await assert.rejects(() => hook.install(root, { cliPath: BIN, base: 'a b;rm' }), /branch name/);
  fs.rmSync(file);
  await hook.install(root, { cliPath: BIN, base: 'main' });
  if (process.platform !== 'win32') {
    sh(root, 'checkout', '-q', '-b', 'feature'); write(root, '.env', 'S=1\n'); sh(root, 'add', '-A'); sh(root, 'commit', '-q', '-m', 'env');
    const out = spawnSync('sh', [file], { cwd: root, encoding: 'utf8' });
    assert.equal(out.status, 1); assert.match(out.stderr, /Bazinga guard blocked/);
    assert.equal(spawnSync('sh', [file], { cwd: root, encoding: 'utf8', env: { ...process.env, BAZINGA_SKIP: '1' } }).status, 0);
  }
});

test('proxycli: arguments are validated', () => {
  assert.match(proxycli.validate(proxycli.parseArgs([])), /--upstream/);
  assert.match(proxycli.validate(proxycli.parseArgs(['--upstream', 'ftp://x'])), /web address/);
  assert.match(proxycli.validate(proxycli.parseArgs(['--upstream', 'http://x', '--format', 'xml'])), /format/);
  assert.match(proxycli.validate(proxycli.parseArgs(['--upstream', 'http://x', '--port', 'abc'])), /port/);
  assert.match(proxycli.validate(proxycli.parseArgs(['--upstream', 'http://x', '--wat'])), /Unknown/);
  assert.equal(proxycli.validate(proxycli.parseArgs(['--upstream', 'http://localhost:11434', '--format', 'openai', '--no-lean'])), '');
});

test('proxycli.start: a proxy on the requested port forwards a request and repairs nothing it should not', async () => {
  const upstream = http.createServer((req, res) => {
    const parts = []; req.on('data', (c) => parts.push(c));
    req.on('end', () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'x', content: [{ type: 'text', text: 'hi' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } })); });
  });
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
  const p = await proxycli.start({ upstream: `http://127.0.0.1:${upstream.address().port}`, format: 'anthropic', port: 0, lean: true, repair: true, hint: '', quiet: true });
  try {
    const body = JSON.stringify({ model: 'x', max_tokens: 5, messages: [{ role: 'user', content: 'hi' }] });
    const out = await new Promise((resolve, reject) => {
      const rq = http.request(`${p.url}/v1/messages`, { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, (r) => { const c = []; r.on('data', (d) => c.push(d)); r.on('end', () => resolve(JSON.parse(Buffer.concat(c).toString()))); });
      rq.on('error', reject); rq.end(body);
    });
    assert.equal(out.content[0].text, 'hi');
  } finally { await p.close(); upstream.close(); }
});

test('proxycli.main: help exits 0, bad arguments exit 2 without starting anything', async () => {
  const lines = [];
  assert.equal(await proxycli.main(['--help'], { out: (l) => lines.push(l), err: (l) => lines.push(l) }), 0);
  assert.equal(await proxycli.main([], { out: (l) => lines.push(l), err: (l) => lines.push(l) }), 2);
  assert.ok(lines.some((l) => /--upstream/.test(l)));
});

test('pipeline examples never put pull request text straight into a shell script (script injection)', () => {
  const dir = path.join(__dirname, '..', 'examples');
  for (const f of fs.readdirSync(dir).filter((x) => /\.ya?ml$/.test(x))) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const line of text.split('\n')) {
      if (/^\s*#/.test(line)) continue;
      if (/\bnode\b.*\$\{\{\s*github\.(event|head_ref)/.test(line)) assert.fail(`${f}: ${line.trim()}`);
    }
  }
});

test('the exported standalone guard includes the pull request comment module', () => {
  const { exportGuard } = require('../scripts/export-guard');
  const out = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'exp-'));
  const files = exportGuard(out);
  assert.ok(files.includes('src/core/prcomment.js'));
  const r = spawnSync(process.execPath, [path.join(out, 'bin', 'ide-guard.js'), '--help'], { encoding: 'utf8' });
  assert.equal(r.status, 0); assert.match(r.stdout, /--comment/);
});

test('modelRecorder keeps shapes only: a request, a JSON reply and a streamed reply', () => {
  const { Capture, modelRecorder } = require('../src/core/capture');
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'cap-'));
  const c = new Capture({ dir, enabled: () => true });
  const rec = modelRecorder(c);
  rec('model-request', { model: 'qwen3:14b', messages: [{ role: 'user', content: 'my secret prompt' }] }, { format: 'openai' });
  rec('model-response', { status: 200, contentType: 'application/json', raw: JSON.stringify({ choices: [{ message: { content: 'secret answer' }, finish_reason: 'stop' }] }) }, {});
  rec('model-response', { status: 200, contentType: 'text/event-stream', raw: 'data: {"choices":[{"delta":{"content":"secret"}}]}\n\ndata: [DONE]\n\n' }, {});
  rec('model-response', { status: 500, contentType: 'text/plain', raw: 'secret failure' }, {});
  const all = fs.readFileSync(path.join(dir, 'model-request.jsonl'), 'utf8') + fs.readFileSync(path.join(dir, 'model-response.jsonl'), 'utf8');
  assert.ok(!/secret/.test(all), 'no readable text');
  assert.match(all, /qwen3:14b/); assert.match(all, /finish_reason/); assert.match(all, /DONE/);
});

test('proxy --capture writes shapes of what went through; --capture without a folder is refused', async () => {
  assert.match(proxycli.validate(proxycli.parseArgs(['--upstream', 'http://x', '--capture'])), /folder/);
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'pcap-'));
  const upstream = http.createServer((req, res) => { req.resume(); req.on('end', () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'x', content: [{ type: 'text', text: 'private reply' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } })); }); });
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
  const p = await proxycli.start({ upstream: `http://127.0.0.1:${upstream.address().port}`, format: 'anthropic', port: 0, lean: true, repair: true, hint: '', quiet: true, capture: dir });
  try {
    const body = JSON.stringify({ model: 'x', max_tokens: 5, messages: [{ role: 'user', content: 'private question' }] });
    await new Promise((resolve, reject) => { const rq = http.request(`${p.url}/v1/messages`, { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, (r) => { r.resume(); r.on('end', resolve); }); rq.on('error', reject); rq.end(body); });
    await new Promise((r) => setTimeout(r, 100));
  } finally { await p.close(); upstream.close(); }
  const text = fs.readdirSync(dir).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('');
  assert.match(text, /model-request/); assert.match(text, /model-response/); assert.ok(!/private/.test(text));
});

test('bazinga proxy: starts, prints its address, stops cleanly on Ctrl+C (exit 0)', { skip: process.platform === 'win32' }, async () => {
  const { spawn } = require('node:child_process');
  const child = spawn(process.execPath, [BIN, 'proxy', '--upstream', 'http://127.0.0.1:9', '--port', '0', '--quiet']);
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  await new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error(`no start line: ${out}`)), 10000); const i = setInterval(() => { if (/listening on http:\/\/127\.0\.0\.1:\d+/.test(out)) { clearTimeout(t); clearInterval(i); resolve(); } }, 50); });
  const code = new Promise((r) => child.on('close', r));
  child.kill('SIGINT');
  assert.equal(await code, 0);
  assert.match(out, /ANTHROPIC_BASE_URL=http:\/\/127\.0\.0\.1:\d+/);
});

test('githook.status: not installed, installed, a hook of your own, and a path inside an app package', async () => {
  const root = repo({ 'a.txt': 'x\n' });
  assert.deepEqual(await hook.status(root, BIN), { installed: false, foreign: false, possible: true });
  assert.equal((await hook.status(root, '/Applications/Bazinga.app/Contents/Resources/app.asar/bin/bazinga.js')).possible, false);
  await hook.install(root, { cliPath: BIN, base: 'main' });
  assert.equal((await hook.status(root, BIN)).installed, true);
  await hook.uninstall(root);
  const dir = await hook.install(root, { cliPath: BIN, base: 'main' }).then((r) => r.dir);
  fs.rmSync(path.join(dir, 'pre-push')); fs.writeFileSync(path.join(dir, 'pre-push'), '#!/bin/sh\n');
  const st = await hook.status(root, BIN);
  assert.deepEqual([st.installed, st.foreign, st.possible], [false, true, false]);
});
