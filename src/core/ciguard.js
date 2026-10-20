'use strict';
/**
 * The merge guard outside the IDE: the same rules (protected paths, immutable/weakened tests, bugfix-needs-test,
 * dependency changes) evaluated on a branch against its target, so a pipeline can block the pull request.
 *
 * `.ide/policy.json` is the shared floor, committed with the project:
 *   { "oversight": "supervised", "mergeGuard": { "protectedPaths": "block", "testsImmutable": "block" }, "protectedPaths": ["db/**"] }
 * Users and `.ide/config.json` can make the guard stricter than the policy but never looser.
 */
const fs = require('node:fs');
const path = require('node:path');
const { git } = require('./git');
const { evaluateMerge, DEFAULT_POLICY } = require('./guard');
const scopeCore = require('./scope');
const { isTestPath } = scopeCore;
const { DEFAULT_PROTECTED } = require('./guardrules');
const oversight = require('./oversight');
const { toPosix } = require('./util');

const ORDER = { off: 0, warn: 1, block: 2 };
const strictest = (a, b) => ((ORDER[b] ?? -1) > (ORDER[a] ?? -1) ? b : a);
const ASSERTION_LINE = /\b(assert\w*|expect|should|verify|fail|toBe\w*|toEqual|toThrow|@Test|@Parameterized\w*|(?:it|test|describe)\s*\(|def\s+test_)/;

function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }

/** `git diff --name-status -z --no-renames` output -> [{path,status}] */
function parseNameStatus(text) {
  const parts = String(text || '').split('\0').filter(Boolean);
  const out = [];
  for (let i = 0; i + 1 < parts.length; i += 2) out.push({ status: parts[i][0], path: toPosix(parts[i + 1]) });
  return out;
}

/**
 * The floor: policy.json (its oversight preset first, explicit values after). Returns { mergeGuard, protectedPaths|null }.
 */
async function policyText(root, ref) {
  if (ref) { try { return await git(root, ['show', `${ref}:.ide/policy.json`]); } catch { /* not on that ref */ } }
  try { return fs.readFileSync(path.join(root, '.ide', 'policy.json'), 'utf8'); } catch { return null; }
}

function floorFrom(text) {
  let pol = null;
  try { pol = text ? JSON.parse(text) : null; } catch { /* unreadable policy */ }
  if (!pol || typeof pol !== 'object') return { mergeGuard: {}, protectedPaths: null, present: false };
  const merged = oversight.mergeLayers([pol]);
  return { mergeGuard: merged.mergeGuard || {}, protectedPaths: Array.isArray(pol.protectedPaths) ? pol.protectedPaths : null, present: true };
}

/**
 * Policy actually used: DEFAULT_POLICY < the user's/config's choices, then lifted to at least the floor of policy.json.
 * Protected paths: the union of the floor's list and the configured (or built-in) one.
 */
function effectivePolicy(root, { mergeGuard = {}, protectedPaths = null } = {}, floorText) {
  const floor = floorFrom(floorText !== undefined ? floorText : (() => { try { return fs.readFileSync(path.join(root, '.ide', 'policy.json'), 'utf8'); } catch { return null; } })());
  const wanted = { ...DEFAULT_POLICY, ...(mergeGuard || {}) };
  const policy = { ...wanted };
  for (const [rule, level] of Object.entries(floor.mergeGuard)) policy[rule] = strictest(policy[rule] || 'off', level);
  let globs = protectedPaths || DEFAULT_PROTECTED;
  if (floor.protectedPaths) globs = [...new Set([...globs, ...floor.protectedPaths])];
  return { policy, protectedGlobs: globs, floorPresent: floor.present };
}

async function removedAssertionsBetween(root, base, head, rel) {
  try {
    const diff = await git(root, ['diff', '--no-color', '-U0', `${base}...${head}`, '--', rel]);
    let n = 0;
    for (const line of diff.split('\n')) if (line.startsWith('-') && !line.startsWith('---') && ASSERTION_LINE.test(line)) n++;
    return n;
  } catch { return 0; }
}

/**
 * @returns {Promise<{guard, files:Array, base, head}>}
 */
async function evaluateBranch({ root, base, head = 'HEAD', task = '', branch = '' }) {
  const out = await git(root, ['-c', 'core.quotepath=false', 'diff', '--name-status', '-z', '--no-renames', `${base}...${head}`]);
  // .ide/ is the IDE's own state, except the shared policy: changing that in a PR must show up (it is protected)
  const files = parseNameStatus(out).filter((f) => !f.path.startsWith('.ide/') || f.path === '.ide/policy.json');
  const testEdits = [];
  for (const f of files) {
    if (!isTestPath(f.path) || f.status === 'A') continue;
    let sc = null;
    if (f.status !== 'D') { try { sc = scopeCore.compareStrength(scopeCore.testStrength(await git(root, ['show', `${base}:${f.path}`])), scopeCore.testStrength(await git(root, ['show', `${head}:${f.path}`]))); } catch { /* unreadable: no verdict */ } }
    testEdits.push({ path: f.path, status: f.status, removedAssertions: f.status === 'D' ? 0 : await removedAssertionsBetween(root, base, head, f.path), ...(sc ? { weaker: sc.weaker, reasons: sc.reasons } : {}) });
  }
  const cfg = readJson(path.join(root, '.ide', 'config.json')) || {};
  const level = oversight.isLevel(cfg.oversight) ? oversight.presetFor(cfg.oversight) : {};
  // the floor comes from the TARGET branch: a pull request cannot loosen the rules by editing the policy it is judged by
  let floorText = await policyText(root, base);
  if (floorText === null || floorText === undefined) floorText = await policyText(root, null);
  const { policy, protectedGlobs } = effectivePolicy(root, { mergeGuard: { ...(level.mergeGuard || {}), ...(cfg.mergeGuard || {}) }, protectedPaths: cfg.protectedPaths || null }, floorText);
  // rules that need a person at the IDE (review ticks, the agent's summary, a scope allowlist, local gates) do not apply in CI
  for (const id of ['unreviewed', 'summary', 'scope', 'gatesNotRun', 'errors']) policy[id] = 'off';
  const guard = evaluateMerge({ result: { findings: [] }, scope: { files, outOfScope: [], testEdits, report: null }, task, branch, policy, protectedGlobs });
  return { guard, files, base, head };
}

const esc = (s) => String(s).replace(/\r?\n/g, ' ');
/** Human text, or pipeline annotations for Azure DevOps / GitHub Actions. */
function format(res, kind = 'text') {
  const { guard } = res;
  const lines = [];
  for (const it of guard.items) {
    const files = it.files && it.files.length ? ` (${it.files.slice(0, 8).join(', ')}${it.files.length > 8 ? ', …' : ''})` : '';
    const msg = `${it.id}: ${it.text}${files}`;
    if (kind === 'azure') lines.push(`##vso[task.logissue type=${it.level === 'block' ? 'error' : 'warning'}]${esc(msg)}`);
    else if (kind === 'github') lines.push(`::${it.level === 'block' ? 'error' : 'warning'} title=Bazinga guard::${esc(msg)}`);
    else lines.push(`${it.level === 'block' ? 'BLOCK' : 'warn '} ${msg}`);
  }
  lines.push(guard.clean ? 'Guard: clean.' : `Guard: ${guard.blockers} blocker(s), ${guard.warnings} warning(s) in ${res.files.length} changed file(s) vs ${res.base}.`);
  return lines.join('\n');
}

module.exports = { parseNameStatus, floorFrom, effectivePolicy, evaluateBranch, format, strictest };
