'use strict';
// shared helpers for tests that need a throw-away git repository
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const sh = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' });
const write = (root, rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
function tmpdir(prefix = 'bazinga-t-') { return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix))); }
// A `net` IPC address for tests (an agentd-style control socket). On Windows a filesystem path is not a valid
// one - it needs the \\.\pipe\ namespace, same as src/main/main.js's own socketPath() for the real daemon - so
// this mirrors that rather than letting every test re-discover it as a hang (tests run one file per process,
// but node:test can run several files at once, so the name still needs to be unique across processes).
let sockSeq = 0;
function sockFor(name = 'sock') {
  return process.platform === 'win32' ? `\\\\.\\pipe\\bazinga-test-${name}-${process.pid}-${++sockSeq}` : path.join(tmpdir(), `${name}.sock`);
}
function repo(files = { 'a.txt': 'one\n' }, { commit = true } = {}) {
  const root = tmpdir('bazinga-repo-');
  // Windows' git defaults to core.autocrlf=true, which rewrites LF to CRLF on checkout/restore and breaks exact-content
  // assertions; pin it off so this throw-away repo behaves the same on every platform.
  sh(root, 'init', '-q', '-b', 'main'); sh(root, 'config', 'user.email', 't@t'); sh(root, 'config', 'user.name', 't'); sh(root, 'config', 'core.autocrlf', 'false');
  for (const [k, v] of Object.entries(files)) write(root, k, v);
  if (commit) { sh(root, 'add', '.'); sh(root, 'commit', '-q', '-m', 'init'); }
  return root;
}
module.exports = { sh, write, tmpdir, repo, sockFor };
