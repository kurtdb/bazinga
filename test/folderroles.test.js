'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const fr = require('../src/core/folderroles');
const agentprep = require('../src/core/agentprep');
const agenthint = require('../src/core/agenthint');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bz-folders-'));
const mk = (root, ...dirs) => { for (const d of dirs) fs.mkdirSync(path.join(root, d), { recursive: true }); };

test('normalize: clean relative folders, one role per folder, no escapes', () => {
  const f = fr.normalize({ source: ['./src/main/java/', 'src\\main\\kotlin', '../outside', '/abs', 'C:\\x', '', '.', 'a//b', 'dup', 'dup'], tests: ['dup', 'src/test/java', 'x/../y'] });
  assert.deepEqual(f.source, ['a/b', 'dup', 'src/main/java', 'src/main/kotlin']);
  assert.deepEqual(f.tests, ['src/test/java']); // dup stays with source: the first role listed wins
  assert.deepEqual(fr.normalize(null), { source: [], tests: [] });
  assert.deepEqual(fr.normalize({ source: 'nope' }), { source: [], tests: [] });
});

test('mark: assigns, moves between roles, clears; refuses the root and unknown roles; does not change its input', () => {
  const start = { source: ['src'], tests: [] };
  const a = fr.mark(start, 'tests', 'tests');
  assert.deepEqual(a, { source: ['src'], tests: ['tests'] });
  assert.deepEqual(start, { source: ['src'], tests: [] });
  const b = fr.mark(a, 'tests', 'source');
  assert.deepEqual(b, { source: ['src', 'tests'], tests: [] });
  assert.deepEqual(fr.mark(b, 'src', null), { source: ['tests'], tests: [] });
  assert.deepEqual(fr.mark(b, './tests/', null), { source: ['src'], tests: [] });
  assert.throws(() => fr.mark(a, '', 'source'), /cannot be marked/);
  assert.throws(() => fr.mark(a, '..', 'source'), /cannot be marked/);
  assert.throws(() => fr.mark(a, 'x', 'docs'), /Unknown role/);
});

test('roleOf and classify: the most specific marked folder wins (tests inside source)', () => {
  const f = { source: ['src', 'app'], tests: ['src/test', 'tests'] };
  assert.equal(fr.roleOf(f, 'src'), 'source');
  assert.equal(fr.roleOf(f, 'src/main'), null);
  assert.deepEqual(fr.classify(f, 'src/main/App.java'), { role: 'source', folder: 'src' });
  assert.deepEqual(fr.classify(f, 'src/test/AppTest.java'), { role: 'tests', folder: 'src/test' });
  assert.deepEqual(fr.classify(f, 'tests'), { role: 'tests', folder: 'tests' });
  assert.equal(fr.classify(f, 'srcx/a.js'), null, 'a folder name prefix is not a parent folder');
  assert.equal(fr.classify(f, 'README.md'), null);
});

test('describe: the text for the model, only what is marked', () => {
  assert.equal(fr.describe({ source: [], tests: [] }), '');
  const both = fr.describe({ source: ['src/main/java', 'app'], tests: ['src/test/java'] });
  assert.match(both, /^Project layout \(folders the user marked in Bazinga, relative to the project root\):/);
  assert.match(both, /- Source code: app, src\/main\/java/);
  assert.match(both, /- Tests: src\/test\/java/);
  assert.match(both, /Production code belongs in the source folders and tests belong in the test folders\./);
  assert.match(both, /never put a test in a source folder/);
  assert.match(fr.describe({ tests: ['tests'] }), /^- Tests: tests$/m);
  assert.match(fr.describe({ tests: ['tests'] }), /Tests belong in the test folders\.$/);
  assert.doesNotMatch(fr.describe({ source: ['src'] }), /Tests:/);
});

test('existing: marks of folders that were renamed or deleted do not reach the model', () => {
  const root = tmp(); mk(root, 'src', 'tests');
  fs.writeFileSync(path.join(root, 'notes'), 'a file, not a folder');
  assert.deepEqual(fr.existing(root, { source: ['src', 'gone'], tests: ['tests', 'notes'] }), { source: ['src'], tests: ['tests'] });
  fs.rmSync(root, { recursive: true, force: true });
});

test('detect and mergeDetected: conventional layouts; never changes a folder that is already marked', () => {
  const maven = tmp(); mk(maven, 'src/main/java', 'src/main/resources', 'src/test/java', 'src/test/resources');
  assert.deepEqual(fr.detect(maven), { source: ['src/main/java'], tests: ['src/test/java'] });
  const node = tmp(); mk(node, 'src/components', '__tests__', 'tests');
  assert.deepEqual(fr.detect(node), { source: ['src'], tests: ['__tests__', 'tests'] });
  const empty = tmp();
  assert.deepEqual(fr.detect(empty), { source: [], tests: [] });
  const merged = fr.mergeDetected({ source: ['tests'], tests: [] }, { source: ['src'], tests: ['tests'] });
  assert.deepEqual(merged, { source: ['src', 'tests'], tests: [] }, '“tests” was marked as source by the user: not overridden');
  for (const d of [maven, node, empty]) fs.rmSync(d, { recursive: true, force: true });
});

