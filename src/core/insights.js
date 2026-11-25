'use strict';
/**
 * "Usage & insights": small pure parsers for numbers other tools already produce. Nothing here starts a process or opens a socket;
 * the window collects the raw output and these turn it into short sentences and numbers. Every parser returns null / empty for
 * input it does not understand: an insight that cannot be read is hidden, never guessed.
 */

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const pct = (v) => { const n = num(v); return n === null ? null : Math.max(0, Math.min(100, Math.round(n))); };

// ------------------------------------------------------------ Claude plan limits (from Claude Code's status-line JSON)
function limitOf(x) {
  if (!x || typeof x !== 'object') return null;
  const p = pct(x.used_percentage);
  if (p === null) return null;
  let r = num(x.resets_at);
  if (r !== null && r < 1e12) r *= 1000; // seconds -> ms
  return { pct: p, resetsAt: r };
}
/** @returns {{at:number, fiveHour:object|null, sevenDay:object|null, model:string, contextPct:number|null}|null} null when the JSON has no plan-limit numbers */
function snapshot(input, now = Date.now()) {
  const rl = input && input.rate_limits;
  const fiveHour = limitOf(rl && rl.five_hour); const sevenDay = limitOf(rl && rl.seven_day);
  if (!fiveHour && !sevenDay) return null;
  const cw = input.context_window || {};
  return { at: now, fiveHour, sevenDay, model: String((input.model && (input.model.display_name || input.model.id)) || '').slice(0, 60), contextPct: pct(cw.used_percentage) };
}
function statusLineText(input) {
  const s = snapshot(input, 0);
  const model = String((input && input.model && (input.model.display_name || input.model.id)) || '').slice(0, 40);
  if (!s) return model;
  return [model, s.fiveHour ? `5h ${s.fiveHour.pct}%` : '', s.sevenDay ? `7d ${s.sevenDay.pct}%` : ''].filter(Boolean).join(' · ');
}
const clock = (ms, now, tz) => {
  if (!ms) return '';
  const d = new Date(ms);
  const same = d.toDateString() === new Date(now).toDateString();
  const t = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: tz });
  return same ? t : `${d.toLocaleDateString([], { weekday: 'short', timeZone: tz })} ${t}`;
};
/** Plain-language lines for the window. A snapshot older than 6 h is called stale, not shown as current. */
function describeLimits(snap, now = Date.now(), tz) {
  if (!snap) return null;
  const stale = now - snap.at > 6 * 3600e3;
  const line = (label, l) => l && `${label}: ${l.pct}% used${l.resetsAt && l.resetsAt > now ? `, resets ${clock(l.resetsAt, now, tz)}` : ''}`;
  return { lines: [line('Last 5 hours', snap.fiveHour), line('Last 7 days', snap.sevenDay)].filter(Boolean), stale, warn: [snap.fiveHour, snap.sevenDay].some((l) => l && l.pct >= 85) && !stale, ageMs: now - snap.at };
}

// ------------------------------------------------------------ token / cost totals from the scorecard records
function totals(records, now = Date.now()) {
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const windows = { today: start.getTime(), week: now - 7 * 86400e3, month: now - 30 * 86400e3 };
  const out = {};
  for (const [k, since] of Object.entries(windows)) {
    const rs = (records || []).filter((r) => r.at >= since);
    const cost = rs.reduce((a, r) => a + (Number(r.costUsd) || 0), 0);
    out[k] = { runs: rs.length, tokens: rs.reduce((a, r) => a + (Number(r.tokens) || 0), 0), costUsd: cost, localRuns: rs.filter((r) => r.local).length, unknownCost: rs.filter((r) => !r.local && !(Number(r.costUsd) > 0)).length };
  }
  return out;
}
/** Active working time per kind of task over the last 30 days (agents' own busy time, not wall-clock). */
function timeByKind(records, now = Date.now()) {
  const m = new Map();
  for (const r of records || []) {
    if (r.at < now - 30 * 86400e3 || !(Number(r.activeMs) > 0)) continue;
    const c = m.get(r.kind) || { kind: r.kind, runs: 0, ms: 0 }; c.runs++; c.ms += Number(r.activeMs); m.set(r.kind, c);
  }
  return [...m.values()].sort((a, b) => b.ms - a.ms).map((c) => ({ ...c, avgMs: Math.round(c.ms / c.runs) }));
}

