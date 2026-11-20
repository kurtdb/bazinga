'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const governance = require('../src/core/governance');

/** A fake GitHub: a git tree for the repo, plus raw file content keyed by "<folder>/<relPath>". */
function fakeFetch({ tree, raw }) {
  return async (url) => {
    if (url.startsWith('https://api.github.com/repos/')) {
      return new Response(JSON.stringify({ tree }), { status: 200 });
    }
    const m = /^https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/main\/(.+)$/.exec(url);
    if (m && Object.prototype.hasOwnProperty.call(raw, m[1])) return new Response(raw[m[1]], { status: 200 });
    return new Response('not found', { status: 404 });
  };
}

test('listStacks: every entry has an id, label and folder', () => {
  const stacks = governance.listStacks();
  assert.ok(stacks.length > 0);
  for (const s of stacks) { assert.ok(s.id); assert.ok(s.label); assert.ok(s.folder); }
});

test('listStackFiles: only blobs under the stack folder, govbuild.json and samples/ excluded', async () => {
  const tree = [
    { type: 'blob', path: 'react-only/CLAUDE.md' },
    { type: 'blob', path: 'react-only/.claude/rules/security.md' },
    { type: 'blob', path: 'react-only/govbuild.json' },
    { type: 'blob', path: 'react-only/samples/App.tsx' },
    { type: 'tree', path: 'react-only/.claude' },
    { type: 'blob', path: 'vue-only/CLAUDE.md' }, // a different stack - must not leak in
  ];
  const files = await governance.listStackFiles('react-only', { fetchImpl: fakeFetch({ tree, raw: {} }) });
  assert.deepEqual(files.sort(), ['.claude/rules/security.md', 'CLAUDE.md']);
});

test('listStackFiles: an empty result is refused with a clear message, not silently returned', async () => {
  await assert.rejects(
    governance.listStackFiles('react-only', { fetchImpl: fakeFetch({ tree: [{ type: 'blob', path: 'react-only/samples/App.tsx' }], raw: {} }) }),
    /No template files found/,
  );
});

test('downloadStack: writes every file under destDir, preserving relative structure', async () => {
  const tree = [
    { type: 'blob', path: 'python-fastapi-react/CLAUDE.md' },
    { type: 'blob', path: 'python-fastapi-react/.claude/rules/backend.md' },
  ];
  const raw = {
    'python-fastapi-react/CLAUDE.md': '# Project\n',
    'python-fastapi-react/.claude/rules/backend.md': '# Backend rules\n',
  };
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'bazinga-gov-test-'));
  try {
    const files = await governance.downloadStack('python-fastapi-react', dest, { fetchImpl: fakeFetch({ tree, raw }) });
    assert.deepEqual(files.sort(), ['.claude/rules/backend.md', 'CLAUDE.md']);
    assert.equal(fs.readFileSync(path.join(dest, 'CLAUDE.md'), 'utf8'), '# Project\n');
    assert.equal(fs.readFileSync(path.join(dest, '.claude', 'rules', 'backend.md'), 'utf8'), '# Backend rules\n');
  } finally { fs.rmSync(dest, { recursive: true, force: true }); }
});

test('downloadStack: a missing raw file (404) is refused, nothing left half-written silently ignored', async () => {
  const tree = [{ type: 'blob', path: 'react-only/CLAUDE.md' }];
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'bazinga-gov-test-'));
  try {
    await assert.rejects(
      governance.downloadStack('react-only', dest, { fetchImpl: fakeFetch({ tree, raw: {} }) }),
      /Could not download CLAUDE\.md/,
    );
  } finally { fs.rmSync(dest, { recursive: true, force: true }); }
});
