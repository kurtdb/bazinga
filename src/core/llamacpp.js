'use strict';
// Running llama.cpp's own server (llama-server) as a managed child process, the same way Ollama is talked to
// in ollama.js - except here Bazinga owns the process lifecycle too, since llama.cpp (unlike Ollama) has no
// daemon of its own to attach to.
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { which } = require('./util');
const { safeFetch } = require('./safeFetch');

const DEFAULT_PORT = 8712; // arbitrary, chosen away from Ollama's 11434 and common dev-server ports
const DEFAULT_CTX_SIZE = 32768;
const REPO = 'ggml-org/llama.cpp';

function binDir(userDataDir) {
  return path.join(userDataDir, 'llamacpp', 'bin');
}

/** The llama-server binary to run: PATH first (so a user's own GPU-accelerated build is preferred), else a copy Bazinga downloaded. */
function resolveBinary(userDataDir) {
  const onPath = which('llama-server');
  if (onPath) return onPath;
  const exe = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
  const candidate = path.join(binDir(userDataDir), exe);
  return fs.existsSync(candidate) ? candidate : null;
}

/** Which of a GitHub release's assets is the plain CPU build for this machine, or null if none matches. */
function pickAsset(assets, platform = process.platform, arch = process.arch) {
  // llama.cpp's CI publishes assets named like llama-<tag>-bin-macos-arm64.zip / -bin-ubuntu-x64.zip / -bin-win-cpu-x64.zip.
  // Backend-specific builds (cuda/vulkan/sycl/hip/musa) are excluded on purpose - v1 is PATH-first with a CPU-only
  // download fallback (a user who wants GPU accel builds their own and puts it on PATH).
  const excluded = /cuda|vulkan|sycl|hip|musa|rpc/i;
  const names = {
    darwin: arch === 'arm64' ? /macos-arm64/i : /macos-x64/i,
    linux: arch === 'arm64' ? /ubuntu-arm64|linux-arm64/i : /ubuntu-x64|ubuntu-latest|linux-x64/i,
    win32: /win-cpu-x64|win-x64/i,
  };
  const want = names[platform];
  if (!want) return null;
  return (assets || []).find((a) => want.test(a.name) && !excluded.test(a.name) && /\.zip$/i.test(a.name)) || null;
}

/** Extracts a .zip without adding an unzip dependency: the OS's own tool (unzip on macOS/Linux, Expand-Archive on Windows). */
function extractZip(zipPath, destDir, spawnFn = spawn) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(destDir, { recursive: true });
    const isWin = process.platform === 'win32';
    const child = isWin
      ? spawnFn('powershell', ['-NoProfile', '-Command', `Expand-Archive -Path "${zipPath}" -DestinationPath "${destDir}" -Force`], { windowsHide: true })
      : spawnFn('unzip', ['-o', zipPath, '-d', destDir]);
    let stderr = '';
    child.on('error', (err) => reject(new Error(`could not extract ${path.basename(zipPath)}: ${err.message}`)));
    if (child.stderr) child.stderr.on('data', (d) => { stderr += d; });
    if (child.stdout) child.stdout.on('data', () => {}); // drain - this is a short-lived helper process, but never leave a pipe unread
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`extracting ${path.basename(zipPath)} failed (exit ${code}): ${stderr.slice(0, 300)}`))));
  });
}

/** A llama-server binary anywhere inside dir (release zips nest it under a version-named folder). */
function findBinaryIn(dir, exe) {
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let entries; try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.name === exe) return p;
    }
  }
  return null;
}

/**
 * Downloads the plain CPU build of llama-server for this platform from the project's latest GitHub release,
 * extracts it into userData/llamacpp/bin, and returns the resolved binary path. Streams to disk (not safeFetch's
 * read-whole-body contract - this is a multi-hundred-MB binary) but still always drains or destroys the response,
 * the same crbug-378822137 discipline as every other network call here.
 */
async function downloadBinary(userDataDir, { onProgress, fetchImpl = fetch, spawnFn = spawn } = {}) {
  const { body: release } = await safeFetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { 'user-agent': 'bazinga' } }, 'json', fetchImpl);
  const asset = pickAsset(release.assets);
  if (!asset) throw new Error(`no CPU build of llama-server found for ${process.platform}/${process.arch} in the latest ${REPO} release`);
  const dir = binDir(userDataDir);
  fs.mkdirSync(dir, { recursive: true });
  const zipPath = path.join(dir, asset.name);
  const res = await fetchImpl(asset.browser_download_url);
  if (!res.ok || !res.body) { await res.body?.cancel?.().catch(() => {}); throw new Error(`download failed: HTTP ${res.status}`); }
  const total = Number(res.headers.get('content-length')) || asset.size || 0;
  let got = 0;
  const out = fs.createWriteStream(zipPath);
  try {
    for await (const chunk of res.body) {
      got += chunk.length;
      out.write(chunk);
      if (onProgress) onProgress({ bytesDownloaded: got, totalBytes: total });
    }
  } finally {
    await new Promise((r) => out.end(r));
  }
  const extractDir = path.join(dir, 'extracted');
  await extractZip(zipPath, extractDir, spawnFn);
  fs.rmSync(zipPath, { force: true });
  const exe = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
  const found = findBinaryIn(extractDir, exe);
  if (!found) throw new Error(`${exe} was not found inside the downloaded release archive`);
  const dest = path.join(dir, exe);
  fs.copyFileSync(found, dest);
  fs.rmSync(extractDir, { recursive: true, force: true });
  if (process.platform !== 'win32') fs.chmodSync(dest, 0o755);
  return dest;
}

