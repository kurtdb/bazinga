'use strict';
const { quote } = require('./container');

/**
 * Agent terminals run in a login shell, and the shell's startup files (~/.zshrc, ~/.zprofile ...) run AFTER the environment
 * was handed to it, so an `export ANTHROPIC_API_KEY=...` there silently wins over the agent button's settings
 * (a "local model" agent then talks to the paid API). Setting the variables on the command line itself happens after
 * the startup files, so they cannot be overridden.
 */
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function shellKindFor(shell, platform) {
  const sh = String(shell || '').toLowerCase();
  if (/powershell|pwsh/.test(sh)) return 'ps';
  if (/(^|[\\/])cmd(\.exe)?$/.test(sh)) return 'cmd';
  if (!sh && platform === 'win32') return 'ps';
  return 'posix';
}

const val = (v, kind) => (String(v) === '' ? "''" : quote(String(v), kind));

/** The text to put in front of the command line, or '' when there is nothing to set. */
function prefixFor(env, kind = 'posix') {
  const entries = Object.entries(env || {}).filter(([k]) => NAME.test(k));
  if (!entries.length) return '';
  if (kind === 'ps') return `${entries.map(([k, v]) => `$env:${k}=${val(v, 'ps')}`).join('; ')}; `;
  if (kind === 'cmd') {
    for (const [, v] of entries) if (/["%&|<>^\r\n]/.test(String(v))) throw new Error('A value contains a character cmd.exe cannot set safely.');
    return `${entries.map(([k, v]) => `set "${k}=${v}"`).join(' && ')} && `;
  }
  return `env ${entries.map(([k, v]) => `${k}=${val(v, 'posix')}`).join(' ')} `;
}

/** The text typed into the terminal with the variables in front; an empty line stays empty. */
function applyTo(line, env, kind) {
  if (!String(line || '').trim()) return line;
  return `${prefixFor(env, kind)}${line}`;
}

module.exports = { prefixFor, applyTo, shellKindFor };
