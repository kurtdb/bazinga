'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { replaceInText } = require('../src/core/search');

test('replaceInText: plain text, case-insensitive by default, counts every match', () => {
  const r = replaceInText('Foo bar foo BAR', { query: 'foo', regex: false, caseSensitive: false, replacement: 'X' });
  assert.equal(r.content, 'X bar X BAR');
  assert.equal(r.count, 2);
});

test('replaceInText: caseSensitive narrows the match', () => {
  const r = replaceInText('Foo foo', { query: 'foo', regex: false, caseSensitive: true, replacement: 'X' });
  assert.equal(r.content, 'Foo X');
  assert.equal(r.count, 1);
});

test('replaceInText: no match leaves content untouched and count 0', () => {
  const r = replaceInText('hello world', { query: 'nope', regex: false, caseSensitive: false, replacement: 'X' });
  assert.equal(r.content, 'hello world');
  assert.equal(r.count, 0);
});

test('replaceInText: plain-text mode treats "$" in the replacement literally (no $1/$& substitution)', () => {
  const r = replaceInText('price: foo', { query: 'foo', regex: false, caseSensitive: false, replacement: '$1 $& dollars' });
  assert.equal(r.content, 'price: $1 $& dollars');
  assert.equal(r.count, 1);
});

test('replaceInText: regex mode supports capture groups in the replacement', () => {
  const r = replaceInText('John Smith', { query: '(\\w+) (\\w+)', regex: true, caseSensitive: false, replacement: '$2 $1' });
  assert.equal(r.content, 'Smith John');
  assert.equal(r.count, 1);
});

test('replaceInText: invalid regex is reported, not thrown', () => {
  const r = replaceInText('abc', { query: '(unclosed', regex: true, caseSensitive: false, replacement: 'x' });
  assert.equal(r.error, 'Invalid regular expression');
});

test('replaceInText: zero-width matches do not loop forever and still advance', () => {
  const r = replaceInText('abc', { query: 'x*', regex: true, caseSensitive: false, replacement: '-' });
  assert.equal(r.content, '-a-b-c-');
});
