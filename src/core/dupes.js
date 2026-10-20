'use strict';
/**
 * Native duplicate-UI-component detection (no external tool).
 * Catches what token-based clone detectors miss: an agent adding a *new* SubmitButton / PrimaryButton / ModalBox
 * with its own markup when a shared Button / Modal already exists, or defining the same component name twice.
 *
 *  duplicate-name      the same component name is defined in more than one file
 *  reimplements        a variant (SubmitButton) does not render the shared base (Button) that exists in the project
 *  many-variants       several variants and no shared base at all: create one
 *  raw-element         a raw <button>/<input>... is used although a shared component for it exists
 */
const fs = require('node:fs');
const path = require('node:path');

const SOURCE = /\.(jsx|tsx|js|ts|vue|svelte)$/i;
const SKIP = /(\.(test|spec|stories|story)\.[a-z]+$|(^|\/)(__tests__|__mocks__|node_modules|dist|build|coverage)\/)/i;
const GENERIC = new Set(['App', 'Page', 'Layout', 'Loading', 'Error', 'NotFound', 'Root', 'Template', 'Default', 'Index', 'Home', 'Main', 'Component', 'Provider', 'Head', 'Document', 'Story']);
const PRIMITIVES = ['Button', 'Input', 'TextField', 'Textarea', 'Select', 'Checkbox', 'Radio', 'Switch', 'Modal', 'Dialog', 'Card', 'Badge', 'Tag', 'Chip', 'Tooltip', 'Spinner', 'Loader', 'Avatar', 'Alert', 'Toast', 'Dropdown', 'Tabs', 'Table', 'Pagination'];
const RAW = { button: ['Button'], input: ['Input', 'TextField'], select: ['Select'], textarea: ['Textarea', 'TextArea'] };

