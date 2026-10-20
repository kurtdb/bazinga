'use strict';
/**
 * Task scope checks: "did the agent do what was asked, and nothing else?" without a second model.
 *  - baseline:   hashes of the changed files when the task started, so pre-existing edits aren't blamed on the agent
 *  - allowlist:  paths the task may touch; anything else is out of scope
 *  - test edits: existing tests that were modified or deleted (with a count of removed assertion-like lines)
 *  - self-report: compare the agent's own "files I changed" summary with the real diff
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { toPosix, globToRegExp } = require('./util');
const { git } = require('./git');

const TEST_PATTERNS = [
  /(^|\/)(tests?|__tests__|spec|specs|e2e|cypress)\//i,
  /(^|\/)src\/test\//i,
  /\.(test|spec)\.[a-z0-9]+$/i,
  /(^|\/)test_[^/]+\.py$/i,
  /_test\.(py|go)$/i,
  /(Test|Tests|IT|Spec)\.(java|kt|scala|groovy)$/,
  /(^|\/)conftest\.py$/i,
];
const isTestPath = (p) => TEST_PATTERNS.some((re) => re.test(toPosix(p)));

const ASSERTION_LINE = /\b(assert\w*|expect|should|verify|fail|toBe\w*|toEqual|toThrow|@Test|@Parameterized\w*|(?:it|test|describe)\s*\(|def\s+test_)/;

function fileHash(root, rel) {
  try { return crypto.createHash('sha1').update(fs.readFileSync(path.join(root, rel))).digest('hex'); } catch { return 'deleted'; }
}

/** Remember the current state of every changed file: { rel: hash }. */
function snapshot(root, changed) {
  const out = {};
  for (const c of changed) out[c.path] = fileHash(root, c.path);
  return out;
}

/** The changed files that differ from the baseline (new since the task started, or edited again since). */
function taskFiles(root, changed, baseline) {
  if (!baseline) return changed.map((c) => ({ ...c, hash: fileHash(root, c.path) }));
  const out = [];
  for (const c of changed) {
    const hash = fileHash(root, c.path);
    if (baseline[c.path] !== hash) out.push({ ...c, hash });
  }
  // files that were dirty at the start and are clean now: the agent reverted them
  return out;
}

function parseAllow(text) {
  return String(text || '').split(/[\n,;]+/).map((s) => toPosix(s.trim())).filter(Boolean);
}

/** Special allowlist words: `@tests` = any test file, `@new-tests` = test files that are new (existing files may not be touched). */
const SCOPE_WORDS = {
  '@tests': (rel) => isTestPath(rel),
  '@new-tests': (rel, status) => isTestPath(rel) && (status === 'A' || status === '?' || status === '??'),
};

