'use strict';
// shared helpers for tests that need a throw-away git repository
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const sh = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' });
const write = (root, rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
function tmpdir(prefix = 'bazinga-t-') { return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix))); }
function repo(files = { 'a.txt': 'one\n' }, { commit = true } = {}) {
  const root = tmpdir('bazinga-repo-');
  sh(root, 'init', '-q', '-b', 'main'); sh(root, 'config', 'user.email', 't@t'); sh(root, 'config', 'user.name', 't');
  for (const [k, v] of Object.entries(files)) write(root, k, v);
  if (commit) { sh(root, 'add', '.'); sh(root, 'commit', '-q', '-m', 'init'); }
  return root;
}
module.exports = { sh, write, tmpdir, repo };
