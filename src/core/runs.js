'use strict';
/**
 * Agent runs: every run gets its own git worktree on its own branch (agent/<slug>), so several agents can work
 * in parallel without touching your working tree, and each result is reviewed and merged (or thrown away) on its own.
 *
 * Worktrees live next to the repository: <parent>/<repo>.worktrees/<slug>
 * Run metadata lives in the worktree's private git dir (never shows up in `git status`, disappears with the worktree).
 */
const fs = require('node:fs');
const path = require('node:path');
const { git, isRepo, hasHead, branch: currentBranch, changedFiles } = require('./git');
const { toPosix } = require('./util');
const runstats = require('./runstats');
const journal = require('./journal');

const BRANCH_PREFIX = 'agent/';
const META_FILE = 'bazinga-run.json';
const SEP = '\x1f';

const slugify = (s) => String(s || 'run').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'run';
const trim = (s) => String(s).trim();
const errText = (err) => String((err && (err.stderr || err.message)) || err).trim();

async function repoTop(root) { return path.resolve(trim(await git(root, ['rev-parse', '--show-toplevel']))); }
async function prefixOf(root) { return toPosix(trim(await git(root, ['rev-parse', '--show-prefix']))).replace(/\/+$/, ''); }

/** [{ path, branch, head }] from `git worktree list --porcelain`; the first entry is the main worktree. */
async function worktrees(root) {
  const out = await git(root, ['worktree', 'list', '--porcelain']);
  const list = [];
  let cur = null;
  for (const line of out.split(/\r?\n/)) {
    if (line.startsWith('worktree ')) { cur = { path: path.resolve(line.slice(9)), branch: null, head: null }; list.push(cur); }
    else if (cur && line.startsWith('branch ')) cur.branch = line.slice(7).replace(/^refs\/heads\//, '');
    else if (cur && line.startsWith('HEAD ')) cur.head = line.slice(5);
  }
  return list;
}

async function gitDirOf(wtTop) { return path.resolve(wtTop, trim(await git(wtTop, ['rev-parse', '--git-dir']))); }

async function readMeta(wtTop) {
  try { return JSON.parse(fs.readFileSync(path.join(await gitDirOf(wtTop), META_FILE), 'utf8')); } catch { return null; }
}
async function writeMeta(wtTop, meta) {
  fs.writeFileSync(path.join(await gitDirOf(wtTop), META_FILE), JSON.stringify(meta, null, 2));
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (e.name === '.cache' || e.name === 'node_modules') continue;
    const s = path.join(src, e.name); const d = path.join(dest, e.name);
    if (e.isDirectory()) copyDir(s, d); else if (e.isFile()) fs.copyFileSync(s, d);
  }
}

/** Create a worktree + branch from the current HEAD. `root` may be any folder inside the repository (also another worktree). */
async function createRun(root, { name, task, agent, allow, linkDirs = [] } = {}) {
  if (!(await isRepo(root))) throw new Error('Agent runs need a git repository.');
  const wts = await worktrees(root);
  const mainTop = wts[0].path;
  // always branch from the MAIN checkout's current commit, also when the IDE is currently showing another run
  if (!(await hasHead(mainTop))) throw new Error('Make at least one commit first: a worktree needs something to start from.');
  const prefix = await prefixOf(root);
  const baseCommit = trim(await git(mainTop, ['rev-parse', 'HEAD']));
  const baseBranch = await currentBranch(mainTop);

  const base = slugify(name || task);
  const existingBranches = new Set(trim(await git(mainTop, ['branch', '--list', '--format=%(refname:short)'])).split(/\r?\n/));
  let slug = base; let n = 1;
  const dirFor = (s) => path.join(path.dirname(mainTop), `${path.basename(mainTop)}.worktrees`, s);
  while (existingBranches.has(BRANCH_PREFIX + slug) || fs.existsSync(dirFor(slug))) slug = `${base}-${++n}`;

  const wtTop = dirFor(slug);
  fs.mkdirSync(path.dirname(wtTop), { recursive: true });
  await git(mainTop, ['worktree', 'add', '-q', '-b', BRANCH_PREFIX + slug, wtTop, baseCommit]);

  // untracked project config (.ide/) is not part of a fresh checkout: bring it along
  const ideSrc = path.join(mainTop, prefix, '.ide');
  const ideDest = path.join(wtTop, prefix, '.ide');
  if (fs.existsSync(ideSrc) && !fs.existsSync(ideDest)) { try { copyDir(ideSrc, ideDest); } catch { /* best effort */ } }
  for (const dir of linkDirs) {
    const src = path.join(mainTop, prefix, dir); const dest = path.join(wtTop, prefix, dir);
    try { if (fs.existsSync(src) && !fs.existsSync(dest)) fs.symlinkSync(src, dest, process.platform === 'win32' ? 'junction' : 'dir'); } catch { /* best effort */ }
  }

  const meta = { id: slug, name: name || slug, task: task || '', agent: agent || '', allow: allow || '', branch: BRANCH_PREFIX + slug, baseCommit, baseBranch, created: Date.now() };
  await writeMeta(wtTop, meta);
  return { ...meta, top: wtTop, root: path.join(wtTop, prefix), mainRoot: path.join(mainTop, prefix) };
}

