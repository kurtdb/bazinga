'use strict';
const test = require('node:test');
const assert = require('node:assert');
const W = require('../src/core/workflow');
const { WORKFLOW, verdict } = require('../src/core/wfselfcheck');

const states = (v) => Object.fromEntries(v.items.map((i) => [i.id, i.state]));

test('the self-check workflow is a valid workflow (the same rules as a file)', () => {
  assert.deepStrictEqual(W.validate(WORKFLOW), []);
  assert.deepStrictEqual(WORKFLOW.steps.map((s) => [s.id, s.gate, s.needs.join()]), [['write', 'changed', ''], ['read', 'none', 'write']]);
});

test('verdict: nothing started yet', () => {
  const v = verdict({ steps: {} });
  assert.strictEqual(v.done, false);
  assert.deepStrictEqual(states(v), { start: 'wait', signal: 'wait', gate: 'wait', chain: 'wait', finish: 'wait' });
});

test('verdict: everything worked with a hook signal', () => {
  const v = verdict({ finished: 1, steps: { write: { status: 'passed', runId: 'r', signal: 'hook' }, read: { status: 'passed', runId: 'r', signal: 'hook' } } });
  assert.ok(v.done && v.ok);
  assert.ok(v.items.every((i) => i.state === 'ok'));
  assert.match(v.advice[0], /machinery is fine/);
});

test('verdict: it worked, but the finished signal was guessed: warning with the hooks advice', () => {
  const v = verdict({ finished: 1, steps: { write: { status: 'passed', runId: 'r', signal: 'quiet' }, read: { status: 'passed', runId: 'r', signal: 'quiet' } } });
  assert.ok(v.ok); assert.strictEqual(states(v).signal, 'warn');
  assert.match(v.advice.join(' '), /Hooks/);
});

test('verdict: the model talked but changed nothing', () => {
  const v = verdict({ steps: { write: { status: 'failed', runId: 'r', signal: 'hook', why: 'the agent changed no files' } } });
  assert.ok(v.done && !v.ok);
  assert.strictEqual(states(v).gate, 'fail'); assert.strictEqual(states(v).chain, 'fail');
  assert.match(v.advice.join(' '), /did not use its Write tool/);
});

test('verdict: step 1 passed but step 2 never started points at the Debug tab (the chaining bug)', () => {
  const v = verdict({ steps: { write: { status: 'passed', runId: 'r', signal: 'hook' } } });
  assert.strictEqual(v.done, false);
  assert.strictEqual(states(v).chain, 'wait');
  assert.match(v.advice.join(' '), /step 2 did not start/);
});

test('verdict: time limit and exit code get their own advice', () => {
  assert.match(verdict({ steps: { write: { status: 'failed', runId: 'r', signal: 'forced', why: 'stopped after 10 minutes (the time limit of this step)' } } }).advice.join(), /10 minutes/);
  assert.match(verdict({ steps: { write: { status: 'failed', runId: 'r', signal: 'exit', why: 'the agent ended with exit code 1' } } }).advice.join(), /error/);
});
