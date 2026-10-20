'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const IGNORED_DIRS = new Set([
  '.git', 'node_modules', 'target', 'dist', 'build', 'out', '.venv', 'venv', '__pycache__',
  '.mypy_cache', '.ruff_cache', '.pytest_cache', '.idea', '.vscode', '.next', 'coverage', '.gradle',
  '.turbo', '.cache', '.parcel-cache',
]);

function toPosix(p) {
  return String(p).replace(/\\/g, '/');
}

function toArray(v) {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

/** Find an executable on PATH (honours PATHEXT on Windows). Returns the full path or null. */
function which(cmd) {
  const isWin = process.platform === 'win32';
  const exts = isWin ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean) : [''];
  const dirs = (process.env.PATH || process.env.Path || '').split(path.delimiter).filter(Boolean);
  const hasExt = isWin && path.extname(cmd) !== '';
  for (const dir of dirs) {
    for (const ext of hasExt ? [''] : exts) {
      const candidate = path.join(dir, cmd + ext);
      try {
        const st = fs.statSync(candidate);
        if (!st.isFile()) continue;
        if (!isWin) fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch { /* keep looking */ }
    }
  }
  return null;
}

/** Kill a child process and everything it spawned (process group on POSIX, taskkill /T on Windows). */
function killTree(child) {
  if (!child || child.pid === undefined) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    } else {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    }
  } catch { /* already gone */ }
}

/**
 * Run a shell command line. Resolves with { code, stdout, stderr, timedOut, cancelled, durationMs } and never rejects.
 * opts: cwd, timeoutMs, env, input (written to stdin; stdin is always closed so tools never wait for it), signal (AbortSignal).
 */
function runShell(command, { cwd, timeoutMs = 300000, env, input, signal } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let cancelled = false;
    const MAX = 16 * 1024 * 1024;
    const child = spawn(command, {
      cwd,
      env: { ...process.env, ...(env || {}), FORCE_COLOR: '0', NO_COLOR: '1' },
      shell: true,
      windowsHide: true,
      detached: process.platform !== 'win32', // own process group so cancel/timeout can kill the whole tree
    });
    const onAbort = () => { cancelled = true; killTree(child); };
    if (signal) {
      if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true });
    }
    const timer = setTimeout(() => { timedOut = true; killTree(child); }, timeoutMs);
    child.stdin.on('error', () => { /* process exited before reading stdin */ });
    child.stdin.end(input === undefined ? undefined : input);
    child.stdout.on('data', (d) => { if (stdout.length < MAX) stdout += d.toString('utf8'); });
    child.stderr.on('data', (d) => { if (stderr.length < MAX) stderr += d.toString('utf8'); });
    const finish = (code, extraErr = '') => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve({ code: code === null || code === undefined ? -1 : code, stdout, stderr: stderr + extraErr, timedOut, cancelled, durationMs: Date.now() - started });
    };
    child.on('error', (err) => finish(-1, String(err.message)));
    child.on('close', (code) => finish(code));
  });
}

function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, 'i');
}

/** Patterns without "/" match the basename, patterns with "/" match the whole relative path. */
function matchesAny(file, patterns) {
  const list = toArray(patterns);
  if (list.length === 0) return true;
  const base = file.slice(file.lastIndexOf('/') + 1);
  return list.some((p) => globToRegExp(p).test(p.includes('/') ? file : base));
}

/** Walk a project for files, skipping noisy directories. Returns posix relative paths. */
function listAllFiles(root, limit = 5000) {
  const out = [];
  const walk = (rel) => {
    if (out.length >= limit) return;
    let entries;
    try { entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.length >= limit) return;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!IGNORED_DIRS.has(e.name)) walk(childRel);
      } else if (e.isFile()) {
        out.push(childRel);
      }
    }
  };
  walk('');
  return out;
}

/**
 * Find files by glob (relative posix paths) INCLUDING build output such as target/, which listAllFiles skips.
 * Used to pick up test/analysis reports written by a command; sinceMs drops stale reports from earlier runs.
 */
function findFiles(root, patterns, { sinceMs = 0, maxEntries = 100000 } = {}) {
  const regs = toArray(patterns).map((p) => globToRegExp(toPosix(p)));
  const out = [];
  let seen = 0;
  const skip = new Set(['node_modules', '.git']);
  const walk = (rel) => {
    if (seen > maxEntries) return;
    let entries;
    try { entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      seen++;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!skip.has(e.name)) walk(childRel);
      } else if (e.isFile() && regs.some((r) => r.test(childRel))) {
        try { if (fs.statSync(path.join(root, childRel)).mtimeMs >= sinceMs) out.push(childRel); } catch { /* vanished */ }
      }
    }
  };
  walk('');
  return out;
}

module.exports = { IGNORED_DIRS, toPosix, toArray, which, killTree, runShell, listAllFiles, findFiles, matchesAny, globToRegExp };
