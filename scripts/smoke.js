#!/usr/bin/env node
'use strict';
/**
 * End-to-end smoke test: launches the real Electron app against a throw-away git repo and checks that
 * Monaco, xterm, the file tree, the terminal (pty) and the quality-gate pipeline all work.
 *   npm run smoke
 * On Linux without a display it uses xvfb-run when available.
 */
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const electronPath = process.env.BAZINGA_BIN || require('electron');
const appDir = path.join(__dirname, '..');

function git(cwd, ...args) { execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, stdio: 'ignore' }); }

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'bazinga-smoke-'));
git(fixture, 'init', '-q');
fs.writeFileSync(path.join(fixture, 'a.py'), 'print("v1")\n');
fs.writeFileSync(path.join(fixture, 'README.md'), '# demo\n');
fs.writeFileSync(path.join(fixture, 'b.py'), 'one\ntwo\nthree\n');
fs.mkdirSync(path.join(fixture, 'tests'));
fs.writeFileSync(path.join(fixture, 'tests', 'test_x.py'), 'def test_x():\n    assert 1 == 1\n');
fs.writeFileSync(path.join(fixture, 'util.py'), 'def helper(x):\n    return x\n\n\nclass Box:\n    def open(self):\n        return helper(1)\n');
fs.writeFileSync(path.join(fixture, 'calls.py'), 'from util import helper\nhelper(1)\nhelper(2)\n');
// a Spring Boot module for the Build-and-run section
fs.mkdirSync(path.join(fixture, 'svc', 'src', 'main', 'java', 'be', 'acme'), { recursive: true });
fs.mkdirSync(path.join(fixture, 'svc', 'src', 'main', 'resources'), { recursive: true });
fs.writeFileSync(path.join(fixture, 'svc', 'pom.xml'), '<project><artifactId>spring-boot-starter</artifactId></project>');
fs.writeFileSync(path.join(fixture, 'svc', 'src', 'main', 'java', 'be', 'acme', 'DemoApplication.java'), 'package be.acme;\n@SpringBootApplication\npublic class DemoApplication {}\n');
fs.writeFileSync(path.join(fixture, 'svc', 'src', 'main', 'resources', 'application-dev.yml'), 'a: 1\n');
const jdir = path.join(fixture, 'svc', 'src', 'main', 'java', 'be', 'acme');
fs.mkdirSync(path.join(fixture, '.claude', 'skills', 'demo'), { recursive: true });
fs.writeFileSync(path.join(fixture, '.claude', 'skills', 'demo', 'SKILL.md'), '---\nname: demo\ndescription: Demo skill\n---\nHi');
fs.writeFileSync(path.join(jdir, 'HelloController.java'), 'package be.acme;\n@RestController\n@RequestMapping("/api")\npublic class HelloController {\n    @GetMapping("/hello/{name}")\n    public String hello(String name) { return "hi"; }\n    @Bean\n    public Greeter greeter() { return null; }\n}\n');
fs.writeFileSync(path.join(jdir, 'Greeter.java'), 'package be.acme;\npublic interface Greeter {\n    String greet();\n}\n');
fs.writeFileSync(path.join(jdir, 'LoudGreeter.java'), 'package be.acme;\npublic class LoudGreeter implements Greeter {\n    public String greet() { return "HI"; }\n}\n');
fs.writeFileSync(path.join(jdir, 'QuietGreeter.java'), 'package be.acme;\npublic class QuietGreeter implements Greeter {\n    public String greet() { return "hi"; }\n}\n');
git(fixture, 'add', '.');
git(fixture, 'commit', '-q', '-m', 'init');
for (const b of ['feature/one', 'feature/two', 'feature/three-with-a-rather-long-name']) git(fixture, 'branch', b); // many refs on one commit: the History rows must not wrap
fs.writeFileSync(path.join(fixture, 'a.py'), 'print("v2")\n');
fs.writeFileSync(path.join(fixture, 'b.py'), 'one\nTWO\nthree\n');
fs.mkdirSync(path.join(fixture, '.ide'));
fs.writeFileSync(path.join(fixture, '.ide', 'config.json'), JSON.stringify({
  agents: [{ name: 'Echo', command: 'echo started', resumeCommand: 'echo RESUMED_OK' }, { name: 'NoResume', command: 'echo plain' }, { name: 'Smoke ACP', command: `node "${path.join(__dirname, '..', 'node_modules', '@agentclientprotocol', 'sdk', 'dist', 'examples', 'agent.js')}"`, protocol: 'acp', policy: 'ask' }],
  reviewCommand: 'node -e "process.stdin.pipe(process.stdout)"',
  // a fake language server for .py files: exercises hover / definition / references / completion / diagnostics end to end
  lsp: { enabled: true, servers: { python: { command: process.execPath, args: [path.join(appDir, 'test', 'fixtures', 'fake-lsp.js')], extensions: ['py'] } } },
}));
fs.writeFileSync(path.join(fixture, '.ide', 'checks.yaml'), `useDefaults: false
checks:
  - name: Demo gate
    match: ["*.py"]
    scope: project
    run: "node -e \\"console.log('a.py:1:1: error: demo finding')\\""
    parser: regex
    pattern: '^(?<file>.+?):(?<line>\\d+):(?<column>\\d+): (?<severity>\\w+): (?<message>.*)$'
`);

