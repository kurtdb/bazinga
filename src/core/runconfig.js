'use strict';
/**
 * Saved run configurations: .ide/run.json, shared with the team through git.
 *   { "configs": [ { "name": "Orders (dev, debug)", "dir": "orders", "profile": "dev", "env": "DB_URL=jdbc:h2:mem:x", "jvmArgs": "-Xmx512m", "debugPort": 5005 } ] }
 */
const fs = require('node:fs');
const path = require('node:path');
const { checkProfile, checkJvmArgs, checkDebugPort, parseEnv } = require('./spring');

const file = (root) => path.join(root, '.ide', 'run.json');

/** Throws a readable error for anything that must not reach a command line; returns the cleaned config. */
function validate(cfg) {
  if (!cfg || typeof cfg !== 'object') throw new Error('Not a run configuration.');
  const name = String(cfg.name || '').trim();
  if (!name || name.length > 60) throw new Error('A configuration needs a name (up to 60 characters).');
  const dir = String(cfg.dir || '').replace(/\\/g, '/');
  if (dir.split('/').includes('..') || path.isAbsolute(dir)) throw new Error('The module folder must be inside the project.');
  const env = String(cfg.env || '');
  parseEnv(env);
  return { name, dir: dir.replace(/^\.\/?/, '').replace(/\/+$/, ''), profile: checkProfile(cfg.profile), env, jvmArgs: checkJvmArgs(cfg.jvmArgs), debugPort: checkDebugPort(cfg.debugPort) };
}

function loadRunConfigs(root) {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file(root), 'utf8')); } catch { return []; }
  const out = [];
  for (const c of Array.isArray(raw && raw.configs) ? raw.configs : []) { try { out.push(validate(c)); } catch { /* a hand-edited bad entry is skipped, not fatal */ } }
  return out;
}

function write(root, configs) {
  fs.mkdirSync(path.dirname(file(root)), { recursive: true });
  const tmp = `${file(root)}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify({ configs }, null, 2)}\n`);
  fs.renameSync(tmp, file(root));
}

/** Add or replace (same name) a configuration. */
function saveRunConfig(root, cfg) {
  const clean = validate(cfg);
  const list = loadRunConfigs(root).filter((c) => c.name !== clean.name);
  list.push(clean);
  list.sort((a, b) => a.name.localeCompare(b.name));
  write(root, list);
  return clean;
}

function deleteRunConfig(root, name) {
  const list = loadRunConfigs(root);
  const next = list.filter((c) => c.name !== name);
  if (next.length !== list.length) write(root, next);
  return list.length - next.length;
}

module.exports = { validate, loadRunConfigs, saveRunConfig, deleteRunConfig };
