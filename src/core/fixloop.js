'use strict';
/**
 * Automatic fix loop: agent finishes -> quality gates run -> if they found problems the findings go back to the same
 * agent as its next prompt -> repeat, at most `maxRounds` times, and stop early when a round changes nothing.
 *
 * nextStep / buildFixPrompt are pure. FixLoop wires them to a terminal; all side effects are injected so it can be tested.
 */
const { formatFindings } = require('./checks');

const RANK = { error: 0, warning: 1, info: 2 };

/** The findings the loop acts on: not legacy (older than the task), at least `include` severe. */
function relevantFindings(result, include = 'error') {
  const max = RANK[include] === undefined ? 0 : RANK[include];
  return ((result && result.findings) || []).filter((f) => !f.legacy && RANK[f.severity] !== undefined && RANK[f.severity] <= max);
}

function fingerprint(findings) {
  // test failures also carry their output (digits stripped: timings, ports, line numbers): a different assertion message is progress
  const norm = (f) => (f.rule === 'test-failure' ? String(f.detail || '').replace(/\d+/g, '#').replace(/\s+/g, ' ').slice(-400) : '');
  return findings.map((f) => [f.tool, f.file || '', f.line || 0, f.rule || '', f.message, norm(f)].join('|')).sort().join('\n');
}

/**
 * @returns {{action:'done'|'fix'|'stop', reason:string, fingerprint?:string}}
 */
function nextStep({ round, maxRounds, findings, prevFingerprint }) {
  if (!findings.length) return { action: 'done', reason: round ? `clean after ${round} fix round${round === 1 ? '' : 's'}` : 'clean' };
  if (round >= maxRounds) return { action: 'stop', reason: `${findings.length} problem${findings.length === 1 ? '' : 's'} left after ${maxRounds} fix round${maxRounds === 1 ? '' : 's'}` };
  const fp = fingerprint(findings);
  if (prevFingerprint && fp === prevFingerprint) return { action: 'stop', reason: findings.every((f) => f.rule === 'test-failure') ? 'no progress: the same tests fail with the same output' : 'no progress: the same problems came back unchanged' };
  return { action: 'fix', reason: `${findings.length} problem${findings.length === 1 ? '' : 's'}`, fingerprint: fp };
}

function buildFixPrompt(result, { round, maxRounds, include = 'error' } = {}) {
  const list = relevantFindings(result, include);
  const body = formatFindings({ findings: list }, { limit: 40 });
  return [
    `The automatic quality gate found ${list.length} problem${list.length === 1 ? '' : 's'} in your changes (fix round ${round} of ${maxRounds}).`,
    'Fix the root cause of each one. Do not silence a rule, delete or weaken a test, or touch files unrelated to the task.',
    'Where a finding says a shared component or code already exists, reuse it instead of keeping a copy.',
    '',
    body,
    '',
    'When you are done, stop and wait; the gate will run again.',
  ].join('\n');
}

/**
 * Should the fix loop hand the work to a stronger agent instead of trying again? Only when the user named one, once per run
 * (the stronger agent is not handed on again), and only while problems remain: after `after` failed rounds, or when the loop
 * would give up (no progress, rounds used up).
 */
function shouldEscalate({ escalate, escalated, round, step, findings }) {
  if (!escalate || !escalate.agent || escalated || !findings.length) return false;
  const after = Math.max(1, Number(escalate.after) || 2);
  if (step.action === 'fix') return round >= after;
  return step.action === 'stop';
}

/** The first prompt of the agent that takes over: the task, who tried before, and what is still wrong. */
function buildEscalationPrompt(result, { task = '', from = 'another agent', round = 0, include = 'error' } = {}) {
  const list = relevantFindings(result, include);
  return [
    `You are taking over a task from ${from}. ${from} worked on it in this working copy and could not get the quality gate clean${round ? ` after ${round} fix round${round === 1 ? '' : 's'}` : ''}.`,
    task ? `\nThe task was:\n${String(task).slice(0, 4000)}` : '',
    '\nFirst look at what was already changed (git status, git diff), then keep what is right. Do not start over unless the approach itself is wrong.',
    `The gate still reports ${list.length} problem${list.length === 1 ? '' : 's'}:`,
    '',
    formatFindings({ findings: list }, { limit: 40 }),
    '',
    'Fix the root cause of each one. Do not silence a rule, delete or weaken a test, or touch files unrelated to the task. When you are done, stop and wait; the gate will run again.',
  ].filter((x) => x !== '').join('\n');
}