// ------------------------------------------------------------ local model health (Ollama /api/ps via ollama.status().loaded)
const GB = 1024 ** 3;
function modelHealth(loaded) {
  return (loaded || []).filter((m) => m && m.name).map((m) => {
    const size = Number(m.size) || 0; const vram = Number(m.sizeVram) || 0;
    const onGpu = size > 0 ? Math.round((Math.min(vram, size) / size) * 100) : null;
    let verdict = 'ok'; let text = `${(size / GB).toFixed(1)} GB in memory${m.context ? `, ${m.context} tokens of context` : ''}`;
    if (onGpu !== null && onGpu < 100) { verdict = onGpu < 50 ? 'bad' : 'warn'; text += `. Only ${onGpu}% fits on the GPU; the rest runs on the CPU, which is much slower. A smaller model or a shorter context helps.`; }
    return { name: m.name, sizeGb: Math.round((size / GB) * 10) / 10, onGpuPct: onGpu, context: m.context || 0, expiresAt: m.expiresAt || null, verdict, text };
  });
}

// ------------------------------------------------------------ test coverage files -> Map(file -> {covered:number[], missed:number[]})
const addLine = (map, file, line, hits) => {
  if (!file || !(line > 0)) return;
  const e = map.get(file) || { covered: new Set(), missed: new Set() };
  (hits > 0 ? e.covered : e.missed).add(line);
  map.set(file, e);
};
function parseLcov(text) {
  const map = new Map(); let file = '';
  for (const l of String(text).split(/\r?\n/)) {
    if (l.startsWith('SF:')) file = l.slice(3).trim();
    else if (l.startsWith('DA:')) { const [n, h] = l.slice(3).split(','); addLine(map, file, Number(n), Number(h)); }
    else if (l === 'end_of_record') file = '';
  }
  return map;
}
/** JaCoCo XML: <package name="a/b"><sourcefile name="X.java"><line nr="3" mi="0" ci="2"/> ... */
function parseJacoco(xml) {
  const map = new Map();
  for (const pk of String(xml).matchAll(/<package name="([^"]*)">([\s\S]*?)<\/package>/g)) {
    for (const sf of pk[2].matchAll(/<sourcefile name="([^"]+)">([\s\S]*?)<\/sourcefile>/g)) {
      const file = `${pk[1] ? `${pk[1]}/` : ''}${sf[1]}`;
      for (const l of sf[2].matchAll(/<line nr="(\d+)"[^>]*?\bmi="(\d+)"[^>]*?\bci="(\d+)"/g)) addLine(map, file, Number(l[1]), Number(l[3]) > 0 ? 1 : 0);
    }
  }
  return map;
}
/** Cobertura XML (coverage.py `coverage xml`, many others): <class filename="a.py"><line number="3" hits="1"/> */
function parseCobertura(xml) {
  const map = new Map();
  for (const c of String(xml).matchAll(/<class [^>]*?filename="([^"]+)"[^>]*>([\s\S]*?)<\/class>/g)) {
    for (const l of c[2].matchAll(/<line number="(\d+)"[^>]*?\bhits="(\d+)"/g)) addLine(map, c[1], Number(l[1]), Number(l[2]));
  }
  return map;
}
function parseCoverage(text) {
  const t = String(text || '');
  if (/^SF:/m.test(t)) return parseLcov(t);
  if (/<report\b[^>]*>/.test(t) && /<sourcefile\b/.test(t)) return parseJacoco(t);
  if (/<coverage\b/.test(t) && /<class\b/.test(t)) return parseCobertura(t);
  return new Map();
}
/** Find the entry for a project file: coverage files hold relative or absolute paths, JaCoCo only package + file name. */
function coverageFor(map, rel) {
  const r = String(rel).replace(/\\/g, '/');
  let best = null; let bestLen = 0;
  for (const [f, v] of map) {
    const ff = f.replace(/\\/g, '/');
    if ((r === ff || r.endsWith(`/${ff}`) || ff.endsWith(`/${r}`)) && ff.length > bestLen) { best = v; bestLen = ff.length; }
  }
  if (!best) return null;
  const covered = [...best.covered].sort((a, b) => a - b); const missed = [...best.missed].filter((n) => !best.covered.has(n)).sort((a, b) => a - b);
  const total = covered.length + missed.length;
  return { covered, missed, pct: total ? Math.round((covered.length / total) * 100) : null };
}
const COVERAGE_FILES = ['coverage/lcov.info', 'lcov.info', 'target/site/jacoco/jacoco.xml', 'build/reports/jacoco/test/jacocoTestReport.xml', 'coverage.xml', 'build/reports/jacoco/jacocoTestReport.xml'];

