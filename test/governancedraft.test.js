'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildTask, allowGlobs } = require('../src/core/governancedraft');

test('buildTask: names the stack, lists the staged files, and references the staging dir throughout the advice', () => {
  const task = buildTask({ label: 'Python (FastAPI) + React', files: ['CLAUDE.md', '.claude/rules/security.md'], stagingDir: '.bazinga-governance-draft' });
  assert.match(task, /Python \(FastAPI\) \+ React/);
  assert.match(task, /- CLAUDE\.md/);
  assert.match(task, /- \.claude\/rules\/security\.md/);
  assert.match(task, /\.bazinga-governance-draft\/ in this worktree/);
  assert.match(task, /delete the \.bazinga-governance-draft\/ folder entirely/);
  assert.doesNotMatch(task, /STAGING_DIR/); // the placeholder must always be substituted, never leak through
});

test('allowGlobs: the staging dir plus one glob per top-level destination, root files kept exact', () => {
  const globs = allowGlobs(['CLAUDE.md', '.claude/rules/security.md', '.claude/architecture/overview.md', '.github/instructions/copilot.md'], '.bazinga-governance-draft');
  assert.deepEqual(new Set(globs), new Set(['.bazinga-governance-draft/**', 'CLAUDE.local.md', '.gitignore', 'CLAUDE.md', '.claude/**', '.github/**']));
});
