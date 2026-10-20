#!/usr/bin/env node
'use strict';
/**
 * Bazinga without the window: the same gates, merge guard and local-model helper, for terminals, git hooks and pipelines.
 *
 *   bazinga check [options]        quality gates on the changed files (see: bazinga check --help)
 *   bazinga guard [options]        merge guard against a target branch; --comment puts the result on the pull request
 *   bazinga proxy [options]        tool-call helper for local models in front of Ollama / LM Studio (see: bazinga proxy --help)
 *   bazinga hook install|uninstall [--base origin/main] [--merge]   git pre-push (and pre-merge-commit) hook that runs the guard
 *   bazinga version
 */
const path = require('node:path');

const USAGE = require('node:fs').readFileSync(__filename, 'utf8').split('*/')[0].replace(/^#!.*\n'use strict';\n\/\*\*?/, '').replace(/^ \* ?/gm, '');

async function main(argv = process.argv.slice(2)) {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case 'check': return require('./ide-check').main(rest);
    case 'guard': return require('./ide-guard').main(rest);
    case 'proxy': return require('../src/core/proxycli').main(rest);
    case 'hook': {
      const hook = require('../src/core/githook');
      const sub = rest[0];
      const base = rest.includes('--base') ? rest[rest.indexOf('--base') + 1] : 'origin/main';
      try {
        if (sub === 'install') {
          const r = await hook.install(process.cwd(), { cliPath: path.resolve(__filename), base, hooks: rest.includes('--merge') ? ['pre-push', 'pre-merge-commit'] : ['pre-push'] });
          console.log(`${r.installed.length ? `Installed: ${r.installed.join(', ')} in ${r.dir}` : 'Nothing installed.'}${r.skipped.length ? `\nSkipped: ${r.skipped.join(', ')}` : ''}`);
          return r.installed.length ? 0 : 1;
        }
        if (sub === 'uninstall') { const r = await hook.uninstall(process.cwd()); console.log(r.removed.length ? `Removed: ${r.removed.join(', ')}` : 'No Bazinga hook found.'); return 0; }
      } catch (e) { console.error(`Hook: ${String(e.message).split('\n')[0]}`); return 2; }
      console.error('Usage: bazinga hook install|uninstall [--base origin/main] [--merge]'); return 2;
    }
    case 'version': case '--version': case '-v': console.log(require('../package.json').version); return 0;
    case undefined: case 'help': case '-h': case '--help': console.log(USAGE); return cmd === undefined ? 2 : 0;
    default: console.error(`Unknown command: ${cmd}\n\n${USAGE}`); return 2;
  }
}

if (require.main === module) main().then((c) => process.exit(c || 0), (e) => { console.error(e.message); process.exit(1); });
module.exports = { main };
