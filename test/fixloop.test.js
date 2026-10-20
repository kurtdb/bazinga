'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { IdleDetector } = require('../src/core/idle');
const { nextStep, buildFixPrompt, relevantFindings, fingerprint, FixLoop } = require('../src/core/fixloop');

const F = (message, extra = {}) => ({ tool: 'ESLint', file: 'a.js', line: 3, severity: 'error', message, ...extra });

test('idle: output followed by silence is idle exactly once', () => {
  let t = 1000;
  const d = new IdleDetector({ idleMs: 5000, minBytes: 100, now: () => t });
  d.feed('x'.repeat(500));
  t += 4000; assert.strictEqual(d.poll(), false);
  t += 2000; assert.strictEqual(d.poll(), true);
  t += 9000; assert.strictEqual(d.poll(), false, 'only once per busy period');
});

test('idle: echo of your own typing never counts as agent work', () => {
  let t = 0;
  const d = new IdleDetector({ idleMs: 1000, minBytes: 100, now: () => t });
  d.feed('x'.repeat(500)); d.input();
  d.feed('ls'); // echo
  t += 5000;
  assert.strictEqual(d.poll(), false);
});

test('idle: continuous output keeps it busy', () => {
  let t = 0;
  const d = new IdleDetector({ idleMs: 1000, minBytes: 10, now: () => t });
  for (let i = 0; i < 10; i++) { d.feed('spinner frame'); t += 500; assert.strictEqual(d.poll(), false); }
});

test('relevantFindings drops legacy findings and respects the severity threshold', () => {
  const r = { findings: [F('a'), F('b', { legacy: true }), F('c', { severity: 'warning' }), F('d', { severity: 'info' })] };
  assert.deepStrictEqual(relevantFindings(r).map((f) => f.message), ['a']);
  assert.deepStrictEqual(relevantFindings(r, 'warning').map((f) => f.message), ['a', 'c']);
});

test('nextStep: done, fix, round limit and no-progress', () => {
  assert.strictEqual(nextStep({ round: 0, maxRounds: 3, findings: [] }).action, 'done');
  const fix = nextStep({ round: 0, maxRounds: 3, findings: [F('a')] });
  assert.strictEqual(fix.action, 'fix');
  assert.strictEqual(nextStep({ round: 1, maxRounds: 3, findings: [F('a')], prevFingerprint: fix.fingerprint }).action, 'stop');
  assert.match(nextStep({ round: 1, maxRounds: 3, findings: [F('a')], prevFingerprint: fix.fingerprint }).reason, /no progress/);
  const limit = nextStep({ round: 3, maxRounds: 3, findings: [F('z')] });
  assert.strictEqual(limit.action, 'stop');
  assert.match(limit.reason, /after 3 fix rounds/);
  assert.notStrictEqual(fingerprint([F('a')]), fingerprint([F('b')]));
});

test('fix prompt lists findings and forbids the usual shortcuts', () => {
  const p = buildFixPrompt({ findings: [F('Raw <button> used', { file: 'src/Login.jsx', line: 7, rule: 'raw-element' })] }, { round: 2, maxRounds: 3 });
  assert.match(p, /fix round 2 of 3/);
  assert.match(p, /src\/Login\.jsx:7/);
  assert.match(p, /Do not silence a rule, delete or weaken a test/);
});

function harness({ results, cfg = { enabled: true, maxRounds: 3, tier: 'fast', include: 'error' } }) {
  const log = { pasted: [], submitted: [], events: [] };
  let call = 0;
  const loop = new FixLoop({
    getConfig: () => cfg,
    runChecks: async () => results[Math.min(call++, results.length - 1)],
    paste: (id, text) => log.pasted.push({ id, text }),
    submit: (id) => log.submitted.push(id),
    emit: (e) => log.events.push(e),
    sleep: async () => {},
  });
  loop.register(1, { root: '/p', label: 'Claude' });
  return { loop, log };
}

test('loop: feeds findings back, then reports clean', async () => {
  const { loop, log } = harness({ results: [{ findings: [F('dup button')] }, { findings: [] }] });
  assert.strictEqual((await loop.onIdle(1)).action, 'fix');
  assert.strictEqual(log.pasted.length, 1);
  assert.deepStrictEqual(log.submitted, [1]);
  assert.strictEqual((await loop.onIdle(1)).action, 'done');
  assert.strictEqual(log.events.at(-1).state, 'done');
  assert.match(log.events.at(-1).reason, /clean after 1 fix round/);
});

