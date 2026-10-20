'use strict';
/** Small pure helpers the main process relies on, kept here so they can be unit-tested without Electron. */
const fs = require('node:fs');
const path = require('node:path');

/** Resolve `rel` inside `base`; throws when it would escape (../, absolute paths elsewhere). */
function resolveWithin(base, rel) {
  const abs = path.resolve(base, rel || '.');
  if (abs !== base && !abs.startsWith(base + path.sep)) throw new Error('Path is outside the project.');
  return abs;
}

/** 'powershell' | 'cmd' | 'posix': how arguments must be quoted for the configured terminal shell. */
function shellKindOf(config, { platform = process.platform, env = process.env } = {}) {
  const sh = String((config && config.shell) || (platform === 'win32' ? 'powershell.exe' : env.SHELL || 'sh')).split(/[\\/]/).pop().toLowerCase(); // either separator: a Windows path is also judged correctly on other systems
  if (/^(powershell|pwsh)/.test(sh)) return 'powershell';
  if (/^cmd/.test(sh)) return 'cmd';
  return 'posix';
}

/** Language-server settings: user settings < the project's .ide/config.json. Servers the project defines are flagged `fromProject` (they need approval). */
function lspConfigFor(root, settings = {}) {
  const global = (settings && settings.lsp) || {};
  let project = {};
  try { project = JSON.parse(fs.readFileSync(path.join(root, '.ide', 'config.json'), 'utf8')).lsp || {}; } catch { /* no project config */ }
  const servers = {};
  for (const [n, v] of Object.entries(global.servers || {})) servers[n] = { ...v };
  for (const [n, v] of Object.entries(project.servers || {})) servers[n] = { ...(servers[n] || {}), ...v, fromProject: true };
  return { enabled: project.enabled !== undefined ? !!project.enabled : !!global.enabled, servers };
}

/** New list of trusted project roots with `root` added once. */
function withTrusted(state, root) {
  const trusted = Array.isArray(state && state.trusted) ? state.trusted : [];
  return { ...(state || {}), trusted: trusted.includes(root) ? trusted : [...trusted, root] };
}

module.exports = { resolveWithin, shellKindOf, lspConfigFor, withTrusted };