// ------------------------------------------------------------ SonarCloud quality gate
function sonarUrl(projectKey, { branch, pullRequest, host = 'https://sonarcloud.io' } = {}) {
  const q = new URLSearchParams({ projectKey: String(projectKey) });
  if (pullRequest) q.set('pullRequest', String(pullRequest)); else if (branch) q.set('branch', String(branch));
  return `${host.replace(/\/$/, '')}/api/qualitygates/project_status?${q}`;
}
function parseSonarGate(json) {
  const ps = json && json.projectStatus;
  if (!ps || !ps.status) return null;
  const failing = (ps.conditions || []).filter((c) => c.status === 'ERROR' || c.status === 'WARN').map((c) => ({ metric: c.metricKey, status: c.status, actual: c.actualValue, threshold: c.errorThreshold }));
  return { status: ps.status, ok: ps.status === 'OK', failing, text: ps.status === 'OK' ? 'Quality gate passed.' : `Quality gate ${ps.status === 'ERROR' ? 'failed' : String(ps.status).toLowerCase()}: ${failing.map((f) => f.metric.replace(/_/g, ' ')).join(', ') || 'see SonarCloud'}.` };
}

// ------------------------------------------------------------ dependency problems
function parseNpmAudit(json) {
  const v = json && json.metadata && json.metadata.vulnerabilities;
  if (!v) return null;
  const c = { critical: v.critical || 0, high: v.high || 0, moderate: v.moderate || 0, low: v.low || 0 };
  const total = c.critical + c.high + c.moderate + c.low;
  return { ...c, total, text: total ? `${total} known problem${total === 1 ? '' : 's'} in dependencies (${c.critical} critical, ${c.high} high, ${c.moderate} moderate, ${c.low} low).` : 'No known problems in dependencies.' };
}
/** `gh api repos/{owner}/{repo}/dependabot/alerts?state=open` */
function parseDependabot(json) {
  if (!Array.isArray(json)) return null;
  const c = { critical: 0, high: 0, moderate: 0, low: 0 };
  for (const a of json) { const s = String((a.security_advisory && a.security_advisory.severity) || (a.security_vulnerability && a.security_vulnerability.severity) || '').toLowerCase(); if (s in c) c[s]++; }
  const total = json.length;
  return { ...c, total, text: total ? `${total} open Dependabot alert${total === 1 ? '' : 's'} (${c.critical} critical, ${c.high} high).` : 'No open Dependabot alerts.' };
}

// ------------------------------------------------------------ Maven dependencies (pom.xml) + OSV.dev vulnerability lookup
/** Dependencies declared directly in pom.xml - not dependencyManagement, which only sets defaults/bounds for a
 *  parent pom and is not itself "what this project depends on". `${...}` property references are resolved
 *  against <properties> when possible (e.g. ${spring.version}); left as the raw literal otherwise. */
function parseMavenDeps(xml) {
  const text = String(xml || '').replace(/<dependencyManagement>[\s\S]*?<\/dependencyManagement>/g, '');
  const props = {};
  const propsBlock = /<properties>([\s\S]*?)<\/properties>/.exec(text);
  if (propsBlock) for (const m of propsBlock[1].matchAll(/<([\w.-]+)>([^<]*)<\/\1>/g)) props[m[1]] = m[2].trim();
  const resolve = (v) => { const m = /^\$\{([\w.-]+)\}$/.exec(String(v || '').trim()); return m ? (props[m[1]] || v) : v; };
  const out = [];
  for (const d of text.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)) {
    const body = d[1];
    const field = (name) => { const m = new RegExp(`<${name}>([^<]*)<\\/${name}>`).exec(body); return m ? m[1].trim() : ''; };
    const groupId = field('groupId'); const artifactId = field('artifactId');
    if (!groupId || !artifactId) continue;
    out.push({ groupId, artifactId, version: resolve(field('version')), scope: field('scope') || 'compile', name: `${groupId}:${artifactId}` });
  }
  return out;
}
/** Gradle's version catalog (gradle/libs.versions.toml): the [versions] and [libraries] tables only - a narrow,
 *  hand-rolled subset matching this project's existing TOML reader (core/agentconfig.js's parseTomlTables), not
 *  a general TOML parser; [bundles]/[plugins] are not dependencies for vulnerability scanning and are not read.
 *  A library entry is either the shorthand string form (`alias = "group:artifact:version"`) or an inline table
 *  (`alias = { module = "group:artifact", version.ref = "key" }` or `{ group = "..", name = "..", version = ".." }`).
 *  @returns {Map<string, {groupId, artifactId, version}>} keyed by the alias with every `-`/`_`/`.` separator
 *           stripped and lowercased, so it matches however build.gradle's `libs.*` accessor spells it (Gradle
 *           itself builds that accessor the same way, from whichever separator the alias happens to use).
 */
