'use strict';
/**
 * Adaptive guard rules: if you keep ticking "merge anyway" past the same blocker, Bazinga notices and offers to
 * relax that rule instead of making you override it forever. Stored per user, across projects (like the scorecard) -
 * counts are the AI's track record with blockers, not something that should reset when a branch is deleted.
 */
const fs = require('node:fs');
const path = require('node:path');

const THRESHOLD = 3; // overridden this many times before it is worth asking about
const CONFIG_REL = path.join('.ide', 'config.json');

function load(file) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { counts: (j && typeof j.counts === 'object' && j.counts) || {}, dismissed: Array.isArray(j.dismissed) ? j.dismissed : [] };
  } catch { return { counts: {}, dismissed: [] }; }
}

function save(file, store) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(store));
    fs.renameSync(tmp, file);
  } catch { /* a convenience; it never blocks a merge */ }
  return store;
}

/** Call once a merge went ahead over an override: `ruleIds` are the blocking guard item ids ticked past. */
function recordOverride(file, ruleIds) {
  const store = load(file);
  for (const id of ruleIds || []) store.counts[id] = (store.counts[id] || 0) + 1;
  return save(file, store);
}

function dismiss(file, ruleId) {
  const store = load(file);
  if (!store.dismissed.includes(ruleId)) store.dismissed.push(ruleId);
  return save(file, store);
}

/** Clears a rule's override count and dismissal, so the suggestion can resurface after THRESHOLD more overrides. */
function resetCount(file, ruleId) {
  const store = load(file);
  delete store.counts[ruleId];
  store.dismissed = store.dismissed.filter((id) => id !== ruleId);
  return save(file, store);
}

/** One step down: 'block' -> 'warn' -> 'off'. Already-relaxed or unknown levels are returned unchanged. */
function relax(level) {
  return level === 'block' ? 'warn' : level === 'warn' ? 'off' : level;
}

/**
 * Writes a relaxed rule into the *project's* .ide/config.json instead of the IDE-level settings, for teams that
 * commit their guard policy. Same read/validate/write recipe as core/folderroles.js's save() - leaves every other
 * key untouched, throws on invalid JSON rather than clobbering it.
 */
function relaxProject(root, ruleId, next) {
  const file = path.join(root, CONFIG_REL);
  let cfg = {};
  let text = null;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (text !== null && text.trim()) {
    try { cfg = JSON.parse(text); } catch (e) { throw new Error(`.ide/config.json is not valid JSON (${e.message}); fix it first, nothing was changed.`); }
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) throw new Error('.ide/config.json must contain a JSON object; nothing was changed.');
  }
  cfg.mergeGuard = { ...(cfg.mergeGuard || {}), [ruleId]: next };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(cfg, null, 2)}\n`);
  return cfg.mergeGuard;
}

/**
 * Rules worth offering to relax: overridden at least `threshold` times, not dismissed, and still 'block' in
 * `policy` (nothing to offer once it is already 'warn' or 'off'). Most-overridden first.
 */
function suggestions(store, policy, { threshold = THRESHOLD } = {}) {
  const dismissed = new Set((store && store.dismissed) || []);
  return Object.entries((store && store.counts) || {})
    .filter(([id, n]) => n >= threshold && !dismissed.has(id) && policy && policy[id] === 'block')
    .map(([id, count]) => ({ id, count, next: relax(policy[id]) }))
    .sort((a, b) => b.count - a.count);
}

module.exports = { THRESHOLD, load, save, recordOverride, dismiss, resetCount, relax, relaxProject, suggestions };
