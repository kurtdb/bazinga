'use strict';
const { fileURLToPath } = require('node:url');

/**
 * Each parser turns tool output into findings:
 *   { file, line, column, severity: 'error' | 'warning' | 'info', message, rule }
 * File paths are normalised to project-relative posix paths by the runner.
 */

function tryJson(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  try { return JSON.parse(t); } catch { /* fall through */ }
  const starts = [t.indexOf('['), t.indexOf('{')].filter((i) => i >= 0);
  if (!starts.length) return null;
  const start = Math.min(...starts);
  const end = Math.max(t.lastIndexOf(']'), t.lastIndexOf('}'));
  if (end <= start) return null;
  try { return JSON.parse(t.slice(start, end + 1)); } catch { return null; }
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : undefined);

function eslint(stdout) {
  const data = tryJson(stdout);
  if (!Array.isArray(data)) return [];
  const out = [];
  for (const f of data) {
    for (const m of f.messages || []) {
      out.push({ file: f.filePath, line: m.line, column: m.column, severity: m.severity === 2 ? 'error' : 'warning', message: m.message, rule: m.ruleId || undefined });
    }
  }
  return out;
}

function ruff(stdout) {
  const data = tryJson(stdout);
  if (!Array.isArray(data)) return [];
  return data.map((d) => ({
    file: d.filename,
    line: d.location && d.location.row,
    column: d.location && d.location.column,
    severity: /^(F|E9)/.test(d.code || '') || d.code === null ? 'error' : 'warning',
    message: d.message,
    rule: d.code || undefined,
  }));
}

function pyright(stdout) {
  const data = tryJson(stdout);
  if (!data || !Array.isArray(data.generalDiagnostics)) return [];
  return data.generalDiagnostics.map((d) => ({
    file: d.file,
    line: d.range ? d.range.start.line + 1 : undefined,
    column: d.range ? d.range.start.character + 1 : undefined,
    severity: d.severity === 'error' ? 'error' : d.severity === 'warning' ? 'warning' : 'info',
    message: d.message,
    rule: d.rule,
  }));
}

function shellcheck(stdout) {
  const data = tryJson(stdout);
  const list = Array.isArray(data) ? data : data && Array.isArray(data.comments) ? data.comments : [];
  return list.map((d) => ({
    file: d.file,
    line: d.line,
    column: d.column,
    severity: d.level === 'error' ? 'error' : d.level === 'warning' ? 'warning' : 'info',
    message: d.message,
    rule: d.code ? `SC${d.code}` : undefined,
  }));
}

function yamllint(stdout) {
  const out = [];
  for (const line of String(stdout).split(/\r?\n/)) {
    const m = /^(.+?):(\d+):(\d+): \[(error|warning)\] (.+?)(?: \(([\w-]+)\))?$/.exec(line);
    if (m) out.push({ file: m[1], line: num(m[2]), column: num(m[3]), severity: m[4], message: m[5], rule: m[6] });
  }
  return out;
}

function tsc(stdout) {
  const out = [];
  for (const line of String(stdout).split(/\r?\n/)) {
    const m = /^(.+?)\((\d+),(\d+)\): (error|warning) (TS\d+): (.*)$/.exec(line);
    if (m) out.push({ file: m[1], line: num(m[2]), column: num(m[3]), severity: m[4], message: m[6], rule: m[5] });
  }
  return out;
}

function mypy(stdout) {
  const out = [];
  for (const line of String(stdout).split(/\r?\n/)) {
    const m = /^(.+?):(\d+):(?:(\d+):)? (error|warning|note): (.*?)(?:\s+\[([\w-]+)\])?$/.exec(line);
    if (m) out.push({ file: m[1], line: num(m[2]), column: num(m[3]), severity: m[4] === 'note' ? 'info' : m[4], message: m[5], rule: m[6] });
  }
  return out;
}

function maven(stdout) {
  const out = [];
  for (const line of String(stdout).split(/\r?\n/)) {
    // javac:      [ERROR] /abs/A.java:[12,8] cannot find symbol
    // checkstyle: [WARN] /abs/A.java:[12,5] (whitespace) WhitespaceAround: '{' is not followed by whitespace.
    const m = /^\[(ERROR|WARNING|WARN)\]\s+(.+?\.java):\[(\d+)(?:,(\d+))?\]\s+(?:\(([\w-]+)\)\s+)?(.*)$/.exec(line.trim());
    if (m) out.push({ file: m[2], line: num(m[3]), column: num(m[4]), severity: m[1] === 'ERROR' ? 'error' : 'warning', message: m[6], rule: m[5] || 'javac' });
  }
  return out;
}

