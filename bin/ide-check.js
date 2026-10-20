#!/usr/bin/env node
'use strict';
/**
 * Run the same quality gates the IDE uses, from any terminal or as a Claude Code hook.
 *
 *   node bin/ide-check.js                      fast + slow gates on changed files
 *   node bin/ide-check.js --tier fast          only the fast gates
 *   node bin/ide-check.js --files all          every file, not just changed ones
 *   node bin/ide-check.js --only "ESLint,Ruff" selected gates
 *   node bin/ide-check.js --json               machine-readable output
 *   node bin/ide-check.js --all-findings       also count issues on lines you did not change (normally shown as legacy and ignored)
 *   node bin/ide-check.js --hook               Claude Code PostToolUse mode: silent when clean,
 *                                              prints errors to stderr and exits 2 so Claude fixes them
 *
 * Exit codes: 0 clean (warnings allowed), 1 errors found, 2 errors found in --hook mode.
 */
const path = require('node:path');
const { runChecks, formatFindings } = require('../src/core/checks');

function parseArgs(argv) {
  const args = { root: process.cwd(), tier: 'all', files: 'changed', json: false, hook: false, only: undefined, allFindings: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') args.root = path.resolve(argv[++i]);
    else if (a === '--tier') args.tier = argv[++i];
    else if (a === '--files') args.files = argv[++i];
    else if (a === '--only') args.only = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--json') args.json = true;
    else if (a === '--all-findings') args.allFindings = true;
    else if (a === '--hook') { args.hook = true; args.tier = 'fast'; }
    else if (a === '-h' || a === '--help') args.help = true;
  }
  return args;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(require('node:fs').readFileSync(__filename, 'utf8').split('*/')[0].replace(/^#!.*\n'use strict';\n\/\*\*?/, ''));
    return 0;
  }
  if (args.hook) process.stdin.resume().on('data', () => {}); // hook input is not needed; drain it

  const result = await runChecks(args.root, { tier: args.tier, files: args.files, only: args.only, changedLinesOnly: !args.allFindings });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return result.counts.error > 0 ? 1 : 0;
  }

  const errors = result.counts.error;
  if (args.hook) {
    if (errors === 0) return 0;
    process.stderr.write(`Quality gate: ${errors} error(s) in the files you just changed. Fix these before continuing:\n${formatFindings(result)}\n`);
    return 2;
  }

  for (const r of result.runs) {
    const mark = { passed: 'PASS', findings: 'FAIL', failed: 'FAIL', skipped: 'skip' }[r.status];
    console.log(`${mark.padEnd(5)} ${r.name}${r.note ? ` (${r.note})` : r.count ? ` (${r.count})` : ''}`);
  }
  if (result.findings.length) console.log(`\n${formatFindings(result)}`);
  const hidden = result.counts.legacy ? ` (${result.counts.legacy} pre-existing on untouched lines ignored; --all-findings shows them)` : '';
  console.log(`\n${result.counts.error} error(s), ${result.counts.warning} warning(s), ${result.counts.info} info in ${(result.durationMs / 1000).toFixed(1)}s${hidden}`);
  return errors > 0 ? 1 : 0;
}

if (require.main === module) main().then((code) => process.exit(code), (err) => { console.error(err.message); process.exit(1); });
module.exports = { parseArgs, main };
