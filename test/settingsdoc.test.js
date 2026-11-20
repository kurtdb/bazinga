'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const settingsdoc = require('../src/core/settingsdoc');
const { DEFAULT_CONFIG } = require('../src/core/config');
const { DEFAULT_KEYBINDINGS } = require('../src/core/keybindings');

test('every settings key (DEFAULT_CONFIG + any SCHEMA-only key) has a one-line description, so a new setting cannot ship undocumented', () => {
  for (const key of settingsdoc.allKeys()) {
    assert.ok(settingsdoc.DESCRIPTIONS[key], `"${key}" has no entry in DESCRIPTIONS`);
  }
});

test('renderBlock: every key, its default and its keybindings all appear, wrapped in the markers', () => {
  const block = settingsdoc.renderBlock({ settingsPath: '/x/settings.json', userDataDir: '/x' });
  assert.ok(block.startsWith(settingsdoc.START) && block.endsWith(settingsdoc.END));
  assert.match(block, /\/x\/settings\.json/);
  for (const key of Object.keys(DEFAULT_CONFIG)) assert.match(block, new RegExp(`\\*\\*${key}\\*\\*`));
  assert.match(block, /default `"system"`/); // theme's actual default, not a placeholder
  for (const kb of DEFAULT_KEYBINDINGS) assert.match(block, new RegExp(`\\*\\*${kb.id}\\*\\*`));
  assert.match(block, /secrets\.json.*Never read or edit this/);
});

test('renderBlock: the "customizing Bazinga itself" section only appears when sourceDir is given (a dev checkout, not a packaged build)', () => {
  const packaged = settingsdoc.renderBlock({ settingsPath: '/x/settings.json', userDataDir: '/x' });
  assert.ok(!packaged.includes('customizing Bazinga itself'));
  const fromSource = settingsdoc.renderBlock({ settingsPath: '/x/settings.json', userDataDir: '/x', sourceDir: '/dev/bazinga' });
  assert.match(fromSource, /customizing Bazinga itself/);
  assert.match(fromSource, /\/dev\/bazinga/);
  assert.match(fromSource, /no stable boundary/);
});

test('typeLine: enums, nullable wrapping, and ranged numbers read as plain English', () => {
  assert.equal(settingsdoc.typeLine('theme'), 'one of: system, light, dark, high-contrast, high-contrast-light, night, nerd, tron, wargames');
  assert.equal(settingsdoc.typeLine('oversight'), 'one of: autonomous, supervised, guided, stepwise, or null');
  assert.equal(settingsdoc.typeLine('editorFontSize'), 'a number (>= 8, <= 40)');
  assert.equal(settingsdoc.typeLine('shell'), 'a string, or null');
  assert.equal(settingsdoc.typeLine('notAKey'), '');
  assert.equal(settingsdoc.typeLine('agents'), 'a list of objects', 'agents is an array of objects, not strings');
  assert.equal(settingsdoc.typeLine('skillsMirrors'), 'a list of strings');
});

test('applyBlock: upserting is idempotent and leaves text around the markers alone', () => {
  const doc = 'before\n\nafter\n';
  const a = settingsdoc.applyBlock(doc, { settingsPath: '/x/settings.json', userDataDir: '/x' });
  assert.ok(a.startsWith('before\n\nafter\n\n') && a.includes(settingsdoc.START));
  assert.equal(settingsdoc.applyBlock(a, { settingsPath: '/x/settings.json', userDataDir: '/x' }), null, 'same inputs: nothing to write');
  const b = settingsdoc.applyBlock(a, { settingsPath: '/y/settings.json', userDataDir: '/y' });
  assert.ok(b.startsWith('before\n\nafter\n\n') && b.includes('/y/settings.json') && !b.includes('/x/settings.json'));
});
