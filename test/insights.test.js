'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const I = require('../src/core/insights');

test('plan limits: read from rate_limits, seconds become ms, missing fields mean "nothing to show"', () => {
  const s = I.snapshot({ model: { display_name: 'Sonnet' }, rate_limits: { five_hour: { used_percentage: 41.6, resets_at: 1800000000 }, seven_day: { used_percentage: 61 } } }, 5);
  assert.equal(s.fiveHour.pct, 42);
  assert.equal(s.fiveHour.resetsAt, 1800000000000);
  assert.equal(s.sevenDay.resetsAt, null);
  assert.equal(I.snapshot({ model: 'x' }), null);
  assert.equal(I.snapshot({ rate_limits: { five_hour: { used_percentage: 'abc' } } }), null);
  assert.equal(I.statusLineText({ model: { display_name: 'Sonnet' } }), 'Sonnet');
  assert.match(I.statusLineText({ model: { display_name: 'Sonnet' }, rate_limits: { five_hour: { used_percentage: 10 } } }), /Sonnet · 5h 10%/);
});
test('plan limits: an old snapshot is stale and never raises a warning; 85 % does', () => {
  const now = 10_000_000_000;
  const snap = { at: now - 60_000, fiveHour: { pct: 90, resetsAt: now + 3600e3 }, sevenDay: { pct: 10, resetsAt: null } };
  assert.equal(I.describeLimits(snap, now).warn, true);
  assert.match(I.describeLimits(snap, now).lines[0], /90% used, resets/);
  const old = I.describeLimits({ ...snap, at: now - 7 * 3600e3 }, now);
  assert.equal(old.stale, true);
  assert.equal(old.warn, false);
});
test('the status-line script writes the snapshot file and prints a line (real process)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-'));
  const out = path.join(dir, 'sub', 'limits.json');
  const r = spawnSync(process.execPath, [path.join(__dirname, '../bin/statusline.js'), out], { input: JSON.stringify({ model: { display_name: 'M' }, rate_limits: { five_hour: { used_percentage: 7 } } }), encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /M · 5h 7%/);
  assert.equal(JSON.parse(fs.readFileSync(out, 'utf8')).fiveHour.pct, 7);
  const bad = spawnSync(process.execPath, [path.join(__dirname, '../bin/statusline.js'), out], { input: 'not json', encoding: 'utf8' });
  assert.equal(bad.status, 0);
});
test('totals and time per kind', () => {
  const now = new Date(2026, 9, 20, 15, 0, 0).getTime();
  const recs = [
    { at: now - 3600e3, tokens: 100, costUsd: 0.5, local: false, kind: 'bugfix', activeMs: 60000 },
    { at: now - 2 * 86400e3, tokens: 50, costUsd: 0, local: true, kind: 'bugfix', activeMs: 30000 },
    { at: now - 2 * 86400e3, tokens: 10, costUsd: 0, local: false, kind: 'tests', activeMs: 0 },
    { at: now - 40 * 86400e3, tokens: 999, costUsd: 9, local: false, kind: 'tests', activeMs: 5000 },
  ];
  const t = I.totals(recs, now);
  assert.equal(t.today.runs, 1);
  assert.equal(t.week.tokens, 160);
  assert.equal(t.week.localRuns, 1);
  assert.equal(t.week.unknownCost, 1);
  assert.equal(t.month.runs, 3);
  const k = I.timeByKind(recs, now);
  assert.deepEqual(k.map((x) => [x.kind, x.runs, x.avgMs]), [['bugfix', 2, 45000]]);
});
test('model health: a model that does not fit on the GPU is called out', () => {
  const G = 1024 ** 3;
  const [a, b, c] = I.modelHealth([{ name: 'a', size: 8 * G, sizeVram: 8 * G, context: 32768 }, { name: 'b', size: 20 * G, sizeVram: 14 * G }, { name: 'c', size: 20 * G, sizeVram: 2 * G }, { name: '' }]);
  assert.equal(a.verdict, 'ok');
  assert.equal(b.verdict, 'warn');
  assert.equal(b.onGpuPct, 70);
  assert.equal(c.verdict, 'bad');
  assert.match(b.text, /CPU/);
  assert.deepEqual(I.modelHealth(undefined), []);
});
test('coverage: lcov, JaCoCo and Cobertura are read; a line is covered if any instruction/hit covers it', () => {
  const lcov = 'SF:src/a.js\nDA:1,3\nDA:2,0\nend_of_record\nSF:src/b.js\nDA:1,0\nend_of_record\n';
  const m = I.parseCoverage(lcov);
  assert.deepEqual(I.coverageFor(m, 'src/a.js'), { covered: [1], missed: [2], pct: 50 });
  assert.equal(I.coverageFor(m, '/abs/project/src/a.js').pct, 50);
  assert.equal(I.coverageFor(m, 'src/none.js'), null);
  const jac = '<report name="x"><package name="com/acme"><sourcefile name="Foo.java"><line nr="3" mi="0" ci="2" mb="0" cb="0"/><line nr="4" mi="2" ci="0"/></sourcefile></package></report>';
  assert.deepEqual(I.coverageFor(I.parseCoverage(jac), 'src/main/java/com/acme/Foo.java'), { covered: [3], missed: [4], pct: 50 });
  const cob = '<coverage><packages><package><classes><class name="t" filename="pkg/t.py"><lines><line number="1" hits="1"/><line number="2" hits="0"/></lines></class></classes></package></packages></coverage>';
  assert.equal(I.coverageFor(I.parseCoverage(cob), 'pkg/t.py').missed[0], 2);
  assert.equal(I.parseCoverage('hello').size, 0);
});
test('REGRESSION shape: coverage of "Foo.java" must not match "BarFoo.java"', () => {
  const m = I.parseCoverage('<report><package name="p"><sourcefile name="BarFoo.java"><line nr="1" mi="0" ci="1"/></sourcefile></package></report>');
  assert.equal(I.coverageFor(m, 'src/p/Foo.java'), null);
});
test('Sonar gate url and verdict', () => {
  assert.equal(I.sonarUrl('org_proj', { pullRequest: 12 }), 'https://sonarcloud.io/api/qualitygates/project_status?projectKey=org_proj&pullRequest=12');
  assert.match(I.sonarUrl('a b', { branch: 'feat/x' }), /projectKey=a\+b&branch=feat%2Fx/);
  const g = I.parseSonarGate({ projectStatus: { status: 'ERROR', conditions: [{ status: 'ERROR', metricKey: 'new_coverage', actualValue: '40', errorThreshold: '80' }, { status: 'OK', metricKey: 'x' }] } });
  assert.equal(g.ok, false);
  assert.match(g.text, /failed: new coverage/);
  assert.equal(I.parseSonarGate({ projectStatus: { status: 'OK', conditions: [] } }).ok, true);
  assert.equal(I.parseSonarGate({ errors: [{ msg: 'Insufficient privileges' }] }), null);
});
test('dependency problems: npm audit and Dependabot', () => {
  assert.equal(I.parseNpmAudit({ metadata: { vulnerabilities: { critical: 1, high: 2, moderate: 0, low: 1, total: 4 } } }).total, 4);
  assert.match(I.parseNpmAudit({ metadata: { vulnerabilities: { critical: 0, high: 0, moderate: 0, low: 0 } } }).text, /No known/);
  assert.equal(I.parseNpmAudit({ error: {} }), null);
  const d = I.parseDependabot([{ security_advisory: { severity: 'high' } }, { security_vulnerability: { severity: 'low' } }]);
  assert.equal(d.high, 1);
  assert.equal(d.total, 2);
  assert.equal(I.parseDependabot({ message: 'Not Found' }), null);
});
test('Actuator health and metrics', () => {
  const h = I.parseActuatorHealth({ status: 'DOWN', components: { db: { status: 'DOWN' }, ping: { status: 'UP' } } });
  assert.equal(h.up, false);
  assert.match(h.text, /db DOWN/);
  assert.equal(I.parseActuatorHealth({ foo: 1 }), null);
  assert.equal(I.metricValue({ measurements: [{ statistic: 'VALUE', value: 5 }] }), 5);
  assert.equal(I.metricValue({}), null);
  assert.equal(I.formatMetric('bytes', 209715200), '200 MB');
  assert.equal(I.formatMetric('ratio', 0.456), '46%');
  assert.equal(I.formatMetric('n', null), '?');
});
test('REGRESSION: main.js must not shadow the module-level readJson inside registerIpc (it broke session:get and the whole app start)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/main/main.js'), 'utf8');
  assert.equal((src.match(/^\s+(const|let|var)\s+readJson\s*=/gm) || []).length, 0);
  assert.equal((src.match(/^function readJson\(/gm) || []).length, 1);
});
