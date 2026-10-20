'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const lock = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package-lock.json'), 'utf8'));
const atLeast = (v, min) => { const a = v.split('.').map(Number); const b = min.split('.').map(Number); for (let i = 0; i < 3; i++) { if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0); } return true; };

test('every copy of dompurify is a patched one (Monaco ships its own pinned copy unless overridden)', () => {
  const copies = Object.entries(lock.packages).filter(([k]) => /(^|\/)node_modules\/dompurify$/.test(k));
  assert.ok(copies.length >= 1);
  for (const [k, v] of copies) assert.ok(atLeast(v.version, '3.4.16'), `${k} is ${v.version}: XSS fixes are in 3.4.16`);
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.equal(pkg.overrides && pkg.overrides['monaco-editor'] && pkg.overrides['monaco-editor'].dompurify, '$dompurify', 'the override that keeps Monaco on the same copy');
});

test('no package depends on itself: electron-builder\'s module scan loops forever on such a cycle and runs out of memory (npm run dist:win crashed on tree-sitter-wasms)', () => {
  for (const [key, p] of Object.entries(lock.packages)) {
    if (!key) continue;
    const name = key.split('node_modules/').pop();
    const deps = { ...p.dependencies, ...p.optionalDependencies };
    assert.ok(!(name in deps), `${key} lists itself as a dependency`);
  }
});

test('the vendored grammars cover every language the symbol parser knows, and are shipped with the app', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'treesitter.js'), 'utf8');
  const langs = new Set([...src.match(/const EXT = \{[^}]*\}/)[0].matchAll(/: '([a-z_]+)'/g)].map((m) => m[1]));
  assert.ok(langs.size >= 8);
  for (const l of langs) assert.ok(fs.existsSync(path.join(__dirname, '..', 'vendor', 'tree-sitter-wasms', `tree-sitter-${l}.wasm`)), `missing grammar for ${l}`);
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.ok(pkg.build.files.includes('vendor/**'));
  assert.ok(!pkg.dependencies['tree-sitter-wasms']);
});
