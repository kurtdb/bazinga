'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_KEYBINDINGS, normalizeChord, resolve, findConflicts } = require('../src/core/keybindings');

test('normalizeChord: canonical modifier order, single-char keys upper-cased, punctuation keys kept as-is', () => {
  assert.equal(normalizeChord('Shift+Mod+p'), 'Mod+Shift+P');
  assert.equal(normalizeChord('ctrl+`'), 'Ctrl+`');
  assert.equal(normalizeChord('alt+shift+ctrl+mod+x'), 'Mod+Ctrl+Shift+Alt+X');
  assert.equal(normalizeChord(''), null);
  assert.equal(normalizeChord('Mod+Shift'), null); // modifiers only, no real key
  assert.equal(normalizeChord(null), null);
  assert.equal(normalizeChord(undefined), null);
});

test('resolve: defaults alone, an override, an explicit unbind (null), and an unknown id is ignored', () => {
  const defaults = resolve({});
  assert.equal(defaults.saveFile, 'Mod+S');
  assert.equal(defaults.newTerminal, 'Ctrl+`');
  assert.equal(Object.keys(defaults).length, DEFAULT_KEYBINDINGS.length);

  const rebound = resolve({ saveFile: 'Mod+Shift+S' });
  assert.equal(rebound.saveFile, 'Mod+Shift+S');
  assert.equal(rebound.goToFile, 'Mod+P'); // untouched commands keep their default

  const unbound = resolve({ goToFile: null });
  assert.equal(unbound.goToFile, null);

  const ignored = resolve({ notARealCommand: 'Mod+Z' });
  assert.equal(ignored.notARealCommand, undefined);
});

test('findConflicts: no conflicts by default; two commands rebound onto the same chord are grouped; unbound commands never conflict', () => {
  assert.deepEqual(findConflicts(resolve({})), []);

  const clash = resolve({ goToFile: 'Mod+S' }); // now shares saveFile's default chord
  const conflicts = findConflicts(clash);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].chord, 'Mod+S');
  assert.deepEqual(conflicts[0].ids.sort(), ['goToFile', 'saveFile']);

  const bothUnbound = resolve({ goToFile: null, goToSymbol: null });
  assert.deepEqual(findConflicts(bothUnbound), []);
});
