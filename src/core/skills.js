'use strict';
/**
 * Agent skills (the skills.sh ecosystem: a folder with a SKILL.md, shipped in git repositories) on two levels:
 *   IDE level      ~/<skillsDir>            (e.g. ~/.claude/skills)   available in every project
 *   project level  <project>/<skillsDir>    (e.g. .claude/skills)     committed with the project; wins over the IDE level
 * Installing = `git clone --depth 1` of the source into a temp folder, picking skill folders, previewing, then copying.
 * Nothing is executed. Every installed skill gets a `.bazinga-source.json` so it can be listed, updated and removed.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { git } = require('./git');

const PROVENANCE = '.bazinga-source.json';
const MAX_DEPTH = 3;
const MAX_FILES = 200;
const MAX_BYTES = 5 * 1024 * 1024;
const SKIP_DIRS = new Set(['.git', 'node_modules', '.github']);

const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 64);

/**
 * "owner/repo", "owner/repo/sub/path", "https://github.com/o/r", ".../tree/<branch>/<path>", "https://host/o/r.git".
 * Only https sources: nothing is fetched from a path or an ssh URL typed by accident.
 */
function parseSource(input) {
  const raw = String(input || '').trim().replace(/^npx\s+skills\s+add\s+/i, '').replace(/^skills\s+add\s+/i, '').trim();
  if (!raw) return { error: 'Enter a source like owner/repo or a https git URL.' };
  let m = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:\/(.+))?$/.exec(raw);
  if (m && !/^https?:/i.test(raw)) return { url: `https://github.com/${m[1]}/${m[2].replace(/\.git$/, '')}.git`, subpath: m[3] || '', label: `${m[1]}/${m[2]}` };
  let u;
  try { u = new URL(raw); } catch { return { error: 'Not a recognised source. Use owner/repo or a https URL.' }; }
  if (u.protocol !== 'https:') return { error: 'Only https sources are supported.' };
  const parts = u.pathname.split('/').filter(Boolean);
  if (parts.length < 2) return { error: 'The URL needs an owner and a repository.' };
  const repoName = parts[1].replace(/\.git$/, '');
  let subpath = '';
  let branch = '';
  if ((parts[2] === 'tree' || parts[2] === 'blob') && parts.length > 3) { branch = parts[3]; subpath = parts.slice(4).join('/'); }
  else if (parts.length > 2 && parts[2] !== 'tree') subpath = parts.slice(2).join('/');
  return { url: `https://${u.host}/${parts[0]}/${repoName}.git`, subpath, branch, label: `${u.host === 'github.com' ? '' : `${u.host}/`}${parts[0]}/${repoName}` };
}

/** Minimal frontmatter (name, description) without a YAML dependency issue for odd files. */
function parseSkillMd(text) {
  const out = { name: '', description: '' };
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(text || ''));
  if (!m) return out;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^(name|description):\s*(.*)$/.exec(line);
    if (kv) out[kv[1]] = kv[2].replace(/^["']|["']$/g, '').trim();
  }
  return out;
}

function walkFiles(dir, base = dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walkFiles(path.join(dir, e.name), base, acc); } else if (e.isFile()) acc.push(path.relative(base, path.join(dir, e.name)).split(path.sep).join('/'));
    if (acc.length > MAX_FILES) break;
  }
  return acc;
}

/** Skill folders inside a checkout: every folder (depth <= 3) containing a SKILL.md. */
function findSkills(checkout, subpath = '') {
  const start = path.resolve(checkout, subpath || '.');
  if (start !== path.resolve(checkout) && !start.startsWith(path.resolve(checkout) + path.sep)) return [];
  const found = [];
  const visit = (dir, depth) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    if (entries.some((e) => e.isFile() && e.name === 'SKILL.md')) {
      const meta = parseSkillMd(fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8'));
      const files = walkFiles(dir);
      const rel = path.relative(checkout, dir).split(path.sep).join('/');
      const name = slug(meta.name || path.basename(dir === path.resolve(checkout) ? path.basename(checkout) : dir));
      found.push({ name, description: meta.description, dir: rel, files, hasScripts: files.some((f) => !/\.(md|txt|json|ya?ml)$/i.test(f)), bytes: files.reduce((a, f) => { try { return a + fs.statSync(path.join(dir, f)).size; } catch { return a; } }, 0) });
      return; // a skill folder is a leaf
    }
    if (depth >= MAX_DEPTH) return;
    for (const e of entries) if (e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) visit(path.join(dir, e.name), depth + 1);
  };
  visit(start, 0);
  return found;
}

/** Shallow clone into a fresh temp folder. `allowLocal` is for tests. */
async function fetchSource(parsed, { allowLocal = false } = {}) {
  if (parsed.error) throw new Error(parsed.error);
  if (!allowLocal && !/^https:\/\//.test(parsed.url)) throw new Error('Only https sources are supported.');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bazinga-skills-'));
  const dest = path.join(tmp, 'repo');
  const args = ['clone', '--depth', '1', '--quiet', '--no-tags', ...(parsed.branch ? ['--branch', parsed.branch] : []), '--', parsed.url, dest];
  try { await git(tmp, args, { env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }); } catch (err) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw new Error(`Could not fetch ${parsed.label || parsed.url}: ${String(err.message || err).split('\n')[0]}`);
  }
  let commit = '';
  try { commit = (await git(dest, ['rev-parse', 'HEAD'])).trim(); } catch { /* ignore */ }
  return { tmp, checkout: dest, commit };
}

function dirSize(files, dir) { return files.reduce((a, f) => a + fs.statSync(path.join(dir, f)).size, 0); }

