'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { toPosix, which } = require('./util');
const { projectFiles } = require('./git');

const MAX_FILE_BYTES = 1024 * 1024;

function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/**
 * Which ripgrep to run: the one bundled with the IDE (@vscode/ripgrep, so search is fast on a machine without it), else one on PATH, else null
 * (then a plain JS scan over the project files is used).
 */
function rgBinary(deps = {}) {
  try {
    const bundled = (deps.bundled || (() => require('@vscode/ripgrep').rgPath))();
    if (bundled && (deps.exists || fs.existsSync)(bundled)) return bundled;
  } catch { /* the optional platform package is not installed */ }
  return (deps.which || which)('rg') ? 'rg' : null;
}

function ripgrep(root, { query, regex, caseSensitive }, limit, bin = 'rg') {
  return new Promise((resolve) => {
    const args = ['--line-number', '--column', '--no-heading', '--color', 'never', '--max-columns', '300', '--max-count', '100',
      caseSensitive ? '-s' : '-i', ...(regex ? [] : ['-F']), '--glob', '!.git', '-e', query, '--', '.'];
    execFile(bin, args, { cwd: root, maxBuffer: 64 * 1024 * 1024, timeout: 20000, windowsHide: true, encoding: 'utf8' }, (err, stdout) => {
      if (err && err.code !== 1 && !stdout) return resolve({ error: err.code === 2 ? 'Invalid search pattern' : String(err.message) });
      const results = [];
      for (const line of String(stdout).split('\n')) {
        const m = /^(.*?):(\d+):(\d+):(.*)$/.exec(line);
        if (!m) continue;
        results.push({ file: toPosix(m[1]).replace(/^\.\//, ''), line: Number(m[2]), column: Number(m[3]), text: m[4].trim() });
        if (results.length >= limit) break;
      }
      resolve({ results, truncated: results.length >= limit, engine: 'rg' });
    });
  });
}

async function jsSearch(root, { query, regex, caseSensitive }, limit) {
  let re;
  try { re = new RegExp(regex ? query : escapeRegExp(query), caseSensitive ? '' : 'i'); } catch { return { error: 'Invalid regular expression' }; }
  const files = await projectFiles(root);
  const results = [];
  const deadline = Date.now() + 15000;
  let truncated = false;
  for (const rel of files) {
    if (results.length >= limit || Date.now() > deadline) { truncated = true; break; }
    const abs = path.join(root, rel);
    let buf;
    try {
      if (fs.statSync(abs).size > MAX_FILE_BYTES) continue;
      buf = fs.readFileSync(abs);
    } catch { continue; }
    if (buf.subarray(0, 8000).includes(0)) continue;
    const lines = buf.toString('utf8').split(/\r?\n/);
    for (let i = 0; i < lines.length && results.length < limit; i++) {
      const m = re.exec(lines[i]);
      if (m) results.push({ file: rel, line: i + 1, column: m.index + 1, text: lines[i].trim().slice(0, 300) });
    }
  }
  return { results, truncated, engine: 'js' };
}

/** search(root, { query, regex, caseSensitive, engine?: 'rg'|'js' }) -> { results: [{ file, line, column, text }], truncated, engine } | { error } */
async function search(root, opts, limit = 2000) {
  if (!opts || !String(opts.query || '').length) return { results: [], truncated: false, engine: 'none' };
  const bin = opts.engine === 'js' ? null : rgBinary();
  if (bin) {
    const res = await ripgrep(root, opts, limit, bin);
    if (!res.error) return res;
  }
  return jsSearch(root, opts, limit);
}

module.exports = { search, rgBinary };
