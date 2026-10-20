'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { detectPrompt, PromptWatcher, stripAnsi } = require('../src/core/promptdetect');
const { shouldNotify } = require('../src/core/notify');

test('recognises the usual permission questions', () => {
  const yes = [
    'Do you want to proceed?\n❯ 1. Yes\n  2. Yes, and don\'t ask again\n  3. No, and tell Claude what to do differently (esc)',
    'Bash command\n  rm -rf build\nDo you want to run this command?',
    'Allow Claude to edit src/a.js?',
    'Overwrite the file? [y/N]',
    'Continue (y/n)',
    'Press Enter to continue',
    ' ❯ 1. Yes\n   2. No',
    'Esc to cancel · Tab to add additional instructions',
    'Would you like to apply these changes?',
  ];
  for (const t of yes) assert.equal(detectPrompt(t)?.kind, 'permission', t);
});

test('ordinary output is not a prompt', () => {
  for (const t of ['Compiling 12 files...\nBUILD SUCCESS', 'I updated the tests and everything passes.', 'yes yes no no', '', null, undefined, '1. First item\n2. Second item']) assert.equal(detectPrompt(t), null, String(t));
});

test('ANSI colour and cursor codes do not hide or fake a prompt', () => {
  const coloured = '\x1b[1m\x1b[33mDo you want to proceed?\x1b[0m\r\n\x1b[36m❯ 1. Yes\x1b[0m\r\n  2. No';
  assert.equal(stripAnsi('\x1b[31mred\x1b[0m'), 'red');
  assert.equal(detectPrompt(coloured).kind, 'permission');
  assert.match(detectPrompt(coloured).text, /Do you want to proceed\?|1\. Yes/);
});

test('only the end of the output counts: an old question that was answered is not reported', () => {
  const old = `Do you want to proceed?\n1. Yes\n2. No\n${'working...\n'.repeat(20)}All done, tests pass.`;
  assert.equal(detectPrompt(old), null);
});

test('PromptWatcher: reports once after the quiet period, resets on output and on input', () => {
  let t = 100;
  const w = new PromptWatcher({ quietMs: 1000, now: () => t });
  assert.equal(w.poll(), null);
  w.feed('Do you want to proceed?\n❯ 1. Yes\n  2. No');
  t = 600; assert.equal(w.poll(), null, 'still within the quiet period');
  t = 1300; assert.equal(w.poll()?.kind, 'permission');
  assert.ok(w.pending);
  t = 5000; assert.equal(w.poll(), null, 'reported only once');
  w.feed('more output'); assert.equal(w.pending, null);
  w.feed('Overwrite? [y/N]'); t = 9000; assert.ok(w.poll());
  w.input(); assert.equal(w.pending, null); t = 20000; assert.equal(w.poll(), null, 'answered');
});

test('the new kind is a notification kind and follows the same focus rules', () => {
  assert.equal(shouldNotify({ enabled: true, focused: false, kind: 'agent-prompt' }), true);
  assert.equal(shouldNotify({ enabled: true, focused: true, kind: 'agent-prompt' }), false);
  assert.equal(shouldNotify({ enabled: false, focused: false, kind: 'agent-prompt' }), false);
});
