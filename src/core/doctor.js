'use strict';
/**
 * "Does this machine have what Bazinga and its features expect?" Each tool is looked up on PATH and asked for its version.
 * `required` tools are needed for the core; the rest only enable a feature (said in the hint), so a missing one is a note, not an error.
 */
const { spawn } = require('node:child_process');
const { which } = require('./util');

const TOOLS = [
  { id: 'git', label: 'Git', args: ['--version'], required: true, hint: 'Needed for changes, history, agent runs. https://git-scm.com' },
  { id: 'node', label: 'Node.js', args: ['--version'], required: true, hint: 'Needed to run the project scripts and gates (version 18 or newer).', minMajor: 18 },
  { id: 'java', label: 'Java (JDK)', args: ['-version'], hint: 'Needed for Maven/Gradle builds and the Java language server.' },
  { id: 'mvn', label: 'Maven', args: ['-v'], hint: 'Only needed if a project has no mvnw wrapper.' },
  { id: 'gradle', label: 'Gradle', args: ['-v'], hint: 'Only needed if a project has no gradlew wrapper.' },
  { id: 'rg', label: 'ripgrep', args: ['--version'], hint: 'Makes project search fast; a built-in search is used without it.' },
  { id: 'claude', label: 'Claude Code', args: ['--version'], hint: 'The Claude agent button and the AI review command.' },
  { id: 'copilot', label: 'Copilot CLI', args: ['--version'], hint: 'The Copilot agent button.' },
  { id: 'gh', label: 'GitHub CLI', args: ['--version'], hint: 'Opening pull requests and reading their status on GitHub (run "gh auth login").' },
  { id: 'az', label: 'Azure CLI', args: ['--version'], hint: 'Pull requests on Azure DevOps (run "az login" and "az extension add --name azure-devops").' },
  { id: 'docker', label: 'Docker', args: ['--version'], hint: 'Optional: run agents in a container (Settings → Agent safety). Build the image: docker build -t bazinga-agent:latest docker/agent' },
  { id: 'gitleaks', label: 'gitleaks', args: ['version'], hint: 'Extra secret scanning; a built-in scanner runs without it.' },
  { id: 'jdtls', label: 'jdtls (Java language server)', args: null, hint: 'Optional: exact usages and hover for Java.' },
  { id: 'pyright-langserver', label: 'pyright (Python language server)', args: null, hint: 'Optional: hover and usages for Python.' },
  { id: 'typescript-language-server', label: 'typescript-language-server', args: null, hint: 'Optional: hover and usages for TS/JS.' },
];

/** First line that looks like a version, from whatever the tool printed. */
function parseVersion(text) {
  // the JVM prints "Picked up JAVA_TOOL_OPTIONS: ... proxyHost=127.0.0.1 ..." before the real output: not a version
  const clean = String(text || '').split(/\r?\n/).filter((l) => !/^\s*Picked up\b/.test(l)).join('\n');
  const m = /(\d+\.\d+(?:\.\d+)?(?:[-.\w]*)?)/.exec(clean);
  return m ? m[1] : '';
}

function run(file, args, timeoutMs) {
  return new Promise((resolve) => {
    let out = ''; let done = false;
    const finish = (v) => { if (!done) { done = true; clearTimeout(timer); resolve(v); } };
    let child;
    try { child = spawn(file, args, { windowsHide: true, shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'] }); } catch { resolve(''); return; }
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } finish(out); }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; }); // java -version prints on stderr
    child.on('error', () => finish(''));
    child.on('close', () => finish(out));
  });
}

async function checkTool(tool, { timeoutMs = 6000, find = which } = {}) {
  const found = find(tool.id);
  const base = { id: tool.id, label: tool.label, required: !!tool.required, hint: tool.hint, path: found, ok: !!found, version: '', note: '' };
  if (!found) return base;
  if (tool.args) {
    base.version = parseVersion(await run(found, tool.args, timeoutMs));
    if (tool.minMajor && base.version && Number(base.version.split('.')[0]) < tool.minMajor) { base.ok = false; base.note = `version ${tool.minMajor} or newer is needed`; }
  }
  return base;
}

/** Things that are not executables: node-pty, git identity, the terminal shell. */
async function extraChecks({ shell, gitIdentity } = {}) {
  const out = [];
  let ptyOk = true; let ptyNote = '';
  try { require('node-pty'); } catch (err) { ptyOk = false; ptyNote = String(err.message).split('\n')[0]; }
  out.push({ id: 'node-pty', label: 'Terminal engine (node-pty)', required: true, ok: ptyOk, version: '', path: null, note: ptyNote, hint: 'Run "npm install" again; on Windows a prebuilt binary is expected, on Linux you need build tools.' });
  const sh = shell || (process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/bash');
  out.push({ id: 'shell', label: `Terminal shell (${sh})`, required: true, ok: !!(require('node:fs').existsSync(sh) || which(sh)), version: '', path: sh, note: '', hint: 'Set "shell" in .ide/config.json or the settings.' });
  if (gitIdentity) {
    const id = await gitIdentity();
    out.push({ id: 'git-identity', label: 'Git identity (user.name / user.email)', required: false, ok: !!(id.name && id.email), version: id.name ? `${id.name} <${id.email || '?'}>` : '', path: null, note: '', hint: 'git config --global user.name "…" ; git config --global user.email "…"  (commits fail without it)' });
  }
  return out;
}

async function runDoctor(opts = {}) {
  const tools = await Promise.all(TOOLS.map((t) => checkTool(t, opts)));
  const extra = await extraChecks(opts);
  const results = [...extra.slice(0, 2), ...tools.slice(0, 2), ...extra.slice(2), ...tools.slice(2)];
  return { results, ok: results.filter((r) => r.required).every((r) => r.ok), missingRequired: results.filter((r) => r.required && !r.ok).map((r) => r.id) };
}

/** Plain-text report for the terminal. */
function formatReport(report) {
  const lines = report.results.map((r) => {
    const mark = r.ok ? 'OK  ' : r.required ? 'FAIL' : 'miss';
    const ver = r.version ? ` ${r.version}` : '';
    const tail = r.ok ? '' : `  ->  ${r.note ? `${r.note}. ` : ''}${r.hint}`;
    return `${mark} ${r.label}${ver}${tail}`;
  });
  lines.push('', report.ok ? 'All required tools are present.' : `Missing or too old (required): ${report.missingRequired.join(', ')}`);
  return lines.join('\n');
}

module.exports = { TOOLS, parseVersion, checkTool, extraChecks, runDoctor, formatReport };
