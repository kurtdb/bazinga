'use strict';
/**
 * Task templates for "New agent run": reusable task texts.
 * Layers, later wins by name:  built-in < IDE settings (`taskTemplates`) < project .ide/config.json (`taskTemplates`).
 */
const BUILTIN = [
  { name: 'Fix a bug (test first)', text: 'Fix this bug: <describe it>\n\nFirst write a failing test that reproduces it, then fix it, then make sure the test passes. Do not change existing tests.' },
  { name: 'Add a feature', text: 'Add this feature: <describe it>\n\nFollow the existing code style and add tests for the new behaviour. Keep the change small and focused.' },
  { name: 'Refactor without behaviour change', text: 'Refactor: <what and why>\n\nDo not change behaviour. Existing tests must keep passing unchanged. Do not touch files unrelated to this refactor.' },
  { name: 'Write missing tests', allow: '@new-tests', text: 'Write tests for: <class or area>\n\nCover the main paths and the edge cases. Add new test files only: never overwrite or shorten an existing test file. Do not change production code; if you find a bug, report it instead of fixing it.' },
];

const clip = (v, n) => String(v == null ? '' : v).slice(0, n);

function sanitize(list, source) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const t of list) {
    if (!t || typeof t !== 'object') continue;
    const name = clip(t.name, 80).trim();
    const text = clip(t.text, 8000);
    if (!name || !text.trim()) continue;
    out.push({ name, text, allow: t.allow ? clip(t.allow, 300) : '', source });
  }
  return out;
}

/** @returns {Array<{name,text,allow,source:'built-in'|'ide'|'project'}>} in display order; a later layer replaces a template of the same name. */
function mergeTemplates({ ide, project, builtin = true } = {}) {
  const byName = new Map();
  const layers = [...(builtin ? [sanitize(BUILTIN, 'built-in')] : []), sanitize(ide, 'ide'), sanitize(project, 'project')];
  for (const layer of layers) for (const t of layer) byName.set(t.name.toLowerCase(), t);
  return [...byName.values()];
}

/** Markdown form: each "## Name" starts a template; an optional first line "allow: src/**" sets its scope. */
function parseMarkdown(md) {
  const out = [];
  let cur = null;
  for (const line of String(md || '').split(/\r?\n/)) {
    const h = /^##\s+(.+?)\s*$/.exec(line);
    if (h) { cur = { name: h[1], lines: [] }; out.push(cur); continue; }
    if (cur) cur.lines.push(line);
  }
  return out.map((c) => {
    let lines = c.lines;
    let allow = '';
    const first = lines.findIndex((l) => l.trim());
    const m = first >= 0 && /^allow:\s*(.+)$/i.exec(lines[first].trim());
    if (m) { allow = m[1]; lines = lines.slice(first + 1); }
    return { name: c.name, text: lines.join('\n').trim(), allow };
  });
}
const toMarkdown = (list) => (list || []).map((t) => `## ${t.name}\n${t.allow ? `allow: ${t.allow}\n` : ''}${t.text}\n`).join('\n');

module.exports = { parseMarkdown, toMarkdown, BUILTIN, mergeTemplates, sanitize };
