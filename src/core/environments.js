'use strict';
const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');

const ideDir = (root) => path.join(root, '.ide');
const envFile = (root) => path.join(ideDir(root), 'environments.yaml');

function normalize(doc) {
  const list = (Array.isArray(doc && doc.environments) ? doc.environments : [])
    .filter((e) => e && e.name)
    .map((e) => ({ name: String(e.name), vars: e.vars && typeof e.vars === 'object' ? e.vars : {} }));
  const active = typeof (doc && doc.active) === 'string' && list.some((e) => e.name === doc.active) ? doc.active : null;
  return { environments: list, active };
}

/**
 * Named sets of {{var}} values a REST client request can substitute into its URL, headers, body and auth
 * fields - hand-edited like .ide/scripts.yaml/.ide/checks.yaml, no in-app editor. One is "active" project-wide
 * (persisted here, not per-request) and picked from a dropdown in the REST client tab.
 */
function load(root) {
  let text;
  try { text = fs.readFileSync(envFile(root), 'utf8'); } catch (e) { if (e.code === 'ENOENT') return { environments: [], active: null }; throw e; }
  let doc;
  try { doc = YAML.parse(text); } catch (e) { throw new Error(`Invalid YAML in .ide/environments.yaml: ${e.message}`); }
  return normalize(doc);
}

function save(root, state) {
  const norm = normalize(state);
  fs.mkdirSync(ideDir(root), { recursive: true });
  fs.writeFileSync(envFile(root), YAML.stringify(norm), 'utf8');
  return { saved: norm.environments.length };
}

/** The active environment's vars, or {} when none is set - what a REST request substitutes {{name}} tokens against. */
function activeVars(root) {
  const { environments, active } = load(root);
  const env = environments.find((e) => e.name === active);
  return env ? env.vars : {};
}

module.exports = { load, save, activeVars };
