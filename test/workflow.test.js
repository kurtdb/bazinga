'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const wf = require('../src/core/workflow');

const ok = (y) => { const r = wf.parse(y); assert.deepEqual(r.errors, []); return r.workflow; };

test('built-in workflows are valid', () => { for (const y of wf.BUILTIN) assert.ok(ok(y).steps.length >= 2); });

test('parse: order follows needs, defaults filled', () => {
  const w = ok('name: n\nsteps:\n  - {id: b, needs: [a], task: t2}\n  - {id: a, task: t1, gate: guard}\n');
  assert.deepEqual(w.steps.map((s) => s.id), ['a', 'b']);
  assert.equal(w.steps[1].gate, 'none'); assert.equal(w.steps[1].retries, 1); assert.equal(w.steps[1].approval, null);
});

test('parse: errors are specific', () => {
  const e = (y) => wf.parse(y).errors.join('|');
  assert.match(e('a: [unclosed'), /not valid YAML|empty/);
  assert.match(e('steps: []'), /name is missing.*no steps|no steps/);
  assert.match(e('name: n\nsteps:\n  - {id: a, task: x, needs: [zz]}'), /unknown step zz/);
  assert.match(e('name: n\nsteps:\n  - {id: a, task: x, needs: [b]}\n  - {id: b, task: y, needs: [a]}'), /circle/);
  assert.match(e('name: n\nsteps:\n  - {id: a, task: x}\n  - {id: a, task: y}'), /duplicate/);
  assert.match(e('name: n\nsteps:\n  - {id: a, task: x, gate: magic}'), /gate must be/);
  assert.match(e('name: n\nsteps:\n  - {id: a, task: x, approval: maybe}'), /approval/);
  assert.match(e('name: n\nsteps:\n  - {id: "a b", task: x}'), /id must be/);
  assert.match(e('name: n\nsteps:\n  - {id: a}'), /task is missing/);
  assert.match(e('name: n\nsteps:\n  - {id: a, task: x, retries: 9}'), /retries/);
  const many = `name: n\nsteps:\n${Array.from({ length: 13 }, (_, i) => `  - {id: s${i}, task: x}`).join('\n')}`;
  assert.match(e(many), /at most 12/);
});

test('nextSteps: parallel branches start together, dependents wait, failure and approval stop everything', () => {
  const w = ok('name: n\nsteps:\n  - {id: a, task: x}\n  - {id: b, task: x}\n  - {id: c, needs: [a, b], task: x}\n');
  assert.deepEqual(wf.nextSteps(w.steps, {}).start, ['a', 'b']);
  assert.deepEqual(wf.nextSteps(w.steps, { a: { status: 'passed' }, b: { status: 'running' } }).start, []);
  assert.deepEqual(wf.nextSteps(w.steps, { a: { status: 'passed' }, b: { status: 'passed' } }).start, ['c']);
  assert.match(wf.nextSteps(w.steps, { a: { status: 'failed' } }).reason, /failed/);
  assert.match(wf.nextSteps(w.steps, { a: { status: 'awaiting-approval' } }).reason, /approval of a/);
  assert.equal(wf.nextSteps(w.steps, { a: { status: 'passed' }, b: { status: 'skipped' }, c: { status: 'passed' } }).reason, 'finished');
});

test('afterGate: retry then fail; approval from the step or the oversight default', () => {
  const step = { gate: 'guard', retries: 1, approval: null };
  assert.equal(wf.afterGate(step, { gatePassed: false, attempts: 1 }).retry, true);
  assert.equal(wf.afterGate(step, { gatePassed: false, attempts: 2 }).status, 'failed');
  assert.equal(wf.afterGate(step, { gatePassed: true }).status, 'passed');
  assert.equal(wf.afterGate(step, { gatePassed: true, approvalDefault: true }).status, 'awaiting-approval');
  assert.equal(wf.afterGate({ ...step, approval: 'none' }, { gatePassed: true, approvalDefault: true }).status, 'passed');
  assert.equal(wf.afterGate({ ...step, approval: 'human' }, { gatePassed: true }).status, 'awaiting-approval');
});

test('checkGate: tests-added, tests-untouched, guard', () => {
  const f = (path, status = 'M') => ({ path, status });
  assert.ok(wf.checkGate('tests-added', { files: [f('src/test/java/AT.java', 'A')] }).passed);
  assert.ok(!wf.checkGate('tests-added', { files: [f('src/Foo.java'), f('src/test/java/AT.java', 'D')] }).passed);
  assert.ok(wf.checkGate('tests-untouched', { files: [f('src/test/java/NewTest.java', 'A'), f('src/Foo.java')] }).passed);
  assert.ok(!wf.checkGate('tests-untouched', { files: [f('src/test/java/FooTest.java')] }).passed);
  assert.ok(!wf.checkGate('guard', { guard: { ok: false, blockers: 2 } }).passed);
  assert.ok(wf.checkGate('guard', { guard: { ok: true } }).passed);
  assert.ok(!wf.checkGate('nope', {}).passed);
});

