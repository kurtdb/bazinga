'use strict';
/**
 * Orchestrated agent workflows: a few agent runs chained with gates and human checkpoints.
 * A workflow file (YAML, `.ide/workflows/*.yaml` or the IDE-level folder) lists steps; this module parses and validates it
 * and decides, from the state of the steps, what may start next. It never starts anything itself.
 *
 *   name: Fix bug with review
 *   mode: interactive              # unattended = each step runs `claude -p` (no live terminal; the process ending is the done signal)
 *   finish: none                   # merge = after the last step, merge the runs while the merge guard has nothing to say
 *   steps:
 *     - id: reproduce
 *       agent: Claude                  # optional: default agent
 *       task: "Write a failing test for: {input}"
 *       gate: tests-added              # none | guard | tests-added | tests-untouched
 *       timeout: 30                    # minutes; a step still running after that is stopped and fails (default: no limit)
 *       approval: human                # pause for your OK before the next step starts (default: oversight level decides)
 *     - id: fix
 *       needs: [reproduce]
 *       task: "Make the failing test pass."
 */
const YAML = require('yaml');

const GATES = ['none', 'guard', 'tests-added', 'tests-untouched', 'changed', 'refactor'];
const STATUS = ['waiting', 'ready', 'running', 'awaiting-gate', 'awaiting-approval', 'passed', 'failed', 'skipped'];
const DONE = new Set(['passed', 'skipped']);
const MODES = ['interactive', 'unattended'];
const FINISHES = ['none', 'merge'];
const MAX_STEPS = 12;
const MAX_RETRIES = 3;
const MAX_TIMEOUT = 240; // minutes
const ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,30}$/;

/** @returns {{ workflow?: object, errors: string[] }} */
function parse(text, source = 'workflow') {
  const errors = [];
  let doc;
  try { doc = YAML.parse(String(text || '')); } catch (e) { return { errors: [`${source}: not valid YAML (${String(e.message).split('\n')[0]})`] }; }
  if (!doc || typeof doc !== 'object') return { errors: [`${source}: empty`] };
  const name = String(doc.name || '').trim().slice(0, 80);
  if (!name) errors.push(`${source}: name is missing`);
  const mode = doc.mode === undefined ? 'interactive' : String(doc.mode);
  if (!MODES.includes(mode)) errors.push(`${source}: mode must be ${MODES.join(' or ')}`);
  const finish = doc.finish === undefined ? 'none' : String(doc.finish);
  if (!FINISHES.includes(finish)) errors.push(`${source}: finish must be ${FINISHES.join(' or ')}`);
  const raw = Array.isArray(doc.steps) ? doc.steps : [];
  if (!raw.length) errors.push(`${source}: no steps`);
  if (raw.length > MAX_STEPS) errors.push(`${source}: at most ${MAX_STEPS} steps`);
  const steps = [];
  const ids = new Set();
  for (const [i, s] of raw.slice(0, MAX_STEPS).entries()) {
    const where = `${source} step ${i + 1}`;
    if (!s || typeof s !== 'object') { errors.push(`${where}: not an object`); continue; }
    const id = String(s.id || '');
    if (!ID_RE.test(id)) errors.push(`${where}: id must be letters, digits, - or _ (got "${id}")`);
    if (ids.has(id)) errors.push(`${where}: duplicate id ${id}`);
    ids.add(id);
    const task = String(s.task || '').trim();
    if (!task) errors.push(`${where}: task is missing`);
    const gate = s.gate === undefined ? 'none' : String(s.gate);
    if (!GATES.includes(gate)) errors.push(`${where}: gate must be one of ${GATES.join(', ')}`);
    const needs = s.needs === undefined ? [] : Array.isArray(s.needs) ? s.needs.map(String) : [String(s.needs)];
    const approval = s.approval === undefined ? null : String(s.approval);
    if (approval !== null && !['human', 'none'].includes(approval)) errors.push(`${where}: approval must be human or none`);
    const retries = s.retries === undefined ? 1 : Number(s.retries);
    if (!Number.isInteger(retries) || retries < 0 || retries > MAX_RETRIES) errors.push(`${where}: retries must be 0 to ${MAX_RETRIES}`);
    const timeout = s.timeout === undefined ? 0 : Number(s.timeout);
    if (!Number.isInteger(timeout) || timeout < 0 || timeout > MAX_TIMEOUT) errors.push(`${where}: timeout must be 0 (none) to ${MAX_TIMEOUT} minutes`);
    steps.push({ id, task: task.slice(0, 8000), agent: s.agent ? String(s.agent) : '', gate, needs, approval, retries, timeout, allow: s.allow ? String(s.allow) : '' });
  }
  for (const s of steps) for (const n of s.needs) if (!ids.has(n)) errors.push(`${source}: step ${s.id} needs unknown step ${n}`);
  const order = errors.length ? null : topoOrder(steps);
  if (!errors.length && !order) errors.push(`${source}: the steps depend on each other in a circle`);
  if (errors.length) return { errors };
  return { workflow: { name, description: String(doc.description || '').slice(0, 300), mode, finish, steps: order }, errors: [] };
}

