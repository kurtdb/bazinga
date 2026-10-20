'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { printCommand } = require('../src/core/printmode');
const W = require('../src/core/workflow');

test('print command: -p after claude, edits accepted, the shell ends with the exit code', () => {
  assert.strictEqual(printCommand('claude "$BAZINGA_TASK" --tools Read,Edit', 'posix'), 'claude -p "$BAZINGA_TASK" --tools Read,Edit --permission-mode acceptEdits; exit $?');
  assert.strictEqual(printCommand('claude $env:BAZINGA_TASK', 'ps'), 'claude -p $env:BAZINGA_TASK --permission-mode acceptEdits; exit $LASTEXITCODE');
  assert.strictEqual(printCommand('claude %BAZINGA_TASK%', 'cmd'), 'claude -p %BAZINGA_TASK% --permission-mode acceptEdits & exit %errorlevel%');
  assert.strictEqual(printCommand('claude.exe "x"', 'posix').startsWith('claude.exe -p "x"'), true);
});
test('print command keeps a permission mode the button already has, and refuses other agents', () => {
  assert.ok(!/acceptEdits/.test(printCommand('claude "t" --permission-mode plan')));
  assert.ok(!/acceptEdits/.test(printCommand('claude "t" --dangerously-skip-permissions')));
  assert.strictEqual(printCommand('aider --yes', 'posix'), null);
  assert.strictEqual(printCommand('', 'posix'), null);
});
test('workflow files can say mode and finish; unknown values are errors; serialize keeps them', () => {
  const ok = W.parse('name: x\nmode: unattended\nfinish: merge\nsteps:\n  - id: a\n    task: do it\n');
  assert.deepStrictEqual([ok.workflow.mode, ok.workflow.finish], ['unattended', 'merge']);
  const dflt = W.parse('name: x\nsteps:\n  - id: a\n    task: do it\n');
  assert.deepStrictEqual([dflt.workflow.mode, dflt.workflow.finish], ['interactive', 'none']);
  assert.match(W.parse('name: x\nmode: robot\nsteps:\n  - id: a\n    task: t\n').errors.join(), /mode must be/);
  assert.match(W.parse('name: x\nfinish: push\nsteps:\n  - id: a\n    task: t\n').errors.join(), /finish must be/);
  const round = W.parse(W.serialize(ok.workflow)).workflow;
  assert.deepStrictEqual([round.mode, round.finish], ['unattended', 'merge']);
  assert.ok(!/mode:/.test(W.serialize(dflt.workflow)));
});

test('step timeout: 0 to 240 whole minutes, kept by serialize, left out when unset', () => {
  const ok = W.parse('name: x\nsteps:\n  - id: a\n    task: t\n    timeout: 30\n  - id: b\n    task: t\n');
  assert.deepStrictEqual(ok.workflow.steps.map((s) => s.timeout), [30, 0]);
  assert.match(W.serialize(ok.workflow), /timeout: 30/);
  assert.strictEqual((W.serialize(ok.workflow).match(/timeout:/g) || []).length, 1);
  for (const bad of ['-1', '241', '1.5', 'soon']) assert.match(W.parse(`name: x\nsteps:\n  - id: a\n    task: t\n    timeout: ${bad}\n`).errors.join(), /timeout must be/, bad);
});
