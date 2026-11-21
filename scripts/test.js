#!/usr/bin/env node
'use strict';
/**
 * `npm test` entry point. Node's test runner isolates each *.test.js file in its own child process by
 * default, so a plain `node --require ./test/tmpcleanup.js --test ...` would only patch fs.mkdtempSync in
 * the orchestrating process, not in the child processes that actually create the throw-away directories.
 * NODE_OPTIONS is inherited by child processes Node spawns, so the preload reaches them from here - but only
 * when the test files are passed explicitly; handing `--test` a glob pattern string instead (as the plain
 * `node --test "test/**\/*.test.js"` command used to) makes Node re-exec itself for glob expansion in a way
 * that does not forward NODE_OPTIONS to the actual per-file test processes. So the glob is expanded here.
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const testDir = path.join(__dirname, '..', 'test');
function collect(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...collect(full));
    else if (entry.isFile() && entry.name.endsWith('.test.js')) files.push(full);
  }
  return files;
}
const testFiles = collect(testDir).sort();

const preload = path.join(testDir, 'tmpcleanup.js');
const nodeOptions = [process.env.NODE_OPTIONS, `--require ${preload}`].filter(Boolean).join(' ');

// A hung test (waiting on a connection/event that will never arrive) used to block the whole run forever
// instead of failing - this caps any single test at 8 minutes, so a hang fails fast with the test's own name
// in the output instead of silently consuming CI minutes until GitHub's own multi-hour job timeout kicks in.
// 8 minutes, not 1: checks.test.js's real-toolchain end-to-end test needs real room on a CI runner that
// actually has Go/Rust/.NET/Java/Maven/Gradle installed (a plain dev machine without them just skips fast) -
// 240000 (4 min) was still not enough on the Windows runner specifically (Ubuntu/macOS both fit in that).
const result = spawnSync(process.execPath, ['--test', '--test-timeout=480000', ...testFiles], {
  stdio: 'inherit',
  env: { ...process.env, NODE_OPTIONS: nodeOptions },
});
process.exit(result.status === null ? 1 : result.status);