/** Steps in a valid execution order, or null when there is a cycle. */
function topoOrder(steps) {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const out = []; const state = new Map();
  const visit = (s) => {
    if (state.get(s.id) === 2) return true;
    if (state.get(s.id) === 1) return false;
    state.set(s.id, 1);
    for (const n of s.needs) { const d = byId.get(n); if (d && !visit(d)) return false; }
    state.set(s.id, 2); out.push(s);
    return true;
  };
  for (const s of steps) if (!visit(s)) return null;
  return out;
}

/** {input} in a step's task: the text you typed when starting the workflow; {previous}: the ids' branches are mentioned for context. */
function renderTask(step, { input = '' } = {}) {
  return step.task.split('{input}').join(String(input || '').trim());
}

/**
 * Which steps may start now. A step is ready when every step it needs has passed (or was skipped).
 * `approvalDefault` is true when the oversight level wants a human OK after every step (Guided, Step by step).
 * @param {object[]} steps
 * @param {Object<string,{status:string,attempts?:number}>} state
 */
function nextSteps(steps, state) {
  const st = (id) => (state[id] && state[id].status) || 'waiting';
  const blockedByFailure = steps.some((s) => st(s.id) === 'failed');
  if (blockedByFailure) return { start: [], reason: 'a step failed' };
  const paused = steps.find((s) => st(s.id) === 'awaiting-approval');
  if (paused) return { start: [], reason: `waiting for your approval of ${paused.id}` };
  const start = steps.filter((s) => st(s.id) === 'waiting' && s.needs.every((n) => DONE.has(st(n))));
  return { start: start.map((s) => s.id), reason: start.length ? '' : (steps.every((s) => DONE.has(st(s.id))) ? 'finished' : 'waiting for running steps') };
}

/** What happens when a step's agent has gone quiet and its gate result is known. */
function afterGate(step, { gatePassed, attempts = 1, approvalDefault = false }) {
  if (!gatePassed) return attempts > step.retries ? { status: 'failed', reason: `gate "${step.gate}" failed after ${attempts} attempt(s)` } : { status: 'running', retry: true, reason: `gate "${step.gate}" failed: sending the findings back (attempt ${attempts + 1})` };
  const needsHuman = step.approval === 'human' || (step.approval === null && approvalDefault);
  return needsHuman ? { status: 'awaiting-approval' } : { status: 'passed' };
}

/** Gate checks over the files a step changed ({path,status}) using the merge-guard modules. */
function checkGate(gate, { files = [], guard = null }) {
  const { isTestPath } = require('./scope');
  switch (gate) {
    case 'none': return { passed: true };
    case 'guard': return guard && guard.ok === false ? { passed: false, why: `${guard.blockers} merge-guard blocker(s)` } : { passed: true };
    case 'tests-added': return files.some((f) => isTestPath(f.path) && f.status !== 'D') ? { passed: true } : { passed: false, why: 'no test was added or changed' };
    case 'changed': return files.length ? { passed: true } : { passed: false, why: 'the agent changed no files' };
    case 'refactor': {
      if (!files.length) return { passed: false, why: 'the agent changed no files' };
      const touched = files.filter((f) => isTestPath(f.path) && !['A', '?'].includes(f.status));
      return touched.length ? { passed: false, why: `existing tests changed: ${touched.map((f) => f.path).join(', ')}` } : { passed: true };
    }
    case 'tests-untouched': { const edited = files.filter((f) => isTestPath(f.path) && !['A', '?'].includes(f.status)); return edited.length ? { passed: false, why: `existing tests changed: ${edited.map((f) => f.path).join(', ')}` } : { passed: true }; }
    default: return { passed: false, why: `unknown gate ${gate}` };
  }
}

