'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../src/renderer/index.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../src/renderer/styles.css'), 'utf8');

test('the sidebar rail is a separate element in front of #sidebar, not nested inside it', () => {
  const railAt = html.indexOf('id="side-tabs"');
  const sidebarAt = html.indexOf('<aside id="sidebar">');
  assert.ok(railAt >= 0 && sidebarAt >= 0, 'rail or sidebar markup missing');
  assert.ok(railAt < sidebarAt, 'the rail must come before (outside) <aside id="sidebar">, as its own fixed-width column');
});

test('old horizontal .tabs styling is gone; the rail owns that layout now', () => {
  assert.ok(!/\.tabs\b/.test(css), 'leftover .tabs selector in styles.css');
  assert.ok(/\.rail\s*\{/.test(css), '.rail base style missing from styles.css');
});

test('the rail is a proper ARIA tablist: each tab links to the panel it reveals', () => {
  assert.match(html, /id="side-tabs"[^>]*role="tablist"/);
  const tabs = ['files', 'search', 'agents', 'changes', 'history', 'scripts'];
  for (const name of tabs) {
    const btn = new RegExp(`data-tab="${name}"[^>]*role="tab"[^>]*id="tab-${name}"[^>]*aria-controls="side-${name}"`);
    assert.match(html, btn, `#tab-${name} is missing role="tab" / aria-controls="side-${name}"`);
    const panel = new RegExp(`id="side-${name}"[^>]*role="tabpanel"[^>]*aria-labelledby="tab-${name}"`);
    assert.match(html, panel, `#side-${name} is missing role="tabpanel" / aria-labelledby="tab-${name}"`);
  }
});

test('exactly one rail tab starts selected, with a matching roving tabindex', () => {
  const selected = [...html.matchAll(/aria-selected="true"/g)];
  assert.strictEqual(selected.length, 1, 'exactly one tab should start aria-selected="true"');
  assert.match(html, /data-tab="files"[^>]*aria-selected="true"[^>]*tabindex="0"/, 'the default tab (files) should start selected with tabindex="0"');
  const unselectedTabIndex = [...html.matchAll(/aria-selected="false"[^>]*tabindex="(-?\d)"/g)];
  assert.ok(unselectedTabIndex.length >= 5 && unselectedTabIndex.every((m) => m[1] === '-1'), 'every unselected tab should start tabindex="-1" (roving tabindex)');
});
