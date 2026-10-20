'use strict';
// Folders the user marks as "source" or "tests". The marks live in the project's .ide/config.json (committed, so the whole
// team and every agent share them) and become metadata for the model: a few lines in the standing instructions
// (--append-system-prompt-file) and a managed block in AGENTS.md for agents that read that file instead.
const fs = require('node:fs');
const path = require('node:path');

const ROLES = ['source', 'tests'];
const LABELS = { source: 'Source code', tests: 'Tests' };
const START = '<!-- bazinga:folders:start (generated, do not edit between the markers) -->';
const END = '<!-- bazinga:folders:end -->';

const toPosix = (p) => String(p || '').replace(/\\/g, '/');

/** One folder name as stored: relative to the project, forward slashes, no ./ or trailing /. Returns '' when it is not usable. */
function cleanRel(p) {
  let s = toPosix(p).trim().replace(/^\.\//, '').replace(/\/+/g, '/').replace(/\/$/, '');
  if (!s || s === '.' || s.startsWith('/') || /^[A-Za-z]:/.test(s) || s.split('/').some((x) => x === '..' || x === '')) return '';
  return s;
}

/** Anything -> { source: [...], tests: [...] } with clean, unique, sorted folders; a folder has one role only (the first role listed wins). */
function normalize(folders) {
  const out = { source: [], tests: [] };
  const seen = new Set();
  for (const role of ROLES) {
    const list = folders && Array.isArray(folders[role]) ? folders[role] : [];
    for (const f of list) {
      const rel = cleanRel(f);
      if (!rel || seen.has(rel)) continue;
      seen.add(rel); out[role].push(rel);
    }
    out[role].sort((a, b) => a.localeCompare(b));
  }
  return out;
}

const isEmpty = (folders) => !ROLES.some((r) => (folders && folders[r] || []).length);

/** Marks one folder with a role (or clears it with role = null). Returns the new folders; the input is not changed. */
function mark(folders, rel, role) {
  const r = cleanRel(rel);
  if (!r) throw new Error('This folder cannot be marked (the project root itself, or a path outside the project).');
  if (role !== null && role !== undefined && !ROLES.includes(role)) throw new Error(`Unknown role “${role}”.`);
  const base = normalize(folders);
  const next = { source: base.source.filter((x) => x !== r), tests: base.tests.filter((x) => x !== r) };
  if (role) next[role].push(r);
  return normalize(next);
}

/** The role of one folder as marked itself: 'source' | 'tests' | null. */
function roleOf(folders, rel) {
  const r = cleanRel(rel);
  const f = normalize(folders);
  return ROLES.find((role) => f[role].includes(r)) || null;
}

/** The role of any path: the most specific marked folder above it wins (src/test/java inside src is tests). { role, folder } or null. */
function classify(folders, rel) {
  const p = toPosix(rel).replace(/^\.\//, '');
  const f = normalize(folders);
  let best = null;
  for (const role of ROLES) for (const dir of f[role]) {
    if ((p === dir || p.startsWith(`${dir}/`)) && (!best || dir.length > best.folder.length)) best = { role, folder: dir };
  }
  return best;
}

/** Only the marked folders that exist (a renamed or deleted folder must not mislead the model). */
function existing(root, folders) {
  const f = normalize(folders);
  const ok = (rel) => { try { return fs.statSync(path.join(root, rel)).isDirectory(); } catch { return false; } };
  return { source: f.source.filter(ok), tests: f.tests.filter(ok) };
}

/** The text for the model. '' when nothing is marked. */
function describe(folders) {
  const f = normalize(folders);
  if (isEmpty(f)) return '';
  const lines = ['Project layout (folders the user marked in Bazinga, relative to the project root):'];
  for (const role of ROLES) if (f[role].length) lines.push(`- ${LABELS[role]}: ${f[role].join(', ')}`);
  const how = [];
  if (f.source.length) how.push('Production code belongs in the source folders');
  if (f.tests.length) how.push(f.source.length ? 'and tests belong in the test folders' : 'Tests belong in the test folders');
  lines.push(`${how.join(' ')}.${f.source.length && f.tests.length ? ' Mirror the path of the code under test (same package or folder structure), and never put a test in a source folder or production code in a test folder.' : ''}`);
  return lines.join('\n');
}

/** Conventional folders that exist in the project (Maven/Gradle layouts, src/, test(s)/…), as a suggestion. */
function detect(root) {
  const isDir = (rel) => { try { return fs.statSync(path.join(root, rel)).isDirectory(); } catch { return false; } };
  const source = []; const tests = [];
  for (const lang of ['java', 'kotlin', 'scala']) {
    if (isDir(`src/main/${lang}`)) source.push(`src/main/${lang}`);
    if (isDir(`src/test/${lang}`)) tests.push(`src/test/${lang}`);
  }
  if (!source.length && isDir('src') && !isDir('src/main')) source.push('src');
  for (const t of ['test', 'tests', '__tests__', 'spec']) if (isDir(t)) tests.push(t);
  return normalize({ source, tests });
}

/** Adds detected folders to the marked ones without changing any folder that is already marked. */
function mergeDetected(folders, detected) {
  const base = normalize(folders);
  const taken = new Set([...base.source, ...base.tests]);
  const add = normalize(detected);
  return normalize({ source: [...base.source, ...add.source.filter((x) => !taken.has(x))], tests: [...base.tests, ...add.tests.filter((x) => !taken.has(x))] });
}

// ---------------------------------------------------------------------------------------------------- the files inside
const SKIP_DIRS = new Set(['node_modules', '.git', '__pycache__', 'target', 'build', 'dist', 'out', '.venv', 'venv', '.gradle', '.idea', '.mypy_cache', '.pytest_cache', 'coverage', '.next', '.tox']);
const CODE_EXT = /\.(java|kt|kts|scala|groovy|py|js|jsx|mjs|cjs|ts|tsx|go|rs|cs|rb|php|c|cc|cpp|h|hpp|swift|sql|vue|svelte)$/i;
const TEST_NAME = /^(test_.*\.py|.*_test\.(py|go)|.*Tests?\.(java|kt|scala|groovy|cs)|.*\.(test|spec)\.(js|jsx|ts|tsx|mjs|cjs))$/;
const MAX_WALK = 20000;

/** Code files under one folder (project-relative, forward slashes), skipping dependency and build folders. Stops after MAX_WALK entries. */
function walkFiles(root, rel, accept = (name) => CODE_EXT.test(name), budget = { left: MAX_WALK }) {
  const out = [];
  let entries;
  try { entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { return out; }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const e of entries) {
    if (budget.left-- <= 0) break;
    const r = `${rel}/${e.name}`;
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) out.push(...walkFiles(root, r, accept, budget)); }
    else if (e.isFile() && accept(e.name)) out.push(r);
  }
  return out;
}