function parseVersionCatalog(text) {
  const versions = new Map();
  const libraries = new Map();
  const normalize = (k) => k.toLowerCase().replace(/[-_.]/g, '');
  let section = '';
  for (const rawLine of String(text || '').split('\n')) {
    const line = rawLine.replace(/#.*/, '').trim();
    if (!line) continue;
    const header = /^\[(\w+)\]$/.exec(line);
    if (header) { section = header[1]; continue; }
    const kv = /^([\w.-]+)\s*=\s*(.+)$/.exec(line);
    if (!kv) continue;
    const [, key, rawValue] = kv;
    const value = rawValue.trim();
    if (section === 'versions') {
      const m = /^"([^"]*)"$/.exec(value);
      if (m) versions.set(key, m[1]);
    } else if (section === 'libraries') {
      const str = /^"([^"]*)"$/.exec(value);
      if (str) {
        const [groupId, artifactId, version] = str[1].split(':');
        if (groupId && artifactId) libraries.set(normalize(key), { groupId, artifactId, version: version || '' });
        continue;
      }
      const inline = /^\{([\s\S]*)\}$/.exec(value);
      if (!inline) continue;
      const body = inline[1];
      const field = (name) => { const f = new RegExp(`(?:^|[,{])\\s*${name}\\s*=\\s*"([^"]*)"`).exec(body); return f ? f[1] : ''; };
      let groupId = field('group'); let artifactId = field('name');
      if (!groupId || !artifactId) { const [g, a] = field('module').split(':'); groupId = groupId || g; artifactId = artifactId || a; }
      if (!groupId || !artifactId) continue;
      const versionRef = field('version.ref');
      libraries.set(normalize(key), { groupId, artifactId, version: versionRef ? (versions.get(versionRef) || '') : field('version') });
    }
  }
  return libraries;
}
/** Dependencies declared in build.gradle/build.gradle.kts: the dominant single-GAV-coordinate-string form
 *  (`implementation 'group:artifact:version'` Groovy, `implementation("group:artifact:version")` Kotlin),
 *  Groovy's named-argument map-style form (`implementation group: '..', name: '..', version: '..'`, any
 *  argument order - real-world files use all three forms interchangeably), and a version-catalog reference
 *  (`implementation(libs.foo.bar)`) resolved against `catalog` (parseVersionCatalog's return value; omit it and
 *  catalog references are simply skipped, same graceful-degradation as every other optional-input gate here). */
function parseGradleDeps(text, catalog = null) {
  const configs = 'implementation|api|compileOnly|runtimeOnly|testImplementation|testRuntimeOnly|compile|testCompile';
  const src = String(text || '');
  const out = [];
  const re = new RegExp(`^\\s*(${configs})\\s*[(]?\\s*['"]([^'"]+)['"]`, 'gm');
  for (const m of src.matchAll(re)) {
    const [groupId, artifactId, ...rest] = m[2].split(':');
    if (!groupId || !artifactId) continue;
    out.push({ groupId, artifactId, version: rest.join(':') || '', scope: m[1], name: `${groupId}:${artifactId}` });
  }
  const reMap = new RegExp(`^\\s*(${configs})\\s*[(]?\\s*([^\\n]*)$`, 'gm');
  for (const m of src.matchAll(reMap)) {
    const rest = m[2];
    if (!/\bgroup\s*:/.test(rest) || !/\bname\s*:/.test(rest)) continue; // map-style only - any argument order
    const field = (name) => { const f = new RegExp(`\\b${name}\\s*:\\s*['"]([^'"]*)['"]`).exec(rest); return f ? f[1] : ''; };
    const groupId = field('group'); const artifactId = field('name');
    if (!groupId || !artifactId) continue;
    out.push({ groupId, artifactId, version: field('version'), scope: m[1], name: `${groupId}:${artifactId}` });
  }
  if (catalog && catalog.size) {
    const reCat = new RegExp(`^\\s*(${configs})\\s*[(]?\\s*libs((?:\\.[A-Za-z][\\w]*)+)`, 'gm');
    for (const m of src.matchAll(reCat)) {
      const key = m[2].split('.').filter(Boolean).join('').toLowerCase();
      const lib = catalog.get(key);
      if (!lib) continue;
      out.push({ groupId: lib.groupId, artifactId: lib.artifactId, version: lib.version, scope: m[1], name: `${lib.groupId}:${lib.artifactId}` });
    }
  }
  return out;
}
/** Request body for OSV.dev's free, keyless batch vulnerability lookup (POST /v1/querybatch). A dependency with
 *  no resolved version (an unresolvable ${property}, or none declared - inherited from a parent/BOM) is skipped;
 *  OSV needs an exact version to match against. */
