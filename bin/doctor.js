#!/usr/bin/env node
'use strict';
/**
 * Checks the machine for the tools Bazinga uses:   npm run doctor        (add --json for machine-readable output)
 * Exit code 1 when a required tool is missing.
 */
const { execFile } = require('node:child_process');
const { runDoctor, formatReport } = require('../src/core/doctor');

const gitIdentity = () => new Promise((resolve) => {
  const get = (key) => new Promise((r) => execFile('git', ['config', '--get', key], { windowsHide: true }, (e, out) => r(e ? '' : String(out).trim())));
  Promise.all([get('user.name'), get('user.email')]).then(([name, email]) => resolve({ name, email }));
});

runDoctor({ gitIdentity }).then((report) => {
  console.log(process.argv.includes('--json') ? JSON.stringify(report, null, 2) : formatReport(report));
  process.exit(report.ok ? 0 : 1);
}, (err) => { console.error(err.message); process.exit(2); });
