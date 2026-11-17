'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { execFileSync } = require('node:child_process');
const L = require('../src/core/llamacpp');
const { which } = require('../src/core/util');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'llamacpp-'));

function fakeHealthServer(statusCode = 200) {
  const srv = http.createServer((req, res) => {
    if (req.url === '/health') { res.statusCode = statusCode; res.end('{"status":"ok"}'); return; }
    res.statusCode = 404; res.end();
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port })));
}

function fakeChild() {
  const child = new EventEmitter();
  child.pid = 4321;
  child.exitCode = null; child.signalCode = null;
  child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
  child.kills = [];
  child.kill = (sig = 'SIGTERM') => { child.kills.push(sig); if (sig === 'SIGKILL') setImmediate(() => { child.exitCode = 0; child.emit('exit', 0); }); };
  return child;
}

test('pickAsset: the plain CPU build for this platform/arch, never a cuda/vulkan/etc build even if its name also matches', () => {
  const assets = [
    { name: 'llama-b1234-bin-macos-arm64.zip' },
    { name: 'llama-b1234-bin-macos-x64.zip' },
    { name: 'llama-b1234-bin-ubuntu-x64.zip' },
    { name: 'llama-b1234-bin-ubuntu-x64-vulkan.zip' },
    { name: 'llama-b1234-bin-win-cpu-x64.zip' },
  ];
  assert.equal(L.pickAsset(assets, 'darwin', 'arm64').name, 'llama-b1234-bin-macos-arm64.zip');
  assert.equal(L.pickAsset(assets, 'darwin', 'x64').name, 'llama-b1234-bin-macos-x64.zip');
  assert.equal(L.pickAsset(assets, 'linux', 'x64').name, 'llama-b1234-bin-ubuntu-x64.zip');
  assert.equal(L.pickAsset(assets, 'win32', 'x64').name, 'llama-b1234-bin-win-cpu-x64.zip');
  assert.equal(L.pickAsset(assets, 'freebsd', 'x64'), null, 'no mapping for an unsupported platform');
  assert.equal(L.pickAsset([], 'darwin', 'arm64'), null);
});