/** Terminal-safe single paste: bracketed paste so a multi-line prompt arrives as one message, then Enter. */
const asPaste = (text) => `\x1b[200~${text}\x1b[201~`;

class FixLoop {
  /**
   * deps: { getConfig(root) -> {enabled,maxRounds,tier,include}, runChecks(root, {tier}) -> result,
   *         paste(id, text), submit(id), emit(event), sleep(ms) }
   */
  constructor(deps) {
    this.deps = deps;
    this.terms = new Map(); // id -> { root, label, round, prev, busy }
  }

  register(id, { root, label, escalated = false }) { this.terms.set(id, { root, label: label || `terminal ${id}`, round: 0, prev: null, busy: false, escalated: !!escalated }); }
  unregister(id) { this.terms.delete(id); }
  /** Stop looping for this terminal (e.g. the run's time budget is used) without forgetting it. */
  pause(id, paused = true) { const t = this.terms.get(id); if (t) t.paused = !!paused; }

  /** The user typed into the terminal: they took over, so the round counter starts again. */
  userInput(id) {
    const t = this.terms.get(id);
    if (t && !t.busy) { t.round = 0; t.prev = null; }
  }

  /** The agent in terminal `id` went quiet. Returns what was done, mostly for tests. */
  async onIdle(id) {
    const t = this.terms.get(id);
    if (!t || t.busy) return { action: 'ignored' };
    if (t.paused) return { action: 'paused' };
    const cfg = this.deps.getConfig(t.root) || {};
    if (!cfg.enabled) return { action: 'disabled' };
    t.busy = true;
    try {
      this.deps.emit({ id, label: t.label, state: 'checking', round: t.round, maxRounds: cfg.maxRounds });
      const result = await this.deps.runChecks(t.root, { tier: cfg.tier || 'fast' });
      if (!result || result.error) {
        this.deps.emit({ id, label: t.label, state: 'error', round: t.round, maxRounds: cfg.maxRounds, reason: (result && result.error) || 'checks failed' });
        return { action: 'error' };
      }
      const findings = relevantFindings(result, cfg.include);
      const step = nextStep({ round: t.round, maxRounds: cfg.maxRounds, findings, prevFingerprint: t.prev });
      if (this.deps.escalate && shouldEscalate({ escalate: cfg.escalate, escalated: t.escalated, round: t.round, step, findings })) {
        let handled = false;
        try { handled = await this.deps.escalate({ id, root: t.root, label: t.label, result, findings, round: t.round, reason: step.reason, include: cfg.include, agent: cfg.escalate.agent }); } catch { handled = false; }
        if (handled) {
          t.escalated = true;
          this.deps.emit({ id, label: t.label, state: 'escalating', round: t.round, maxRounds: cfg.maxRounds, reason: `handed over to ${cfg.escalate.agent}`, count: findings.length, to: cfg.escalate.agent });
          t.round = 0; t.prev = null;
          return { action: 'escalate', reason: `handed over to ${cfg.escalate.agent}`, to: cfg.escalate.agent };
        }
      }
      if (step.action !== 'fix') {
        this.deps.emit({ id, label: t.label, state: step.action, round: t.round, maxRounds: cfg.maxRounds, reason: step.reason, count: findings.length });
        t.round = 0; t.prev = null;
        return step;
      }
      t.round += 1; t.prev = step.fingerprint;
      this.deps.emit({ id, label: t.label, state: 'fixing', round: t.round, maxRounds: cfg.maxRounds, reason: step.reason, count: findings.length });
      this.deps.paste(id, buildFixPrompt(result, { round: t.round, maxRounds: cfg.maxRounds, include: cfg.include }));
      await (this.deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms))))(150);
      this.deps.submit(id);
      return { ...step, round: t.round };
    } finally {
      t.busy = false;
    }
  }
}

module.exports = { relevantFindings, fingerprint, nextStep, shouldEscalate, buildEscalationPrompt, buildFixPrompt, asPaste, FixLoop };
