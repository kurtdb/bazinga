'use strict';
/**
 * A cheap fingerprint of "what is changed in the working tree": every changed path with its size and modification time.
 * Compared between two polls it tells whether anything changed, even when the file watcher missed the event
 * (watchers die on errors, drop events under load, and some folders cannot be watched at all).
 */
const fs = require('node:fs');
const path = require('node:path');
const { changedFilesStrict, isRepo } = require('./git');
const { listAllFiles } = require('./util');

/** No git: fingerprint the whole tree (path, size, mtime), bounded so a huge folder cannot make the poller slow. */
function treeSignature(root) {
  const parts = [];
  for (const rel of listAllFiles(root, 20000)) {
    try { const st = fs.statSync(path.join(root, rel)); parts.push(`${rel}\t${st.size}:${Math.round(st.mtimeMs)}`); } catch { /* vanished */ }
  }
  return parts.sort().join('\n');
}

async function signature(root) {
  if (!(await isRepo(root))) return treeSignature(root);
  let files;
  // null = "could not tell" (git failed): the caller keeps what it knew instead of treating it as "everything was reverted"
  try { files = await changedFilesStrict(root); } catch { return null; }
  const parts = [];
  for (const f of files) {
    let stamp = 'gone';
    try { const st = fs.statSync(path.join(root, f.path)); stamp = `${st.size}:${Math.round(st.mtimeMs)}`; } catch { /* deleted */ }
    parts.push(`${f.status}\t${f.path}\t${stamp}`);
  }
  return parts.sort().join('\n');
}

module.exports = { signature };