/**
 * Update the statistics of the agent run whose worktree contains `cwd` (no-op when cwd is not inside a run).
 * `change` is (stats) => newStats. Never throws: statistics must not break an agent session.
 */
async function recordStats(cwd, change) {
  try {
    const top = path.resolve(trim(await git(cwd, ['rev-parse', '--show-toplevel'])));
    const meta = await readMeta(top);
    if (!meta || !meta.id) return false;
    meta.stats = runstats.normalize(change(runstats.normalize(meta.stats)));
    await writeMeta(top, meta);
    return true;
  } catch { return false; }
}

/** Adds facts to a run's metadata (for example who took over). */
async function recordMeta(cwd, patch) {
  try {
    const top = path.resolve(trim(await git(cwd, ['rev-parse', '--show-toplevel'])));
    const meta = await readMeta(top);
    if (!meta || !meta.id) return false;
    await writeMeta(top, { ...meta, ...patch });
    return true;
  } catch { return false; }
}

/** Absolute path of the repository's common git dir (shared by all worktrees). */
async function commonGitDir(cwd) {
  return path.resolve(cwd, trim(await git(cwd, ['rev-parse', '--git-common-dir'])));
}
/** Where run journals live: in the repository's common git dir, so they outlive the worktree. */
async function journalDir(cwd) {
  const common = trim(await git(cwd, ['rev-parse', '--git-common-dir']));
  return path.join(path.resolve(cwd, common), 'bazinga-journals');
}
/** Append an event to the journal of the run whose worktree contains `cwd` (no-op elsewhere; never throws). */
async function journalEvent(cwd, event) {
  try {
    const top = path.resolve(trim(await git(cwd, ['rev-parse', '--show-toplevel'])));
    const meta = await readMeta(top);
    if (!meta || !meta.id) return false;
    return journal.append(await journalDir(cwd), meta.id, event);
  } catch { return false; }
}
async function readJournal(root, id) {
  try { return journal.read(await journalDir(root), id); } catch { return []; }
}

/** All agent runs of the repository containing `root`, with a little status each. */
async function listRuns(root) {
  if (!(await isRepo(root))) return { main: null, runs: [] };
  const wts = await worktrees(root);
  const mainTop = wts[0].path;
  const prefix = await prefixOf(root);
  const runs = [];
  for (const wt of wts.slice(1)) {
    if (!wt.branch || !wt.branch.startsWith(BRANCH_PREFIX)) continue;
    if (!fs.existsSync(wt.path)) continue;
    const meta = (await readMeta(wt.path)) || { id: wt.branch.slice(BRANCH_PREFIX.length), name: wt.branch.slice(BRANCH_PREFIX.length), baseCommit: null };
    const rRoot = path.join(wt.path, prefix);
    let files = 0; let commits = 0;
    try { files = (await changedFiles(rRoot)).filter((f) => !f.path.startsWith('.ide/')).length; } catch { /* ignore */ }
    try { if (meta.baseCommit) commits = Number(trim(await git(wt.path, ['rev-list', '--count', `${meta.baseCommit}..HEAD`]))); } catch { /* ignore */ }
    runs.push({ ...meta, branch: wt.branch, top: wt.path, root: rRoot, mainRoot: path.join(mainTop, prefix), files, commits, statsText: runstats.summarize(meta.stats) });
  }
  runs.sort((a, b) => (b.created || 0) - (a.created || 0));
  return { main: { root: path.join(mainTop, prefix), top: mainTop, branch: await currentBranch(mainTop) }, runs };
}

