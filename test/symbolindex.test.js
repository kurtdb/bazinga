'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SymbolIndex } = require('../src/core/symbolindex');
const symbols = require('../src/core/symbols');

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bazinga-symidx-'));
  fs.writeFileSync(path.join(root, 'a.js'), 'function alpha() {\n  return 1;\n}\n');
  fs.writeFileSync(path.join(root, 'b.py'), 'class Beta:\n    def gamma(self):\n        pass\n');
  return root;
}

const symbolsOf = async (rel, content) => symbols.findSymbols(rel, content);

test('refresh() indexes every file, all() flattens with the relative path', async () => {
  const root = project();
  const idx = new SymbolIndex(root, async () => ['a.js', 'b.py'], symbolsOf);
  await idx.refresh();
  const names = idx.all().map((s) => s.name).sort();
  assert.deepEqual(names, ['Beta', 'alpha', 'gamma']);
  const alpha = idx.all().find((s) => s.name === 'alpha');
  assert.equal(alpha.rel, 'a.js');
  assert.equal(alpha.kind, 'function');
  assert.equal(alpha.line, 1);
});

test('unchanged files are not re-parsed; invalidate() forces a re-check', async () => {
  const root = project();
  let calls = 0;
  const counting = async (rel, content) => { calls++; return symbolsOf(rel, content); };
  const idx = new SymbolIndex(root, async () => ['a.js', 'b.py'], counting);
  await idx.refresh();
  assert.equal(calls, 2);
  await idx.refresh(); // same files, nothing changed: refresh() is a no-op signal, not even the file-list is re-walked twice for parsing
  assert.equal(calls, 2);
  idx.invalidate();
  await idx.refresh(); // sig unchanged (same size/mtime) -> still skipped, just re-checked
  assert.equal(calls, 2);
  fs.writeFileSync(path.join(root, 'a.js'), 'function alpha() {\n  return 2;\n}\nfunction delta() {}\n');
  idx.invalidate();
  await idx.refresh();
  assert.equal(calls, 3, 'only the changed file was re-parsed');
  assert.ok(idx.all().some((s) => s.name === 'delta'));
});

test('a file removed from the project list is dropped from the index on the next refresh', async () => {
  const root = project();
  let files = ['a.js', 'b.py'];
  const idx = new SymbolIndex(root, async () => files, symbolsOf);
  await idx.refresh();
  assert.ok(idx.all().some((s) => s.name === 'Beta'));
  files = ['a.js'];
  idx.invalidate();
  await idx.refresh();
  assert.ok(!idx.all().some((s) => s.name === 'Beta'));
});

test('a file with no recognised symbols, or a language findSymbols does not know, contributes nothing (never throws)', async () => {
  const root = project();
  fs.writeFileSync(path.join(root, 'empty.js'), '// just a comment\n');
  fs.writeFileSync(path.join(root, 'data.txt'), 'plain text, no symbol parser for .txt\n');
  const idx = new SymbolIndex(root, async () => ['empty.js', 'data.txt'], symbolsOf);
  await idx.refresh();
  assert.deepEqual(idx.all(), []);
});
