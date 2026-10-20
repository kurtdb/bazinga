'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { search, rgBinary } = require('../src/core/search');

test('the bundled ripgrep is preferred, then one on PATH, then none', () => {
  assert.strictEqual(rgBinary({ bundled: () => '/b/rg', exists: () => true, which: () => '/usr/bin/rg' }), '/b/rg');
  assert.strictEqual(rgBinary({ bundled: () => '/b/rg', exists: () => false, which: () => '/usr/bin/rg' }), 'rg', 'bundled file missing: PATH');
  assert.strictEqual(rgBinary({ bundled: () => { throw new Error('not installed'); }, which: () => '/usr/bin/rg' }), 'rg');
  assert.strictEqual(rgBinary({ bundled: () => { throw new Error('x'); }, which: () => null }), null);
});

test('search finds text with ripgrep (the bundled one when installed) and gives the same answer as the JS scan', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'a.js'), 'const needle = 1;\nconst other = 2;\n');
  fs.writeFileSync(path.join(root, 'b.txt'), 'no match\nNEEDLE again\n');
  const viaRg = await search(root, { query: 'needle', caseSensitive: false });
  const viaJs = await search(root, { query: 'needle', caseSensitive: false, engine: 'js' });
  if (rgBinary()) assert.strictEqual(viaRg.engine, 'rg');
  assert.strictEqual(viaJs.engine, 'js');
  const key = (r) => r.results.map((x) => `${x.file}:${x.line}`).sort();
  assert.deepStrictEqual(key(viaRg), ['b.txt:2', 'src/a.js:1']);
  assert.deepStrictEqual(key(viaRg), key(viaJs));
  assert.ok(rgBinary(), 'the bundled ripgrep (or one on PATH) is available in this environment');
  fs.rmSync(root, { recursive: true, force: true });
});
