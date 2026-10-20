'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFeed } = require('../src/core/watchfeed');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('watchfeed: events are debounced into one message', async () => {
  const sent = [];
  const feed = createFeed({ send: (...a) => sent.push(a), delay: 20 });
  feed.event(); feed.event(); feed.event();
  await wait(60);
  assert.deepEqual(sent, [['fs:changed']]);
});

test('watchfeed: events during the quality gates are still reported (regression: a running or hung check blinded the IDE), without re-triggering the checks', async () => {
  const sent = [];
  let running = true;
  const feed = createFeed({ send: (...a) => sent.push(a), isChecksRunning: () => running, delay: 20 });
  feed.event();
  running = false; // the checks finished before the debounce fired: still must not start another run
  await wait(60);
  assert.deepEqual(sent, [['fs:changed', { poll: true }]]);
  feed.event(); // a normal edit afterwards behaves normally
  await wait(60);
  assert.deepEqual(sent[1], ['fs:changed']);
});

test('watchfeed: stop cancels a pending message', async () => {
  const sent = [];
  const feed = createFeed({ send: (...a) => sent.push(a), delay: 20 });
  feed.event(); feed.stop();
  await wait(50);
  assert.equal(sent.length, 0);
});

test('watchfeed: a file that changes without pause still gets reported (regression: the debounce was postponed forever)', async () => {
  const sent = [];
  const feed = createFeed({ send: (...a) => sent.push(a), delay: 40, maxWait: 120 });
  const end = Date.now() + 300;
  while (Date.now() < end) { feed.event(); await wait(10); }
  assert.ok(sent.length >= 1, 'reported while events were still arriving');
  feed.stop();
});