test('loop: gives up after maxRounds and when nothing changes', async () => {
  const stuck = harness({ results: [{ findings: [F('same')] }] });
  assert.strictEqual((await stuck.loop.onIdle(1)).action, 'fix');
  assert.strictEqual((await stuck.loop.onIdle(1)).action, 'stop');
  assert.strictEqual(stuck.log.pasted.length, 1, 'no second prompt when nothing changed');

  const changing = harness({ results: [1, 2, 3, 4, 5].map((n) => ({ findings: [F(`problem ${n}`)] })) });
  const actions = [];
  for (let i = 0; i < 4; i++) actions.push((await changing.loop.onIdle(1)).action);
  assert.deepStrictEqual(actions, ['fix', 'fix', 'fix', 'stop']);
  assert.strictEqual(changing.log.pasted.length, 3);
});

test('loop: disabled does nothing; user input resets the round counter', async () => {
  const off = harness({ results: [{ findings: [F('x')] }], cfg: { enabled: false } });
  assert.strictEqual((await off.loop.onIdle(1)).action, 'disabled');
  assert.strictEqual(off.log.pasted.length, 0);

  const h = harness({ results: [1, 2, 3, 4, 5, 6].map((n) => ({ findings: [F(`p${n}`)] })) });
  await h.loop.onIdle(1); await h.loop.onIdle(1);
  h.loop.userInput(1);
  assert.strictEqual(h.loop.terms.get(1).round, 0);
  assert.strictEqual((await h.loop.onIdle(1)).action, 'fix');
});

test('loop: a failing gate run is reported, not treated as clean', async () => {
  const { loop, log } = harness({ results: [{ error: 'Project not trusted' }] });
  assert.strictEqual((await loop.onIdle(1)).action, 'error');
  assert.strictEqual(log.pasted.length, 0);
  assert.strictEqual(log.events.at(-1).state, 'error');
});

test('loop: overlapping idle events do not start two gate runs', async () => {
  let release; const gate = new Promise((r) => { release = r; });
  let runs = 0;
  const loop = new FixLoop({ getConfig: () => ({ enabled: true, maxRounds: 3 }), runChecks: async () => { runs++; await gate; return { findings: [] }; }, paste() {}, submit() {}, emit() {} });
  loop.register(1, { root: '/p' });
  const a = loop.onIdle(1); const b = await loop.onIdle(1);
  assert.strictEqual(b.action, 'ignored');
  release(); await a;
  assert.strictEqual(runs, 1);
});

test('FixLoop: a paused terminal is not looped, resuming works', async () => {
  let checks = 0;
  const fl = new FixLoop({ getConfig: () => ({ enabled: true, maxRounds: 3, include: 'error' }), runChecks: async () => { checks++; return { findings: [] }; }, paste() {}, submit() {}, emit() {}, sleep: async () => {} });
  fl.register(1, { root: '/r' });
  fl.pause(1);
  assert.strictEqual((await fl.onIdle(1)).action, 'paused');
  assert.strictEqual(checks, 0);
  fl.pause(1, false);
  await fl.onIdle(1);
  assert.strictEqual(checks, 1);
});

// ---------------------------------------------------------------------------------------------------- escalation
const { shouldEscalate, buildEscalationPrompt } = require('../src/core/fixloop');

test('shouldEscalate: only with a named agent, remaining problems, and not twice', () => {
  const fix = { action: 'fix' }; const stop = { action: 'stop' }; const done = { action: 'done' };
  const one = [F('x')];
  const esc = { agent: 'Claude', after: 2 };
  assert.equal(shouldEscalate({ escalate: esc, escalated: false, round: 2, step: fix, findings: one }), true, 'after the second failed round');
  assert.equal(shouldEscalate({ escalate: esc, escalated: false, round: 1, step: fix, findings: one }), false, 'still has a round to try');
  assert.equal(shouldEscalate({ escalate: esc, escalated: false, round: 1, step: stop, findings: one }), true, 'the loop would give up (no progress)');
  assert.equal(shouldEscalate({ escalate: esc, escalated: false, round: 3, step: done, findings: [] }), false);
  assert.equal(shouldEscalate({ escalate: esc, escalated: true, round: 3, step: stop, findings: one }), false, 'once');
  assert.equal(shouldEscalate({ escalate: { agent: '', after: 2 }, escalated: false, round: 3, step: stop, findings: one }), false, 'nobody named');
  assert.equal(shouldEscalate({ escalate: undefined, escalated: false, round: 3, step: stop, findings: one }), false);
  assert.equal(shouldEscalate({ escalate: { agent: 'Claude' }, escalated: false, round: 2, step: fix, findings: one }), true, 'after defaults to 2');
});

