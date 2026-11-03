'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const sk = require('../src/core/skills');
const { repo, tmpdir, write } = require('./helpers');

test('parseSource: shorthand, URLs, tree paths, npx prefix; rejects non-https', () => {
  assert.deepStrictEqual(sk.parseSource('vercel-labs/agent-skills'), { url: 'https://github.com/vercel-labs/agent-skills.git', subpath: '', label: 'vercel-labs/agent-skills' });
  assert.strictEqual(sk.parseSource('npx skills add acme/tools').url, 'https://github.com/acme/tools.git');
  const t = sk.parseSource('https://github.com/acme/tools/tree/dev/skills/pdf');
  assert.strictEqual(t.branch, 'dev'); assert.strictEqual(t.subpath, 'skills/pdf');
  assert.strictEqual(sk.parseSource('acme/tools/skills/pdf').subpath, 'skills/pdf');
  assert.ok(sk.parseSource('git@github.com:a/b.git').error);
  assert.ok(sk.parseSource('http://github.com/a/b').error);
  assert.ok(sk.parseSource('').error);
  assert.ok(sk.parseSource('file:///etc').error);
});

test('findSkills / install / list / remove with provenance', async () => {
  const src = repo({
    'skills/pdf/SKILL.md': '---\nname: PDF Tools\ndescription: Work with PDFs\n---\nUse it.',
    'skills/pdf/run.py': 'print(1)',
    'skills/notes/SKILL.md': '---\nname: notes\ndescription: Take notes\n---\n',
    'README.md': 'hi',
    'node_modules/x/SKILL.md': '---\nname: x\n---',
  });
  const f = await sk.fetchSource({ url: `file://${src}`, label: 'local' }, { allowLocal: true });
  try {
    const skills = sk.findSkills(f.checkout);
    assert.deepStrictEqual(skills.map((s) => s.name).sort(), ['notes', 'pdf-tools']);
    const pdf = skills.find((s) => s.name === 'pdf-tools');
    assert.ok(pdf.hasScripts && pdf.description === 'Work with PDFs');
    assert.ok(!skills.find((s) => s.name === 'notes').hasScripts);
    const target = path.join(tmpdir(), '.claude', 'skills');
    const r = sk.installSkill(f.checkout, pdf, target, { source: { label: 'local', url: 'u', commit: f.commit } });
    assert.ok(fs.existsSync(path.join(r.dest, 'run.py')));
    assert.throws(() => sk.installSkill(f.checkout, pdf, target), /already installed/);
    sk.installSkill(f.checkout, pdf, target, { replace: true, source: { label: 'local', url: 'u', commit: f.commit } });
    const list = sk.listInstalled(target);
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].source, 'local');
    assert.strictEqual(list[0].provenance.commit, f.commit);
    assert.ok(sk.removeSkill(target, 'pdf-tools'));
    assert.deepStrictEqual(sk.listInstalled(target), []);
    assert.throws(() => sk.removeSkill(target, '../x'), /Invalid/);
  } finally { fs.rmSync(f.tmp, { recursive: true, force: true }); }
});

test('subpath narrows the search and cannot escape the checkout', async () => {
  const src = repo({ 'a/SKILL.md': '---\nname: a\n---', 'b/SKILL.md': '---\nname: b\n---' });
  const f = await sk.fetchSource({ url: `file://${src}` }, { allowLocal: true });
  try {
    assert.deepStrictEqual(sk.findSkills(f.checkout, 'a').map((s) => s.name), ['a']);
    assert.deepStrictEqual(sk.findSkills(f.checkout, '../..'), []);
    assert.throws(() => sk.installSkill(f.checkout, { name: 'evil', dir: '../..' }, tmpdir()), /escapes/);
  } finally { fs.rmSync(f.tmp, { recursive: true, force: true }); }
});

test('fetchSource: https only unless allowLocal; failure cleans up and explains', async () => {
  await assert.rejects(sk.fetchSource({ url: 'file:///tmp/x' }), /https/);
  await assert.rejects(sk.fetchSource({ url: 'file:///nonexistent/repo', label: 'nope' }, { allowLocal: true }), /Could not fetch nope/);
});

