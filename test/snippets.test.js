'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadSnippets, saveSnippets } = require('../src/core/snippets');

const tmpRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bazinga-snippets-'));

test('loadSnippets returns an empty array when the file does not exist yet', () => {
  const root = tmpRoot();
  assert.deepEqual(loadSnippets(root), []);
});

test('saveSnippets then loadSnippets round-trips, filtering out entries with no prefix/body', () => {
  const root = tmpRoot();
  const { saved } = saveSnippets(root, [
    { prefix: 'flog', body: "console.log('$1');", language: 'JavaScript', description: 'quick log' },
    { prefix: '', body: 'x' },
    { prefix: 'noBody' },
  ]);
  assert.equal(saved, 1);
  const loaded = loadSnippets(root);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].prefix, 'flog');
  assert.equal(loaded[0].language, 'javascript');
  assert.equal(loaded[0].description, 'quick log');
  assert.ok(fs.existsSync(path.join(root, '.ide', 'snippets.yaml')));
});

test('a body given as an array of lines (VS Code snippet JSON shape) is joined with newlines', () => {
  const root = tmpRoot();
  saveSnippets(root, [{ prefix: 'fordict', body: ['for key, value in d.items():', '    $1'] }]);
  assert.equal(loadSnippets(root)[0].body, 'for key, value in d.items():\n    $1');
});

test('a blank language means every language, not a literal empty-string match', () => {
  const root = tmpRoot();
  saveSnippets(root, [{ prefix: 'todo', body: '// TODO: $1' }]);
  assert.equal(loadSnippets(root)[0].language, '');
});

test('loadSnippets raises a clear error on invalid YAML rather than a raw parser exception', () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, '.ide'), { recursive: true });
  fs.writeFileSync(path.join(root, '.ide', 'snippets.yaml'), 'snippets: [this: is: not: valid\n');
  assert.throws(() => loadSnippets(root), /Invalid YAML/);
});
