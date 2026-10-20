'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { shouldNotify, fixLoopMessage } = require('../src/core/notify');

test('notifications only when the window is not in front, and only when enabled', () => {
  assert.strictEqual(shouldNotify({ enabled: true, focused: false, kind: 'agent-idle' }), true);
  assert.strictEqual(shouldNotify({ enabled: true, focused: true, kind: 'agent-idle' }), false);
  assert.strictEqual(shouldNotify({ enabled: true, focused: true, minimized: true, kind: 'fixloop' }), true);
  assert.strictEqual(shouldNotify({ enabled: false, focused: false, kind: 'agent-idle' }), false);
  assert.strictEqual(shouldNotify({ enabled: true, focused: false, kind: 'something-else' }), false);
});

test('fix loop: only the outcomes interrupt you, not the intermediate steps', () => {
  assert.strictEqual(fixLoopMessage({ state: 'checking' }), null);
  assert.strictEqual(fixLoopMessage({ state: 'fixing' }), null);
  assert.match(fixLoopMessage({ state: 'escalating', label: 'qwen', reason: 'handed over to Claude' }).body, /Claude/);
  assert.match(fixLoopMessage({ state: 'done', label: 'Claude', reason: 'clean after 2 fix rounds' }).title, /Claude: gates are green/);
  assert.match(fixLoopMessage({ state: 'stop', reason: 'no progress' }).body, /no progress/);
  assert.match(fixLoopMessage({ state: 'error', reason: 'x' }).title, /could not run/);
});
