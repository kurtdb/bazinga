'use strict';
const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');

const ideDir = (root) => path.join(root, '.ide');
const snippetsFile = (root) => path.join(ideDir(root), 'snippets.yaml');

function normalize(list) {
  return (Array.isArray(list) ? list : []).filter((s) => s && s.prefix && s.body).map((s) => ({
    prefix: String(s.prefix),
    body: Array.isArray(s.body) ? s.body.join('\n') : String(s.body),
    language: s.language ? String(s.language).toLowerCase() : '',
    description: s.description ? String(s.description) : '',
  }));
}

/**
 * User-defined code snippets, offered as Monaco completion items (triggered by typing the prefix, same
 * ${1:placeholder} tab-stop syntax VS Code snippets use - Monaco's own snippet controller handles that, no
 * extra parsing here). Hand-edited like .ide/scripts.yaml, but also writable from the editor's "Save
 * selection as snippet" action - a project-level, git-shareable collection file like requests.yaml/environments.yaml.
 * `body` can be a single (possibly multi-line) string or an array of lines, the same two shapes VS Code's own
 * snippet JSON format allows (lines, since JSON has no multi-line string); YAML's block-scalar `|` covers the
 * single-string case naturally. `language` is a Monaco language id ("javascript", "python", ...); left blank,
 * the snippet is offered in every language.
 */
function loadSnippets(root) {
  let text;
  try { text = fs.readFileSync(snippetsFile(root), 'utf8'); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  let doc;
  try { doc = YAML.parse(text); } catch (e) { throw new Error(`Invalid YAML in .ide/snippets.yaml: ${e.message}`); }
  return normalize(Array.isArray(doc) ? doc : doc && doc.snippets);
}

function saveSnippets(root, list) {
  const norm = normalize(list);
  fs.mkdirSync(ideDir(root), { recursive: true });
  fs.writeFileSync(snippetsFile(root), YAML.stringify({ snippets: norm }), 'utf8');
  return { saved: norm.length };
}

module.exports = { loadSnippets, saveSnippets };
