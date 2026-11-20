'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildTask } = require('../src/core/skilldraft');

test('buildTask: names the exact target file, includes the user\'s purpose verbatim and the triggering-description advice', () => {
  const task = buildTask({ name: 'React Test Writer', purpose: 'write unit tests for React components when asked' });
  assert.match(task, /\.claude\/skills\/react-test-writer\/SKILL\.md/);
  assert.match(task, /write unit tests for React components when asked/);
  assert.match(task, /description/i);
  assert.match(task, /WHEN it should trigger/);
});

test('buildTask: a custom skillsDir is used, and the name is slugged the same way skills.js installs one', () => {
  const task = buildTask({ name: 'Weird Name!!', purpose: 'x', skillsDir: '.agents/skills' });
  assert.match(task, /\.agents\/skills\/weird-name\/SKILL\.md/);
});

test('buildTask: modelAfter adds a "read this first" line with its own name slugged; omitted when not given', () => {
  const withModel = buildTask({ name: 'a', purpose: 'x', modelAfter: 'Some Other Skill' });
  assert.match(withModel, /\.claude\/skills\/some-other-skill\/SKILL\.md for a sense of this project/);
  const without = buildTask({ name: 'a', purpose: 'x' });
  assert.doesNotMatch(without, /for a sense of this project/);
});

test('buildTask: a missing name or purpose is refused with a clear message, nothing silently defaulted', () => {
  assert.throws(() => buildTask({ name: '', purpose: 'x' }), /name/i);
  assert.throws(() => buildTask({ name: 'ok', purpose: '' }), /what the skill should do/i);
  assert.throws(() => buildTask({ name: 'ok', purpose: '   ' }), /what the skill should do/i);
});
