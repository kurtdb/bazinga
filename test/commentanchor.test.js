'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { anchorLine, anchorAll } = require('../src/core/commentanchor');

const file = 'a\nfoo();\nb\nfoo();\nc\n';

test('anchor: same line, moved line, nearest duplicate, vanished line', () => {
  assert.equal(anchorLine(file, { line: 2, code: 'foo();' }), 2);
  assert.equal(anchorLine('x\nx2\nfoo();\n', { line: 2, code: '  foo();  ' }), 3, 'moved down, whitespace ignored');
  assert.equal(anchorLine(file, { line: 3, code: 'foo();' }), 2, 'two matches: the nearest wins (ties go to the first)');
  assert.equal(anchorLine(file, { line: 4, code: 'foo();' }), 4);
  assert.equal(anchorLine(file, { line: 2, code: 'removed();' }), null);
});

test('anchor: blank lines only keep their place; CRLF is fine', () => {
  assert.equal(anchorLine('a\n\nb\n', { line: 2, code: '' }), 2);
  assert.equal(anchorLine('a\nb\n', { line: 2, code: '' }), null);
  assert.equal(anchorLine('a\r\nfoo\r\n', { line: 5, code: 'foo' }), 2);
});

test('anchorAll: drops invalid entries and unreadable files, keeps the rest', () => {
  const files = { 'ok.js': 'one\ntwo\n' };
  const read = (rel) => { if (rel in files) return files[rel]; throw new Error('gone'); };
  const res = anchorAll([
    { rel: 'ok.js', line: 2, code: 'two', text: ' fix this ' },
    { rel: 'ok.js', line: 1, code: 'zzz', text: 'stale' },
    { rel: 'missing.js', line: 1, code: 'x', text: 'y' },
    { rel: 'ok.js', line: 1, code: 'one', text: '   ' },
    null, { rel: 5 },
  ], read);
  assert.deepEqual(res, [{ rel: 'ok.js', line: 2, text: 'fix this' }]);
  assert.deepEqual(anchorAll(undefined, read), []);
});
