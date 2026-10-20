'use strict';
/**
 * Files dropped on a terminal (or images pasted into it) become paths in the prompt. Only the path text is built here:
 * nothing is read, and control characters in file names are removed so a name cannot inject keystrokes.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { quote } = require('./testcmd');
const { toPosix } = require('./util');

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_PATHS = 50;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/g;

/** Path as the agent should see it: relative (forward slashes) inside the project, absolute otherwise. */
function displayPath(p, root) {
  const clean = String(p).replace(CONTROL, '');
  if (!clean) return '';
  if (root && path.isAbsolute(clean)) {
    const rel = path.relative(root, clean);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return toPosix(rel);
  }
  return clean;
}

/**
 * @param paths     dropped file paths (absolute, or project-relative from the file tree)
 * @param opts      { root, shellKind: 'posix'|'powershell'|'cmd', agent: bool, at: bool (Claude Code: write @path) }
 * @returns text to paste, with a trailing space so you can keep typing; '' when nothing usable
 */
function formatDropPaths(paths, { root, shellKind = 'posix', agent = false, at = false } = {}) {
  const list = (Array.isArray(paths) ? paths : []).map((p) => displayPath(p, root)).filter(Boolean).slice(0, MAX_PATHS);
  if (!list.length) return '';
  const one = (p) => {
    if (!agent) return quote(shellKind, p); // a shell: quote for that shell
    if (/\s/.test(p)) return `"${p.replace(/"/g, '')}"`; // an agent prompt: quote only when needed (no @ form for these)
    // Claude Code: @path puts the file's content into the prompt, so a weak model does not need a working Read tool call
    const image = IMAGE_EXT.has(path.extname(p).slice(1).toLowerCase());
    return at && !image ? `@${p}` : p;
  };
  return `${list.map(one).join(' ')} `;
}

/** Save a pasted image (clipboard screenshot) and return its path. */
function saveImage(dir, base64, ext, { now = Date.now(), maxAgeDays = 7 } = {}) {
  const e = String(ext || '').toLowerCase().replace(/^\./, '');
  if (!IMAGE_EXT.has(e)) throw new Error('Only png, jpg, gif and webp images can be pasted.');
  const buf = Buffer.from(String(base64 || ''), 'base64');
  if (!buf.length) throw new Error('The image is empty.');
  if (buf.length > MAX_IMAGE_BYTES) throw new Error('The image is larger than 20 MB.');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `paste-${now}-${crypto.randomBytes(3).toString('hex')}.${e === 'jpeg' ? 'jpg' : e}`);
  fs.writeFileSync(file, buf);
  try { // forget old pastes
    for (const f of fs.readdirSync(dir)) {
      if (!/^paste-\d+-[0-9a-f]{6}\.\w+$/.test(f)) continue;
      const full = path.join(dir, f);
      if (now - fs.statSync(full).mtimeMs > maxAgeDays * 86400000) fs.unlinkSync(full);
    }
  } catch { /* best effort */ }
  return file;
}

const defaultDropDir = (userData) => path.join(userData || os.tmpdir(), 'pasted-images');

module.exports = { formatDropPaths, displayPath, saveImage, defaultDropDir, IMAGE_EXT };