/** { source: [files], tests: [files] } inside the marked folders that exist. */
function listFiles(root, folders) {
  const f = existing(root, folders);
  const out = { source: [], tests: [] };
  for (const role of ROLES) {
    const seen = new Set();
    for (const dir of f[role]) for (const file of walkFiles(root, dir)) if (!seen.has(file)) { seen.add(file); out[role].push(file); }
    out[role].sort((a, b) => a.localeCompare(b));
  }
  return out;
}

/**
 * The exact paths of the code in the marked folders, so the model does not have to guess or search (small models are bad at both).
 * Up to maxLines lines; when there are more files than that, one line per folder with its number of files instead.
 */
function describeFiles(root, folders, { maxLines = 60 } = {}) {
  if (!(maxLines > 0)) return '';
  const lists = listFiles(root, folders);
  const total = lists.source.length + lists.tests.length;
  if (!total) return '';
  const lines = ['Files in the marked folders (use exactly these paths, relative to the project root):'];
  if (total <= maxLines) {
    for (const role of ROLES) if (lists[role].length) { lines.push(`${LABELS[role]}:`); for (const f of lists[role]) lines.push(`- ${f}`); }
  } else {
    const perRole = Math.max(5, Math.floor(maxLines / ROLES.filter((r) => lists[r].length).length));
    for (const role of ROLES) {
      if (!lists[role].length) continue;
      const byDir = new Map();
      for (const f of lists[role]) { const d = f.slice(0, f.lastIndexOf('/')); byDir.set(d, (byDir.get(d) || 0) + 1); }
      lines.push(`${LABELS[role]} (${lists[role].length} files; the folders with most of them first, use Glob for the names):`);
      const dirs = [...byDir.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, perRole).sort((a, b) => a[0].localeCompare(b[0]));
      for (const [d, n] of dirs) lines.push(`- ${d}/ (${n} file${n === 1 ? '' : 's'})`);
      if (byDir.size > dirs.length) lines.push(`- … and ${byDir.size - dirs.length} more folders`);
    }
  }
  return lines.join('\n');
}

