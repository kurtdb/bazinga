'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const idx = require('../src/core/skillindex');

const skills = [{ name: 'pdf', description: 'Work with PDFs' }, { name: 'sql', description: '' }];

test('skillindex: a block is added to an existing AGENTS.md without touching the rest, and updating is stable', () => {
  const doc = '# Rules\n\nUse tabs.\n';
  const a = idx.applyBlock(doc, skills, '.claude/skills');
  assert.ok(a.startsWith('# Rules\n\nUse tabs.\n\n'));
  assert.match(a, /\*\*pdf\*\*: Work with PDFs \(`\.claude\/skills\/pdf\/SKILL\.md`\)/);
  assert.match(a, /\*\*sql\*\*: no description/);
  assert.equal(idx.applyBlock(a, skills, '.claude/skills'), null, 'same skills: nothing to write');
  const b = idx.applyBlock(a, [skills[0]], '.claude/skills');
  assert.ok(b.startsWith('# Rules\n\nUse tabs.\n') && !/sql/.test(b));
});

test('skillindex: text around the markers survives, removal leaves the user\'s content', () => {
  const doc = `before\n${idx.renderBlock(skills, '.agents/skills')}\nafter\n`;
  const next = idx.applyBlock(doc, [{ name: 'x', description: 'd' }], '.agents/skills');
  assert.ok(next.startsWith('before\n') && next.trimEnd().endsWith('after'));
  const removed = idx.applyBlock(next, [], '.agents/skills');
  assert.ok(!removed.includes('bazinga:skills'));
  assert.ok(removed.includes('before') && removed.includes('after'));
});

test('skillindex: no skills and no block means no file is created or changed; a file that only held the block becomes empty', () => {
  assert.equal(idx.applyBlock('', [], '.claude/skills'), null);
  assert.equal(idx.applyBlock('# hi\n', [], '.claude/skills'), null);
  const only = idx.applyBlock('', skills, '.claude/skills');
  assert.equal(idx.applyBlock(only, [], '.claude/skills'), '');
});

test('skillindex: multi-line descriptions are flattened to one line', () => {
  assert.match(idx.renderBlock([{ name: 'a', description: 'line one\n  line two' }], '.claude/skills'), /\*\*a\*\*: line one line two \(/);
});