// Regression: the smoke test used to overwrite the REAL settings of whoever ran it. Run against a fake home that holds
// a marker settings file in every place the app could use, and check afterwards that none of them changed.
const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'bazinga-home-'));
const markerFiles = [];
for (const appName of ['bazinga', 'Bazinga']) {
  for (const base of ['.config', path.join('AppData', 'Roaming'), path.join('Library', 'Application Support')]) {
    const file = path.join(fakeHome, base, appName, 'settings.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{"marker":"keep me"}');
    markerFiles.push(file);
  }
}
const isolatedEnv = { HOME: fakeHome, USERPROFILE: fakeHome, XDG_CONFIG_HOME: path.join(fakeHome, '.config'), APPDATA: path.join(fakeHome, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(fakeHome, 'AppData', 'Local') };

// Own the app's userData dir too (instead of letting main.js --smoke mint one of its own), so it can be cleaned up below.
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'bazinga-userdata-'));
isolatedEnv.BAZINGA_USER_DATA = userData;

// Seed scorecard history for the "auto-merge" smoke step: 3 prior wins (scorecard.js's MIN_RUNS) for agent "Smoke" on
// a "docs" task, so that step's 4th run has a track record real enough for automerge.autoMergeEligible() to say yes.
fs.writeFileSync(path.join(userData, 'scorecard.json'), JSON.stringify({ version: 1, records: Array.from({ length: 3 }, (_, i) => ({
  at: Date.now() - (3 - i) * 60000, agent: 'Smoke', model: '', local: false, kind: 'docs', outcome: 'merged', result: 'win',
  escalatedTo: '', fixRounds: 0, fixLoop: true, activeMs: 1000, files: 1, costUsd: 0, tokens: 0,
})) }));

// a stand-in for docker, so the "run in a container" flow can be exercised: the real command line is typed into the terminal either way
const fakeBin = path.join(fakeHome, 'fakebin');
fs.mkdirSync(fakeBin, { recursive: true });
fs.writeFileSync(path.join(fakeBin, 'docker'), '#!/bin/sh\necho "FAKE_DOCKER $*"\n', { mode: 0o755 });
isolatedEnv.PATH = `${fakeBin}${path.delimiter}${process.env.PATH}`;

const electronArgs = [...(process.env.BAZINGA_BIN ? [] : [appDir]), fixture, '--smoke', '--no-sandbox', '--disable-gpu'];
let cmd = electronPath;
let args = electronArgs;
if (process.platform === 'linux' && !process.env.DISPLAY) {
  cmd = 'xvfb-run';
  args = ['-a', electronPath, ...electronArgs];
}

const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...isolatedEnv, ELECTRON_ENABLE_LOGGING: '0' } });
let out = '';
child.stdout.on('data', (d) => { out += d; });
child.stderr.on('data', (d) => { out += d; });
// 420s: the fixed budget grew with the suite (session replay, semantic diff, adaptive-guard-rule and auto-merge
// coverage added real steps, each spawning a terminal or running the gates, and several steps now revert/restore
// a dirty main around a real merge), so 300s started clipping healthy runs too.
const SMOKE_TIMEOUT_MS = 420000;
const timer = setTimeout(() => { console.error(`Smoke test timed out after ${SMOKE_TIMEOUT_MS / 1000}s`); const steps = out.split('\n').filter((l) => l.includes('[smoke]')); console.error(steps.length ? steps.slice(-60).join('\n') : `No step was reported. Last output of the app:\n${out.split('\n').slice(-25).join('\n')}`); child.kill('SIGKILL'); }, SMOKE_TIMEOUT_MS);

// Best-effort removal of everything this run created outside the project, whether it passed, failed or timed out
// (a run used to leave the fixture, the fake home, the Electron userData dir and any agent-run worktree behind,
// forever — thousands of them pile up in the OS temp dir over time).
function cleanup() {
  for (const dir of [fixture, `${fixture}.worktrees`, fakeHome, userData]) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

child.on('close', (code) => {
  clearTimeout(timer);
  const line = out.split('\n').find((l) => l.startsWith('SMOKE_RESULT '));
  if (!line) {
    console.error('No SMOKE_RESULT received. Output:\n' + out.slice(-3000));
    cleanup();
    process.exit(1);
  }
  const report = require('../src/core/smokeerrors').apply(JSON.parse(line.slice('SMOKE_RESULT '.length)));
  const touched = markerFiles.filter((f) => fs.readFileSync(f, 'utf8') !== '{"marker":"keep me"}');
  if (touched.length) { report.ok = false; report.errors.push(`The smoke test modified real user settings: ${touched.join(', ')}`); }
  console.log(JSON.stringify(report, null, 2));
  cleanup();
  process.exit(report.ok && code === 0 ? 0 : 1);
});
