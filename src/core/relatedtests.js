'use strict';
/**
 * Related tests for the fix loop: after the static gates are clean, run the tests that belong to the changed files
 * and turn failures into findings the agent can act on.
 *
 * findRelatedTests is pure (file names + a reader). runRelatedTests runs the tests through an injectable runner.
 */
const path = require('node:path');
const { isTestPath } = require('./scope');
const { fileTestCommand } = require('./testcmd');
const { toPosix, runShell } = require('./util');

const SOURCE_EXT = /\.(java|kt|js|jsx|mjs|cjs|ts|tsx|py)$/i;
const baseOf = (p) => path.posix.basename(toPosix(p)).replace(/\.[^.]+$/, '');
/** Foo.test.ts / FooTest / FooTests / FooSpec / test_foo / foo_test -> foo (lowercase) */
function stem(name) {
  return name.replace(/\.(test|spec)$/i, '').replace(/^test_/i, '').replace(/_test$/i, '').replace(/(Tests?|IT|Spec)$/, '').toLowerCase();
}

/**
 * @param changed  [{path,status}] changed files
 * @param allFiles every file in the project (posix, relative)
 * @param readFile (rel) -> string  only used to look for imports of changed files
 * @returns {string[]} test files, changed tests first, at most `max`
 */
function findRelatedTests({ changed, allFiles, readFile = () => '', max = 5 }) {
  const live = changed.filter((c) => c.status !== 'D' && SOURCE_EXT.test(c.path)).map((c) => toPosix(c.path));
  const tests = allFiles.map(toPosix).filter((f) => SOURCE_EXT.test(f) && isTestPath(f));
  const out = [];
  const add = (f) => { if (!out.includes(f)) out.push(f); };
  for (const f of live) if (isTestPath(f)) add(f);
  const sources = live.filter((f) => !isTestPath(f));
  const stems = new Set(sources.map((f) => baseOf(f).toLowerCase()));
  for (const t of tests) if (stems.has(stem(baseOf(t)))) add(t);
  // tests that import / mention a changed class or module by name (cheap text search)
  const names = [...new Set(sources.map(baseOf))].filter((n) => n.length >= 3);
  if (names.length) {
    for (const t of tests) {
      if (out.includes(t)) continue;
      let text = '';
      try { text = readFile(t) || ''; } catch { /* unreadable */ }
      if (names.some((n) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text))) add(t);
    }
  }
  return out.slice(0, max);
}

const tail = (r, n = 30) => `${r.stdout || ''}\n${r.stderr || ''}`.split('\n').map((l) => l.replace(/\s+$/, '')).filter(Boolean).slice(-n).join('\n');

/**
 * Run each test file. A failing run becomes one finding with a stable message (so the fix loop can tell "same failure").
 * A run that cannot start (no runner found) or times out is reported in `skipped`, never as a failure.
 */
async function runRelatedTests({ root, files, readFile, timeoutSec = 120, run = runShell, signal }) {
  const findings = []; const skipped = []; const passed = [];
  for (const rel of files) {
    if (signal && signal.aborted) break;
    let content = '';
    try { content = readFile(rel) || ''; } catch { /* ignore */ }
    // fileTestCommand defaults to posix quoting; run() below always executes through spawn's shell:true,
    // which is cmd.exe on Windows (not whatever shell the user configured for terminals) - single-quoted
    // arguments pass through to node literally there, so e.g. --test-name-pattern='fine' never matches.
    const cmd = fileTestCommand(root, rel, { content, shellKind: process.platform === 'win32' ? 'cmd' : 'posix' });
    if (!cmd) { skipped.push({ file: rel, reason: 'no test command known' }); continue; }
    const r = await run(cmd.command, { cwd: path.join(root, cmd.cwd || ''), timeoutMs: timeoutSec * 1000, signal });
    if (r.cancelled) break;
    if (r.timedOut) { skipped.push({ file: rel, reason: `timed out after ${timeoutSec}s` }); continue; }
    const text = tail(r, 200);
    if (r.code === 127 || /command not found|is not recognized as|No module named pytest|npm ERR! could not determine executable/i.test(text)) { skipped.push({ file: rel, reason: 'runner not available' }); continue; }
    if (r.code === 0) { passed.push(rel); continue; }
    findings.push({ tool: 'tests', scope: 'files', severity: 'error', file: rel, line: 0, rule: 'test-failure', message: `Tests fail: ${cmd.label}`, detail: tail(r, 30) });
  }
  return { findings, skipped, passed };
}

module.exports = { findRelatedTests, runRelatedTests, stem };
