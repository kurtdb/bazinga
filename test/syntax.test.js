'use strict';
// A script that does not even parse (for example a name declared twice) leaves the window blank and nothing in the unit tests notices.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..', 'src');
const files = [];
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.js$/.test(e.name)) files.push(p); } })(root);

test('every script of the app parses (the window is a classic script, so a duplicate const breaks everything)', () => {
  assert.ok(files.length > 20);
  const bad = [];
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    try { new vm.Script(src.replace(/^#!.*/, ''), { filename: f }); } catch (e) { bad.push(`${path.relative(root, f)}: ${e.message}`); }
  }
  assert.deepEqual(bad, []);
});