/** Copy one skill folder to `<targetRoot>/<name>`. Symlinks are skipped; refuses to replace unless `replace`. */
function installSkill(checkout, skill, targetRoot, { replace = false, source = {} } = {}) {
  const name = slug(skill.name);
  if (!name) throw new Error('The skill has no usable name.');
  const src = path.resolve(checkout, skill.dir);
  if (src !== path.resolve(checkout) && !src.startsWith(path.resolve(checkout) + path.sep)) throw new Error('Skill path escapes the repository.');
  const files = walkFiles(src);
  if (!files.includes('SKILL.md')) throw new Error(`${name}: SKILL.md missing.`);
  if (dirSize(files, src) > MAX_BYTES) throw new Error(`${name}: larger than ${MAX_BYTES / 1024 / 1024} MB.`);
  const dest = path.join(targetRoot, name);
  if (fs.existsSync(dest)) {
    if (!replace) throw new Error(`${name} is already installed here.`);
    fs.rmSync(dest, { recursive: true, force: true });
  }
  for (const f of files) {
    const to = path.join(dest, f);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(src, f), to);
  }
  fs.writeFileSync(path.join(dest, PROVENANCE), JSON.stringify({ ...source, skillDir: skill.dir, installed: new Date().toISOString() }, null, 2));
  return { name, dest };
}

function listInstalled(targetRoot) {
  let entries = [];
  try { entries = fs.readdirSync(targetRoot, { withFileTypes: true }); } catch { return []; }
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const md = path.join(targetRoot, e.name, 'SKILL.md');
    if (!fs.existsSync(md)) continue;
    const meta = parseSkillMd(fs.readFileSync(md, 'utf8'));
    let prov = null;
    try { prov = JSON.parse(fs.readFileSync(path.join(targetRoot, e.name, PROVENANCE), 'utf8')); } catch { /* hand-made skill */ }
    out.push({ name: e.name, description: meta.description, source: prov ? prov.label || prov.url : null, provenance: prov });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function removeSkill(targetRoot, name) {
  const n = slug(name);
  if (!n || n !== name) throw new Error('Invalid skill name.');
  const dest = path.join(targetRoot, n);
  if (!fs.existsSync(path.join(dest, 'SKILL.md'))) throw new Error(`${n} is not installed here.`);
  fs.rmSync(dest, { recursive: true, force: true });
  return true;
}

/** Where a level's skills live. Project paths must stay inside the project. */
function levelDir(level, { root, home, skillsDir = '.claude/skills' }) {
  const rel = String(skillsDir || '.claude/skills').replace(/\\/g, '/');
  if (path.isAbsolute(rel) || rel.split('/').includes('..')) throw new Error('skillsDir must be a relative path inside the project.');
  if (level === 'ide') return path.join(home, rel);
  if (level === 'project') { if (!root) throw new Error('Open a project first.'); return path.join(root, rel); }
  throw new Error(`Unknown level: ${level}`);
}

/**
 * Every folder a level's skills are written to: the primary `skillsDir` first (the one that is listed), then the mirrors.
 * Claude Code reads .claude/skills, Copilot reads .agents/skills (project and personal level) and .github/skills, so a skill
 * installed once must land in each of them or only one of the tools knows about it.
 */
function levelDirs(level, { root, home, skillsDir = '.claude/skills', mirrors = [] }) {
  const rels = [skillsDir, ...(Array.isArray(mirrors) ? mirrors : [])].map((r) => String(r || '').trim().replace(/\\/g, '/').replace(/\/+$/, '')).filter(Boolean);
  const seen = new Set();
  const out = [];
  for (const rel of rels) {
    if (seen.has(rel.toLowerCase())) continue;
    seen.add(rel.toLowerCase());
    out.push(levelDir(level, { root, home, skillsDir: rel }));
  }
  return out;
}

/** Install into every target. The first target decides whether an existing skill may be replaced; mirrors follow it. */
function installEverywhere(checkout, skill, targets, opts = {}) {
  let first = null;
  targets.forEach((t, i) => {
    const res = installSkill(checkout, skill, t, i === 0 ? opts : { ...opts, replace: true });
    if (i === 0) first = res;
  });
  return first;
}

function removeEverywhere(targets, name) {
  let removed = 0;
  for (const t of targets) { try { removeSkill(t, name); removed++; } catch { /* not in this folder */ } }
  if (!removed) throw new Error(`${name} is not installed here.`);
  return true;
}

/** Copy skills that exist in the first folder to the mirrors that lack them (older installs were primary-only). */
function syncMirrors(targets) {
  const [primary, ...mirrors] = targets;
  const copied = [];
  if (!primary) return copied;
  for (const s of listInstalled(primary)) {
    for (const m of mirrors) {
      if (fs.existsSync(path.join(m, s.name, 'SKILL.md'))) continue;
      fs.cpSync(path.join(primary, s.name), path.join(m, s.name), { recursive: true, filter: (src) => !fs.lstatSync(src).isSymbolicLink() });
      copied.push(`${s.name} → ${m}`);
    }
  }
  return copied;
}

/** Both levels, project winning on equal names. */
function effectiveSkills({ project = [], ide = [] }) {
  const byName = new Map();
  for (const s of ide) byName.set(s.name, { ...s, level: 'ide' });
  for (const s of project) byName.set(s.name, { ...s, level: 'project', overrides: byName.has(s.name) });
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = { PROVENANCE, parseSource, parseSkillMd, findSkills, fetchSource, installSkill, listInstalled, removeSkill, levelDir, levelDirs, installEverywhere, removeEverywhere, syncMirrors, effectiveSkills, slug };
