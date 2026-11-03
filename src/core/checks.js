'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { changedFiles, changedLineMap, isChangedLine } = require('./git');
const { loadChecksConfig } = require('./config');
const parsers = require('./parsers');
const { toPosix, toArray, which, runShell, listAllFiles, findFiles, matchesAny } = require('./util');
const { findDuplicateComponents } = require('./dupes');
const { scanSecrets } = require('./secrets');
const os = require('node:os');

const MAX_COMMAND_LENGTH = 6500; // stay below the ~8k cmd.exe limit
const MAX_FILES_PER_CHECK = 2000;
const TEXT_PARSERS = new Set(['tsc', 'mypy', 'maven', 'yamllint', 'regex']);

function unmetRequirement(check, root) {
  for (const bin of toArray(check.requiresBin)) {
    if (!which(bin)) return `${bin} is not installed`;
  }
  const files = toArray(check.requiresFile);
  const missing = files.filter((f) => !fs.existsSync(path.join(root, f)));
  if (missing.length) return `missing ${missing.join(', ')}`;
  const anyFiles = toArray(check.requiresFileAny);
  if (anyFiles.length && !anyFiles.some((f) => fs.existsSync(path.join(root, f)))) {
    return `missing one of ${anyFiles.join(', ')}`;
  }
  return unmetContentRequirement(check, root);
}

/** check.requiresFileContains: { file | anyFile, pattern, note? } - the first existing file must match pattern (case-insensitive). */
function unmetContentRequirement(check, root) {
  const req = check.requiresFileContains;
  if (!req || !req.pattern) return null;
  const candidates = toArray(req.file || req.anyFile);
  const file = candidates.find((f) => fs.existsSync(path.join(root, f)));
  if (!file) return req.note || `missing ${candidates.join(' or ')}`;
  let text;
  try { text = fs.readFileSync(path.join(root, file), 'utf8'); } catch { return req.note || `could not read ${file}`; }
  let re;
  try { re = new RegExp(req.pattern, 'i'); } catch { return null; }
  if (!re.test(text)) return req.note || `${file} does not match the required configuration`;
  return null;
}

