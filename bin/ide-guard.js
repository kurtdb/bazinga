#!/usr/bin/env node
'use strict';
/**
 * The Bazinga merge guard for pipelines: block a pull request that touches protected files, edits or deletes
 * existing tests (when the policy says so), fixes a bug without a test, or changes dependencies.
 *
 *   node bin/ide-guard.js --base origin/main              compare HEAD with the target branch
 *   node bin/ide-guard.js --task "$(PR title)"            task text, used to recognise bugfixes (default: the branch name)
 *   node bin/ide-guard.js --format azure|github|text|json annotations for the pipeline (default: text)
 *   node bin/ide-guard.js --strict                        warnings fail the build too
 *   node bin/ide-guard.js --comment                       also put the result on the pull request (Azure DevOps / GitHub; needs the pipeline's token)
 *
 * Rules and levels come from .ide/policy.json (the shared floor) and .ide/config.json (can only tighten).
 * Exit codes: 0 ok, 1 blockers (or warnings with --strict), 2 usage or git error.
 */
const path = require('node:path');
const { git } = require('../src/core/git');
const ci = require('../src/core/ciguard');

function parseArgs(argv, env = process.env) {
  const a = { root: process.cwd(), base: '', head: 'HEAD', task: '', branch: '', format: 'text', strict: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--root') a.root = path.resolve(argv[++i]);
    else if (k === '--base') a.base = argv[++i];
    else if (k === '--head') a.head = argv[++i];
    else if (k === '--task') a.task = argv[++i];
    else if (k === '--branch') a.branch = argv[++i];
    else if (k === '--format') a.format = argv[++i];
    else if (k === '--strict') a.strict = true;
    else if (k === '--comment') a.comment = true;
    else if (k === '-h' || k === '--help') a.help = true;
  }
  // pipeline defaults
  const target = env.SYSTEM_PULLREQUEST_TARGETBRANCH || env.GITHUB_BASE_REF || '';
  if (!a.base && target) a.base = `origin/${target.replace(/^refs\/heads\//, '')}`;
  if (!a.base) a.base = 'origin/main';
  if (!a.branch) a.branch = (env.SYSTEM_PULLREQUEST_SOURCEBRANCH || env.GITHUB_HEAD_REF || env.BUILD_SOURCEBRANCHNAME || '').replace(/^refs\/heads\//, '');
  return a;
}

async function main(argv = process.argv.slice(2)) {
  const a = parseArgs(argv);
  if (a.help) { console.log(require('node:fs').readFileSync(__filename, 'utf8').split('*/')[0].replace(/^#!.*\n'use strict';\n\/\*\*?/, '')); return 0; }
  if (!a.branch) { try { a.branch = (await git(a.root, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim(); } catch { /* detached */ } }
  let res;
  try { res = await ci.evaluateBranch({ root: a.root, base: a.base, head: a.head, task: a.task, branch: a.branch }); } catch (err) {
    console.error(`Could not compare ${a.head} with ${a.base}: ${String(err.message || err).split('\n')[0]}\nIn a shallow checkout fetch the target branch first (git fetch origin <branch> --depth=...), or set fetchDepth: 0.`);
    return 2;
  }
  if (a.format === 'json') console.log(JSON.stringify({ ...res.guard, files: res.files.length, base: res.base }, null, 2));
  else console.log(ci.format(res, a.format));
  if (a.comment) {
    const r = await require('../src/core/prcomment').post(res);
    console.log(r.posted ? `Pull request comment ${r.updated ? 'updated' : 'added'}.` : `No pull request comment: ${r.reason}`);
  }
  return res.guard.blockers > 0 || (a.strict && res.guard.warnings > 0) ? 1 : 0;
}

if (require.main === module) main().then((c) => process.exit(c), (e) => { console.error(e.message); process.exit(2); });
module.exports = { parseArgs, main };
