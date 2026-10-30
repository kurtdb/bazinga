'use strict';
/**
 * Turns the output of a test run (node --test, pytest, vitest, jest, Maven, Gradle, go test, cargo test, dotnet test) into one honest verdict.
 * The important rule: "exit code 0 but zero tests ran" is NOT a pass, because that is what a mistyped name filter looks like.
 */
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const strip = (s) => String(s || '').replace(ANSI, '');
const num = (m, i = 1) => (m ? Number(m[i]) : 0);

/** @returns {{passed:number, failed:number, skipped:number, total:number}|null} counts, or null when the output has no summary we know */
function parseCounts(text) {
  let m;
  // node:test (TAP-ish summary lines)
  if ((m = /^# tests (\d+)/m.exec(text))) {
    return { total: num(m), passed: num(/^# pass (\d+)/m.exec(text)), failed: num(/^# fail (\d+)/m.exec(text)), skipped: num(/^# skipped (\d+)/m.exec(text)) };
  }
  // node:test default spec reporter
  if ((m = /^ℹ tests (\d+)/m.exec(text))) {
    return { total: num(m), passed: num(/^ℹ pass (\d+)/m.exec(text)), failed: num(/^ℹ fail (\d+)/m.exec(text)), skipped: num(/^ℹ skipped (\d+)/m.exec(text)) };
  }
  // Maven surefire: last "Tests run: N, Failures: F, Errors: E, Skipped: S"
  const mvn = [...text.matchAll(/Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)/g)];
  if (mvn.length) {
    const l = mvn[mvn.length - 1];
    const total = Number(l[1]); const failed = Number(l[2]) + Number(l[3]); const skipped = Number(l[4]);
    return { total, failed, skipped, passed: Math.max(0, total - failed - skipped) };
  }
  // jest: "Tests:       1 failed, 2 passed, 3 total"; vitest: "Tests  1 failed | 2 passed (3)"
  if ((m = /^\s*Tests:\s+(.*)$/m.exec(text)) || (m = /^\s*Tests\s{2,}(.*)$/m.exec(text))) {
    const line = m[1];
    const get = (w) => num(new RegExp(`(\\d+) ${w}`).exec(line));
    const failed = get('failed'); const passed = get('passed'); const skipped = get('skipped') + get('todo');
    const total = num(/(\d+) total/.exec(line)) || num(/\((\d+)\)/.exec(line)) || failed + passed + skipped;
    return { total, passed, failed, skipped };
  }
  // pytest: "=== 1 failed, 2 passed, 1 skipped in 0.12s ===" or "2 passed in 0.01s"
  const py = [...text.matchAll(/^=*\s*((?:\d+ (?:passed|failed|skipped|errors?|xfailed|xpassed|deselected|warnings?)(?:, )?)+) in [\d.]+s/gm)];
  if (py.length) {
    const line = py[py.length - 1][1];
    const get = (w) => num(new RegExp(`(\\d+) ${w}`).exec(line));
    const failed = get('failed') + get('errors?'); const passed = get('passed'); const skipped = get('skipped');
    return { total: failed + passed + skipped, passed, failed, skipped };
  }
  // go test -v: "--- PASS: Test" / "--- FAIL: Test" / "--- SKIP: Test" per test; a -run filter matching nothing
  // still exits 0 with no such lines at all, flagged instead by its own "[no tests to run]" marker.
  const goLines = [...text.matchAll(/^--- (PASS|FAIL|SKIP): /gm)];
  if (goLines.length) {
    const passed = goLines.filter((m) => m[1] === 'PASS').length;
    const failed = goLines.filter((m) => m[1] === 'FAIL').length;
    const skipped = goLines.filter((m) => m[1] === 'SKIP').length;
    return { total: passed + failed + skipped, passed, failed, skipped };
  }
  if (/\[no tests to run\]/.test(text)) return { total: 0, passed: 0, failed: 0, skipped: 0 };
  // cargo test: last "test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; ..."
  const cargo = [...text.matchAll(/test result: \w+\. (\d+) passed; (\d+) failed; (\d+) ignored; \d+ measured; \d+ filtered out/g)];
  if (cargo.length) {
    const l = cargo[cargo.length - 1];
    const passed = num(l, 1); const failed = num(l, 2); const skipped = num(l, 3);
    return { total: passed + failed + skipped, passed, failed, skipped };
  }
  // dotnet test (VSTest console runner): last "Failed: 0, Passed: 3, Skipped: 0, Total: 3, Duration: ..."
  const net = [...text.matchAll(/Failed:\s*(\d+),\s*Passed:\s*(\d+),\s*Skipped:\s*(\d+),\s*Total:\s*(\d+)/g)];
  if (net.length) {
    const l = net[net.length - 1];
    return { failed: num(l, 1), passed: num(l, 2), skipped: num(l, 3), total: num(l, 4) };
  }
  if (/no tests ran/i.test(text)) return { total: 0, passed: 0, failed: 0, skipped: 0 };
  return null;
}

/**
 * @param r {code:number, stdout:string, stderr:string, timedOut?:boolean, cancelled?:boolean}
 * @returns {{status:'passed'|'failed'|'notfound'|'unavailable'|'timeout'|'cancelled', headline:string, counts:object|null, output:string}}
 */
function summarize(r) {
  const output = strip(`${r.stdout || ''}\n${r.stderr || ''}`).split('\n').map((l) => l.replace(/\s+$/, '')).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (r.cancelled) return { status: 'cancelled', headline: 'Cancelled', counts: null, output };
  if (r.timedOut) return { status: 'timeout', headline: 'Timed out', counts: null, output };
  if (r.code === 127 || /command not found|is not recognized as an internal or external command|is not recognized as the name of a cmdlet|No module named pytest|could not determine executable|ENOENT/i.test(output) && r.code !== 0 && !parseCounts(output)) {
    return { status: 'unavailable', headline: 'The test runner could not be started. Is it installed? (see the output)', counts: null, output };
  }
  const counts = parseCounts(output);
  if (counts && counts.total === 0) return { status: 'notfound', headline: 'No test ran. The name filter matched nothing, so this is not a pass.', counts, output };
  if (/No tests found|no tests collected|no test files found/i.test(output) && r.code !== 0) return { status: 'notfound', headline: 'No test ran. The runner found nothing to run.', counts, output };
  if (r.code === 0) {
    const c = counts;
    return { status: 'passed', counts: c, output, headline: c ? `${c.passed} passed${c.skipped ? `, ${c.skipped} skipped` : ''}` : 'Passed' };
  }
  const c = counts;
  return { status: 'failed', counts: c, output, headline: c && c.failed ? `${c.failed} failed${c.passed ? `, ${c.passed} passed` : ''}` : `Failed (exit code ${r.code})` };
}

module.exports = { summarize, parseCounts, strip };