function health(port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/health', timeout: timeoutMs }, (res) => {
      res.on('data', () => {}); // drained, never parsed - we only care that something answered
      res.on('end', () => resolve(res.statusCode < 500));
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
  });
}

let current = null; // { child, port, model, ctxSize, binaryPath } while a server is running; null otherwise

/**
 * Starts llama-server with one model loaded; resolves once it answers its own /health endpoint (or rejects with
 * the captured stderr tail on failure/timeout). Only one instance is managed at a time (llama.cpp is one-model-
 * per-process by design) - call stop() first to swap models.
 */
async function start({ binaryPath, modelPath, port = DEFAULT_PORT, ctxSize = DEFAULT_CTX_SIZE, alias = '', extraArgs = [], pollMs = 300, readyTimeoutMs = 60000 }, spawnFn = spawn) {
  if (current) throw new Error('a llama-server is already running; stop it first');
  // --alias makes llama-server report this exact name from /v1/models, so a Claude Code agent pointed at it with
  // --model <alias> passes agentprep's "does the server list this model" check instead of a mismatched auto-name.
  const args = ['--model', modelPath, '--port', String(port), '--host', '127.0.0.1', '--ctx-size', String(ctxSize), ...(alias ? ['--alias', alias] : []), ...extraArgs];
  const child = spawnFn(binaryPath, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let stderr = '';
  child.stdout.on('data', () => {}); // llama-server logs mostly go to stderr; drained all the same (dap.js lesson: an unread pipe stalls the child)
  child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-4000); });
  const mine = { child, port, model: modelPath, ctxSize, binaryPath, alias };
  current = mine;
  // stop()'s SIGKILL escalation resolves as soon as it SENDS the signal, without waiting for the exit event
  // that follows - so this child's real 'exit' can still arrive after a newer start() has already replaced
  // `current`. Only clear it if it is still ours, or a fast stop()+start() would wipe out the new process's state.
  const cleanup = () => { if (current === mine) current = null; };
  child.on('exit', cleanup);
  child.on('error', cleanup);
  const deadline = Date.now() + readyTimeoutMs;
  try {
    while (Date.now() < deadline) {
      if (!current) throw new Error(`llama-server exited before it was ready:\n${stderr}`);
      if (await health(port)) return { pid: child.pid, port };
      await new Promise((r) => setTimeout(r, pollMs));
    }
    throw new Error(`llama-server did not answer on port ${port} within ${Math.round(readyTimeoutMs / 1000)}s:\n${stderr}`);
  } catch (err) {
    await stop();
    throw err;
  }
}

/** SIGTERM, then SIGKILL after a grace period if it's still alive - same escalation as acp.js's AcpRun.close(). */
function stop() {
  const run = current;
  current = null;
  if (!run || !run.child || run.child.exitCode !== null || run.child.signalCode !== null) return Promise.resolve();
  const { child } = run;
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (done) return; done = true; resolve(); };
    child.once('exit', finish);
    // SIGKILL cannot be caught/ignored on POSIX; Windows ignores the signal argument and force-terminates
    // regardless, so escalating unconditionally is safe cross-platform (same reasoning as acp.js).
    setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } finish(); }, 3000);
    try { child.kill(); } catch { /* gone */ }
  });
}

/** { running, model, ctxSize, port } - running is false when nothing is managed right now, same contract as ollama.status(). */
async function status() {
  if (!current) return { running: false };
  const ok = await health(current.port);
  return { running: ok, model: current.model, ctxSize: current.ctxSize, port: current.port, alias: current.alias };
}

/** Things worth stopping the user over before they try to start an agent against this. */
function problems(st, { hasBinary } = {}) {
  if (!hasBinary) return [{ kind: 'no-binary', text: 'llama-server was not found on PATH and no downloaded copy exists yet. Download it, or install llama.cpp and make sure llama-server is on PATH.' }];
  if (!st.running) return [{ kind: 'not-running', text: 'llama.cpp is not running. Pick a model and press Start.' }];
  return [];
}

/** Things worth a status-bar line, but not worth blocking on. */
function notes(st) {
  if (st.running && st.ctxSize && st.ctxSize < DEFAULT_CTX_SIZE) return [`llama.cpp is running with a ${st.ctxSize}-token context, smaller than the usual ${DEFAULT_CTX_SIZE}.`];
  return [];
}

module.exports = {
  DEFAULT_PORT, DEFAULT_CTX_SIZE, REPO,
  resolveBinary, downloadBinary, pickAsset, start, stop, status, problems, notes,
  _internal: { health, extractZip, findBinaryIn, binDir },
};