/** Workflow object (from the editor) -> YAML text. Defaults are left out so the file stays short. */
function serialize(wf) {
  const doc = { name: String(wf.name || '').trim() };
  if (wf.description && String(wf.description).trim()) doc.description = String(wf.description).trim();
  if (wf.mode && wf.mode !== 'interactive') doc.mode = wf.mode;
  if (wf.finish && wf.finish !== 'none') doc.finish = wf.finish;
  doc.steps = (wf.steps || []).map((s) => {
    const o = { id: s.id };
    if (s.agent) o.agent = s.agent;
    if (s.needs && s.needs.length) o.needs = s.needs;
    o.task = s.task;
    if (s.gate && s.gate !== 'none') o.gate = s.gate;
    if (s.approval) o.approval = s.approval;
    if (s.retries !== undefined && s.retries !== 1) o.retries = s.retries;
    if (s.timeout) o.timeout = s.timeout;
    if (s.allow) o.allow = s.allow;
    return o;
  });
  return YAML.stringify(doc, { lineWidth: 0 });
}

/** Validate a workflow object exactly as a file would be: errors are the same ones parse() reports. */
function validate(wf) { return parse(serialize(wf), 'workflow').errors; }

/** A file name for a workflow: letters, digits, dashes. */
const fileName = (name) => `${String(name || 'workflow').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'workflow'}.yaml`;

/**
 * Left-to-right layout for drawing: column = longest chain of dependencies before the step, row = order within the column.
 * @returns {{ nodes: Array<{id,col,row,x,y}>, edges: Array<{from,to}>, width, height, node:{w,h} }}
 */
function layout(steps, { w = 112, h = 30, gapX = 36, gapY = 12, pad = 6 } = {}) {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const col = new Map();
  const depth = (s, seen = new Set()) => {
    if (col.has(s.id)) return col.get(s.id);
    if (seen.has(s.id)) return 0; // cycle: invalid workflows are rejected by parse(); never loop here
    seen.add(s.id);
    const d = s.needs.length ? 1 + Math.max(...s.needs.map((n) => (byId.get(n) ? depth(byId.get(n), seen) : -1))) : 0;
    col.set(s.id, Math.max(0, d));
    return col.get(s.id);
  };
  for (const s of steps) depth(s);
  const rows = new Map();
  const nodes = steps.map((s) => {
    const c = col.get(s.id);
    const r = rows.get(c) || 0; rows.set(c, r + 1);
    return { id: s.id, col: c, row: r, x: pad + c * (w + gapX), y: pad + r * (h + gapY) };
  });
  const edges = [];
  for (const s of steps) for (const n of s.needs) if (byId.has(n)) edges.push({ from: n, to: s.id });
  const cols = nodes.length ? Math.max(...nodes.map((n) => n.col)) + 1 : 0;
  const maxRows = Math.max(0, ...rows.values());
  return { nodes, edges, node: { w, h }, width: pad * 2 + cols * w + Math.max(0, cols - 1) * gapX, height: pad * 2 + maxRows * h + Math.max(0, maxRows - 1) * gapY };
}

const BUILTIN = [
  `name: Fix a bug (test first, separate review)
description: Reproduce with a failing test, fix it, then let a second agent review the diff.
steps:
  - id: reproduce
    task: "Write a failing test that reproduces this bug, and nothing else: {input}"
    gate: tests-added
  - id: fix
    needs: [reproduce]
    task: "Make the failing test pass with a minimal fix. Do not change existing tests."
    gate: guard
  - id: review
    needs: [fix]
    task: "Review the changes in this branch against REVIEW.md and report problems. Do not change files."
    approval: human
`,
  `name: Refactor with frozen tests
description: Refactor while every existing test stays untouched.
steps:
  - id: refactor
    task: "Refactor: {input}\\n\\nWork on the files named above (find them first if only an area is named) and make the changes yourself with the Edit tool. Nobody is here to answer questions. Behaviour must not change, and existing tests must stay untouched."
    gate: refactor
  - id: check
    needs: [refactor]
    task: "Run the tests and report what fails, if anything. Do not change files."
    approval: human
`,
];

module.exports = { MAX_TIMEOUT, MODES, FINISHES, layout, serialize, validate, fileName, GATES, STATUS, MAX_STEPS, parse, topoOrder, renderTask, nextSteps, afterGate, checkGate, BUILTIN };
