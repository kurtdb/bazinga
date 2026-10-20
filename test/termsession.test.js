'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const T = require('../src/core/termsession');

const ROOT = path.resolve('/work/shop');
const AGENTS = [
  { name: 'Claude', command: 'claude', env: { A: '1' } },
  { name: 'Copilot', command: 'copilot' },
  { name: 'Own', command: 'myagent --x', resumeCommand: 'myagent --x --last' },
  { name: 'Plain', command: 'aider' },
];

test('resume commands: known agents, explicit override, unknown agents, and no double flag', () => {
  assert.strictEqual(T.resumeCommand(AGENTS[0]), 'claude --continue');
  assert.strictEqual(T.resumeCommand(AGENTS[1]), 'copilot --continue');
  assert.strictEqual(T.resumeCommand(AGENTS[2]), 'myagent --x --last');
  assert.strictEqual(T.resumeCommand(AGENTS[3]), null);
  assert.strictEqual(T.resumeCommand({ command: 'claude --resume' }), null, 'already resumes: nothing to add');
  assert.strictEqual(T.resumeCommand({ command: 'C:\\tools\\claude.cmd --model x' }), 'C:\\tools\\claude.cmd --model x --continue');
  assert.strictEqual(T.resumeCommand(undefined), null);
});

test('records: exited terminals and terminals outside the project are not saved', () => {
  const recs = T.toRecords([
    { title: 'Terminal', cwd: ROOT },
    { title: 'Claude', cwd: path.join(ROOT, 'api'), agent: 'Claude', runId: 'r1' },
    { title: 'dead', cwd: ROOT, exited: true },
    { title: 'elsewhere', cwd: path.resolve('/other') },
    { title: 'sibling', cwd: ROOT + '-x' },
    null,
  ], ROOT);
  assert.deepStrictEqual(recs.map((r) => [r.kind, r.title]), [['shell', 'Terminal'], ['agent', 'Claude']]);
  assert.strictEqual(recs[1].runId, 'r1');
});

test('restore plan: shell stays a shell, agent resumes, agent without resume gets a note, unknown agent too', () => {
  const plan = T.planRestore([
    { kind: 'shell', title: 'Terminal', cwd: ROOT },
    { kind: 'agent', title: 'fix · Claude', cwd: path.join(ROOT, 'a'), agent: 'Claude' },
    { kind: 'agent', title: 'Plain', cwd: ROOT, agent: 'Plain' },
    { kind: 'agent', title: 'Gone', cwd: ROOT, agent: 'Removed' },
  ], { root: ROOT, agents: AGENTS });
  assert.strictEqual(plan.length, 4);
  assert.strictEqual(plan[0].initialInput, undefined);
  assert.deepStrictEqual([plan[1].initialInput, plan[1].watch, plan[1].env], ['claude --continue\r', true, { A: '1' }]);
  assert.match(plan[2].note, /resumeCommand/); assert.strictEqual(plan[2].initialInput, undefined);
  assert.match(plan[3].note, /no longer configured/);
});

test('restore plan drops folders outside the project (path traversal in a tampered session file)', () => {
  const plan = T.planRestore([{ kind: 'shell', cwd: path.join(ROOT, '..', 'etc') }, { kind: 'shell', cwd: path.resolve('/') }, { kind: 'shell', cwd: path.join(ROOT, 'ok') }], { root: ROOT, agents: [] });
  assert.deepStrictEqual(plan.map((p) => p.cwd), [path.join(ROOT, 'ok')]);
});

test('old session format (a count) still restores that many plain terminals, capped', () => {
  assert.strictEqual(T.planRestore(2, { root: ROOT }).length, 2);
  assert.strictEqual(T.planRestore(999, { root: ROOT }).length, 12);
  assert.strictEqual(T.planRestore(undefined, { root: ROOT }).length, 0);
  assert.strictEqual(T.planRestore('x', { root: ROOT }).length, 0);
});

test('regression: an agent that ran in a container is never resumed on the host after a restart', () => {
  const { toRecords, planRestore } = require('../src/core/termsession');
  const recs = toRecords([{ title: 'r · claude 🐳', cwd: '/p/run', agent: 'Claude', runId: 'r', container: true }], '/p');
  assert.equal(recs[0].container, true);
  const plan = planRestore(recs, { root: '/p', agents: [{ name: 'Claude', command: 'claude' }] });
  assert.equal(plan.length, 1);
  assert.equal(plan[0].initialInput, undefined);
  assert.equal(plan[0].agent, null);
  assert.match(plan[0].note, /container/);
});