/** `cargo check`/`cargo clippy --message-format=json`: one JSON object per line, most of them not diagnostics at all. */
function cargo(stdout) {
  const out = [];
  for (const line of String(stdout).split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    let obj;
    try { obj = JSON.parse(t); } catch { continue; }
    const msg = obj.reason === 'compiler-message' && obj.message;
    if (!msg || (msg.level !== 'error' && msg.level !== 'warning')) continue;
    const spans = msg.spans || [];
    const span = spans.find((s) => s.is_primary) || spans[0] || {};
    out.push({ file: span.file_name, line: span.line_start, column: span.column_start, severity: msg.level, message: msg.message, rule: msg.code && msg.code.code });
  }
  return out;
}

function sarifUri(uri) {
  if (!uri) return undefined;
  if (uri.startsWith('file://')) { try { return fileURLToPath(uri); } catch { return uri; } }
  try { return decodeURIComponent(uri); } catch { return uri; }
}

function sarif(stdout) {
  const data = tryJson(stdout);
  if (!data || !Array.isArray(data.runs)) return [];
  const out = [];
  for (const run of data.runs) {
    for (const r of run.results || []) {
      const loc = r.locations && r.locations[0] && r.locations[0].physicalLocation;
      const region = (loc && loc.region) || {};
      const level = r.level || 'warning';
      out.push({
        file: sarifUri(loc && loc.artifactLocation && loc.artifactLocation.uri),
        line: region.startLine,
        column: region.startColumn,
        severity: level === 'error' ? 'error' : level === 'warning' ? 'warning' : 'info',
        message: (r.message && (r.message.text || r.message.markdown)) || r.ruleId || 'finding',
        rule: r.ruleId,
      });
    }
  }
  return out;
}

/** Generic parser: check.pattern is a regex with named groups file, line, column, severity, message, rule. */
function regex(stdout, check) {
  if (!check || !check.pattern) return [];
  let re;
  try { re = new RegExp(check.pattern); } catch { return []; }
  const out = [];
  for (const line of String(stdout).split(/\r?\n/)) {
    const m = re.exec(line);
    if (!m || !m.groups) continue;
    const sev = (m.groups.severity || 'error').toLowerCase();
    out.push({
      file: m.groups.file,
      line: num(m.groups.line),
      column: num(m.groups.column),
      severity: sev.startsWith('warn') ? 'warning' : sev.startsWith('info') || sev === 'note' ? 'info' : 'error',
      message: m.groups.message || line.trim(),
      rule: m.groups.rule,
    });
  }
  return out;
}

/** Findings come only from the exit code (handled by the runner). */
function exitcode() { return []; }

module.exports = { tryJson, eslint, ruff, pyright, shellcheck, yamllint, tsc, mypy, maven, cargo, sarif, regex, exitcode };

// ---------------------------------------------------------------------------------------------
// Report parsers: tools that write an XML/SARIF report file instead of (or besides) console output.
// Each takes (text, ctx) where ctx.files() lazily returns every project file (relative posix paths),
// used to resolve a Java class or source path to a real file in the project.
// ---------------------------------------------------------------------------------------------

function decodeXml(s) {
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

function xmlAttrs(s) {
  const out = {};
  const re = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(s))) out[m[1]] = decodeXml(m[2] !== undefined ? m[2] : m[3]);
  return out;
}

function pathEndingWith(ctx, suffix, prefer) {
  const all = ctx && ctx.files ? ctx.files() : [];
  const hits = all.filter((f) => f === suffix || f.endsWith(`/${suffix}`));
  if (!hits.length) return undefined;
  return (prefer && hits.find((h) => h.includes(prefer))) || hits[0];
}

/** Work out where a failed test lives: explicit file/line attrs, a Java stack frame, or a Python "path.py:12:" line. */
function locateFailure(attrs, text, ctx) {
  if (attrs.file && attrs.line) return { file: attrs.file, line: num(attrs.line) };
  const cls = attrs.classname || '';
  const frameRe = /\bat\s+([\w.$]+)\.[\w$<>]+\(([\w$]+\.java):(\d+)\)/g;
  let frame;
  let fallback;
  while ((frame = frameRe.exec(text))) {
    const frameClass = frame[1];
    const packagePath = frameClass.replace(/\.[^.]*$/, '').replace(/\./g, '/');
    const resolved = pathEndingWith(ctx, `${packagePath}/${frame[2]}`, '/src/test/') || pathEndingWith(ctx, frame[2], '/src/test/');
    if (!resolved) continue;
    const hit = { file: resolved, line: num(frame[3]) };
    if (cls && (frameClass === cls || frameClass.startsWith(`${cls}$`) || cls.startsWith(`${frameClass}$`))) return hit;
    if (!fallback && resolved.includes('/src/test/')) fallback = hit;
  }
  if (fallback) return fallback;
  const pyRe = /^(\S+?\.py):(\d+):/gm;
  let py;
  let last;
  while ((py = pyRe.exec(text))) last = py;
  if (last) return { file: last[1], line: num(last[2]) };
  return {};
}