/** The layout text plus the files, for the standing instructions. '' when nothing is marked. */
function describeAll(root, folders, opts) {
  const ex = existing(root, folders);
  const head = describe(ex);
  if (!head) return '';
  return [head, describeFiles(root, ex, opts)].filter(Boolean).join('\n\n');
}

const isTestName = (name) => TEST_NAME.test(String(name || ''));

/**
 * A path the model gave, made to point at the file the user means, using the marked folders. Returns { path, note } or null (leave it alone).
 *  - Read / Edit: a name that does not exist as given is looked up inside the marked folders (relative to a marked folder, or a bare file name that occurs exactly once).
 *  - Write: a new file named like a test (test_x.py, XTest.java, x.spec.ts) without a folder goes into the marked test folder, when there is exactly one.
 * Anything ambiguous is left alone: a wrong guess is worse than an error the model can read.
 */
function resolvePath(cwd, folders, p, toolName) {
  if (!cwd || typeof p !== 'string' || !p.trim() || path.isAbsolute(p) || p.startsWith('~') || /^[A-Za-z]:/.test(p)) return null;
  const f = existing(cwd, folders);
  const all = [...f.source, ...f.tests];
  if (!all.length) return null;
  const rel = toPosix(p).trim().replace(/^\.\//, '');
  if (!cleanRel(rel)) return null;
  const isFile = (r) => { try { return fs.statSync(path.join(cwd, r)).isFile(); } catch { return false; } };
  if (/^(Read|Edit|MultiEdit|NotebookEdit)$/.test(toolName)) {
    if (isFile(rel)) return null;
    const hits = all.map((d) => `${d}/${rel}`).filter(isFile);
    if (hits.length === 1) return { path: hits[0], note: 'found in a marked folder' };
    if (hits.length > 1) return null;
    if (!rel.includes('/')) {
      const found = [...new Set(all.flatMap((d) => walkFiles(cwd, d, (n) => n === rel)))];
      if (found.length === 1) return { path: found[0], note: 'the only file with that name in the marked folders' };
    }
    return null;
  }
  if (toolName === 'Write' && !rel.includes('/') && isTestName(rel) && f.tests.length === 1) return { path: `${f.tests[0]}/${rel}`, note: 'a test file goes in the marked test folder' };
  return null;
}

/** Reads the marks from a loaded config (settings < project). */
const fromConfig = (cfg) => normalize(cfg && cfg.folders);

/** Writes the marks into <root>/.ide/config.json, leaving every other key as it was. Throws when that file is not valid JSON. */
function save(root, folders) {
  const file = path.join(root, '.ide', 'config.json');
  let cfg = {};
  let text = null;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (text !== null && text.trim()) {
    try { cfg = JSON.parse(text); } catch (e) { throw new Error(`.ide/config.json is not valid JSON (${e.message}); fix it first, nothing was changed.`); }
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) throw new Error('.ide/config.json must contain a JSON object; nothing was changed.');
  }
  const f = normalize(folders);
  if (isEmpty(f)) delete cfg.folders;
  else cfg.folders = Object.fromEntries(ROLES.filter((r) => f[r].length).map((r) => [r, f[r]]));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(cfg, null, 2)}\n`);
  return f;
}

/** AGENTS.md: the managed block with the layout. Returns the new text, or null when nothing needs to be written. Only the text between the markers is touched. */
function applyBlock(text, folders) {
  const current = String(text || '');
  const has = current.includes(START) && current.includes(END) && current.indexOf(START) < current.indexOf(END);
  const body = describe(folders);
  if (!body) {
    if (!has) return null;
    const out = (current.slice(0, current.indexOf(START)).replace(/\s+$/, '') + current.slice(current.indexOf(END) + END.length)).replace(/^\s+$/, '');
    return out ? `${out.replace(/\s+$/, '')}\n` : '';
  }
  const block = [START, '## Project layout', '', body, END].join('\n');
  if (has) {
    const next = current.slice(0, current.indexOf(START)) + block + current.slice(current.indexOf(END) + END.length);
    return next === current ? null : next;
  }
  const base = current.replace(/\s+$/, '');
  return `${base ? `${base}\n\n` : ''}${block}\n`;
}

module.exports = { ROLES, LABELS, START, END, cleanRel, normalize, isEmpty, mark, roleOf, classify, existing, describe, describeFiles, describeAll, listFiles, resolvePath, isTestName, detect, mergeDetected, fromConfig, save, applyBlock };
