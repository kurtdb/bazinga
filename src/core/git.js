'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const { toPosix, IGNORED_DIRS, listAllFiles } = require('./util');

function git(root, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd: root, maxBuffer: 64 * 1024 * 1024, windowsHide: true, encoding: 'utf8', env: opts.env || process.env }, (err, stdout, stderr) => {
      if (err) { err.stderr = stderr; err.stdout = stdout; reject(err); } else resolve(stdout);
    });
  });
}

/** Like git(), but feeds `input` to stdin (for `git apply`). */
function gitInput(root, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd: root, windowsHide: true });
    let out = ''; let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('close', (code) => { if (code === 0) resolve(out); else { const e = new Error(err.trim() || `git exited with ${code}`); e.stderr = err; reject(e); } });
    child.stdin.end(input);
  });
}

const ok = async (root, args) => { try { await git(root, args); return true; } catch { return false; } };
// git prints some failures ("nothing to commit", hook output) on stdout, so look there before falling back to "Command failed: ..."
const errText = (err) => String((err && (String(err.stderr || '').trim() || String(err.stdout || '').trim() || err.message)) || err).trim();

async function isRepo(root) {
  try { return (await git(root, ['rev-parse', '--is-inside-work-tree'])).trim() === 'true'; } catch { return false; }
}

async function hasHead(root) {
  return ok(root, ['rev-parse', '--verify', '-q', 'HEAD']);
}

async function branch(root) {
  try {
    const name = (await git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
    return name === 'HEAD' ? (await git(root, ['rev-parse', '--short', 'HEAD'])).trim() : name;
  } catch { return null; }
}

/**
 * Files changed in the working tree (staged, unstaged and untracked), relative to `root`.
 * `root` may be a sub-directory of the repository; paths outside it are dropped.
 * Returns [{ path, status, staged, unstaged }] with status one of M A D R ? U.
 */
// Read-only polling must neither take git's optional index lock (it would collide with the agent's own git commands) nor fail because of it.
const READ_ENV = { ...process.env, GIT_OPTIONAL_LOCKS: '0' };

async function changedFilesStrict(root) {
  let prefix = '';
  prefix = toPosix((await git(root, ['rev-parse', '--show-prefix'], { env: READ_ENV })).trim());
  let out;
  try { out = await git(root, ['status', '--porcelain=v1', '-z', '-uall', '--', '.'], { env: READ_ENV }); } catch { await new Promise((r) => setTimeout(r, 250)); out = await git(root, ['status', '--porcelain=v1', '-z', '-uall', '--', '.'], { env: READ_ENV }); } // one retry: another git process may be busy
  const parts = out.split('\0');
  const files = [];
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (!entry) continue;
    const xy = entry.slice(0, 2);
    let p = toPosix(entry.slice(3));
    if (xy[0] === 'R' || xy[0] === 'C') i++; // the next token is the original path
    if (prefix) {
      if (!p.startsWith(prefix)) continue;
      p = p.slice(prefix.length);
    }
    let status = 'M';
    if (xy === '??') status = '?';
    else if (xy.includes('U') || xy === 'AA' || xy === 'DD') status = 'U';
    else if (xy.includes('D')) status = 'D';
    else if (xy.includes('R')) status = 'R';
    else if (xy.includes('A')) status = 'A';
    files.push({ path: p, status, staged: xy[0] !== ' ' && xy[0] !== '?', unstaged: xy[1] !== ' ' || xy === '??' });
  }
  return files;
}

/** Never fails: an unreadable repository looks like "no changes". Use changedFilesStrict where that would be a lie. */
async function changedFiles(root) {
  try { return await changedFilesStrict(root); } catch { return []; }
}

/** Content of a file at HEAD (empty string for untracked or new files). */
async function headContent(root, relPath) {
  try { return await git(root, ['show', `HEAD:./${toPosix(relPath)}`]); } catch { return ''; }
}

// ------------------------------------------------------------------ changed line ranges

function unquoteGitPath(p) {
  if (!p.startsWith('"')) return p;
  try { return JSON.parse(p); } catch { return p.slice(1, -1); }
}

