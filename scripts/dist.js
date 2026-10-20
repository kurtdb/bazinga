#!/usr/bin/env node
'use strict';
/**
 * Build the installers:  node scripts/dist.js --win --x64   |   --mac   |   --linux   (npm run dist:win / dist:mac)
 *
 * Why a wrapper: the package.json build config publishes to GitHub (for the update feed). electron-builder finds the repository by
 * reading .git/config; in a folder without git (a downloaded zip) it cannot, and the macOS build then ends with
 * "Cannot read properties of null (reading 'channel')". Here the update feed is only configured when a GitHub repository can be
 * found; otherwise the build runs without one (the app works, it just does not look for updates).
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

/** { publish } for the build config: the configured one when a GitHub repository is known, else null. */
function choosePublish({ remoteUrl = '', env = {}, configured }) {
  const fromGit = /github\.com[:/]+[^/\s]+\/[^/\s]+?(\.git)?\s*$/i.test(String(remoteUrl).trim());
  const fromCi = /^[^/\s]+\/[^/\s]+$/.test(String(env.GITHUB_REPOSITORY || ''));
  const explicit = Array.isArray(configured) && configured.some((p) => p && typeof p === 'object' && p.owner && p.repo);
  if (fromGit || fromCi || explicit) return { publish: configured, why: '' };
  return { publish: null, why: 'No GitHub repository found (no .git folder or remote), so this build has no update feed. Everything else is the same.' };
}

function main(argv) {
  const root = path.join(__dirname, '..');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const git = spawnSync('git', ['config', '--get', 'remote.origin.url'], { cwd: root, encoding: 'utf8' });
  const { publish, why } = choosePublish({ remoteUrl: git.status === 0 ? git.stdout : '', env: process.env, configured: pkg.build.publish });
  if (why) console.log(`[dist] ${why}`);
  const config = { ...pkg.build, publish };
  const file = path.join(os.tmpdir(), `bazinga-builder-${process.pid}.json`);
  fs.writeFileSync(file, JSON.stringify(config));
  try {
    const bin = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder');
    const r = spawnSync(bin, ['--config', file, '--publish', 'never', ...argv], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
    return r.status === null ? 1 : r.status;
  } finally { try { fs.rmSync(file, { force: true }); } catch { /* temp file */ } }
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { choosePublish };
