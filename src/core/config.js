'use strict';
const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');
const DEFAULT_CHECKS = require('./defaults');
const oversight = require('./oversight');

const DEFAULT_CONFIG = {
  shell: null,            // null = PowerShell on Windows, $SHELL elsewhere
  shellArgs: null,
  theme: 'system',        // 'system' (follow the OS), 'light' or 'dark'
  autoCheck: false,       // run fast checks whenever files change on disk
  autoCheckpoint: true,   // snapshot the working tree before an agent terminal starts
  // taskCommand is used for agent runs; {task} becomes the task text. env: extra environment variables for that agent (e.g. a local model endpoint).
  agents: [
    { name: 'Claude', command: 'claude', taskCommand: 'claude {task}' },
    { name: 'Copilot', command: 'copilot', taskCommand: 'copilot -i {task}' },
  ],
  // Automatic fix loop: when an agent in a watched terminal goes quiet, the gates run and their findings go back to the agent (up to maxRounds times).
  fixLoop: { enabled: false, maxRounds: 3, idleSeconds: 8, tier: 'fast', include: 'error', relatedTests: false, testTimeoutSec: 120, escalate: { agent: '', after: 2 } }, // escalate.agent: the name of a stronger agent that takes over after `after` failed rounds (empty = never)
  // Human-in-the-loop level: 'autonomous' | 'supervised' | 'guided' | 'stepwise' (see core/oversight.js). Unset = the individual settings below. Settable in the IDE settings and in .ide/config.json (the project wins).
  oversight: null,
  taskPrefix: '',         // text put in front of every agent task (set by the guided levels)
  notifyKinds: null,      // null = all kinds; or a list of 'agent-idle' | 'agent-prompt' | 'checks-done' | 'fixloop'
  // Merge guard rules: 'block' (needs an explicit override), 'warn' or 'off'. See core/guard.js for the defaults.
  mergeGuard: {},
  insights: { claudeLimits: false, sonarProject: '', actuatorUrl: 'http://localhost:8080/actuator' }, // see core/insights.js; claudeLimits adds a status-line command to the Claude Code sessions Bazinga starts
  containerWhenUnattended: 'auto', // 'auto' | 'off': unattended workflow steps run in the Docker container when it is set up
  externalEditor: 'auto', // 'auto' | 'vscode' | 'idea': what "Open in other editor" uses
  copilot: { enabled: false }, // optional shortcut to GitHub Copilot usage (see core/copilot.js); off for people without a licence
  jev: { enabled: false }, // Jev (TypeSafe AI) classifies the kind of a task for the scorecard instead of keyword rules; opt-in, sends the task text only (see core/jev.js)
  agentContainer: { enabled: false }, // run agent runs in a Docker container (see core/container.js)
  agentEnv: { scrub: true, allow: [] }, // agent terminals do not inherit variables that look like credentials
  ollama: { baseUrl: 'http://localhost:11434', keepWarm: true, keepAlive: '15m', unloadOthers: true, noThink: true, proxy: true, restrictTools: true, repair: true, lean: true, testMinutes: 15, maxOutputTokens: 8192 }, // local models: load on launch and re-ping while their terminal is open, so they do not unload after 5 idle minutes
  skillsMirrors: ['.agents/skills'], // every install is also copied here (Copilot and other agents read .agents/skills, at project and home level)
  folders: { source: [], tests: [] }, // folders marked as source / tests (right-click in the file tree); told to the agents. Project level: .ide/config.json
  foldersFiles: 60,     // how many file paths of the marked folders are listed for the agents (0 = none); more files are summarised per folder
  foldersIndex: true,   // also keep a managed block with them in AGENTS.md, for agents that read that file instead of the standing instructions
  skillsIndex: true,    // list the project's skills in a managed block of AGENTS.md, for agents without skill support (e.g. local models)
  skillsDir: '.claude/skills', // where skills live, under your home folder (IDE level) and under the project (project level)
  reviewRules: '',      // IDE-level review rules; the project's REVIEW.md is added after them
  runBudgetMinutes: 0,  // 0 = no limit; active agent time per run before you are told
  protectedPaths: null, // null = built-in list (guardrules.DEFAULT_PROTECTED)
  // Lenses above classes and methods: how often the name is used in the project (counted by name) and who last changed it.
  symbolParser: 'auto',  // 'auto' = tree-sitter (Java, Kotlin, TS/JS, Python, Go, Rust, C#) with the line patterns as fallback; 'regex' = line patterns only
  symbolLenses: { usages: true, blame: true, spring: true },
  // Work items mentioned in a run (branch, task, commits): #123 and AB#123 link to GitHub issues / Azure Boards; ticket keys like PROJ-12 link when jiraBaseUrl is set.
  workItems: { jiraBaseUrl: '' },
  jira: { baseUrl: '', email: '', project: '', flavor: 'cloud' }, // the token is not here: it lives encrypted in the OS key store (core/keystore.js)
  // Fleet panel: an agent with no output and no model request for staleMinutes counts as stale. prices = estimated cost, e.g. { "sonnet": [3, 15] } = dollars per million input / output tokens (empty = no cost shown).
  fleet: { staleMinutes: 5, prices: {} },
  agentHooks: true,       // Claude Code reports by itself when it is done or needs permission (hooks); off = Bazinga guesses from the quiet terminal
  notifications: true,    // OS notification when an agent goes idle / the fix loop finishes and the IDE is in the background
  editorFontSize: 13,
  terminalFontSize: 13,
  terminalScrollback: 2000, // lines kept per terminal (200 to 50000); every line costs memory
  // Language servers (opt-in, per project or in settings): { enabled: true, servers: { java: { command: 'jdtls', args: [] } } }. See core/lsp.js for the defaults.
  lsp: { enabled: false, servers: {} },
  runLinkDirs: [],        // folders to link from the main checkout into each agent worktree, e.g. ["node_modules"] (shared: agents installing packages change it for everyone)
  // The review prompt (instructions + diff + gate findings) is piped to this command's stdin; its stdout is shown in the Review tab.
  reviewCommand: 'claude -p "Review the code change described on stdin. Answer in plain text."',
};