test('buildEscalationPrompt: the task, who tried, the remaining problems and the rules', () => {
  const p = buildEscalationPrompt({ findings: [F('Unused import', { file: 'src/a.js' })] }, { task: 'Add postcode validation', from: 'qwen3:14b', round: 2 });
  assert.match(p, /taking over a task from qwen3:14b/);
  assert.match(p, /after 2 fix rounds/);
  assert.match(p, /Add postcode validation/);
  assert.match(p, /git diff/);
  assert.match(p, /Unused import/);
  assert.match(p, /Do not silence a rule/);
});

function escHarness({ results, escalate = { agent: 'Claude', after: 2 }, handled = true, maxRounds = 5 }) {
  const log = { pasted: [], escalations: [], events: [] };
  let call = 0;
  const loop = new FixLoop({
    getConfig: () => ({ enabled: true, maxRounds, tier: 'fast', include: 'error', escalate }),
    runChecks: async () => results[Math.min(call++, results.length - 1)],
    paste: (id, text) => log.pasted.push({ id, text }), submit() {}, emit: (e) => log.events.push(e), sleep: async () => {},
    escalate: async (info) => { log.escalations.push(info); return handled; },
  });
  loop.register(1, { root: '/p', label: 'qwen' });
  return { loop, log };
}

test('loop: after two failed rounds the run is handed over instead of a third round, once, and the counter starts again', async () => {
  const { loop, log } = escHarness({ results: [{ findings: [F('a')] }, { findings: [F('b')] }, { findings: [F('c')] }, { findings: [F('d')] }] });
  assert.equal((await loop.onIdle(1)).action, 'fix');
  assert.equal((await loop.onIdle(1)).action, 'fix');
  const third = await loop.onIdle(1);
  assert.equal(third.action, 'escalate'); assert.equal(third.to, 'Claude');
  assert.equal(log.pasted.length, 2, 'no third paste');
  assert.equal(log.escalations.length, 1);
  assert.equal(log.escalations[0].round, 2); assert.equal(log.escalations[0].agent, 'Claude'); assert.equal(log.escalations[0].findings.length, 1);
  assert.equal(log.events.at(-1).state, 'escalating');
  // the same terminal is not handed over again: the loop carries on as before
  assert.equal((await loop.onIdle(1)).action, 'fix');
});

test('loop: a refused hand-over (no such agent, window said no) leaves the loop as it was', async () => {
  const { loop, log } = escHarness({ results: [{ findings: [F('a')] }, { findings: [F('b')] }, { findings: [F('c')] }], handled: false, maxRounds: 2 });
  await loop.onIdle(1); await loop.onIdle(1);
  const last = await loop.onIdle(1);
  assert.equal(last.action, 'stop');
  assert.equal(log.escalations.length, 1, 'it was asked once, at the point it would have given up');
  assert.ok(log.events.every((e) => e.state !== 'escalating'));
});

test('loop: terminals registered as escalated (workflow steps, compared runs, the stronger agent itself) are never handed over', async () => {
  const { loop, log } = escHarness({ results: [{ findings: [F('a')] }, { findings: [F('b')] }, { findings: [F('c')] }], maxRounds: 2 });
  loop.register(2, { root: '/p', label: 'wf step', escalated: true });
  await loop.onIdle(2); await loop.onIdle(2);
  assert.equal((await loop.onIdle(2)).action, 'stop');
  assert.equal(log.escalations.length, 0);
});

test('loop: a clean result never hands over, and with no agent named nothing changes', async () => {
  const a = escHarness({ results: [{ findings: [F('a')] }, { findings: [] }] });
  await a.loop.onIdle(1);
  assert.equal((await a.loop.onIdle(1)).action, 'done');
  assert.equal(a.log.escalations.length, 0);
  const b = escHarness({ results: [{ findings: [F('a')] }, { findings: [F('b')] }, { findings: [F('c')] }], escalate: { agent: '', after: 2 }, maxRounds: 2 });
  await b.loop.onIdle(1); await b.loop.onIdle(1);
  assert.equal((await b.loop.onIdle(1)).action, 'stop');
  assert.equal(b.log.escalations.length, 0);
});