test('save: writes only the folders key into .ide/config.json and keeps every other key; empty marks remove the key', () => {
  const root = tmp();
  fr.save(root, { source: ['src'], tests: ['tests'] });
  const file = path.join(root, '.ide', 'config.json');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { folders: { source: ['src'], tests: ['tests'] } });
  fs.writeFileSync(file, JSON.stringify({ oversight: 'guided', mergeGuard: { dependencies: 'block' }, folders: { source: ['old'] } }));
  fr.save(root, { source: ['src'], tests: [] });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { oversight: 'guided', mergeGuard: { dependencies: 'block' }, folders: { source: ['src'] } });
  fr.save(root, { source: [], tests: [] });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { oversight: 'guided', mergeGuard: { dependencies: 'block' } });
  assert.deepEqual(fr.fromConfig({ folders: { source: ['./a/'], tests: ['b'] } }), { source: ['a'], tests: ['b'] });
  fs.rmSync(root, { recursive: true, force: true });
});

test('save: a config.json that is not valid JSON is never overwritten', () => {
  const root = tmp(); mk(root, '.ide');
  const file = path.join(root, '.ide', 'config.json');
  fs.writeFileSync(file, '{ "oversight": "guided", ');
  assert.throws(() => fr.save(root, { source: ['src'] }), /not valid JSON.*nothing was changed/);
  assert.equal(fs.readFileSync(file, 'utf8'), '{ "oversight": "guided", ');
  fs.writeFileSync(file, '[1,2]');
  assert.throws(() => fr.save(root, { source: ['src'] }), /must contain a JSON object/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('AGENTS.md block: added after existing text, replaced in place, removed again, other text untouched', () => {
  const f = { source: ['src'], tests: ['tests'] };
  const first = fr.applyBlock('# Rules\n\nBe nice.\n', f);
  assert.match(first, /^# Rules\n\nBe nice\.\n\n<!-- bazinga:folders:start/);
  assert.match(first, /## Project layout\n\nProject layout \(folders/);
  assert.equal(fr.applyBlock(first, f), null, 'nothing to write when it is already up to date');
  const changed = fr.applyBlock(first, { source: ['app'], tests: [] });
  assert.match(changed, /Source code: app/);
  assert.doesNotMatch(changed, /Tests:/);
  assert.match(changed, /Be nice\./);
  assert.equal(fr.applyBlock(changed, { source: [], tests: [] }), '# Rules\n\nBe nice.\n');
  assert.equal(fr.applyBlock('', { source: [], tests: [] }), null);
  assert.equal(fr.applyBlock(fr.applyBlock('', f), { source: [], tests: [] }), '', 'the file only held our block: it becomes empty');
  // it lives next to the skills block without disturbing it
  const skills = '<!-- bazinga:skills:start (generated, do not edit between the markers) -->\n## Skills\n<!-- bazinga:skills:end -->\n';
  const both = fr.applyBlock(skills, f);
  assert.ok(both.startsWith(skills.trimEnd()) && both.includes('bazinga:folders:start'));
  assert.ok(fr.applyBlock(both, { source: [], tests: [] }).includes('bazinga:skills:start'));
});

test('the standing instructions carry the layout, between the agent\'s own text and the project hint', () => {
  assert.equal(agenthint.compose({ agentHint: 'A', layout: 'L', projectHint: 'P', extra: 'E' }), 'A\n\nL\n\nP\n\nE');
  assert.equal(agenthint.compose({ layout: 'L' }), 'L');
});

test('agentprep: marked folders that exist are written into the hint file; missing ones and no marks add nothing', async () => {
  const root = tmp(); mk(root, 'src', 'tests');
  const hints = path.join(root, '.hints');
  const prep = (config) => agentprep.prepare({ name: 'c', command: 'claude' }, { root, hintDir: hints, config });
  const a = await prep({ folders: { source: ['src', 'gone'], tests: ['tests'] } });
  assert.ok(a.hintFile);
  const text = fs.readFileSync(a.hintFile, 'utf8');
  assert.match(text, /- Source code: src$/m);
  assert.match(text, /- Tests: tests$/m);
  assert.doesNotMatch(text, /gone/);
  assert.match(a.command, /--append-system-prompt-file/);
  const none = await prep({});
  assert.equal(none.hintFile, undefined);
  assert.equal(none.command, 'claude');
  const onlyGone = await prep({ folders: { source: ['gone'] } });
  assert.equal(onlyGone.hintFile, undefined);
  fs.rmSync(root, { recursive: true, force: true });
});

test('the UI and the main process are wired: right-click menu on folders, badge, palette command, IPC, config default', () => {
  const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
  const app = read('src', 'renderer', 'app.js');
  assert.match(app, /if \(e\.dir\) row\.addEventListener\('contextmenu', \(ev\) => folderMenu\(ev, e\.rel\)\)/);
  assert.match(app, /Mark as source folder/); assert.match(app, /Mark as test folder/); assert.match(app, /Clear mark/);
  assert.match(app, /api\.folders\.mark\(rel, role\)/);
  assert.match(app, /\['Folders: detect source and test folders'/);
  assert.match(read('src', 'renderer', 'styles.css'), /\.row \.role-tests/);
  const main = read('src', 'main', 'main.js');
  assert.match(main, /ipcMain\.handle\('folders:mark'/); assert.match(main, /ipcMain\.handle\('folders:detect'/);
  assert.match(read('src', 'main', 'preload.js'), /mark: \(rel, role\) => invoke\('folders:mark', rel, role\)/);
  const cfg = require('../src/core/config');
  assert.deepEqual(cfg.DEFAULT_CONFIG.folders, { source: [], tests: [] });
  assert.equal(cfg.DEFAULT_CONFIG.foldersIndex, true);
  // the project file reaches the loaded config
  const root = tmp(); fr.save(root, { source: ['src'], tests: ['tests'] });
  assert.deepEqual(cfg.loadConfig(root, {}).folders, { source: ['src'], tests: ['tests'] });
  fs.rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------------------------------- file names from the marks
const layout = () => {
  const root = tmp();
  mk(root, 'edgy', 'edgy/sub', 'tests', 'node_modules/x', 'docs');
  for (const f of ['edgy/pipeline.py', 'edgy/agents.py', 'edgy/sub/util.py', 'edgy/data.json', 'tests/test_agents.py', 'node_modules/x/index.js', 'docs/pipeline.py', 'README.md']) fs.writeFileSync(path.join(root, f), '# x\n');
  return root;
};

test('describeFiles: the exact paths of the code in the marked folders, no dependency folders, no data files', () => {
  const root = layout();
  const text = fr.describeFiles(root, { source: ['edgy'], tests: ['tests'] });
  assert.match(text, /^Files in the marked folders \(use exactly these paths, relative to the project root\):/);
  assert.match(text, /Source code:\n- edgy\/agents\.py\n- edgy\/pipeline\.py\n- edgy\/sub\/util\.py\nTests:\n- tests\/test_agents\.py$/);
  assert.doesNotMatch(text, /data\.json|node_modules|docs\//);
  assert.equal(fr.describeFiles(root, { source: ['edgy'] }, { maxLines: 0 }), '', 'switched off');
  assert.equal(fr.describeFiles(root, {}), '');
  fs.rmSync(root, { recursive: true, force: true });
});

test('describeFiles: a big project is summarised per folder instead of listing every file', () => {
  const root = tmp(); mk(root, 'src/a', 'src/b', 'src/c');
  for (let i = 0; i < 30; i++) fs.writeFileSync(path.join(root, 'src', i < 20 ? 'a' : i < 28 ? 'b' : 'c', `m${i}.py`), '');
  const text = fr.describeFiles(root, { source: ['src'] }, { maxLines: 10 });
  assert.match(text, /Source code \(30 files; the folders with most of them first, use Glob for the names\):/);
  assert.match(text, /- src\/a\/ \(20 files\)/);
  assert.match(text, /- src\/c\/ \(2 files\)/);
  assert.ok(text.split('\n').length <= 8);
  assert.doesNotMatch(text, /m1\.py/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('describeAll: layout plus files; nothing when nothing is marked or the marked folders are gone', () => {
  const root = layout();
  const all = fr.describeAll(root, { source: ['edgy', 'gone'], tests: ['tests'] });
  assert.match(all, /^Project layout[\s\S]*- Source code: edgy\n- Tests: tests[\s\S]*\n\nFiles in the marked folders/);
  assert.equal(fr.describeAll(root, {}), '');
  assert.equal(fr.describeAll(root, { source: ['gone'] }), '');
  fs.rmSync(root, { recursive: true, force: true });
});

test('resolvePath (Read/Edit): a bare name or a name relative to a marked folder finds the one real file', () => {
  const root = layout();
  const marks = { source: ['edgy'], tests: ['tests'] };
  assert.deepEqual(fr.resolvePath(root, marks, 'pipeline.py', 'Read'), { path: 'edgy/pipeline.py', note: 'found in a marked folder' });
  assert.equal(fr.resolvePath(root, marks, 'sub/util.py', 'Edit').path, 'edgy/sub/util.py');
  assert.equal(fr.resolvePath(root, marks, 'util.py', 'Read').path, 'edgy/sub/util.py', 'found deeper down, it is the only one');
  assert.equal(fr.resolvePath(root, marks, 'test_agents.py', 'Read').path, 'tests/test_agents.py');
  assert.equal(fr.resolvePath(root, marks, 'edgy/pipeline.py', 'Read'), null, 'already right');
  assert.equal(fr.resolvePath(root, marks, 'README.md', 'Read'), null, 'exists as given');
  assert.equal(fr.resolvePath(root, marks, 'nothing.py', 'Read'), null, 'not found anywhere: the tool reports it');
  assert.equal(fr.resolvePath(root, marks, '/etc/passwd', 'Read'), null);
  assert.equal(fr.resolvePath(root, marks, '../x.py', 'Read'), null);
  assert.equal(fr.resolvePath(root, {}, 'pipeline.py', 'Read'), null, 'no marks: no guessing');
  assert.equal(fr.resolvePath(root, marks, 'pipeline.py', 'Bash'), null);
  fs.rmSync(root, { recursive: true, force: true });
});

test('resolvePath: ambiguous names are left alone (docs/pipeline.py is not in a marked folder, but a second copy would be)', () => {
  const root = layout();
  fs.writeFileSync(path.join(root, 'tests', 'pipeline.py'), '');
  assert.equal(fr.resolvePath(root, { source: ['edgy'], tests: ['tests'] }, 'pipeline.py', 'Read'), null, 'two candidates: no guess');
  fs.mkdirSync(path.join(root, 'edgy', 'sub2')); fs.writeFileSync(path.join(root, 'edgy', 'sub2', 'util.py'), '');
  assert.equal(fr.resolvePath(root, { source: ['edgy'] }, 'util.py', 'Read'), null);
  fs.rmSync(root, { recursive: true, force: true });
});

test('resolvePath (Write): a new test file without a folder goes to the one marked test folder; source files and explicit folders are not moved', () => {
  const root = layout();
  const marks = { source: ['edgy'], tests: ['tests'] };
  assert.deepEqual(fr.resolvePath(root, marks, 'test_pipeline.py', 'Write'), { path: 'tests/test_pipeline.py', note: 'a test file goes in the marked test folder' });
  assert.equal(fr.resolvePath(root, marks, 'PipelineTest.java', 'Write').path, 'tests/PipelineTest.java');
  assert.equal(fr.resolvePath(root, marks, 'pipeline.spec.ts', 'Write').path, 'tests/pipeline.spec.ts');
  assert.equal(fr.resolvePath(root, marks, 'pipeline.py', 'Write'), null, 'not a test name');
  assert.equal(fr.resolvePath(root, marks, 'tests/test_x.py', 'Write'), null, 'it named a folder itself');
  assert.equal(fr.resolvePath(root, marks, 'edgy/test_x.py', 'Write'), null, 'even a test in a source folder is the user\'s call');
  assert.equal(fr.resolvePath(root, { source: ['edgy'], tests: ['tests', 'spec'] }, 'test_x.py', 'Write').path, 'tests/test_x.py', 'a marked folder that does not exist does not count');
  fs.mkdirSync(path.join(root, 'spec'));
  assert.equal(fr.resolvePath(root, { source: ['edgy'], tests: ['tests', 'spec'] }, 'test_x.py', 'Write'), null, 'two test folders: no guess');
  assert.equal(fr.resolvePath(root, { source: ['edgy'] }, 'test_x.py', 'Write'), null, 'no test folder marked');
  assert.equal(fr.isTestName('test_a.py'), true); assert.equal(fr.isTestName('a_test.go'), true); assert.equal(fr.isTestName('contest.py'), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test('agentprep: the standing instructions list the files (and foldersFiles: 0 leaves them out)', async () => {
  const root = layout();
  const prep = (config) => agentprep.prepare({ name: 'c', command: 'claude' }, { root, hintDir: path.join(root, '.hints'), config });
  const on = fs.readFileSync((await prep({ folders: { source: ['edgy'], tests: ['tests'] } })).hintFile, 'utf8');
  assert.match(on, /- edgy\/pipeline\.py/);
  assert.match(on, /- tests\/test_agents\.py/);
  const off = fs.readFileSync((await prep({ folders: { source: ['edgy'], tests: ['tests'] }, foldersFiles: 0 })).hintFile, 'utf8');
  assert.doesNotMatch(off, /pipeline\.py/);
  assert.match(off, /- Source code: edgy/);
  fs.rmSync(root, { recursive: true, force: true });
});