const ideDir = (root) => path.join(root, '.ide');

function readText(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}

function readYaml(file) {
  const text = readText(file);
  if (text === null) return null;
  try { return YAML.parse(text) || {}; } catch (e) { throw new Error(`Invalid YAML in ${file}: ${e.message}`); }
}

/** Defaults < user-wide settings (globalSettings, stored by the app) < the project's .ide/config.json. */
function loadConfig(root, globalSettings = {}) {
  const layers = [DEFAULT_CONFIG, globalSettings || {}];
  const text = readText(path.join(ideDir(root), 'config.json'));
  if (text !== null) {
    try { layers.push(JSON.parse(text)); } catch (e) { throw new Error(`Invalid JSON in .ide/config.json: ${e.message}`); }
  }
  // each layer's oversight level (human-in-the-loop preset) is applied just before that layer's own values: see core/oversight.js
  const merged = oversight.mergeLayers(layers);
  if (!Array.isArray(merged.agents) || !merged.agents.length) merged.agents = DEFAULT_CONFIG.agents;
  const eff = oversight.effectiveLevel(globalSettings, layers[2]);
  merged.oversightEffective = eff;
  return merged;
}

/**
 * Scripts live in .ide/scripts.yaml:
 *   scripts:
 *     - name: Import dry run
 *       command: python scripts/import.py --dry-run
 *       cwd: .            # optional, relative to the project
 *       description: ...  # optional
 */
function loadScripts(root) {
  const doc = readYaml(path.join(ideDir(root), 'scripts.yaml'));
  if (!doc) return [];
  const list = Array.isArray(doc) ? doc : doc.scripts;
  if (!Array.isArray(list)) return [];
  return list
    .filter((s) => s && s.name && s.command)
    .map((s) => ({ name: String(s.name), command: String(s.command), cwd: s.cwd ? String(s.cwd) : '.', description: s.description ? String(s.description) : '' }));
}

/**
 * Checks live in .ide/checks.yaml. Without the file the built-in defaults are used.
 *   useDefaults: true      # keep the built-ins and add/override by name (default true)
 *   disable: [Semgrep]     # built-in names to switch off
 *   checks: [ { name, tier, scope, match, requiresBin, requiresFile, run, parser, pattern, cwd, env, timeoutSec } ]
 * `custom` is true when the project defines its own commands (the app asks for trust before running those).
 */
function loadChecksConfig(root) {
  const doc = readYaml(path.join(ideDir(root), 'checks.yaml'));
  if (!doc) return { checks: DEFAULT_CHECKS.map((c) => ({ ...c })), custom: false };
  let checks = doc.useDefaults === false ? [] : DEFAULT_CHECKS.map((c) => ({ ...c }));
  const disabled = new Set(Array.isArray(doc.disable) ? doc.disable : []);
  checks = checks.filter((c) => !disabled.has(c.name));
  for (const c of Array.isArray(doc.checks) ? doc.checks : []) {
    if (!c || !c.name) continue;
    const i = checks.findIndex((x) => x.name === c.name);
    if (i >= 0) checks[i] = { ...checks[i], ...c }; // same name: change only the fields you give (e.g. just severity)
    else if (c.run || c.native) checks.push(c);
  }
  return { checks, custom: Array.isArray(doc.checks) && doc.checks.length > 0 };
}

/** Nested option objects replace each other in the shallow merge; fill in the missing keys from the defaults. */
function withDefaults(cfg, key) { return { ...DEFAULT_CONFIG[key], ...((cfg && cfg[key]) || {}) }; }

/** Plain-language problems in the project's .ide/config.json (empty list = fine). Never throws. */
function configProblems(root) {
  const text = readText(path.join(ideDir(root), 'config.json'));
  if (text === null) return [];
  let cfg;
  try { cfg = JSON.parse(text); } catch (e) { return [`not valid JSON: ${e.message}`]; }
  return require('./configschema').problems(cfg);
}

module.exports = { configProblems, withDefaults, DEFAULT_CONFIG, ideDir, loadConfig, loadScripts, loadChecksConfig };
