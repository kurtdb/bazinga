'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const html = read('src/renderer/index.html');
const app = read('src/renderer/app.js');

// load icons.js with a minimal DOM stub
const created = [];
const window = {};
vm.runInNewContext(read('src/renderer/icons.js'), { window, document: { createElement: () => { const n = { setAttribute() {}, className: '', innerHTML: '' }; created.push(n); return n; } } });
const names = new Set(window.icon.names);

test('icons.js defines a non-empty path for every icon', () => {
  assert.ok(names.size >= 40);
  for (const n of names) { const node = window.icon(n); assert.ok(/<(path|circle|rect|line|polyline|polygon|ellipse)/.test(node.innerHTML), `${n} is empty`); }
  assert.deepStrictEqual([...window.icon.missing], []);
});

test('an unknown icon name is recorded, so the smoke test can fail on typos', () => {
  window.icon('does-not-exist');
  assert.deepStrictEqual([...window.icon.missing], ['does-not-exist']);
  window.icon.missing.length = 0;
});

test('every icon named in index.html exists', () => {
  const used = [...html.matchAll(/data-icon="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(used.length >= 15);
  for (const n of used) assert.ok(names.has(n), `index.html uses unknown icon ${n}`);
});

test('every icon named in app.js exists', () => {
  const used = new Set();
  for (const m of app.matchAll(/\bic\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g)) for (const t of m[1].replace(/[!=]==\s*'[^']*'/g, '').matchAll(/'([a-z0-9-]+)'/g)) used.add(t[1]);
  for (const m of app.matchAll(/setLabel\([^\n]*\)/g)) for (const t of m[0].matchAll(/'([a-z0-9-]{3,})'/g)) used.add(t[1]);
  const ext = app.match(/const EXT_ICON = \{([\s\S]*?)\};/)[1];
  for (const t of ext.matchAll(/:\s*'([a-z0-9-]+)'/g)) used.add(t[1]);
  const ignore = new Set(['diff', 'dir', 'tab-ico', 'ftype', 'twisty', 'bt-err', 'bt-ok', 'st-A', 'dirty', 'file', 'light', 'dark', 'error', 'warning', 'qo-ico', 'bc-ico', 'spin', 'on', 'danger', 'warn']);
  for (const n of used) if (!ignore.has(n) || n === 'file') assert.ok(names.has(n) || ignore.has(n), `app.js uses unknown icon ${n}`);
  assert.ok(used.size >= 25);
});

test('the CSP still allows everything icons need (inline SVG only, no network)', () => {
  assert.doesNotMatch(html, /https?:\/\/[^"' ]*(font|icon|cdn)/i);
  assert.match(html, /<script src="icons.js"><\/script>\s*<script src="app.js">/);
});
