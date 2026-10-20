'use strict';
/**
 * A git hook that runs the Bazinga guard before a push (or merge commit) so a branch that breaks the policy is stopped locally.
 * The hook file carries a marker; an existing hook of yours is never overwritten.
 */
const fs = require('node:fs');
const path = require('node:path');
const { git } = require('./git');

const MARK = '# bazinga-hook';
const HOOKS = ['pre-push', 'pre-merge-commit'];

function script(cliPath, hook, base) {
  const cli = cliPath.replace(/\\/g, '/');
  return `#!/bin/sh\n${MARK} (${hook}): remove with  bazinga hook uninstall\n` +
    `[ -n "$BAZINGA_SKIP" ] && exit 0\n` +
    `node "${cli}" guard --base ${base} || { echo "Bazinga guard blocked this. Fix it, or skip once with BAZINGA_SKIP=1." >&2; exit 1; }\n`;
}

async function hooksDir(root) {
  const out = (await git(root, ['rev-parse', '--git-path', 'hooks'])).trim();
  return path.resolve(root, out);
}

async function install(root, { cliPath, base = 'origin/main', hooks = ['pre-push'] } = {}) {
  const dir = await hooksDir(root);
  fs.mkdirSync(dir, { recursive: true });
  const done = []; const skipped = [];
  for (const h of hooks) {
    if (!HOOKS.includes(h)) throw new Error(`Unknown hook: ${h} (use ${HOOKS.join(' or ')})`);
    if (!/^[\w./-]+$/.test(base)) throw new Error(`Not a usable branch name: ${base}`);
    const file = path.join(dir, h);
    if (fs.existsSync(file) && !fs.readFileSync(file, 'utf8').includes(MARK)) { skipped.push(`${h} (you already have one)`); continue; }
    fs.writeFileSync(file, script(cliPath, h, base), { mode: 0o755 });
    done.push(h);
  }
  return { dir, installed: done, skipped };
}

async function uninstall(root) {
  const dir = await hooksDir(root);
  const removed = [];
  for (const h of HOOKS) {
    const file = path.join(dir, h);
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf8').includes(MARK)) { fs.rmSync(file); removed.push(h); }
  }
  return { dir, removed };
}

/** Is Bazinga's pre-push hook there, and can one be installed (plain node cannot read files inside an app package)? */
async function status(root, cliPath) {
  const dir = await hooksDir(root);
  const file = path.join(dir, 'pre-push');
  let installed = false;
  try { installed = fs.readFileSync(file, 'utf8').includes(MARK); } catch { /* none */ }
  const foreign = !installed && fs.existsSync(file);
  return { installed, foreign, possible: !foreign && !!cliPath && !/\.asar([\\/]|$)/.test(cliPath) && fs.existsSync(cliPath) };
}

module.exports = { status, MARK, HOOKS, script, install, uninstall };
