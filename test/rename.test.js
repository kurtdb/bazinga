'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { renameAcrossFiles } = require('../src/core/rename');

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bazinga-rename-'));
  fs.writeFileSync(path.join(root, 'a.rb'), 'def foo\n  foo + foo\nend\n');
  fs.writeFileSync(path.join(root, 'b.rb'), "class Foo\n  # a comment about foo\nend\n");
  fs.writeFileSync(path.join(root, 'c.rb'), 'def bar\n  bar\nend\n');
  fs.writeFileSync(path.join(root, 'bin.dat'), Buffer.from([0, 1, 2, 0, 255]));
  return root;
}

test('renames every whole-word occurrence across files (comments included - a documented approximation), leaves untouched files out, is case-sensitive', () => {
  const root = project();
  const res = renameAcrossFiles(root, ['a.rb', 'b.rb', 'c.rb'], 'foo', 'baz');
  assert.equal(res.error, undefined);
  const byRel = Object.fromEntries(res.files.map((f) => [f.rel, f.newText]));
  assert.equal(byRel['a.rb'], 'def baz\n  baz + baz\nend\n');
  assert.equal(byRel['b.rb'], 'class Foo\n  # a comment about baz\nend\n'); // "Foo" (capital class name) is untouched, the lowercase "foo" in the comment is not
  assert.equal(byRel['c.rb'], undefined); // no occurrence of "foo" at all
});

test('skips binary files instead of corrupting them', () => {
  const root = project();
  const res = renameAcrossFiles(root, ['bin.dat'], 'foo', 'baz');
  assert.deepEqual(res.files, []);
});

test('rejects a non-identifier name on either side, and a no-op rename to the same name', () => {
  const root = project();
  assert.match(renameAcrossFiles(root, ['a.rb'], 'not an identifier', 'baz').error, /identifier/);
  assert.match(renameAcrossFiles(root, ['a.rb'], 'foo', 'not valid').error, /valid name/);
  assert.deepEqual(renameAcrossFiles(root, ['a.rb'], 'foo', 'foo'), { files: [] });
});

test('a missing or unreadable file is skipped, not thrown', () => {
  const root = project();
  const res = renameAcrossFiles(root, ['a.rb', 'does-not-exist.rb'], 'foo', 'baz');
  assert.equal(res.files.length, 1);
  assert.equal(res.files[0].rel, 'a.rb');
});
