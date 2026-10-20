#!/usr/bin/env node
'use strict';
/** Copy the standalone merge guard (CLI + the few core modules it needs; no npm install required) into a repository. */
const fs = require('node:fs');
const path = require('node:path');

const FILES = ['bin/ide-guard.js', 'src/core/ciguard.js', 'src/core/guard.js', 'src/core/guardrules.js', 'src/core/oversight.js', 'src/core/scope.js', 'src/core/git.js', 'src/core/util.js'];

function exportGuard(dest, from = path.join(__dirname, '..')) {
  const seen = new Set();
  const queue = [...FILES];
  while (queue.length) {
    const rel = queue.pop();
    if (seen.has(rel)) continue;
    seen.add(rel);
    const text = fs.readFileSync(path.join(from, rel), 'utf8');
    for (const m of text.matchAll(/require\('(\.[^']+)'\)/g)) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1]));
      const file = fs.existsSync(path.join(from, `${target}.js`)) ? `${target}.js` : target;
      if (fs.existsSync(path.join(from, file)) && !seen.has(file)) queue.push(file);
    }
  }
  for (const rel of seen) {
    const to = path.join(dest, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(from, rel), to);
  }
  return [...seen].sort();
}

if (require.main === module) {
  const dest = process.argv[2];
  if (!dest) { console.error('usage: node scripts/export-guard.js <destination folder, e.g. my-repo/tools/bazinga>'); process.exit(2); }
  const files = exportGuard(path.resolve(dest));
  console.log(`Copied ${files.length} files to ${dest}:\n  ${files.join('\n  ')}`);
}
module.exports = { exportGuard, FILES };
