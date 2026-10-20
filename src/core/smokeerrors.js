'use strict';
/**
 * Errors the smoke test sees in the page. One kind is environmental: when the machine is busy, Monaco's web worker script
 * sometimes fails to load ("importScripts ... editor.worker-xxxx.js failed to load"). The editor then runs that work on the
 * main thread and every step still passes, but the page reports an uncaught error. It is listed as a warning, not a failure.
 * Anything else stays fatal.
 */
const TRANSIENT = [/Failed to execute 'importScripts' on 'WorkerGlobalScope'.*(?:editor|textMate|json|css|html|ts)[\w.-]*worker[\w.-]*\.js.*failed to load/i];

function classify(errors) {
  const fatal = []; const transient = [];
  for (const e of errors || []) (TRANSIENT.some((re) => re.test(String(e))) ? transient : fatal).push(String(e));
  return { fatal, transient };
}

/** The report of one smoke run -> the report with transient errors moved to `warnings`, and `ok` recomputed. */
function apply(report) {
  const { fatal, transient } = classify(report.errors);
  const stepsOk = Object.values(report.steps || {}).every((v) => v === 'ok');
  return { ...report, errors: fatal, warnings: transient, ok: fatal.length === 0 && stepsOk && (report.ok || transient.length > 0) };
}

module.exports = { classify, apply, TRANSIENT };
