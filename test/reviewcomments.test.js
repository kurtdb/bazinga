'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { normalize, formatComments, MAX_COMMENTS } = require('../src/core/reviewcomments');

test('comments are grouped by file, ordered by line, with the code line quoted', () => {
  const text = formatComments([
    { file: 'b.js', line: 9, text: 'rename this', code: 'const x = 1;' },
    { file: 'a.js', line: 12, text: 'handle null\nand empty' },
    { file: 'a.js', line: 3, text: 'extract a function' },
  ]);
  const lines = text.split('\n');
  assert.match(lines[0], /3 comments/);
  assert.deepStrictEqual(lines.filter((l) => /^[ab]\.js$/.test(l)), ['a.js', 'b.js']);
  assert.ok(text.indexOf('line 3') < text.indexOf('line 12'));
  assert.ok(text.includes('line 9  `const x = 1;`'));
  assert.ok(text.includes('    handle null\n    and empty'));
  assert.match(text, /stop and wait\.$/);
});

test('empty, file-less and text-less comments are dropped; nothing to send gives an empty string', () => {
  assert.strictEqual(formatComments([]), '');
  assert.strictEqual(formatComments(null), '');
  assert.strictEqual(formatComments([{ file: '', line: 1, text: 'x' }, { file: 'a', line: 1, text: '   ' }, null]), '');
  assert.match(formatComments([{ file: 'a', line: 1, text: 'x' }]), /1 comment\./);
});

test('control characters are stripped (they would end up in a terminal), lengths and counts are capped, backslashes normalised', () => {
  const n = normalize([{ file: 'src\\a.js', line: 0, text: 'ok\u001b[31mbad\u0007\u0000', code: 'x'.repeat(500) }]);
  assert.strictEqual(n[0].file, 'src/a.js'); assert.strictEqual(n[0].line, 1);
  assert.ok(!/[\u0000-\u0008\u001b\u007f]/.test(n[0].text));
  assert.strictEqual(n[0].code.length, 200);
  const many = Array.from({ length: 100 }, (_, i) => ({ file: 'a', line: i + 1, text: 't' }));
  assert.strictEqual(normalize(many).length, MAX_COMMENTS);
  assert.strictEqual(normalize([{ file: 'a', line: 1, text: 'y'.repeat(9000) }])[0].text.length, 2000);
});

test('a comment cannot close the bracketed paste early', () => {
  const t = formatComments([{ file: 'a', line: 1, text: 'sneaky \u001b[201~ rm -rf' }]);
  assert.ok(!t.includes('\u001b'));
});