function inScope(rel, allow, status) {
  if (!allow.length) return true;
  return allow.some((raw) => {
    const word = SCOPE_WORDS[raw.toLowerCase()];
    if (word) return word(rel, status);
    let p = raw.replace(/^\.\//, '');
    if (p.endsWith('/')) p += '**';
    if (!/[*?]/.test(p)) return rel === p || rel.startsWith(`${p}/`);
    if (!p.includes('/')) return globToRegExp(p).test(rel.slice(rel.lastIndexOf('/') + 1));
    return globToRegExp(p).test(rel);
  });
}

// --- how strong is a test file? (counting by line patterns, not parsing: good enough to see "the good tests were replaced by empty ones")
const CASE_LINE = /(?:^|[^\w.])(?:it|test)(?:\.\w+)?\s*\(|\bdef\s+test_|^\s*@(?:Test|ParameterizedTest|RepeatedTest)\b|\bfunc\s+Test\w+|#\[test\]/;
const ASSERT_LINE = /\b(?:assert\w*|expect\s*\(|verify\s*\(|toBe\w*|toEqual|toThrow|toHaveBeen\w+|fail\s*\(|pytest\.raises|should\b)/;
const TRIVIAL_LINE = /\bassert\s+(?:True|1\s*==\s*1)\b|\bassertTrue\(\s*(?:true|True)\s*\)|\bassertEquals?\(\s*([\w'"]+)\s*,\s*\1\s*\)|\bexpect\(\s*(true|\d+)\s*\)\.toBe\(\s*\2\s*\)|\bassert_eq!\(\s*(\w+)\s*,\s*\3\s*\)/;

/** { cases, assertions, trivial } for the text of a test file. */
function testStrength(text) {
  const out = { cases: 0, assertions: 0, trivial: 0 };
  for (const line of String(text || '').split(/\r?\n/)) {
    if (/^\s*(?:\/\/|#|\*|\/\*)/.test(line)) continue; // comments do not test anything
    if (CASE_LINE.test(line)) out.cases++;
    if (TRIVIAL_LINE.test(line)) out.trivial++; // an always-true assertion proves nothing: it is not counted as one
    else if (ASSERT_LINE.test(line)) out.assertions++;
  }
  return out;
}

/** Is `after` a weaker version of `before`?  { weaker, reasons } */
function compareStrength(before, after) {
  const reasons = [];
  if (after.cases < before.cases) reasons.push(`${before.cases - after.cases} fewer test case(s) (${before.cases} → ${after.cases})`);
  if (after.assertions < before.assertions) reasons.push(`${before.assertions - after.assertions} fewer assertion(s) (${before.assertions} → ${after.assertions})`);
  if (after.trivial > before.trivial) reasons.push(`${after.trivial - before.trivial} always-true assertion(s) added`);
  return { weaker: reasons.length > 0, reasons };
}

/** Before (git HEAD) and after (the file now) for one modified test file; null when either side cannot be read. */
async function strengthChange(root, rel) {
  try {
    const before = testStrength(await git(root, ['show', `HEAD:${rel}`]));
    const after = testStrength(fs.readFileSync(path.join(root, rel), 'utf8'));
    return { before, after, ...compareStrength(before, after) };
  } catch { return null; }
}

async function removedAssertions(root, rel) {
  try {
    const diff = await git(root, ['diff', '-U0', 'HEAD', '--', rel]);
    let n = 0;
    for (const line of diff.split('\n')) if (line.startsWith('-') && !line.startsWith('---') && ASSERTION_LINE.test(line)) n++;
    return n;
  } catch { return 0; }
}

/** File-looking tokens in free text ("`src/a/B.java`", "a.py", "pom.xml"). */
function extractPaths(text) {
  const found = new Set();
  for (const m of String(text || '').matchAll(/[A-Za-z0-9_@.\-]+(?:[\\/][A-Za-z0-9_@.\-]+)*\.[A-Za-z][A-Za-z0-9]{0,7}\b/g)) {
    found.add(toPosix(m[0]).replace(/^\.\//, ''));
  }
  return [...found];
}

function mentions(summary, rel, uniqueBase) {
  const tokens = extractPaths(summary);
  if (tokens.some((t) => t === rel || (t.includes('/') && rel.endsWith(`/${t}`)))) return true;
  const base = rel.slice(rel.lastIndexOf('/') + 1);
  return uniqueBase && tokens.includes(base);
}

/**
 * @param {object} p
 * @param {string} p.root
 * @param {Array}  p.changed    from git.changedFiles
 * @param {object} [p.baseline] from snapshot()
 * @param {string|string[]} [p.allow]  allowlist text or list
 * @param {string} [p.summary]  the agent's own account of what it changed
 * @param {string[]} [p.knownFiles] project files, to spot files the agent mentions but did not change
 */
async function analyzeScope({ root, changed, baseline, allow, summary, knownFiles }) {
  const allowList = Array.isArray(allow) ? allow : parseAllow(allow);
  const files = taskFiles(root, changed, baseline);
  const flags = {}; // rel -> [{ kind, level, text }]
  const flag = (rel, kind, level, text) => { (flags[rel] = flags[rel] || []).push({ kind, level, text }); };

  const outOfScope = [];
  for (const f of files) {
    if (!inScope(f.path, allowList, f.status)) { outOfScope.push(f.path); flag(f.path, 'scope', 'warn', 'Outside the task scope'); }
  }

  const testEdits = [];
  for (const f of files) {
    if (!isTestPath(f.path)) continue;
    if (f.status === 'A' || f.status === '?') continue; // new tests are good
    const removed = f.status === 'D' ? 0 : await removedAssertions(root, f.path);
    const sc = f.status === 'D' ? null : await strengthChange(root, f.path);
    testEdits.push({ path: f.path, status: f.status, removedAssertions: removed, ...(sc ? { before: sc.before, after: sc.after, weaker: sc.weaker, reasons: sc.reasons } : {}) });
    const base = f.status === 'D' ? 'Existing test deleted' : removed ? `Existing test edited, ${removed} assertion-like line(s) removed` : 'Existing test edited';
    const text = sc && sc.weaker ? `${base}; weaker than before: ${sc.reasons.join(', ')}` : base;
    flag(f.path, 'test', f.status === 'D' || removed || (sc && sc.weaker) ? 'warn' : 'info', text);
  }

  let report = null;
  if (summary && String(summary).trim()) {
    const bases = new Map();
    for (const f of files) { const b = f.path.slice(f.path.lastIndexOf('/') + 1); bases.set(b, (bases.get(b) || 0) + 1); }
    const unexplained = files.filter((f) => !mentions(summary, f.path, bases.get(f.path.slice(f.path.lastIndexOf('/') + 1)) === 1)).map((f) => f.path);
    for (const rel of unexplained) flag(rel, 'report', 'warn', 'Not mentioned in the agent’s own summary');
    const changedSet = new Set(files.map((f) => f.path));
    const baseSet = new Set([...changedSet].map((p) => p.slice(p.lastIndexOf('/') + 1)));
    const known = new Set(knownFiles || []);
    const claimedButUnchanged = extractPaths(summary).filter((t) => {
      if (changedSet.has(t) || [...changedSet].some((c) => c.endsWith(`/${t}`))) return false;
      if (!t.includes('/') && baseSet.has(t)) return false;
      return known.has(t) || [...known].some((k) => k.endsWith(`/${t}`));
    });
    report = { unexplained, claimedButUnchanged };
  }

  const warnFiles = Object.keys(flags).filter((r) => flags[r].some((x) => x.level === 'warn'));
  return {
    files: files.map((f) => ({ path: f.path, status: f.status, hash: f.hash })),
    allow: allowList,
    outOfScope,
    testEdits,
    report,
    flags,
    warnings: warnFiles.length,
  };
}

/** A short prompt the user can paste to make the agent produce a summary the self-report check can use. */
const SUMMARY_PROMPT = 'When you are done, end with a section "Files changed" listing every file you created, edited or deleted (full relative paths), one per line with a short reason. Do not touch any file you do not list.';

module.exports = { testStrength, compareStrength, strengthChange, SCOPE_WORDS, isTestPath, fileHash, snapshot, taskFiles, parseAllow, inScope, extractPaths, analyzeScope, SUMMARY_PROMPT };