async function findRun(root, id) {
  const { runs, main } = await listRuns(root);
  const run = runs.find((r) => r.id === id);
  if (!run) throw new Error(`Unknown agent run "${id}".`);
  return { run, main };
}

/**
 * Agents often commit on their own, which would hide their work from the Changes tab (it compares with HEAD).
 * Put those commits back as staged changes on top of the base commit. Returns how many commits were folded.
 */
async function prepareReview(root, id) {
  const { run } = await findRun(root, id);
  if (!run.baseCommit || !run.commits) return { folded: 0 };
  await git(run.top, ['reset', '--soft', run.baseCommit]);
  return { folded: run.commits };
}

async function dirty(top) { return trim(await git(top, ['status', '--porcelain'])) !== ''; }

/**
 * Bring a run's result into the main working tree. squash (default): one commit with your message. Otherwise a merge commit.
 * Refuses when the main working tree has uncommitted changes. On conflicts everything is rolled back.
 */
async function mergeRun(root, id, { message, squash = true } = {}) {
  const { run, main } = await findRun(root, id);
  if (await dirty(main.top)) throw new Error('The main working tree has uncommitted changes. Commit or stash them first, then merge.');
  const msg = trim(message || '') || `Agent run: ${run.name}`;

  if (await dirty(run.top)) {
    await git(run.top, ['add', '-A']);
    await git(run.top, ['commit', '-q', '-m', msg]);
  }
  const ahead = Number(trim(await git(main.top, ['rev-list', '--count', `HEAD..${run.branch}`])));
  if (!ahead) throw new Error('The run has no changes to merge.');

  try {
    if (squash) {
      await git(main.top, ['merge', '--squash', run.branch]);
      if (await dirty(main.top)) await git(main.top, ['commit', '-q', '-m', msg]);
    } else {
      await git(main.top, ['merge', '--no-ff', '-q', '-m', msg, run.branch]);
    }
  } catch (err) {
    let files = [];
    try { files = trim(await git(main.top, ['diff', '--name-only', '--diff-filter=U'])).split(/\r?\n/).filter(Boolean); } catch { /* ignore */ }
    try { await git(main.top, ['merge', '--abort']); } catch { try { await git(main.top, ['reset', '--hard', 'HEAD']); } catch { /* ignore */ } }
    const e = new Error(files.length ? `Merge conflicts in: ${files.join(', ')}. Nothing was changed; ask the agent to rebase onto the current branch, or resolve by hand.` : `Merge failed: ${errText(err)}`);
    e.conflicts = files;
    throw e;
  }
  let commit = '';
  try { commit = trim(await git(main.top, ['rev-parse', 'HEAD'])); } catch { /* undo just will not be offered */ }
  if (commit) await recordMerged(main.top, { id: run.id, name: run.name, branch: run.branch, commit, into: main.branch, at: Date.now() });
  await removeRun(root, id);
  return { merged: run.branch, into: main.branch, commit };
}