/**
 * Which lines did the working tree change versus HEAD?
 * Returns Map<relPath, 'all' | Array<[startLine, endLine]>>. New/untracked files (and everything when there is no HEAD yet) are 'all'.
 * Used to tell findings the agent introduced apart from issues that were already in the file.
 */
async function changedLineMap(root) {
  const files = await changedFiles(root);
  const map = new Map();
  const head = await hasHead(root);
  for (const f of files) if (f.status === '?' || !head) map.set(f.path, 'all');
  if (!head) return map;

  let out = '';
  try {
    out = await git(root, ['-c', 'core.quotepath=false', 'diff', '-U0', '--no-color', '--no-ext-diff', '--no-renames', '--relative', '--src-prefix=a/', '--dst-prefix=b/', 'HEAD']);
  } catch { return map; }

  let cur = null;
  let prev = '';
  for (const line of out.split('\n')) {
    if (line.startsWith('+++ ') && prev.startsWith('--- ')) {
      const p = unquoteGitPath(line.slice(4).replace(/\t.*$/, ''));
      if (p === '/dev/null') cur = null;
      else {
        cur = toPosix(p.replace(/^b\//, ''));
        if (!map.has(cur)) map.set(cur, []);
      }
    } else if (cur && line.startsWith('@@')) {
      const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
      const ranges = map.get(cur);
      if (m && Array.isArray(ranges)) {
        const start = Number(m[1]);
        const count = m[2] === undefined ? 1 : Number(m[2]);
        ranges.push(count === 0 ? [start, start + 1] : [start, start + count - 1]); // pure deletion: the line after the gap
      }
    }
    prev = line;
  }
  return map;
}

function isChangedLine(map, file, line) {
  const ranges = map.get(file);
  if (!ranges) return false;
  if (ranges === 'all') return true;
  return ranges.some(([a, b]) => line >= a && line <= b);
}

// ------------------------------------------------------------------ staging, committing, reverting

const pathArgs = (paths) => ['--', ...paths.map(toPosix)];

async function stage(root, paths) { await git(root, ['add', ...pathArgs(paths)]); }
async function stageAll(root) { await git(root, ['add', '-A', '--', '.']); }

async function unstage(root, paths) {
  if (await hasHead(root)) await git(root, ['restore', '--staged', ...pathArgs(paths)]);
  else await git(root, ['rm', '--cached', '-r', '-q', ...pathArgs(paths)]);
}

/** Commit what is staged. Throws with git's message (empty commit, hook failure, missing identity...). */
async function commit(root, message) {
  const msg = String(message || '').trim();
  if (!msg) throw new Error('Enter a commit message.');
  try { return (await git(root, ['commit', '-m', msg])).trim(); } catch (err) {
    throw new Error(errText(err).split('\n').slice(-6).join('\n'));
  }
}

/**
 * Throw away the agent's changes to one file: restore it from HEAD (staged and unstaged),
 * remove it if it is new and staged, or delete it if it is untracked.
 */
async function revertFile(root, rel) {
  const r = toPosix(rel);
  if (await ok(root, ['cat-file', '-e', `HEAD:./${r}`])) {
    await git(root, ['restore', '--source=HEAD', '--staged', '--worktree', '--', r]);
    return 'restored';
  }
  if (await ok(root, ['ls-files', '--error-unmatch', '--', r])) {
    await git(root, ['rm', '-f', '-q', '--', r]);
    return 'removed';
  }
  const abs = path.resolve(root, r);
  if (abs !== root && abs.startsWith(root + path.sep)) { fs.rmSync(abs, { force: true }); return 'deleted'; }
  throw new Error('Path is outside the project.');
}

// ------------------------------------------------------------------ hunk staging

/**
 * The unstaged hunks of one file (index -> working tree), as git itself splits them, with the file header for re-applying one.
 * Returns { header, hunks: [{ index, newStart, newLines, text }] }.
 */
async function fileHunks(root, rel, { cached = false } = {}) {
  const prefix = toPosix((await git(root, ['rev-parse', '--show-prefix'])).trim());
  const full = prefix + toPosix(rel);
  const out = await git(root, ['-c', 'core.quotepath=false', 'diff', '-U0', '--no-color', '--no-ext-diff', '--no-renames', ...(cached ? ['--cached'] : []), '--', `:(top,literal)${full}`]);
  const lines = out.split('\n');
  const firstHunk = lines.findIndex((l) => l.startsWith('@@'));
  if (firstHunk < 0) return { header: '', hunks: [] };
  const header = `${lines.slice(0, firstHunk).join('\n')}\n`;
  const hunks = [];
  let cur = null;
  for (const line of lines.slice(firstHunk)) {
    const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (m) { cur = { index: hunks.length, newStart: Number(m[1]), newLines: m[2] === undefined ? 1 : Number(m[2]), text: `${line}\n` }; hunks.push(cur); }
    else if (cur && line !== '') cur.text += `${line}\n`;
    else if (cur && line === '') { /* trailing newline of the diff */ }
  }
  return { header, hunks };
}

/** The hunk containing `line` of the working-tree file (a pure deletion matches the line before and after the gap), else the nearest one. */
function hunkAtLine(hunks, line) {
  if (!hunks.length) return null;
  const dist = (h) => {
    const start = h.newLines === 0 ? h.newStart : h.newStart - 0;
    const end = h.newLines === 0 ? h.newStart + 1 : h.newStart + h.newLines - 1;
    return line < start ? start - line : line > end ? line - end : 0;
  };
  return [...hunks].sort((a, b) => dist(a) - dist(b) || a.index - b.index)[0];
}

/** Stage just the change at `line` of the working-tree file (like `git add -p`). Untracked files are staged whole. */
async function stageHunk(root, rel, line) {
  if (!(await ok(root, ['ls-files', '--error-unmatch', '--', toPosix(rel)]))) { await stage(root, [rel]); return { staged: 'file' }; }
  const { header, hunks } = await fileHunks(root, rel);
  const h = hunkAtLine(hunks, line);
  if (!h) throw new Error('There is no unstaged change in this file.');
  await gitInput(root, ['apply', '--cached', '--unidiff-zero', '--whitespace=nowarn', '-'], header + h.text);
  return { staged: 'hunk', hunk: h.index, remaining: hunks.length - 1 };
}

/** Take the change at `line` (index coordinates) back out of the index; the working tree is untouched. */
async function unstageHunk(root, rel, line) {
  const { header, hunks } = await fileHunks(root, rel, { cached: true });
  const h = hunkAtLine(hunks, line);
  if (!h) throw new Error('There is no staged change in this file.');
  await gitInput(root, ['apply', '--cached', '--reverse', '--unidiff-zero', '--whitespace=nowarn', '-'], header + h.text);
  return { unstaged: 'hunk', hunk: h.index, remaining: hunks.length - 1 };
}

// ------------------------------------------------------------------ checkpoints
// A checkpoint is a commit object holding a snapshot of the whole working tree (tracked + untracked, minus ignored files),
// stored under refs/bazinga/checkpoints/. It is built with a temporary index, so the real index, branch and working tree are untouched.

const CP_REF = 'refs/bazinga/checkpoints';
const CP_MAX = 50;
const CP_IDENT = { GIT_AUTHOR_NAME: 'Bazinga', GIT_AUTHOR_EMAIL: 'bazinga@localhost', GIT_COMMITTER_NAME: 'Bazinga', GIT_COMMITTER_EMAIL: 'bazinga@localhost' };

async function createCheckpoint(root, label = 'manual') {
  const gitDir = (await git(root, ['rev-parse', '--absolute-git-dir'])).trim();
  const tmpIndex = path.join(gitDir, `bazinga-index-${process.pid}-${Date.now()}`);
  const env = { ...process.env, ...CP_IDENT, GIT_INDEX_FILE: tmpIndex };
  try {
    const head = (await hasHead(root)) ? (await git(root, ['rev-parse', 'HEAD'])).trim() : null;
    if (head) await git(root, ['read-tree', 'HEAD'], { env });
    await git(root, ['add', '-A', '--', ':/'], { env });
    const tree = (await git(root, ['write-tree'], { env })).trim();
    const args = ['commit-tree', tree, ...(head ? ['-p', head] : []), '-m', `bazinga checkpoint: ${label}`];
    const sha = (await git(root, args, { env })).trim();
    const id = `${Date.now()}`;
    await git(root, ['update-ref', `${CP_REF}/${id}`, sha]);
    await pruneCheckpoints(root);
    return { id, sha, label, time: Math.floor(Date.now() / 1000) };
  } finally {
    try { fs.rmSync(tmpIndex, { force: true }); } catch { /* ignore */ }
  }
}

const LEGACY_CP_REF = 'refs/' + 'lite-ide' + '/checkpoints'; // the tool's former name: move old checkpoints over once
async function migrateLegacyCheckpoints(root) {
  let out = '';
  try { out = await git(root, ['for-each-ref', '--format=%(refname) %(objectname)', LEGACY_CP_REF]); } catch { return; }
  for (const line of out.split('\n').filter(Boolean)) {
    const [ref, sha] = line.split(' ');
    await ok(root, ['update-ref', `${CP_REF}/${ref.slice(LEGACY_CP_REF.length + 1)}`, sha]);
    await ok(root, ['update-ref', '-d', ref]);
  }
}

async function listCheckpoints(root) {
  await migrateLegacyCheckpoints(root);
  let out = '';
  try { out = await git(root, ['for-each-ref', '--sort=-creatordate', '--format=%(refname)%09%(objectname)%09%(creatordate:unix)%09%(subject)', CP_REF]); } catch { return []; }
  return out.split('\n').filter(Boolean).map((line) => {
    const [ref, sha, time, ...subject] = line.split('\t');
    return { id: ref.slice(CP_REF.length + 1), sha, time: Number(time), label: subject.join('\t').replace(/^(bazinga|lite-ide) checkpoint: /, '') };
  });
}

async function pruneCheckpoints(root) {
  const all = await listCheckpoints(root);
  for (const cp of all.slice(CP_MAX)) await ok(root, ['update-ref', '-d', `${CP_REF}/${cp.id}`]);
}

async function deleteCheckpoint(root, id) {
  await git(root, ['update-ref', '-d', `${CP_REF}/${path.basename(String(id))}`]);
}

/**
 * Put the working tree back to a checkpoint: files in the snapshot are restored, files created since then are deleted.
 * The current state is saved as a new checkpoint first, so a restore can itself be undone.
 * The git index (what is staged) is not restored.
 */
async function restoreCheckpoint(root, id) {
  const ref = `${CP_REF}/${path.basename(String(id))}`;
  const sha = (await git(root, ['rev-parse', '--verify', ref])).trim();
  const safety = await createCheckpoint(root, `before restoring ${id}`);
  await git(root, ['restore', `--source=${sha}`, '--worktree', '--', '.']);
  const inSnapshot = new Set((await git(root, ['ls-tree', '-r', '--name-only', sha])).split('\n').filter(Boolean).map(toPosix));
  const nowPresent = (await git(root, ['-c', 'core.quotepath=false', 'ls-files', '-co', '--exclude-standard'])).split('\n').filter(Boolean).map(toPosix);
  const removed = [];
  for (const f of nowPresent) {
    if (inSnapshot.has(f)) continue;
    const abs = path.resolve(root, f);
    if (!abs.startsWith(root + path.sep)) continue;
    try { fs.rmSync(abs, { force: true }); removed.push(f); } catch { /* locked file: leave it */ }
  }
  return { restored: id, safetyCheckpoint: safety.id, removed };
}

// ------------------------------------------------------------------ project file list (quick open)

/** Every non-ignored file in the project: git's own list when available (fast, honours .gitignore), else a directory walk. */
async function projectFiles(root, limit = 50000) {
  if (await isRepo(root)) {
    try {
      const out = await git(root, ['-c', 'core.quotepath=false', 'ls-files', '-co', '--exclude-standard', '-z']);
      return out.split('\0').filter(Boolean).map(toPosix)
        .filter((f) => !f.split('/').some((seg) => IGNORED_DIRS.has(seg)))
        .slice(0, limit);
    } catch { /* fall through */ }
  }
  return listAllFiles(root, limit);
}

module.exports = {
  git, isRepo, hasHead, branch, changedFiles, changedFilesStrict, headContent, changedLineMap, isChangedLine,
  stage, stageAll, unstage, commit, revertFile, gitInput, fileHunks, hunkAtLine, stageHunk, unstageHunk,
  createCheckpoint, listCheckpoints, deleteCheckpoint, restoreCheckpoint, projectFiles,
};