function chunkFiles(template, files) {
  const base = template.replace('{files}', '').length;
  const chunks = [];
  let cur = [];
  let len = base;
  for (const f of files) {
    const add = f.length + 3;
    if (cur.length && len + add > MAX_COMMAND_LENGTH) { chunks.push(cur); cur = []; len = base; }
    cur.push(f);
    len += add;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

function normalizeFile(file, root) {
  if (!file) return undefined;
  let f = String(file);
  if (path.isAbsolute(f)) f = path.relative(root, f);
  return toPosix(f).replace(/^\.\//, '');
}

function tail(result, lines = 40, maxChars = 4000) {
  const text = `${result.stdout}\n${result.stderr}`.trim().split(/\r?\n/).slice(-lines).join('\n');
  return text.length > maxChars ? text.slice(-maxChars) : text;
}

function commandNotFound(result) {
  return result.code === 127 || /is not recognized as an internal or external command/i.test(result.stderr)
    || (/command not found|not found$/im.test(result.stderr) && result.code !== 0 && !result.stdout.trim());
}

/** Gradle task not found means the plugin isn't applied in this project's build script - not a real failure. */
function gradleTaskNotFound(result) {
  return /Task '[^']+' not found in (root project|project ':)/i.test(result.stderr);
}

/** Prefer a project's own wrapper (pins its Gradle version) over a global `gradle` install. */
function gradleBinFor(root) {
  const wrapper = process.platform === 'win32' ? 'gradlew.bat' : 'gradlew';
  if (fs.existsSync(path.join(root, wrapper))) return process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
  return 'gradle';
}

/**
 * For multi-module Maven builds: which modules contain the changed sources?
 * {modules} expands to `-pl "a,b" -am` (those modules plus what they depend on), {modules-only} to `-pl "a,b"`.
 * Both are empty (build everything) for single-module projects or when the root module itself changed.
 */
function mavenModuleArgs(root, files) {
  const none = { modules: '', modulesOnly: '' };
  let rootPom;
  try { rootPom = fs.readFileSync(path.join(root, 'pom.xml'), 'utf8'); } catch { return none; }
  if (!/<modules>/.test(rootPom)) return none;
  const dirs = new Set();
  for (const f of files) {
    if (!/(^|\/)src\//.test(f) && !f.endsWith('pom.xml')) continue;
    let dir = path.posix.dirname(f);
    if (f === 'pom.xml') return none;
    while (dir !== '.' && dir !== '' && !fs.existsSync(path.join(root, dir, 'pom.xml'))) dir = path.posix.dirname(dir);
    if (dir === '.' || dir === '') return none; // belongs to the root module: build everything
    dirs.add(dir);
  }
  if (!dirs.size) return none;
  const list = [...dirs].sort().join(',');
  return { modules: `-pl "${list}" -am`, modulesOnly: `-pl "${list}"` };
}

/** Did the working tree change the finding's line (or any line of its range)? */
function touched(lineMap, f) {
  const end = Math.min(f.endLine || f.line, f.line + 2000);
  for (let n = f.line; n <= end; n++) if (isChangedLine(lineMap, f.file, n)) return true;
  return false;
}

async function runCheck(check, ctx) {
  const base = { name: check.name, tier: check.tier || 'fast' };
  const skipped = (note) => ({ ...base, status: 'skipped', note, count: 0, findings: [], durationMs: 0 });
  const cancelledRun = () => ({ ...base, status: 'cancelled', note: 'cancelled', count: 0, findings: [], durationMs: 0 });

  const unmet = unmetRequirement(check, ctx.root);
  if (unmet) return skipped(unmet);

  const matching = ctx.files.filter((f) => matchesAny(f, check.match));
  if (matching.length === 0) return skipped('no matching files');

  let runTemplate = String(check.run);
  if (runTemplate.includes('{modules')) {
    const m = ctx.mavenArgs();
    runTemplate = runTemplate.replace('{modules-only}', m.modulesOnly).replace('{modules}', m.modules);
  }
  if (runTemplate.includes('{gradle}')) runTemplate = runTemplate.replace('{gradle}', ctx.gradleBin());

  const cwd = check.cwd ? path.resolve(ctx.root, check.cwd) : ctx.root;
  const usesFiles = check.scope !== 'project' && runTemplate.includes('{files}');
  let commands;
  if (usesFiles) {
    const rel = matching
      .filter((f) => !f.includes('"'))
      .slice(0, MAX_FILES_PER_CHECK)
      .map((f) => toPosix(path.relative(cwd, path.join(ctx.root, f))));
    commands = chunkFiles(runTemplate, rel).map((chunk) => runTemplate.replace('{files}', chunk.map((f) => `"${f}"`).join(' ')));
  } else {
    commands = [runTemplate.replace('{files}', '')];
  }

  const parse = parsers[check.parser || 'exitcode'] || parsers.exitcode;
  const started = Date.now();
  const findings = [];
  let failure = null;
  let nonZero = null;
  let tmpDir = null;
  if (!check.native && commands.some((c) => c.includes('{tmpdir}'))) {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bazinga-chk-'));
    commands = commands.map((c) => c.split('{tmpdir}').join(tmpDir.includes(' ') ? `"${tmpDir}"` : tmpDir));
  }
  if (check.native === 'duplicate-components') {
    try { findings.push(...findDuplicateComponents({ root: ctx.root, allFiles: ctx.allFiles(), changed: ctx.files })); } catch (err) { failure = { message: `${check.name} failed: ${err.message}`, detail: '' }; }
    commands = [];
  }

  if (check.native === 'secrets') {
    try { findings.push(...scanSecrets({ root: ctx.root, changed: ctx.files })); } catch (err) { failure = { message: `${check.name} failed: ${err.message}`, detail: '' }; }
    commands = [];
  }

  for (const command of commands) {
    if (ctx.signal && ctx.signal.aborted) return cancelledRun();
    const result = await runShell(command, { cwd, timeoutMs: (check.timeoutSec || 300) * 1000, env: check.env, signal: ctx.signal });
    if (result.cancelled) return cancelledRun();
    if (result.timedOut) {
      failure = { message: `${check.name} timed out after ${check.timeoutSec || 300}s`, detail: tail(result) };
      break;
    }
    if (result.code !== 0 && commandNotFound(result)) return skipped('command not found');
    if (result.code !== 0 && gradleTaskNotFound(result)) return skipped('Gradle task not configured for this project (plugin not applied in build.gradle)');

    const text = TEXT_PARSERS.has(check.parser) ? `${result.stdout}\n${result.stderr}` : (result.stdout.trim() ? result.stdout : result.stderr);
    let parsed = [];
    try { parsed = parse(text, check, result); } catch { parsed = []; }
    findings.push(...parsed);
    if (result.code !== 0 && parsed.length === 0 && !nonZero) nonZero = { code: result.code, detail: tail(result) };
  }

  // Tools that write a report file (Surefire/JUnit XML, SpotBugs, PMD, Checkstyle, SARIF...). Only reports written by this run count.
  const reportPatterns = toArray(check.reports);
  if (reportPatterns.length && !failure) {
    const reportParser = parsers.reportParsers[check.reportFormat || 'junit'];
    if (reportParser) {
      for (const rel of findFiles(ctx.root, reportPatterns, { sinceMs: started - 2000 })) {
        let text;
        try { text = fs.readFileSync(path.join(ctx.root, rel), 'utf8'); } catch { continue; }
        try { findings.push(...reportParser(text, { files: ctx.allFiles })); } catch { /* malformed report */ }
      }
    }
  }

  if (tmpDir) {
    if (check.tmpReport && !failure) {
      const reportParser = parsers.reportParsers[check.reportFormat];
      try { findings.push(...reportParser(fs.readFileSync(path.join(tmpDir, check.tmpReport), 'utf8'), { files: ctx.allFiles })); } catch { /* no report written */ }
    }
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  if (!failure && nonZero && findings.length === 0) {
    const verb = (check.parser || 'exitcode') === 'exitcode' ? 'failed' : 'could not run cleanly';
    failure = { message: `${check.name} ${verb} (exit ${nonZero.code})`, detail: nonZero.detail };
  }

  // onlyChangedFiles: whole-project tools (duplicate detection) report on files nobody touched; keep only the changed ones,
  // and treat them like per-file findings so the "only lines you changed" filter applies.
  const onlyChanged = !!check.onlyChangedFiles;
  const changedSet = new Set(ctx.files);
  const scope = check.scope === 'project' && !onlyChanged ? 'project' : 'files';
  const normalized = findings.map((f) => ({
    tool: check.name,
    scope,
    file: normalizeFile(f.file, ctx.root),
    line: f.line,
    endLine: f.endLine,
    column: f.column,
    severity: check.severity || f.severity || 'error',
    message: f.message,
    rule: f.rule,
    detail: f.detail,
  })).filter((f) => !onlyChanged || (f.file && changedSet.has(f.file)));
  if (failure) {
    normalized.push({ tool: check.name, scope, severity: 'error', message: failure.message, rule: 'run', detail: failure.detail });
  }

  return {
    ...base,
    status: failure ? 'failed' : normalized.length ? 'findings' : 'passed',
    count: normalized.length,
    findings: normalized,
    durationMs: Date.now() - started,
  };
}

/**
 * Run quality gates against a project.
 * opts: { tier: 'fast'|'slow'|'all', only: [names], files: 'changed'|'all'|[paths],
 *         changedLinesOnly (default true): mark findings on lines you did not touch as `legacy` and leave them out of the counts,
 *         signal: AbortSignal (kills the running tool), onProgress(evt) }
 */
async function runChecks(root, opts = {}) {
  const { tier = 'all', only, files: filesOpt = 'changed', onProgress, signal, changedLinesOnly = true } = opts;
  const started = Date.now();
  const { checks } = loadChecksConfig(root);

  let files;
  if (Array.isArray(filesOpt)) files = filesOpt.map(toPosix);
  else if (filesOpt === 'all') files = listAllFiles(root);
  else files = (await changedFiles(root)).filter((f) => f.status !== 'D').map((f) => f.path);
  files = files.filter((f) => fs.existsSync(path.join(root, f)));

  const selected = checks.filter((c) => c.enabled !== false
    && (!only || only.includes(c.name))
    && (tier === 'all' || (c.tier || 'fast') === tier));

  let allFilesCache;
  let mavenCache;
  let gradleBinCache;
  const ctxBase = {
    root,
    files,
    signal,
    allFiles: () => (allFilesCache || (allFilesCache = listAllFiles(root, 100000))),
    mavenArgs: () => (mavenCache || (mavenCache = mavenModuleArgs(root, files))),
    gradleBin: () => (gradleBinCache || (gradleBinCache = gradleBinFor(root))),
  };

  const runs = [];
  const all = [];
  let cancelled = false;
  for (const check of selected) {
    if (signal && signal.aborted) { cancelled = true; break; }
    if (onProgress) onProgress({ type: 'start', name: check.name });
    const run = await runCheck(check, ctxBase);
    runs.push({ name: run.name, tier: run.tier, status: run.status, note: run.note, count: run.count, durationMs: run.durationMs });
    all.push(...run.findings);
    if (onProgress) onProgress({ type: 'done', name: check.name, run: runs[runs.length - 1] });
    if (run.status === 'cancelled') { cancelled = true; break; }
  }

  let lineMap = null;
  if (changedLinesOnly && filesOpt === 'changed') {
    try { lineMap = await changedLineMap(root); } catch { lineMap = null; }
  }
  for (const f of all) {
    f.legacy = !!(lineMap && f.scope === 'files' && f.file && f.line && !touched(lineMap, f));
  }

  const seen = new Set();
  const findings = all.filter((f) => {
    const key = [f.tool, f.file, f.line, f.column, f.rule, f.message].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const sevRank = { error: 0, warning: 1, info: 2 };
  findings.sort((a, b) => (a.file || '').localeCompare(b.file || '') || (a.line || 0) - (b.line || 0) || sevRank[a.severity] - sevRank[b.severity]);

  const counts = { error: 0, warning: 0, info: 0, legacy: 0 };
  for (const f of findings) {
    if (f.legacy) counts.legacy++;
    else counts[f.severity] = (counts[f.severity] || 0) + 1;
  }

  return { root, files, runs, findings, counts, cancelled, durationMs: Date.now() - started };
}

function formatFindings(result, { limit = 60, includeLegacy = false } = {}) {
  const list = result.findings.filter((f) => includeLegacy || !f.legacy);
  const lines = [];
  for (const f of list.slice(0, limit)) {
    const loc = f.file ? `${f.file}${f.line ? `:${f.line}` : ''}${f.column ? `:${f.column}` : ''}` : '(project)';
    lines.push(`${loc}  ${f.severity}  [${f.tool}${f.rule ? ` ${f.rule}` : ''}]  ${f.message}`);
    if (f.detail) lines.push(...f.detail.split('\n').slice(-12).map((l) => `    ${l}`));
  }
  if (list.length > limit) lines.push(`... and ${list.length - limit} more`);
  return lines.join('\n');
}

module.exports = { runChecks, runCheck, formatFindings, mavenModuleArgs, gradleBinFor };
