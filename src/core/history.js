'use strict';
/** Read-only history views: commit graph, stashes, blame, and the files of a commit. */
const { git } = require('./git');
const { toPosix } = require('./util');

const SEP = '\x1f';
const REC = '\x1e';

/** Commits, newest first (topological order so a branch's commits stay together). */
async function log(root, { limit = 300, skip = 0, all = true } = {}) {
  const fmt = ['%H', '%P', '%an', '%at', '%D', '%s'].join(SEP) + REC;
  let out = '';
  try {
    out = await git(root, ['log', ...(all ? ['--all'] : []), '--topo-order', `--max-count=${limit}`, `--skip=${skip}`, `--format=${fmt}`, '--no-color']);
  } catch { return []; } // no commits yet
  return out.split(REC).map((r) => r.replace(/^\n/, '')).filter(Boolean).map((rec) => {
    const [sha, parents, author, time, refs, subject] = rec.split(SEP);
    return {
      sha, short: sha.slice(0, 7), parents: parents ? parents.split(' ') : [], author, time: Number(time),
      refs: refs ? refs.split(', ').filter(Boolean).map((r) => r.replace(/^HEAD -> /, '').trim()) : [],
      head: /(^|, )HEAD/.test(refs || ''), subject,
    };
  });
}

/**
 * Lane layout for drawing the graph. One row per commit; for every row:
 *   lane      column of the commit's dot
 *   incoming  lanes that arrive at the dot from above (the lane the commit was waiting in, plus lanes of children that merge into it)
 *   through   lanes that just pass this row without touching the commit
 *   outgoing  lanes the dot connects to below (one per parent)
 */
function layoutGraph(commits) {
  const lanes = []; // lane index -> sha it is waiting for (null = free)
  const rows = [];
  const free = () => { const i = lanes.indexOf(null); if (i >= 0) return i; lanes.push(null); return lanes.length - 1; };
  for (const c of commits) {
    let incoming = lanes.map((s, i) => (s === c.sha ? i : -1)).filter((i) => i >= 0);
    const lane = incoming.length ? incoming[0] : free();
    if (!incoming.length) lanes[lane] = c.sha;
    const through = lanes.map((s, i) => (s !== null && s !== c.sha ? i : -1)).filter((i) => i >= 0);
    for (const i of incoming) lanes[i] = null;
    const outgoing = [];
    c.parents.forEach((p, n) => {
      let target = lanes.indexOf(p);
      if (target < 0) { target = n === 0 ? lane : free(); lanes[target] = p; if (n === 0 && lanes[lane] !== p) lanes[lane] = p; }
      outgoing.push(target);
    });
    if (!incoming.length) incoming = []; // a branch tip: nothing arrives from above
    rows.push({ sha: c.sha, lane, incoming, through, outgoing, lanes: lanes.length });
    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop();
  }
  return rows;
}

async function stashList(root) {
  let out = '';
  try { out = await git(root, ['stash', 'list', `--format=%gd${SEP}%gs${SEP}%at`]); } catch { return []; }
  return out.split('\n').filter(Boolean).map((l) => { const [ref, subject, time] = l.split(SEP); return { ref, subject, time: Number(time) }; });
}
const stashRef = (ref) => { if (!/^stash@\{\d+\}$/.test(ref)) throw new Error('Invalid stash reference.'); return ref; };
async function stashPush(root, message) { return (await git(root, ['stash', 'push', '--include-untracked', '-m', String(message || 'Bazinga stash')])).trim(); }
async function stashApply(root, ref) { return (await git(root, ['stash', 'apply', stashRef(ref)])).trim(); }
async function stashPop(root, ref) { return (await git(root, ['stash', 'pop', stashRef(ref)])).trim(); }
async function stashDrop(root, ref) { return (await git(root, ['stash', 'drop', stashRef(ref)])).trim(); }

/** Who last touched each line: [{ line, sha, author, time, summary, committed }] */
async function blame(root, rel) {
  const out = await git(root, ['blame', '--line-porcelain', '--', toPosix(rel)]);
  const lines = out.split('\n');
  const result = [];
  let cur = null;
  for (const l of lines) {
    const head = /^([0-9a-f]{40}) \d+ (\d+)/.exec(l);
    if (head) { cur = { line: Number(head[2]), sha: head[1], author: '', time: 0, summary: '', committed: !/^0+$/.test(head[1]) }; continue; }
    if (!cur) continue;
    if (l.startsWith('author ')) cur.author = l.slice(7);
    else if (l.startsWith('author-time ')) cur.time = Number(l.slice(12));
    else if (l.startsWith('summary ')) cur.summary = l.slice(8);
    else if (l.startsWith('\t')) { result.push(cur); cur = null; }
  }
  return result;
}

/** [{ status, path, oldPath? }] for one commit (merges: against the first parent). */
async function commitFiles(root, sha) {
  assertSha(sha);
  const out = await git(root, ['-c', 'core.quotepath=false', 'show', '--first-parent', '-M', '--name-status', '--format=', '--no-color', sha]);
  return out.split('\n').filter(Boolean).map((l) => {
    const parts = l.split('\t');
    const status = parts[0][0];
    return status === 'R' || status === 'C' ? { status, oldPath: parts[1], path: parts[2] } : { status, path: parts[1] };
  });
}

function assertSha(sha) { if (!/^[0-9a-f]{7,40}$/i.test(String(sha))) throw new Error('Invalid commit id.'); }

/** A file's content as of a commit ('' when it did not exist). */
async function fileAt(root, sha, rel) {
  assertSha(sha);
  try { return await git(root, ['show', `${sha}:${toPosix(rel)}`]); } catch { return ''; }
}
const parentOf = async (root, sha) => { assertSha(sha); try { return (await git(root, ['rev-parse', '--verify', '-q', `${sha}^1`])).trim(); } catch { return null; } };

/** Both sides of a commit's change to one file, ready for a read-only diff view. */
async function commitDiff(root, sha, rel, oldPath) {
  const parent = await parentOf(root, sha);
  return { original: parent ? await fileAt(root, parent, oldPath || rel) : '', modified: await fileAt(root, sha, rel) };
}

/** Full details of one commit for the detail pane. */
async function commitInfo(root, sha) {
  assertSha(sha);
  const out = await git(root, ['show', '-s', `--format=%H${SEP}%an${SEP}%ae${SEP}%at${SEP}%B`, sha]);
  const [full, author, email, time, ...body] = out.split(SEP);
  return { sha: full, author, email, time: Number(time), message: body.join(SEP).trim(), files: await commitFiles(root, sha) };
}

module.exports = { log, layoutGraph, stashList, stashPush, stashApply, stashPop, stashDrop, blame, commitFiles, fileAt, commitDiff, commitInfo };