/** JUnit XML (Maven Surefire/Failsafe, pytest --junitxml, many others). One error finding per failed/errored test. */
function junit(xml, ctx) {
  const out = [];
  const caseRe = /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
  let m;
  while ((m = caseRe.exec(xml))) {
    const body = m[2];
    if (!body) continue;
    const fail = /<(failure|error)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/.exec(body);
    if (!fail) continue;
    const attrs = xmlAttrs(m[1]);
    const failAttrs = xmlAttrs(fail[2]);
    const text = decodeXml(fail[3] || '').trim();
    const loc = locateFailure(attrs, text, ctx);
    const shortClass = (attrs.classname || '').split('.').pop();
    const first = (failAttrs.message || text.split('\n')[0] || 'test failed').split('\n')[0];
    // ArchUnit's exception message always starts with this exact, stable prefix - tag it as its own rule
    // category instead of the generic test-failure, so it reads as an architecture problem, not a flaky test.
    const archViolation = /^Architecture Violation \[Priority:/.test(text) || /^Architecture Violation \[Priority:/.test(failAttrs.message || '');
    out.push({
      file: loc.file,
      line: loc.line,
      severity: 'error',
      message: `${shortClass ? `${shortClass}.` : ''}${attrs.name || 'test'}: ${first}`,
      rule: archViolation ? 'architecture-violation' : (fail[1] === 'error' ? 'test-error' : 'test-failure'),
      detail: text.split('\n').slice(0, 15).join('\n'),
    });
  }
  return out;
}

/** SpotBugs XML (target/spotbugsXml.xml). */
function spotbugs(xml, ctx) {
  const out = [];
  const re = /<BugInstance\b([^>]*)>([\s\S]*?)<\/BugInstance>/g;
  let m;
  while ((m = re.exec(xml))) {
    const a = xmlAttrs(m[1]);
    const body = m[2];
    const lines = [...body.matchAll(/<SourceLine\b([^>]*?)\/?>/g)].map((x) => xmlAttrs(x[1]));
    const src = lines.find((l) => l.primary === 'true') || lines[0] || {};
    const msg = /<LongMessage>([\s\S]*?)<\/LongMessage>/.exec(body) || /<ShortMessage>([\s\S]*?)<\/ShortMessage>/.exec(body);
    const priority = Number(a.priority || 3);
    out.push({
      file: src.sourcepath ? pathEndingWith(ctx, src.sourcepath) || src.sourcepath : undefined,
      line: num(src.start),
      severity: priority <= 1 ? 'error' : priority === 2 ? 'warning' : 'info',
      message: msg ? decodeXml(msg[1]).trim() : a.type,
      rule: a.type,
    });
  }
  return out;
}

/** PMD XML (target/pmd.xml). */
function pmd(xml) {
  const out = [];
  const fileRe = /<file\b([^>]*)>([\s\S]*?)<\/file>/g;
  let f;
  while ((f = fileRe.exec(xml))) {
    const name = xmlAttrs(f[1]).name;
    const vRe = /<violation\b([^>]*)>([\s\S]*?)<\/violation>/g;
    let v;
    while ((v = vRe.exec(f[2]))) {
      const a = xmlAttrs(v[1]);
      const priority = Number(a.priority || 3);
      out.push({ file: name, line: num(a.beginline), column: num(a.begincolumn), severity: priority <= 2 ? 'error' : priority === 3 ? 'warning' : 'info', message: decodeXml(v[2]).trim(), rule: a.rule });
    }
  }
  return out;
}

/** Checkstyle XML (target/checkstyle-result.xml). */
function checkstyle(xml) {
  const out = [];
  const fileRe = /<file\b([^>]*)>([\s\S]*?)<\/file>/g;
  let f;
  while ((f = fileRe.exec(xml))) {
    const name = xmlAttrs(f[1]).name;
    const eRe = /<error\b([^>]*?)\/>/g;
    let e;
    while ((e = eRe.exec(f[2]))) {
      const a = xmlAttrs(e[1]);
      if (a.severity === 'ignore') continue;
      out.push({ file: name, line: num(a.line), column: num(a.column), severity: a.severity === 'error' ? 'error' : a.severity === 'warning' ? 'warning' : 'info', message: a.message, rule: a.source ? a.source.split('.').pop().replace(/Check$/, '') : undefined });
    }
  }
  return out;
}

/** jscpd JSON report: every clone becomes a finding on both of its sides, pointing at the other. */
function jscpd(text) {
  const data = JSON.parse(text);
  const out = [];
  for (const d of data.duplicates || []) {
    const a = d.firstFile; const b = d.secondFile;
    if (!a || !b) continue;
    const range = (f) => `${f.name}:${f.start}-${f.end}`;
    const mk = (self, other) => ({
      file: self.name, line: self.start, endLine: self.end, severity: 'error', rule: 'duplicate-code',
      message: `Duplicated code (${d.lines} lines) also at ${range(other)}. Extract a shared function/component/module and reuse it instead of copying.`,
    });
    out.push(mk(a, b), mk(b, a));
  }
  return out;
}

const reportParsers = { junit, spotbugs, pmd, checkstyle, sarif: (text) => sarif(text), jscpd };

module.exports.reportParsers = reportParsers;