const DEFS = [
  /(?:^|\n)\s*(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s+([A-Z][A-Za-z0-9_]*)\s*[<(]/g,
  /(?:^|\n)\s*(?:export\s+)?(?:const|let|var)\s+([A-Z][A-Za-z0-9_]*)\s*(?::[^=\n]+)?=\s*(?:React\.)?(?:memo\(|forwardRef\b|styled[.(]|\(|async\s*\(|[A-Za-z_]\w*\s*=>)/g,
  /(?:^|\n)\s*(?:export\s+(?:default\s+)?)?class\s+([A-Z][A-Za-z0-9_]*)\s+extends\s+(?:React\.)?(?:Pure)?Component\b/g,
];
const JSX = /<[A-Za-z][\w.]*[\s>/]/;

const lineOf = (text, index) => text.slice(0, index).split('\n').length;
const words = (name) => name.match(/[A-Z][a-z0-9]*|[a-z0-9]+/g) || [name];

function parseComponents(rel, text) {
  const isVue = /\.(vue|svelte)$/i.test(rel);
  if (!isVue && !JSX.test(text)) return [];
  if (isVue) {
    const base = path.posix.basename(rel).replace(/\.[^.]+$/, '');
    return /^[A-Z]/.test(base) ? [{ name: base, line: 1 }] : [];
  }
  const found = new Map();
  for (const re of DEFS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      const name = m[1];
      if (GENERIC.has(name) || name.length < 3 || name === name.toUpperCase()) continue; // CONSTANTS are not components
      if (!found.has(name)) found.set(name, { name, line: lineOf(text, m.index + m[0].indexOf(name)) });
    }
  }
  return [...found.values()];
}

function primitiveOf(name) {
  const w = words(name);
  for (const p of PRIMITIVES) if (w.includes(p)) return p;
  return null;
}

/**
 * @param {object} p
 * @param {string} p.root
 * @param {string[]} p.allFiles  project files (posix, relative)
 * @param {string[]} p.changed   files changed by the agent
 * @param {number} [p.maxFiles]
 * @returns {Array<{file,line,severity,message,rule}>} findings, only for changed files
 */
function findDuplicateComponents({ root, allFiles, changed, maxFiles = 4000 }) {
  const changedSet = new Set(changed);
  const sources = allFiles.filter((f) => SOURCE.test(f) && !SKIP.test(f)).slice(0, maxFiles);
  const info = new Map(); // rel -> { text, comps }
  const byName = new Map();  // name -> [{ rel, line }]
  for (const rel of sources) {
    let text;
    try {
      const abs = path.join(root, rel);
      if (fs.statSync(abs).size > 300 * 1024) continue;
      text = fs.readFileSync(abs, 'utf8');
    } catch { continue; }
    const comps = parseComponents(rel, text);
    info.set(rel, { text, comps });
    for (const c of comps) { if (!byName.has(c.name)) byName.set(c.name, []); byName.get(c.name).push({ rel, line: c.line }); }
  }

  const out = [];
  const add = (file, line, severity, rule, message) => out.push({ file, line, severity, rule, message });
  const where = (list) => list.map((d) => `${d.rel}:${d.line}`).join(', ');

  // 1. same name in several files
  for (const [name, defs] of byName) {
    if (defs.length < 2) continue;
    const dirs = new Set(defs.map((d) => path.posix.dirname(d.rel)));
    if (dirs.size < 2 && defs.every((d) => /index\.[a-z]+$/i.test(d.rel))) continue;
    for (const d of defs) {
      if (!changedSet.has(d.rel)) continue;
      const others = defs.filter((x) => x !== d);
      add(d.rel, d.line, 'error', 'duplicate-name', `Component ${name} is defined more than once (also ${where(others)}). Keep one shared component and import it instead of copying it.`);
    }
  }

  // 2. variants of a UI primitive that do not reuse the shared one
  const groups = new Map(); // primitive -> { base: [defs], variants: [defs+name] }
  for (const [name, defs] of byName) {
    const p = primitiveOf(name);
    if (!p) continue;
    const g = groups.get(p) || { base: [], variants: [] };
    if (name === p) g.base.push(...defs); else for (const d of defs) g.variants.push({ ...d, name });
    groups.set(p, g);
  }
  for (const [p, g] of groups) {
    const reusing = (d) => new RegExp(`<${p}\\b|\\b${p}\\s*\\(|extends\\s+${p}\\b|styled\\(\\s*${p}\\b`).test(info.get(d.rel).text);
    const bad = g.variants.filter((v) => !reusing(v));
    if (g.base.length) {
      for (const v of bad) {
        if (!changedSet.has(v.rel) || g.base.some((b) => b.rel === v.rel)) continue;
        add(v.rel, v.line, 'error', 'reimplements', `${v.name} looks like another ${p}, but it does not use the shared ${p} (${where(g.base)}). Reuse ${p} (add a prop or a thin wrapper around it) instead of building a new one.`);
      }
    } else if (bad.length >= 2) {
      const files = new Set(bad.map((b) => b.rel));
      if (files.size < 2) continue;
      for (const v of bad) {
        if (!changedSet.has(v.rel)) continue;
        add(v.rel, v.line, 'warning', 'many-variants', `${bad.length} separate ${p} implementations exist (${where(bad.filter((b) => b !== v))}) and there is no shared ${p}. Create one shared ${p} component and use it everywhere.`);
      }
    }
  }

  // 3. raw elements while a shared component exists
  for (const rel of changedSet) {
    const entry = info.get(rel);
    if (!entry) continue;
    for (const [tag, names] of Object.entries(RAW)) {
      const shared = names.flatMap((n) => byName.get(n) || []).filter((d) => d.rel !== rel);
      if (!shared.length) continue;
      if (entry.comps.some((c) => names.includes(c.name))) continue; // this file is the shared component
      const re = new RegExp(`<${tag}[\\s>/]`, 'g');
      let m; let count = 0; let first = 0;
      while ((m = re.exec(entry.text))) { count++; if (!first) first = lineOf(entry.text, m.index); }
      if (count) add(rel, first, 'error', 'raw-element', `Raw <${tag}> used ${count}x although a shared ${shared[0].rel.split('/').pop().replace(/\.[^.]+$/, '')} component exists (${shared[0].rel}). Use the shared component so styling and behaviour stay in one place.`);
    }
  }
  return out;
}

module.exports = { findDuplicateComponents, parseComponents };