// merged runs, remembered in the repository's git dir so a merge can be undone later (with a revert commit, never by rewriting history)
async function mergedFile(cwd) { return path.join(await commonGitDir(cwd), 'bazinga-merged.json'); }
async function readMerged(cwd) {
  try { const j = JSON.parse(fs.readFileSync(await mergedFile(cwd), 'utf8')); return Array.isArray(j) ? j : []; } catch { return []; }
}
async function recordMerged(cwd, entry) {
  try { const all = (await readMerged(cwd)).concat(entry).slice(-50); fs.writeFileSync(await mergedFile(cwd), JSON.stringify(all)); } catch { /* undo is a courtesy */ }
}
/** Merged runs that can still be undone: the commit is still part of the current branch and was not undone yet. */
async function listMerged(root) {
  const { main } = await listRuns(root);
  if (!main) return [];
  const out = [];
  for (const m of (await readMerged(main.top)).reverse()) {
    if (m.undone) continue;
    try { await git(main.top, ['merge-base', '--is-ancestor', m.commit, 'HEAD']); out.push(m); } catch { /* not in this branch any more */ }
    if (out.length >= 10) break;
  }
  return out;
}
async function undoMerged(root, commit) {
  const { main } = await listRuns(root);
  if (!main) throw new Error('This folder is not a git repository.');
  const entries = await readMerged(main.top);
  const entry = entries.find((m) => m.commit === commit);
  if (!entry) throw new Error('That merge is not in the list of merges Bazinga made.');
  if (await dirty(main.top)) throw new Error('The main working tree has uncommitted changes. Commit or stash them first, then undo.');
  try { await git(main.top, ['merge-base', '--is-ancestor', commit, 'HEAD']); } catch { throw new Error('That merge is not part of the current branch any more (you switched branch, or it was already undone).'); }
  const parents = trim(await git(main.top, ['rev-list', '--parents', '-n', '1', commit])).split(/\s+/).length - 1;
  try {
    await git(main.top, ['revert', '--no-edit', ...(parents > 1 ? ['-m', '1'] : []), commit]);
  } catch (err) {
    try { await git(main.top, ['revert', '--abort']); } catch { /* nothing to abort */ }
    throw new Error(`Undoing it would clash with changes made after the merge, so nothing was changed. Ask the agent to fix it forward, or revert by hand. (${errText(err)})`);
  }
  const revert = trim(await git(main.top, ['rev-parse', 'HEAD']));
  entry.undone = revert;
  try { fs.writeFileSync(await mergedFile(main.top), JSON.stringify(entries)); } catch { /* ignore */ }
  return { undone: entry.name, revert };
}

/** Commits the run made since it branched off, oldest first, and their shas/subjects/times (unix seconds). Empty once
 *  prepareReview() has folded them into staged changes - see its `git reset --soft` above. */
async function runCommits(root, id) {
  const { run } = await findRun(root, id);
  if (!run.baseCommit) return [];
  let out = '';
  try { out = trim(await git(run.top, ['log', '--reverse', `--format=%H${SEP}%s${SEP}%at`, `${run.baseCommit}..HEAD`])); } catch { return []; }
  if (!out) return [];
  return out.split('\n').map((l) => { const [sha, subject, time] = l.split(SEP); return { sha, subject, time: Number(time) }; });
}

/** All run journals of the repository (also of merged and discarded runs): {runId: events[]} */
async function allJournals(root) {
  const dir = await journalDir(root);
  const out = {};
  for (const id of journal.listIds(dir)) out[id] = journal.read(dir, id);
  return out;
}

async function removeRun(root, id) {
  const { run, main } = await findRun(root, id);
  try { await git(main.top, ['worktree', 'remove', '--force', run.top]); } catch { /* maybe already gone */ }
  try { fs.rmSync(run.top, { recursive: true, force: true }); } catch { /* ignore */ }
  try { await git(main.top, ['worktree', 'prune']); } catch { /* ignore */ }
  try { await git(main.top, ['branch', '-D', run.branch]); } catch { /* ignore */ }
  return { removed: run.branch };
}

module.exports = { commonGitDir, journalEvent, readJournal, journalDir,
  recordStats, recordMeta, slugify, createRun, listRuns, findRun, prepareReview, mergeRun, removeRun, listMerged, undoMerged, allJournals, runCommits, BRANCH_PREFIX };