test('renderTask substitutes {input}', () => {
  assert.equal(wf.renderTask({ task: 'Fix: {input} now' }, { input: ' NPE ' }), 'Fix: NPE now');
});

test('serialize: round trip through parse, defaults omitted, validation reports the same errors as a file', () => {
  const w = ok('name: Round trip\ndescription: d\nsteps:\n  - {id: a, task: "do {input}", gate: tests-added, agent: Claude}\n  - {id: b, needs: [a], task: t, approval: human, retries: 2, allow: "src/**"}\n  - {id: c, needs: [b], task: t3}\n');
  const text = wf.serialize(w);
  assert.ok(!/gate: none|retries: 1|approval: null/.test(text), text);
  assert.deepEqual(ok(text), w);
  assert.deepEqual(wf.validate(w), []);
  assert.match(wf.validate({ name: '', steps: [] }).join(' '), /name is missing/);
  assert.match(wf.validate({ name: 'x', steps: [{ id: 'a', task: '' , needs: [], gate: 'none', retries: 1 }] }).join(' '), /task is missing/);
  assert.match(wf.validate({ name: 'x', steps: [{ id: 'a', task: 't', needs: ['a'], gate: 'none', retries: 1 }] }).join(' '), /circle/);
});

test('serialize: task text with quotes, colons and line breaks survives', () => {
  const task = 'Fix: "the bug" in\n  Foo: bar\n# not a comment';
  const w = ok(wf.serialize({ name: 'q: "x"', steps: [{ id: 'a', task, needs: [], gate: 'none', retries: 1 }] }));
  assert.equal(w.steps[0].task, task.trim());
  assert.equal(w.name, 'q: "x"');
});

test('fileName: safe names', () => {
  assert.equal(wf.fileName('Fix a bug (test first)!'), 'fix-a-bug-test-first.yaml');
  assert.equal(wf.fileName('../../etc/passwd'), 'etc-passwd.yaml');
  assert.equal(wf.fileName('***'), 'workflow.yaml');
});

test('layout: columns follow the longest dependency chain, parallel steps share a column, edges point forward', () => {
  const w = ok('name: n\nsteps:\n  - {id: a, task: x}\n  - {id: b, task: x}\n  - {id: c, needs: [a], task: x}\n  - {id: d, needs: [c, b], task: x}\n');
  const l = wf.layout(w.steps);
  const at = (id) => l.nodes.find((n) => n.id === id);
  assert.deepEqual([at('a').col, at('b').col, at('c').col, at('d').col], [0, 0, 1, 2]);
  assert.deepEqual([at('a').row, at('b').row], [0, 1]);
  assert.equal(l.edges.length, 3);
  assert.ok(l.edges.every((e) => at(e.from).col < at(e.to).col));
  assert.ok(at('d').x + l.node.w + 6 <= l.width && at('b').y + l.node.h + 6 <= l.height);
  assert.ok(l.nodes.every((n, i) => l.nodes.every((m, j) => i === j || n.x !== m.x || n.y !== m.y)), 'no two nodes overlap');
});

test('layout: empty and cyclic input do not loop or throw', () => {
  assert.deepEqual(wf.layout([]).nodes, []);
  const cyc = [{ id: 'a', needs: ['b'] }, { id: 'b', needs: ['a'] }];
  assert.equal(wf.layout(cyc).nodes.length, 2);
});

test('regression: a refactor step in which the agent changed nothing (it just asked "anything specific?") does not pass its gate', () => {
  const f = (path, status = 'M') => ({ path, status });
  assert.equal(wf.checkGate('refactor', { files: [] }).passed, false);
  assert.match(wf.checkGate('refactor', { files: [] }).why, /changed no files/);
  assert.equal(wf.checkGate('refactor', { files: [f('src/a.py')] }).passed, true);
  assert.equal(wf.checkGate('refactor', { files: [f('src/a.py'), f('tests/test_a.py')] }).passed, false, 'existing tests stay untouched');
  assert.equal(wf.checkGate('refactor', { files: [f('src/a.py'), f('tests/test_new.py', 'A')] }).passed, true, 'new tests are fine');
  assert.equal(wf.checkGate('changed', { files: [] }).passed, false);
  assert.equal(wf.checkGate('changed', { files: [f('README.md')] }).passed, true);
  const built = wf.parse(wf.BUILTIN[1], 'b').workflow;
  assert.equal(built.steps[0].gate, 'refactor');
  assert.match(built.steps[0].task, /make the changes yourself/);
  assert.match(built.steps[0].task, /Nobody is here to answer questions/);
  // one retry by default: the findings go back to the agent
  assert.equal(wf.afterGate(built.steps[0], { gatePassed: false, attempts: 1 }).retry, true);
  assert.equal(wf.afterGate(built.steps[0], { gatePassed: false, attempts: 2 }).status, 'failed');
});
