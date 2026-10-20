'use strict';
const rules = require('./guardrules');
/**
 * Merge guard: is this agent run fit to be merged?  Pure policy; the data (gate result, scope analysis) comes from the caller.
 *
 * Each rule maps to 'block' (merge needs an explicit override), 'warn' (shown, merge allowed) or 'off'.
 */
const DEFAULT_POLICY = {
  errors: 'block',       // gate errors in your changes
  gatesNotRun: 'warn',   // the gates could not be run at all
  tests: 'block',        // existing tests deleted, or assertions removed from them
  scope: 'warn',         // files outside the task's allowlist
  unreviewed: 'warn',    // changed files you have not ticked as reviewed
  summary: 'warn',       // files missing from the agent's own summary
  protectedPaths: 'block', // files matching the protected globs (env files, CI workflows, keys ...)
  bugfixTest: 'warn',    // a bugfix task that changed source but added/touched no test
  testsImmutable: 'off', // option: existing unit/integration tests must not be edited at all (new ones are fine)
  dependencies: 'warn',  // dependency manifests or lockfiles changed
};

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/**
 * @param {object} p
 * @param {object|null} p.result   gate result ({findings, files}) or null when the gates could not run
 * @param {string} [p.gateError]   why the gates could not run
 * @param {object} p.scope         analyzeScope() output
 * @param {string[]} [p.reviewed]  files the user marked as reviewed
 * @param {object} [p.policy]
 * @param {string} [p.task]  task text and branch name, used to spot bugfixes
 * @param {string[]} [p.protectedGlobs] protected path globs (defaults to guardrules.DEFAULT_PROTECTED)
 * @returns {{ items: Array<{id,level,text,files?:string[]}>, blockers:number, warnings:number, ok:boolean, clean:boolean }}
 */
function evaluateMerge({ result, gateError, scope, reviewed = [], policy = {}, task = '', branch = '', protectedGlobs }) {
  const pol = { ...DEFAULT_POLICY, ...(policy || {}) };
  const items = [];
  const add = (id, text, files) => { if (pol[id] && pol[id] !== 'off') items.push({ id, level: pol[id], text, files }); };

  if (!result) {
    add('gatesNotRun', `Quality gates could not be run${gateError ? `: ${gateError}` : ''}`);
  } else {
    const errors = (result.findings || []).filter((f) => !f.legacy && f.severity === 'error');
    if (errors.length) add('errors', `${plural(errors.length, 'gate error')} in the changes`, [...new Set(errors.map((f) => f.file).filter(Boolean))]);
  }

  const analysis = scope || { files: [], outOfScope: [], testEdits: [], report: null };
  const weakened = (analysis.testEdits || []).filter((t) => t.status === 'D' || t.removedAssertions > 0 || t.weaker);
  if (weakened.length) add('tests', `${plural(weakened.length, 'existing test')} deleted or weakened (${weakened.some((t) => t.weaker) ? 'fewer test cases or assertions, or always-true assertions' : 'assertions removed'})`, weakened.map((t) => t.path));
  if ((analysis.outOfScope || []).length) add('scope', `${plural(analysis.outOfScope.length, 'file')} outside the task scope`, analysis.outOfScope);

  const taskFiles = (analysis.files || []).map((f) => f.path).filter((p) => !p.startsWith('.ide/'));
  const reviewedSet = new Set(reviewed);
  const unreviewed = taskFiles.filter((p) => !reviewedSet.has(p));
  if (unreviewed.length) add('unreviewed', `${unreviewed.length} of ${plural(taskFiles.length, 'changed file')} not marked as reviewed`, unreviewed);

  const unexplained = (analysis.report && analysis.report.unexplained) || [];
  if (unexplained.length) add('summary', `${plural(unexplained.length, 'file')} missing from the agent’s own summary`, unexplained);

  const changedFiles = analysis.files || [];
  const prot = rules.protectedHits(changedFiles, protectedGlobs);
  if (prot.length) add('protectedPaths', `${plural(prot.length, 'protected file')} changed`, prot);
  if (rules.bugfixWithoutTest({ task, branch, files: changedFiles })) add('bugfixTest', 'Looks like a bugfix, but no test was added or changed');
  const edited = rules.modifiedTests(changedFiles);
  if (edited.length) add('testsImmutable', `${plural(edited.length, 'existing test file')} modified or deleted (tests are immutable)`, edited);
  const deps = rules.dependencyFiles(changedFiles);
  if (deps.length) add('dependencies', `${plural(deps.length, 'dependency file')} changed`, deps);

  const blockers = items.filter((i) => i.level === 'block').length;
  const warnings = items.filter((i) => i.level === 'warn').length;
  return { items, blockers, warnings, ok: blockers === 0, clean: items.length === 0 };
}

module.exports = { DEFAULT_POLICY, evaluateMerge };
