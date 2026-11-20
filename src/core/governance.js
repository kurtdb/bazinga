'use strict';
/**
 * "Set up project governance" (Settings -> Skills): reuses the real, MIT-licensed per-tech-stack CLAUDE.md +
 * .claude/rules templates from https://github.com/datallmhub/claude-governance instead of asking an agent to
 * invent similar rules from scratch. Downloading the chosen stack's files is deterministic (no LLM involved) -
 * see core/governancedraft.js for the one-shot agent run that adapts/merges them into the project afterwards.
 */
const fs = require('node:fs');
const path = require('node:path');
const { safeFetch } = require('./safeFetch');

const REPO = 'datallmhub/claude-governance';
const STAGING_DIR = '.bazinga-governance-draft';

// Mirrors the "✅ Ready" rows of the upstream README's "Available stacks" table.
const STACKS = [
  { id: 'react-only', label: 'React / TypeScript only', folder: 'react-only' },
  { id: 'angular-only', label: 'Angular only', folder: 'angular-only' },
  { id: 'vue-only', label: 'Vue.js only', folder: 'vue-only' },
  { id: 'nextjs', label: 'Next.js (full-stack)', folder: 'nextjs' },
  { id: 'nestjs-react', label: 'Node.js (NestJS) + React', folder: 'nestjs-react' },
  { id: 'java-react', label: 'Java (Spring Boot) + React (TypeScript)', folder: 'java-react' },
  { id: 'python-fastapi-react', label: 'Python (FastAPI) + React', folder: 'python-fastapi-react' },
];

function listStacks() { return STACKS.slice(); }
function findStack(id) { return STACKS.find((s) => s.id === id) || null; }

/** Repo-relative paths worth copying: the template itself, not its own build tooling or worked examples. */
function wanted(relPath) { return relPath !== 'govbuild.json' && !relPath.startsWith('samples/'); }

/** Every file under a stack's folder, relative to that folder (e.g. "CLAUDE.md", ".claude/rules/security.md"). */
async function listStackFiles(folder, { fetchImpl = fetch } = {}) {
  const { res, body } = await safeFetch(`https://api.github.com/repos/${REPO}/git/trees/main?recursive=1`, {}, 'json', fetchImpl);
  if (!res.ok) throw new Error(`Could not read ${REPO} (HTTP ${res.status}).`);
  const prefix = `${folder}/`;
  const files = (body.tree || [])
    .filter((e) => e.type === 'blob' && e.path.startsWith(prefix))
    .map((e) => e.path.slice(prefix.length))
    .filter(wanted);
  if (!files.length) throw new Error(`No template files found for "${folder}" - the upstream repository layout may have changed.`);
  return files;
}

/** Downloads a stack's files into `<destDir>/<relPath>`, preserving structure. Returns the relative paths written. */
async function downloadStack(folder, destDir, { fetchImpl = fetch } = {}) {
  const files = await listStackFiles(folder, { fetchImpl });
  const destRoot = path.resolve(destDir);
  for (const rel of files) {
    const dest = path.resolve(destRoot, rel);
    if (dest !== destRoot && !dest.startsWith(destRoot + path.sep)) throw new Error(`Refusing a path that escapes the staging folder: ${rel}`);
    const { res, body } = await safeFetch(`https://raw.githubusercontent.com/${REPO}/main/${folder}/${rel}`, {}, 'text', fetchImpl);
    if (!res.ok) throw new Error(`Could not download ${rel} (HTTP ${res.status}).`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, body);
  }
  return files;
}

module.exports = { REPO, STAGING_DIR, listStacks, findStack, listStackFiles, downloadStack };
