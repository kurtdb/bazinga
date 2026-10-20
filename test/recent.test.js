'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { addRecent, pruneRecent } = require('../src/core/recent');

test('recent: newest first, no duplicates, capped', () => {
  let l = [];
  l = addRecent(l, '/a'); l = addRecent(l, '/b'); l = addRecent(l, '/a');
  assert.deepEqual(l, ['/a', '/b']);
  for (let i = 0; i < 20; i++) l = addRecent(l, `/p${i}`, 5);
  assert.equal(l.length, 5);
  assert.equal(l[0], '/p19');
});

test('recent: tolerates garbage in the stored list and prunes vanished folders', () => {
  assert.deepEqual(addRecent(null, '/a'), ['/a']);
  assert.deepEqual(addRecent([1, null, '/b'], '/a'), ['/a', '/b']);
  assert.deepEqual(pruneRecent(['/x', '/y'], (p) => p === '/x'), ['/x']);
  assert.deepEqual(pruneRecent(['/x'], () => { throw new Error('boom'); }), []);
});