test('findBinaryIn: finds the exe nested inside a release archive\'s own folder, not just at the top level', () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'build', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'build', 'bin', 'llama-server'), 'fake binary');
  assert.equal(L._internal.findBinaryIn(dir, 'llama-server'), path.join(dir, 'build', 'bin', 'llama-server'));
  assert.equal(L._internal.findBinaryIn(dir, 'does-not-exist'), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('extractZip: really extracts via the OS tool (unzip/Expand-Archive), no bundled unzip dependency', { skip: !which('zip') && 'the zip command is not installed; cannot build a test fixture' }, async () => {
  const src = tmp(); const destRoot = tmp();
  fs.writeFileSync(path.join(src, 'llama-server'), 'fake binary contents');
  const zipPath = path.join(destRoot, 'release.zip');
  execFileSync('zip', ['-j', zipPath, path.join(src, 'llama-server')]);
  const destDir = path.join(destRoot, 'out');
  await L._internal.extractZip(zipPath, destDir);
  assert.equal(fs.readFileSync(path.join(destDir, 'llama-server'), 'utf8'), 'fake binary contents');
  fs.rmSync(src, { recursive: true, force: true }); fs.rmSync(destRoot, { recursive: true, force: true });
});

test('start() resolves once /health answers, status() reports it, stop() escalates to SIGKILL when the child ignores SIGTERM', async () => {
  const h = await fakeHealthServer(200);
  try {
    const child = fakeChild();
    const spawnFn = () => child;
    const res = await L.start({ binaryPath: 'x', modelPath: '/models/m.gguf', port: h.port, ctxSize: 4096, pollMs: 10, readyTimeoutMs: 2000 }, spawnFn);
    assert.equal(res.port, h.port);
    const st = await L.status();
    assert.deepEqual(st, { running: true, model: '/models/m.gguf', ctxSize: 4096, port: h.port, alias: '' });
    const t0 = Date.now();
    await L.stop();
    assert.ok(Date.now() - t0 < 3500, 'stop() must not hang on a child that ignores SIGTERM');
    assert.deepEqual(child.kills, ['SIGTERM', 'SIGKILL']);
    assert.deepEqual(await L.status(), { running: false });
  } finally { h.srv.close(); }
});

test('start(): alias is passed as --alias to the child and echoed back by status(), so the agent\'s --model matches what /v1/models reports', async () => {
  const h = await fakeHealthServer(200);
  try {
    const child = fakeChild();
    let argsSeen = null;
    const spawnFn = (bin, args) => { argsSeen = args; return child; };
    await L.start({ binaryPath: 'x', modelPath: '/models/m.gguf', port: h.port, alias: 'my-model', pollMs: 10, readyTimeoutMs: 2000 }, spawnFn);
    assert.deepEqual(argsSeen.slice(argsSeen.indexOf('--alias'), argsSeen.indexOf('--alias') + 2), ['--alias', 'my-model']);
    assert.equal((await L.status()).alias, 'my-model');
    await L.stop();
  } finally { h.srv.close(); }
});

test('start() rejects and cleans up when the child exits before ever answering /health', async () => {
  const child = fakeChild();
  const spawnFn = () => { setImmediate(() => { child.stderr.emit('data', Buffer.from('model file not found\n')); child.exitCode = 1; child.emit('exit', 1); }); return child; };
  await assert.rejects(
    L.start({ binaryPath: 'x', modelPath: '/nope.gguf', port: 9, pollMs: 10, readyTimeoutMs: 2000 }, spawnFn),
    /model file not found/,
  );
  assert.deepEqual(await L.status(), { running: false });
});

test('problems(): no binary beats not-running; a running server with no binary problem reports nothing', () => {
  assert.equal(L.problems({ running: false }, { hasBinary: false })[0].kind, 'no-binary');
  assert.equal(L.problems({ running: false }, { hasBinary: true })[0].kind, 'not-running');
  assert.deepEqual(L.problems({ running: true }, { hasBinary: true }), []);
});

test('notes(): flags a smaller-than-usual context, says nothing when it is at least the default', () => {
  assert.match(L.notes({ running: true, ctxSize: 4096 })[0], /4096/);
  assert.deepEqual(L.notes({ running: true, ctxSize: L.DEFAULT_CTX_SIZE }), []);
  assert.deepEqual(L.notes({ running: false }), []);
});

test('downloadBinary: a clear error when the latest release has no matching CPU build, nothing written to disk', async () => {
  const dir = tmp();
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ assets: [{ name: 'llama-bin-ubuntu-cuda-x64.zip', browser_download_url: 'x' }] }) });
  await assert.rejects(L.downloadBinary(dir, { fetchImpl }), /no CPU build/);
  assert.equal(fs.existsSync(path.join(dir, 'llamacpp')), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('downloadBinary: downloads, extracts, and installs the binary end to end', { skip: (!which('zip') || !which('unzip')) && 'zip/unzip not installed; cannot build a test fixture' }, async () => {
  const dir = tmp(); const work = tmp();
  fs.writeFileSync(path.join(work, 'llama-server'), 'fake binary contents');
  const zipPath = path.join(work, 'release.zip');
  execFileSync('zip', ['-j', zipPath, path.join(work, 'llama-server')]);
  const zipBuf = fs.readFileSync(zipPath);
  const assetName = `llama-bin-${process.platform === 'darwin' ? (process.arch === 'arm64' ? 'macos-arm64' : 'macos-x64') : 'ubuntu-x64'}.zip`;
  const fetchImpl = async (url) => {
    if (String(url).includes('api.github.com')) return { ok: true, status: 200, json: async () => ({ assets: [{ name: assetName, browser_download_url: 'https://example.invalid/release.zip', size: zipBuf.length }] }) };
    return { ok: true, status: 200, headers: { get: (k) => (k === 'content-length' ? String(zipBuf.length) : null) }, body: require('node:stream').Readable.from([zipBuf]) };
  };
  const dest = await L.downloadBinary(dir, { fetchImpl });
  assert.equal(fs.readFileSync(dest, 'utf8'), 'fake binary contents');
  assert.equal(L.resolveBinary(dir), dest, 'resolveBinary finds the copy downloadBinary just installed');
  fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(work, { recursive: true, force: true });
});

test('resolveBinary: null when nothing is on PATH and nothing has been downloaded yet', { skip: !!which('llama-server') && 'llama-server is actually on PATH on this machine' }, () => {
  const dir = tmp();
  assert.equal(L.resolveBinary(dir), null);
  fs.rmSync(dir, { recursive: true, force: true });
});
