'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const mem = require('../src/core/agentmemory');

const mkdir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'am-'));

test('agentmemory: append, readAll round-trip, survive a torn line', () => {
  const dir = mkdir();
  const file = mem.fileFor(dir, '/proj/a');
  assert.ok(mem.append(file, { text: 'fact one', files: ['src/a.js'] }));
  assert.ok(mem.append(file, { text: 'fact two' }));
  fs.appendFileSync(file, '{"torn');
  const all = mem.readAll(file);
  assert.strictEqual(all.length, 2);
  assert.strictEqual(all[0].text, 'fact one');
  assert.deepStrictEqual(all[0].files, ['src/a.js']);
  assert.strictEqual(all[1].files.length, 0);
});

test('agentmemory: empty text is rejected and writes nothing', () => {
  const dir = mkdir();
  const file = mem.fileFor(dir, '/proj/a');
  assert.strictEqual(mem.append(file, { text: '   ' }), false);
  assert.deepStrictEqual(mem.readAll(file), []);
  assert.ok(!fs.existsSync(file));
});

test('agentmemory: text/files are cleaned and capped on write', () => {
  const dir = mkdir();
  const file = mem.fileFor(dir, '/proj/a');
  mem.append(file, { text: `a\u0007b${'x'.repeat(600)}`, files: Array.from({ length: 30 }, (_, i) => `f${i}.js`) });
  const [e] = mem.readAll(file);
  assert.ok(e.text.length <= mem.MAX_TEXT && !e.text.includes('\u0007'));
  assert.strictEqual(e.files.length, mem.MAX_FILES);
});

test('agentmemory: readAll caps the store at MAX_ENTRIES, keeping the most recent', () => {
  const dir = mkdir();
  const file = mem.fileFor(dir, '/proj/a');
  for (let i = 0; i < mem.MAX_ENTRIES + 10; i++) mem.append(file, { text: `fact ${i}` });
  const all = mem.readAll(file);
  assert.strictEqual(all.length, mem.MAX_ENTRIES);
  assert.strictEqual(all[all.length - 1].text, `fact ${mem.MAX_ENTRIES + 9}`);
});

test('agentmemory: fileFor is stable per root and different across roots', () => {
  const dir = mkdir();
  assert.strictEqual(mem.fileFor(dir, '/proj/a'), mem.fileFor(dir, '/proj/a/'));
  assert.notStrictEqual(mem.fileFor(dir, '/proj/a'), mem.fileFor(dir, '/proj/b'));
  assert.ok(!mem.fileFor(dir, '/proj/a').includes('..'));
});

test('agentmemory: recall filters by query, by path prefix, by both, and respects limit', () => {
  const dir = mkdir();
  const file = mem.fileFor(dir, '/proj/a');
  mem.append(file, { text: 'retry swallows ECONNRESET', files: ['src/core/toolproxy.js'] });
  mem.append(file, { text: 'unowned legacy parser', files: ['legacy/orderParser.js'] });
  mem.append(file, { text: 'another retry note', files: ['src/core/toolproxy.js', 'src/core/other.js'] });
  const all = mem.readAll(file);

  const byQuery = mem.recall(all, { query: 'retry' });
  assert.strictEqual(byQuery.length, 2);
  assert.strictEqual(byQuery[0].text, 'another retry note'); // most-recent-first

  const byPath = mem.recall(all, { path: 'src/core' });
  assert.strictEqual(byPath.length, 2);

  const both = mem.recall(all, { query: 'retry', path: 'src/core' });
  assert.strictEqual(both.length, 2);

  const limited = mem.recall(all, { limit: 1 });
  assert.strictEqual(limited.length, 1);
  assert.strictEqual(limited[0].text, 'another retry note');

  assert.strictEqual(mem.recall(all, { query: 'nope' }).length, 0);
  assert.strictEqual(mem.recall([], { query: 'retry' }).length, 0);
});

test('agentmemory: buildIndex orders most-recent-first and respects caps', () => {
  const entries = [
    mem.makeEntry({ text: 'first', files: ['a.js'] }),
    mem.makeEntry({ text: 'second' }),
  ];
  const idx = mem.buildIndex(entries);
  assert.match(idx, /Things agents have already learned/);
  const lines = idx.split('\n').filter((l) => l.startsWith('-'));
  assert.deepStrictEqual(lines, ['- second', '- first [a.js]']);
  assert.strictEqual(mem.buildIndex([]), '');

  const many = Array.from({ length: 30 }, (_, i) => mem.makeEntry({ text: `fact ${i}` }));
  assert.strictEqual(mem.buildIndex(many, { maxEntries: 5 }).split('\n').filter((l) => l.startsWith('-')).length, 5);

  const long = mem.buildIndex([mem.makeEntry({ text: 'x'.repeat(5000) })], { maxChars: 100 });
  assert.ok(long.length <= 100 && long.endsWith('…'));
});