function osvBatchBody(deps) {
  return { queries: deps.filter((d) => d.version && !/^\$\{/.test(d.version)).map((d) => ({ package: { name: d.name, ecosystem: 'Maven' }, version: d.version })) };
}
/** Pairs each queried dependency (same filter/order as osvBatchBody) with the vuln ids OSV found for it.
 *  The batch endpoint only returns id + modified-date for speed; severity needs a separate GET /v1/vulns/{id}. */
function parseOsvBatch(json, deps) {
  const queried = deps.filter((d) => d.version && !/^\$\{/.test(d.version));
  const results = (json && json.results) || [];
  const out = [];
  queried.forEach((d, i) => { for (const v of (results[i] && results[i].vulns) || []) out.push({ dep: d, id: v.id }); });
  return out;
}
/** One OSV vuln record (GET /v1/vulns/{id}) -> a severity bucket. OSV normalizes almost nothing across sources;
 *  database_specific.severity (GHSA's own bucket) is the only field reliably in that shape, so anything else
 *  (a bare CVSS vector with no bucket, or a source that omits severity) is reported as 'unknown' rather than guessed. */
function parseOsvSeverity(json) {
  const s = String((json && json.database_specific && json.database_specific.severity) || '').toLowerCase();
  return ['critical', 'high', 'moderate', 'low'].includes(s) ? s : 'unknown';
}
/** Tally {dep, id, severity} hits into the same shape parseNpmAudit/parseDependabot already use. `label`
 *  names the build tool in the text (Maven dependencies / Gradle dependencies) - OSV.dev's own ecosystem
 *  for both is "Maven" regardless (it's about the registry, not the build tool), so osvBatchBody/
 *  parseOsvBatch/parseOsvSeverity need no label of their own. */
function summarizeOsv(hits, label = 'Maven') {
  const c = { critical: 0, high: 0, moderate: 0, low: 0, unknown: 0 };
  for (const h of hits) c[h.severity in c ? h.severity : 'unknown']++;
  const total = hits.length;
  const known = `${c.critical} critical, ${c.high} high, ${c.moderate} moderate, ${c.low} low${c.unknown ? `, ${c.unknown} unrated` : ''}`;
  return { ...c, total, hits, text: total ? `${total} known problem${total === 1 ? '' : 's'} in ${label} dependencies (OSV.dev: ${known}).` : `No known problems in ${label} dependencies (OSV.dev).` };
}

// ------------------------------------------------------------ Spring Actuator
function parseActuatorHealth(json) {
  if (!json || typeof json.status !== 'string') return null;
  const parts = Object.entries(json.components || {}).map(([name, c]) => ({ name, status: c && c.status ? String(c.status) : '?' }));
  const down = parts.filter((p) => p.status !== 'UP');
  return { status: json.status, up: json.status === 'UP', parts, text: json.status === 'UP' ? `The app is UP (${parts.length} component${parts.length === 1 ? '' : 's'} checked).` : `The app is ${json.status}${down.length ? `: ${down.map((d) => `${d.name} ${d.status}`).join(', ')}` : ''}.` };
}
const METRICS = [['jvm.memory.used', 'Memory used', 'bytes'], ['process.cpu.usage', 'CPU', 'ratio'], ['jvm.threads.live', 'Live threads', 'n'], ['http.server.requests', 'HTTP requests', 'n']];
function metricValue(json) {
  const m = json && Array.isArray(json.measurements) ? json.measurements : null;
  if (!m) return null;
  const pick = m.find((x) => x.statistic === 'VALUE') || m.find((x) => x.statistic === 'COUNT') || m[0];
  return pick ? num(pick.value) : null;
}
function formatMetric(kind, v) {
  if (v === null) return '?';
  if (kind === 'bytes') return `${(v / 1048576).toFixed(0)} MB`;
  if (kind === 'ratio') return `${(v * 100).toFixed(0)}%`;
  return String(Math.round(v));
}

module.exports = {
  snapshot, statusLineText, describeLimits, totals, timeByKind, modelHealth, parseCoverage, parseLcov, parseJacoco, parseCobertura, coverageFor, COVERAGE_FILES,
  sonarUrl, parseSonarGate, parseNpmAudit, parseDependabot, parseMavenDeps, parseGradleDeps, parseVersionCatalog, osvBatchBody, parseOsvBatch, parseOsvSeverity, summarizeOsv, parseActuatorHealth, metricValue, formatMetric, METRICS,
};