test('levelDir: ide under home, project under root, no escaping', () => {
  assert.strictEqual(sk.levelDir('ide', { home: '/h', root: '/p' }), path.join('/h', '.claude/skills'));
  assert.strictEqual(sk.levelDir('project', { home: '/h', root: '/p', skillsDir: '.agents/skills' }), path.join('/p', '.agents/skills'));
  assert.throws(() => sk.levelDir('project', { home: '/h', root: '/p', skillsDir: '../x' }), /relative/);
  assert.throws(() => sk.levelDir('project', { home: '/h', root: '/p', skillsDir: '/etc' }), /relative/);
  assert.throws(() => sk.levelDir('project', { home: '/h', root: null }), /project/);
});

test('effectiveSkills: project wins over IDE level on the same name', () => {
  const e = sk.effectiveSkills({ ide: [{ name: 'a', description: 'ide' }, { name: 'b' }], project: [{ name: 'a', description: 'proj' }, { name: 'c' }] });
  assert.deepStrictEqual(e.map((s) => `${s.name}:${s.level}`), ['a:project', 'b:ide', 'c:project']);
  assert.strictEqual(e[0].overrides, true);
  assert.strictEqual(e[0].description, 'proj');
});

test('SKILL.md without frontmatter still installs under the folder name', async () => {
  const src = repo({ 'my_skill/SKILL.md': 'No frontmatter' });
  const f = await sk.fetchSource({ url: `file://${src}` }, { allowLocal: true });
  try { assert.deepStrictEqual(sk.findSkills(f.checkout).map((s) => s.name), ['my_skill']); } finally { fs.rmSync(f.tmp, { recursive: true, force: true }); }
  write(tmpdir(), 'x', 'y');
});

test('skills: installs go to the primary folder and every mirror; remove and sync cover them all (regression: skills only reached .claude/skills)', () => {
  const os = require('node:os'); const fs = require('node:fs'); const path = require('node:path');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bz-sk-'));
  const checkout = path.join(tmp, 'src'); fs.mkdirSync(path.join(checkout, 'pdf'), { recursive: true });
  fs.writeFileSync(path.join(checkout, 'pdf', 'SKILL.md'), '---\nname: pdf\ndescription: PDFs\n---\nbody');
  const root = path.join(tmp, 'proj'); fs.mkdirSync(root);
  const targets = sk.levelDirs('project', { root, home: tmp, skillsDir: '.claude/skills', mirrors: ['.agents/skills', '.claude/skills'] });
  assert.deepStrictEqual(targets.map((t) => path.relative(root, t).split(path.sep).join('/')), ['.claude/skills', '.agents/skills']);
  const [skill] = sk.findSkills(checkout);
  sk.installEverywhere(checkout, skill, targets, { source: { label: 't' } });
  for (const t of targets) assert.ok(fs.existsSync(path.join(t, 'pdf', 'SKILL.md')));
  assert.throws(() => sk.installEverywhere(checkout, skill, targets, {}), /already installed/);
  sk.installEverywhere(checkout, skill, targets, { replace: true });
  sk.removeEverywhere(targets, 'pdf');
  for (const t of targets) assert.ok(!fs.existsSync(path.join(t, 'pdf')));
  assert.throws(() => sk.removeEverywhere(targets, 'pdf'), /not installed/);
  // an older install exists in the primary folder only
  sk.installSkill(checkout, skill, targets[0], {});
  assert.deepStrictEqual(sk.syncMirrors(targets).length, 1);
  assert.ok(fs.existsSync(path.join(targets[1], 'pdf', 'SKILL.md')));
  assert.deepStrictEqual(sk.syncMirrors(targets), [], 'second sync has nothing to do');
  assert.throws(() => sk.levelDirs('project', { root, home: tmp, mirrors: ['../outside'] }), /relative path inside/);
});

test('installBundled: installs a skill from a plain (non-git) bundled directory with no provenance url, and rejects an unknown name', () => {
  const bundledRoot = repo({ 'clean-code/SKILL.md': '---\nname: Clean Code\ndescription: Uncle Bob mode\n---\nBody.' });
  const target = path.join(tmpdir(), '.claude', 'skills');
  const res = sk.installBundled(bundledRoot, 'clean-code', [target]);
  assert.strictEqual(res.name, 'clean-code');
  const list = sk.listInstalled(target);
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].provenance.url, undefined);
  assert.throws(() => sk.installBundled(bundledRoot, 'does-not-exist', [target]), /not found among the bundled skills/);
});
