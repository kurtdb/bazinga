'use strict';
/**
 * Project-wide rename for files with no LSP configured (see LSP_LANGS in app.js): every project file is scanned
 * for the exact identifier as a whole word (\b...\b, case-sensitive) and every occurrence is replaced. Same
 * "by name only" approximation usages.js already makes and documents (it also matches inside comments, or an
 * unrelated identifier elsewhere that just happens to share the name) - stated here rather than glossed over.
 * One whole-file-replace edit per touched file, not per-occurrence ranges: simpler, and avoids any line/column
 * bookkeeping bug - Monaco's bulk-edit applies a full-document range edit exactly as well as a precise one.
 */
const fs = require('node:fs');
const path = require('node:path');

const MAX_BYTES = 1024 * 1024;
const MAX_FILES = 4000;
const IDENT = /^[A-Za-z_$][\w$]*$/;

function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/**
 * @param {string} root
 * @param {string[]} files  relative paths to scan (caller passes the project's own file list, honouring .gitignore)
 * @param {string} name  the identifier to rename
 * @param {string} newName
 * @returns {{ files: [{ rel: string, newText: string }] } | { error: string }}
 */
function renameAcrossFiles(root, files, name, newName) {
  if (!IDENT.test(String(name || ''))) return { error: 'Not a renamable identifier' };
  if (!IDENT.test(String(newName || ''))) return { error: 'Not a valid name' };
  if (name === newName) return { files: [] };
  const re = new RegExp(`\\b${escapeRegExp(name)}\\b`, 'g');
  const edits = [];
  let scanned = 0;
  for (const rel of files) {
    if (++scanned > MAX_FILES) break;
    let buf;
    try {
      const abs = path.join(root, rel);
      const st = fs.statSync(abs);
      if (!st.isFile() || st.size > MAX_BYTES) continue;
      buf = fs.readFileSync(abs);
    } catch { continue; }
    if (buf.subarray(0, 8000).includes(0)) continue; // binary file: a null byte this early never happens in real text
    const content = buf.toString('utf8');
    if (!re.test(content)) continue;
    re.lastIndex = 0;
    const newText = content.replace(re, newName);
    if (newText !== content) edits.push({ rel, newText });
  }
  return { files: edits };
}

module.exports = { renameAcrossFiles, escapeRegExp };
