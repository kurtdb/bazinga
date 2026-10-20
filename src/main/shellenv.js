'use strict';
const { spawnSync } = require('node:child_process');

/**
 * Apps started from Finder/Dock (macOS) or a desktop launcher (Linux) get a minimal PATH, so `claude`, `git`, `mvn`,
 * `node`, `rg` installed through Homebrew, nvm or SDKMAN are not found. Ask the user's login shell for its real PATH
 * and adopt it. Does nothing on Windows or when started from a terminal that already has a full PATH.
 */
function fixPath() {
  if (process.platform === 'win32' || process.env.BAZINGA_NO_PATHFIX) return false;
  const shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
  try {
    const res = spawnSync(shell, ['-ilc', 'echo "__BAZINGA_PATH__${PATH}__BAZINGA_PATH__"'], {
      encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, TERM: 'dumb' },
    });
    const m = /__BAZINGA_PATH__(.*?)__BAZINGA_PATH__/s.exec(res.stdout || '');
    if (!m || !m[1].trim()) return false;
    const merged = [...m[1].trim().split(':'), ...String(process.env.PATH || '').split(':')].filter(Boolean);
    process.env.PATH = [...new Set(merged)].join(':');
    return true;
  } catch { return false; }
}

module.exports = { fixPath };
