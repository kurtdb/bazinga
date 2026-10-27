'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const replay = require('../src/core/replay');

test('buildTimeline: merges events (ms) and commits (unix seconds) into one ascending timeline', () => {
  const events = [{ t: 1000, kind: 'created' }, { t: 3000, kind: 'idle', text: 'went quiet' }];
  const commits = [{ sha: 'a'.repeat(40), subject: 'first', time: 2 }]; // 2s -> 2000ms, lands between the two events
  const steps = replay.buildTimeline({ events, commits });
  assert.deepEqual(steps.map((s) => s.type), ['event', 'commit', 'event']);
  assert.deepEqual(steps.map((s) => s.t), [1000, 2000, 3000]);
  assert.equal(steps[1].sha, 'a'.repeat(40));
  assert.equal(steps[1].subject, 'first');
});

test('buildTimeline: empty input gives an empty timeline', () => {
  assert.deepEqual(replay.buildTimeline({}), []);
  assert.deepEqual(replay.buildTimeline(), []);
});

test('buildTimeline: an event with no text still carries an empty string, never undefined', () => {
  const steps = replay.buildTimeline({ events: [{ t: 1, kind: 'guard' }] });
  assert.equal(steps[0].text, '');
});
