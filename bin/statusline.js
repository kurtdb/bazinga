#!/usr/bin/env node
'use strict';
/**
 * Claude Code status-line command (opt-in: Settings → insights.claudeLimits). Claude Code pipes a JSON object to it;
 * it keeps the plan-limit part for Bazinga's "Usage & insights" window and prints a short line for Claude Code's own status bar.
 * Usage: node statusline.js <output file>
 */
const fs = require('node:fs');
const path = require('node:path');
const { statusLineText, snapshot } = require('../src/core/insights');

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { raw += d; });
process.stdin.on('end', () => {
  let input = {};
  try { input = JSON.parse(raw || '{}'); } catch { /* print nothing useful */ }
  const out = process.argv[2];
  const snap = snapshot(input, Date.now());
  if (out && snap) {
    try { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(`${out}.tmp`, JSON.stringify(snap)); fs.renameSync(`${out}.tmp`, out); } catch { /* never break the status line */ }
  }
  process.stdout.write(`${statusLineText(input)}\n`);
});
