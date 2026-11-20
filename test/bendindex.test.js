'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const idx = require('../src/core/bendindex');

test('bendindex: a block is added to an existing AGENTS.md without touching the rest, and repeating is stable', () => {
  const doc = '# Rules\n\nUse tabs.\n';
  const a = idx.applyBlock(doc, true);
  assert.ok(a.startsWith('# Rules\n\nUse tabs.\n\n'));
  assert.match(a, /run `bend guide` to learn it/);
  assert.match(a, /run `bend PROOF\.bend` before committing/);
  assert.equal(idx.applyBlock(a, true), null, 'still present: nothing to write');
});

test('bendindex: text around the markers survives, removal leaves the user\'s content', () => {
  const doc = `before\n${idx.renderBlock()}\nafter\n`;
  const removed = idx.applyBlock(doc, false);
  assert.ok(!removed.includes('bazinga:bend'));
  assert.ok(removed.includes('before') && removed.includes('after'));
});

test('bendindex: not present and no block means no file is created or changed; a file that only held the block becomes empty', () => {
  assert.equal(idx.applyBlock('', false), null);
  assert.equal(idx.applyBlock('# hi\n', false), null);
  const only = idx.applyBlock('', true);
  assert.equal(idx.applyBlock(only, false), '');
});
