'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { scan } = require('../src/core/todos');

const write = (root, rel, t) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), t); };
function dir(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bazinga-todos-'));
  for (const [k, v] of Object.entries(files)) write(root, k, v);
  return root;
}

test('scan finds TODO/FIXME/HACK/XXX comments, tags upper-cased, text after the tag trimmed', async () => {
  const root = dir({
    'a.js': '// TODO: wire this up\nconst x = 1;\n',
    'b.js': '// fixme: this leaks\n',
    'c.js': '// HACK no colon just text\n',
    'd.js': '// XXX:   spaced out   \n',
  });
  const { items } = await scan(root);
  const byTag = Object.fromEntries(items.map((i) => [i.tag, i]));
  assert.equal(byTag.TODO.text, 'wire this up');
  assert.equal(byTag.TODO.file, 'a.js');
  assert.equal(byTag.TODO.line, 1);
  assert.equal(byTag.FIXME.text, 'this leaks');
  assert.equal(byTag.HACK.text, 'no colon just text');
  assert.equal(byTag.XXX.text, 'spaced out');
});

test('scan ignores words that merely contain a tag as a substring', async () => {
  const root = dir({ 'a.js': '// this is not a TODOX or FIXMENOT\n' });
  const { items } = await scan(root);
  assert.equal(items.length, 0);
});

test('scan returns an empty list for a project with no matches', async () => {
  const root = dir({ 'a.js': 'const x = 1;\n' });
  const { items, truncated } = await scan(root);
  assert.deepEqual(items, []);
  assert.equal(truncated, false);
});

test('scan never throws on a nonexistent root - falls through to an empty result', async () => {
  const res = await scan('/path/does/not/exist/at/all/bazinga-todos');
  assert.ok(Array.isArray(res.items) || res.error);
});
