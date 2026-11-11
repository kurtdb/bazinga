'use strict';
const { app, BrowserWindow, Menu, ipcMain, dialog, clipboard, nativeTheme, Notification, shell, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { PtyManager } = require('./pty');
const G = require('../core/git');
const { runChecks } = require('../core/checks');
const { search, replaceInText } = require('../core/search');
const todos = require('../core/todos');
const restclient = require('../core/restclient');
const environments = require('../core/environments');
const { runReview } = require('../core/review');
const scope = require('../core/scope');
const { fixPath } = require('./shellenv');
const runs = require('../core/runs');
const oversightCore = require('../core/oversight');
const { DEFAULT_CONFIG, loadConfig, loadScripts, loadChecksConfig, withDefaults } = require('../core/config');
const { FixLoop, asPaste, relevantFindings, buildEscalationPrompt } = require('../core/fixloop');
const scorecard = require('../core/scorecard');
const guardoverrides = require('../core/guardoverrides');
const replay = require('../core/replay');
const verdict = require('../core/verdict');
const semanticdiff = require('../core/semanticdiff');
const compare = require('../core/compare');
const prstatus = require('../core/prstatus');
const workitems = require('../core/workitems');
const jira = require('../core/jira');
const { SecretStore } = require('../core/keystore');
const { DebugLog } = require('../core/debuglog');
const debug = new DebugLog();
const { HookServer } = require('../core/hooks');
const printmode = require('../core/printmode');
const wfselfcheck = require('../core/wfselfcheck');
const skillsearch = require('../core/skillsearch');
const dbg = (source, text) => { try { debug.add(source, text); } catch { /* ignored */ } };
const reviewcomments = require('../core/reviewcomments');
const dropinsert = require('../core/dropinsert');
const { findRelatedTests, runRelatedTests } = require('../core/relatedtests');
const { evaluateMerge, DEFAULT_POLICY } = require('../core/guard');
const { shouldNotify, fixLoopMessage } = require('../core/notify');
const pr = require('../core/pr');
const history = require('../core/history');
const testcmd = require('../core/testcmd');
const testrun = require('../core/testrun');
const spring = require('../core/spring');
const appcore = require('../core/appcore');
const doctor = require('../core/doctor');
const { LocalHistory } = require('../core/localhistory');
const runconfig = require('../core/runconfig');
const symbols = require('../core/symbols');
const treesitter = require('../core/treesitter');
const { UsageIndex } = require('../core/usages');
const { SymbolIndex } = require('../core/symbolindex');
const dap = require('../core/dap');
const { SpringIndex } = require('../core/springmap');
const runstats = require('../core/runstats');
const taskTemplates = require('../core/tasktemplates');
const os = require('node:os');
const changesig = require('../core/changesig');
const { createFeed } = require('../core/watchfeed');
const { addRecent, pruneRecent } = require('../core/recent');
const commentanchor = require('../core/commentanchor');
const skillindex = require('../core/skillindex');
const envinline = require('../core/envinline');
const ollama = require('../core/ollama');
const agentprep = require('../core/agentprep');
const modeltest = require('../core/modeltest');
const toolproxy = require('../core/toolproxy');
const { afterIdle } = require('../core/idle');
const folderroles = require('../core/folderroles');
const toolProxies = toolproxy.manager(); // helpers between Claude Code and a local model server (see core/toolproxy.js)
const containerCore = require('../core/container');
const workflowCore = require('../core/workflow');
const skillsCore = require('../core/skills');
const skillscan = require('../core/skillscan');
const agentconfig = require('../core/agentconfig');
const budgetCore = require('../core/budget');
const { scrubEnv } = require('../core/envscrub');
const journalCore = require('../core/journal');
const termsession = require('../core/termsession');
const { LspManager } = require('../core/lsp');
const { IGNORED_DIRS, toPosix, which, listAllFiles, runShell } = require('../core/util');

const SMOKE = process.argv.includes('--smoke');
const SHOTS = process.env.BAZINGA_SHOTS || null; // directory: the screenshot script saves PNGs of the real UI here

// Tests must never touch the real settings/session of whoever runs them: use a throw-away profile (or the one the script names).
const USER_DATA_OVERRIDE = process.env.BAZINGA_USER_DATA || (SMOKE ? require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'bazinga-userdata-')) : null);
if (USER_DATA_OVERRIDE) app.setPath('userData', USER_DATA_OVERRIDE);
else require('../core/migrate').migrateUserData(app.getPath('userData'), app.getPath('appData'));
const SESSION_ARG = (process.argv.find((a) => a.startsWith('--session-data=')) || '').slice(15);
if (SESSION_ARG) app.setPath('sessionData', SESSION_ARG); // an extra window keeps its own browser storage; settings are shared
const MAX_FILE_BYTES = 2 * 1024 * 1024;

let win = null;
let root = null;
let watcher = null;
let checksRunning = false;
let checksAbort = null;
let reviewAbort = null;
const restAborts = new Map(); // tab id -> AbortController, for in-flight REST client requests
let ptys = null;
let fixloop = null;
let lsp = null;
let dapSession = null;
let usageIndex = null;
let symbolIndex = null;
let springIndex = null;
const getSymbolIndex = (r) => {
  if (!symbolIndex) {
    const cfgSym = loadConfigSafe(r).symbolParser;
    const symbolsOf = async (rel, content) => (cfgSym === 'regex' ? null : await treesitter.symbols(rel, content)) || symbols.findSymbols(rel, content);
    symbolIndex = new SymbolIndex(r, () => G.projectFiles(r), symbolsOf);
  }
  return symbolIndex;
};
const getSpringIndex = (r) => { if (!springIndex) springIndex = new SpringIndex(r, () => G.projectFiles(r)); return springIndex; };
let localHistory = null;
const lhTimers = new Map();

// ---------- persistent state: last project + trust, user settings, per-project session ----------
const userFile = (name) => path.join(app.getPath('userData'), name);
function readTextSafe(file) { try { return fs.readFileSync(file, 'utf8'); } catch { return ''; } }
function readJsonSafe(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }
function readJson(name, fallback) { try { return JSON.parse(fs.readFileSync(userFile(name), 'utf8')); } catch { return fallback; } }
function writeJson(name, data) {
  try { fs.mkdirSync(path.dirname(userFile(name)), { recursive: true }); fs.writeFileSync(userFile(name), JSON.stringify(data, null, 2)); } catch { /* non-fatal */ }
}
const readState = () => readJson('state.json', { lastRoot: null, trusted: [] });
const writeState = (s) => writeJson('state.json', s);
const readSettings = () => readJson('settings.json', {});
/** 'light' / 'dark' force the window chrome (menus, scrollbars, prefers-color-scheme); 'system' follows the OS; the other built-in themes are all dark-background, so they force dark chrome too. A custom theme carries its own dark/light flag. */
function applyNativeTheme() {
  const s = readSettings();
  const t = s.theme;
  if (t === 'light' || t === 'system') { nativeTheme.themeSource = t; return; }
  const custom = (s.customThemes || []).find((c) => c.id === t);
  nativeTheme.themeSource = custom && custom.dark === false ? 'light' : 'dark';
}

function pickInitialRoot() {
  const arg = process.argv.slice(app.isPackaged ? 1 : 2).find((a) => !a.startsWith('-'));
  const candidates = [arg && path.resolve(arg), !SMOKE && readState().lastRoot].filter(Boolean);
  return candidates.find((p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } }) || null;
}

// ---------- helpers ----------
function send(channel, ...args) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
}

function requireRoot() {
  if (!root) throw new Error('No project is open.');
  return root;
}

function resolveInRoot(rel) { return appcore.resolveWithin(requireRoot(), rel); }

/** Wrap an async operation so the renderer gets { error } instead of a rejected promise. */
async function safe(fn) {
  try { const value = await fn(); return value === undefined ? { ok: true } : value; } catch (err) { dbg('app', `error: ${String((err && err.message) || err)}`); return { error: friendlyCore.friendly(err) }; }
}

/** Projects can define commands in .ide/*.yaml; ask once before running those. */
async function ensureTrusted() {
  const state = readState();
  if ((state.trusted || []).includes(root)) return true;
  if (SMOKE) return true;
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['Trust and run', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title: 'Trust this project?',
    message: 'This project defines its own commands in .ide/',
    detail: `${root}\n\nScripts and custom checks run shell commands on your machine. Only continue if you trust the contents of this repository.`,
  });
  if (response !== 0) return false;
  writeState(appcore.withTrusted(state, root));
  return true;
}

// ---------- local history: every content change of a file is kept outside the project ----------
const getLocalHistory = () => (localHistory = localHistory || new LocalHistory(path.join(app.getPath('userData'), 'localhistory')));

/** Before the first snapshot of a file, keep what git has (HEAD) so an overwrite of an untouched file can be undone too. */
async function lhBaseline(r, rel) {
  const lh = getLocalHistory();
  if (lh.has(r, rel) || !(await G.isRepo(r))) return;
  const head = await G.headContent(r, rel);
  if (head) lh.record(r, rel, head, { label: 'last commit' });
}

/** Debounced: read the file as it is now and keep it when it changed. */
function lhRecordDisk(r, rel, label) {
  const key = `${r}\0${rel}`;
  clearTimeout(lhTimers.get(key));
  lhTimers.set(key, setTimeout(async () => {
    lhTimers.delete(key);
    try {
      const abs = appcore.resolveWithin(r, rel);
      const st = fs.statSync(abs);
      if (!st.isFile() || st.size > 1024 * 1024) return;
      await lhBaseline(r, rel);
      getLocalHistory().record(r, rel, fs.readFileSync(abs, 'utf8'), { label });
    } catch { /* deleted, locked or outside: nothing to keep */ }
  }, 500));
}

let watcherOk = false;
let watcherRetries = 0;
let watcherRetryTimer = null;
let pollTimer = null;
let pollBusy = false;
let lastSig = null;

function setWatcherOk(ok) { if (watcherOk !== ok) { watcherOk = ok; send('fs:watcher', ok); } }

/** A watcher that died (error, deleted folder, too many watches) is restarted with a growing delay; polling covers the gap. */
function scheduleWatcherRetry() {
  clearTimeout(watcherRetryTimer);
  if (!root || watcherRetries >= 8) return; // give up: polling and window focus keep the IDE current
  const delay = Math.min(30000, 1000 * 2 ** watcherRetries++);
  watcherRetryTimer = setTimeout(() => startWatcher(true), delay);
  if (watcherRetryTimer.unref) watcherRetryTimer.unref();
}

const feed = createFeed({ send: (...a) => { send(...a); rebaseline(); }, isChecksRunning: () => checksRunning });
const watchStats = { events: 0, ignored: 0, lastEventAt: null, lastEventFile: null, polls: 0, pollChanges: 0, lastPollAt: null, lastPollFiles: 0, lastPollError: null, pollSkipped: null };

function startWatcher(isRetry = false) {
  stopWatcher();
  if (!isRetry) watcherRetries = 0;
  if (!root) return;
  try {
    watcher = fs.watch(root, { recursive: true }, (_evt, filename) => {
      if (!filename) return;
      if (String(filename).split(/[\\/]/).some((part) => IGNORED_DIRS.has(part))) { watchStats.ignored++; return; }
      watchStats.events++; watchStats.lastEventAt = new Date().toISOString(); watchStats.lastEventFile = String(filename);
      if (root) lhRecordDisk(root, toPosix(String(filename)), 'changed on disk');
      if (usageIndex) usageIndex.invalidate();
      if (symbolIndex) symbolIndex.invalidate();
      if (springIndex) springIndex.invalidate();
      feed.event(); // never dropped, not even while the gates run
    });
    watcher.on('error', () => { stopWatcher(); setWatcherOk(false); scheduleWatcherRetry(); });
    watcherRetries = 0;
    setWatcherOk(true);
  } catch {
    setWatcherOk(false); // recursive watching unavailable here: polling below still works
    scheduleWatcherRetry();
  }
}

function stopWatcher() {
  feed.stop();
  if (watcher) { try { watcher.close(); } catch { /* ignore */ } watcher = null; }
}

/** Remember what the working tree looks like now, so the poller only reports what happened after this. */
function rebaseline() {
  if (!root) return;
  const r = root;
  changesig.signature(r).then((s) => { if (root === r) lastSig = s; }).catch(() => {});
}

/** Safety net next to the file watcher: every few seconds, compare a fingerprint of the changed files. */
function startPoller() {
  clearInterval(pollTimer);
  lastSig = null;
  let tick = 0;
  pollTimer = setInterval(async () => {
    tick++;
    // focused: every 4 s; visible but in the background (the agent usually runs in another window): every 12 s; minimized: not at all
    const gone = !win || win.isDestroyed() || win.isMinimized();
    const background = !gone && !win.isFocused();
    if (!root || pollBusy || gone || (background && tick % 3 !== 0)) { watchStats.pollSkipped = gone ? 'window minimized' : pollBusy ? 'busy' : null; return; }
    watchStats.pollSkipped = null;
    pollBusy = true;
    const r = root;
    try {
      const sig = await changesig.signature(r);
      if (root !== r) return;
      if (sig === null) { watchStats.lastPollError = 'git status failed'; return; }
      watchStats.polls++; watchStats.lastPollAt = new Date().toISOString(); watchStats.lastPollFiles = sig ? sig.split('\n').length : 0; watchStats.lastPollError = null;
      if (lastSig !== null && sig !== lastSig) { watchStats.pollChanges++; if (usageIndex) usageIndex.invalidate(); if (symbolIndex) symbolIndex.invalidate(); if (springIndex) springIndex.invalidate(); send('fs:changed', { poll: true }); }
      lastSig = sig;
    } catch (err) { watchStats.lastPollError = String((err && err.message) || err); } finally { pollBusy = false; }
  }, 4000);
  if (pollTimer.unref) pollTimer.unref();
  rebaseline();
}

function setRoot(dir) {
  usageIndex = null; symbolIndex = null; springIndex = null;
  if (lsp) { lsp.dispose().catch(() => {}); lsp = null; }
  if (dapSession) { dapSession.stop().catch(() => {}); dapSession = null; }
  // canonicalize (resolves symlinks, e.g. macOS /var -> /private/var): `git worktree list` reports paths already
  // resolved this way, so without this, switching back from a run's worktree to a root opened via its unresolved
  // form fails the exact-string match in project:switch ("Not a known agent run of this repository").
  try { dir = fs.realpathSync.native(dir); } catch { /* not on disk (yet) or inaccessible: keep it as given */ }
  root = dir;
  const state = readState();
  state.lastRoot = dir;
  state.recent = addRecent(state.recent, dir);
  writeState(state);
  startWatcher();
  startPoller();
}

async function describeProject() {
  if (!root) return { root: null, config: loadConfig(path.join(app.getPath('userData'), '__none__'), readSettings()) };
  const info = { root, name: path.basename(root), watching: watcherOk, isRepo: await G.isRepo(root), branch: null, config: null, scripts: [], checks: [], error: null };
  if (info.isRepo) info.branch = await G.branch(root);
  try {
    info.config = loadConfig(root, readSettings());
    info.configProblems = require('../core/config').configProblems(root);
    info.taskTemplates = taskTemplates.mergeTemplates({ ide: readSettings().taskTemplates, project: [...((readJsonSafe(path.join(root, '.ide', 'config.json')) || {}).taskTemplates || []), ...taskTemplates.parseMarkdown(readTextSafe(path.join(root, '.ide', 'tasks.md')))] });
    info.oversight = oversightCore.describe(readSettings(), readJsonSafe(path.join(root, '.ide', 'config.json')));
    info.scripts = loadScripts(root);
    info.checks = loadChecksConfig(root).checks.map((c) => ({ name: c.name, tier: c.tier || 'fast' }));
  } catch (err) {
    info.error = err.message;
    info.config = loadConfig(path.join(root, '__none__'), readSettings());
  }
  return info;
}

// ---------- language servers (opt-in) ----------
/** Settings < the project's .ide/config.json. Servers whose command the project itself defines need your approval before they start. */
const lspConfigFor = (r) => appcore.lspConfigFor(r, readSettings());

const lspSupports = (rel) => { try { return !!ensureLsp().serverFor(String(rel)); } catch { return false; } };
function ensureLsp() {
  if (lsp) return lsp;
  const r = requireRoot();
  lsp = new LspManager({
    root: r,
    workspaceDir: path.join(app.getPath('userData'), 'lsp'),
    getConfig: () => lspConfigFor(r),
    approve: async ({ command, args }) => {
      if (isTrusted(r)) return true;
      const { response } = await dialog.showMessageBox(win, { type: 'warning', buttons: ['Trust and start', 'Cancel'], defaultId: 1, cancelId: 1, title: 'Start a language server?', message: 'This project defines its own language server command', detail: `${command} ${args.join(' ')}\n\n${r}\n\nIt runs on your machine with your permissions. Only continue if you trust this repository.` });
      if (response !== 0) return false;
      writeState(appcore.withTrusted(readState(), r));
      return true;
    },
  });
  lsp.on('diagnostics', (rel, list) => send('lsp:diagnostics', rel, list));
  lsp.on('state', (st) => send('lsp:state', st));
  return lsp;
}

// ---------- notifications ----------
function notify(kind, title, body) {
  if (SMOKE || !win || win.isDestroyed()) return false;
  const settings = loadConfigSafe(root);
  if (!shouldNotify({ enabled: settings.notifications !== false, focused: win.isFocused(), minimized: win.isMinimized(), kind, kinds: loadConfigSafe(root).notifyKinds })) return false;
  try {
    if (Notification.isSupported()) {
      const n = new Notification({ title, body, silent: false });
      n.on('click', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
      n.show();
    }
    win.flashFrame(true);
    if (process.platform === 'darwin' && app.dock) app.dock.bounce('informational');
  } catch { /* notifications are a convenience */ }
  return true;
}

function loadConfigSafe(r) { try { return loadConfig(r || path.join(app.getPath('userData'), '__none__'), readSettings()); } catch { return { ...DEFAULT_CONFIG, ...readSettings() }; } }

const shellKindOf = (config) => appcore.shellKindOf(config);

const isTrusted = (r) => SMOKE || (readState().trusted || []).includes(r);

/** Run the gates for any known folder without prompting: custom (project-defined) checks need that folder to be trusted already. */
async function runGatesFor(r, { tier = 'fast', signal, onProgress } = {}) {
  let custom = false;
  try { custom = loadChecksConfig(r).custom; } catch (err) { return { error: err.message }; }
  if (custom && !isTrusted(r)) return { error: 'Project not trusted: custom checks were not run. Run the checks once from the toolbar to trust it.' };
  try { return await runChecks(r, { tier, files: 'changed', changedLinesOnly: true, signal, onProgress }); } catch (err) { return { error: err.message }; }
}

/** Gates, then (opt-in) the tests that belong to the changed files. Tests only run when the static gates have no errors, so the agent fixes one kind of problem at a time. */
async function runGatesAndTests(r, o = {}) {
  const res = await runGatesFor(r, o);
  const cfg = withDefaults(loadConfigSafe(r), 'fixLoop');
  if (!cfg.relatedTests || !res || res.error) return res;
  if (relevantFindings(res, cfg.include).length) return res;
  try {
    const changed = await G.changedFiles(r);
    const files = findRelatedTests({ changed, allFiles: listAllFiles(r), readFile: (rel) => fs.readFileSync(path.join(r, rel), 'utf8') });
    if (!files.length) return res;
    const t = await runRelatedTests({ root: r, files, readFile: (rel) => fs.readFileSync(path.join(r, rel), 'utf8'), timeoutSec: cfg.testTimeoutSec, signal: o.signal });
    const findings = [...res.findings, ...t.findings];
    return { ...res, findings, counts: { ...res.counts, error: (res.counts && res.counts.error || 0) + t.findings.length }, tests: { ran: files.length, failed: t.findings.length, skipped: t.skipped } };
  } catch { return res; }
}

/** One line in the scorecard when a run ends: who did the task, what kind of task, and what you did with the result. */
async function recordOutcome(run, outcome) {
  try {
    const kind = (await jevCore.kindOf(run.task, loadConfigSafe(run.root).jev, { key: jevKey() })).kind; // Jev when switched on and sure, else the keyword rules
    let stats = runstats.normalize(run.stats);
    stats = usageTally.fold(stats, run.root); // the last numbers may be newer than what was saved to the run
    if (outcome !== 'merged' && !stats.busyPeriods && !run.files) return; // started and thrown away at once: nothing to learn from
    const cfg = loadConfigSafe(run.root);
    const agent = (cfg.agents || []).find((a) => a.name === run.agent);
    const target = agent ? ollama.localTarget(agent) : null;
    scorecard.add(userFile('scorecard.json'), {
      agent: run.agent || 'agent', model: (target && target.model) || (agent ? ollama.modelOf(agent.command) : ''), local: !!target,
      task: run.task, kind, outcome, escalatedTo: run.escalatedTo || '', fixRounds: stats.fixRounds, fixLoop: !!(withDefaults(cfg, 'fixLoop').enabled), activeMs: stats.activeMs, files: run.files,
      costUsd: stats.costUsd, tokens: stats.tokensIn + stats.tokensOut,
    });
  } catch { /* the scorecard never blocks a merge or a discard */ }
}

function setupFixLoop(onDone) {
  fixloop = new FixLoop({
    getConfig: (r) => withDefaults(loadConfigSafe(r), 'fixLoop'),
    runChecks: (r, o) => runGatesAndTests(r, o),
    paste: (id, text) => ptys.write(id, asPaste(text)),
    submit: (id) => ptys.write(id, '\r'),
    escalate: async (info) => {
      // a stronger agent takes over this run's working copy; the window starts its terminal (it owns the terminals)
      try {
        const base = requireRoot();
        const { runs: list } = await runs.listRuns(base);
        const run = list.find((r) => info.root === r.root || info.root.startsWith(r.root + path.sep));
        if (!run || run.agent === info.agent) return false;
        const agent = (loadConfigSafe(run.root).agents || []).find((a) => a.name === info.agent);
        if (!agent) { dbg('fixloop', `escalation: there is no agent called “${info.agent}” in the settings`); return false; }
        const prompt = buildEscalationPrompt(info.result, { task: run.task, from: run.agent || 'the first agent', round: info.round, include: info.include });
        await runs.recordMeta(run.root, { escalatedTo: agent.name });
        runs.journalEvent(run.root, { kind: 'escalated', text: `${run.agent || 'agent'} → ${agent.name} after ${info.round} fix round${info.round === 1 ? '' : 's'} (${info.findings.length} problem${info.findings.length === 1 ? '' : 's'} left)` });
        dbg('fixloop', `${info.label}: handing the run over to ${agent.name}`);
        send('fixloop:escalate', { from: info.id, runId: run.id, root: run.root, agent: agent.name, prompt });
        return true;
      } catch (err) { dbg('fixloop', `escalation failed: ${err.message}`); return false; }
    },
    emit: (evt) => {
      send('fixloop:status', evt);
      if (evt.state === 'fixing') { const t = fixloop.terms.get(evt.id); if (t) { runs.recordStats(t.root, runstats.addRound); runs.journalEvent(t.root, { kind: 'fix-round', text: String(evt.message || evt.summary || '').slice(0, 200) }); } }
      if (evt.state === 'done' && onDone) { const t = fixloop.terms.get(evt.id); if (t) onDone(t.root); }
      const m = fixLoopMessage(evt);
      if (m) notify('fixloop', m.title, m.body);
    },
  });
}

const budgetTold = new Set();
/** Tell the user once when a run has used its time budget; the fix loop stops for that terminal. */
async function checkBudget(id, term) {
  try {
    const minutes = loadConfigSafe(term.root).runBudgetMinutes;
    if (!minutes) return;
    const { runs: list } = await runs.listRuns(requireRoot());
    const run = list.find((r) => term.root === r.root || term.root.startsWith(r.root + path.sep));
    if (!run) return;
    const b = budgetCore.check(run.stats, minutes);
    if (!b.exceeded || budgetTold.has(run.id)) return;
    budgetTold.add(run.id);
    fixloop.pause(id);
    runs.journalEvent(run.root, { kind: 'budget', text: `${b.usedMin} of ${b.limitMin} min used: fix loop stopped` });
    notify('agent-idle', `${run.name}: time budget used`, `${b.usedMin} of ${b.limitMin} minutes. The fix loop is stopped; decide whether to continue.`);
    send('run:budget', { id: run.id, name: run.name, usedMin: b.usedMin, limitMin: b.limitMin });
  } catch { /* budget is advisory */ }
}

async function handleIdle(id, busyMs, info = {}) {
  const term = fixloop.terms.get(id);
  if (term && busyMs > 0) {
    try { // statistics and the journal are nice to have: they must never keep the IDE from hearing that the agent stopped
      runs.recordStats(term.root, (st) => runstats.addBusy(st, busyMs));
      runs.journalEvent(term.root, { kind: info.prompt ? 'permission-prompt' : 'idle', text: `worked ${Math.round(busyMs / 1000)}s` });
      checkBudget(id, term);
    } catch { /* ignored */ }
  }
  const t = fixloop.terms.get(id);
  const label = (t && t.label) || 'Agent';
  dbg('idle', `${label} (terminal ${id}) ${info.hook ? 'said it finished (hook)' : 'went quiet'} after ${Math.round(busyMs / 1000)}s of work${info.prompt ? ', looks like a permission prompt' : ''}`);
  const res = await afterIdle({ prompt: !!info.prompt, fix: () => fixloop.onIdle(id), send: () => { dbg('idle', `told the window that ${label} (terminal ${id}) is idle`); send('agent:idle', id, { hook: !!info.hook }); }, notify: (title, body) => { dbg('idle', `notification: ${title}`); notify('agent-idle', title, body); }, label });
  dbg('fixloop', `${label}: fix loop result ${res ? res.action : 'none'}${res && res.error ? ` (${res.error})` : ''}`);
}

// Token use of a cloud Claude session: the Stop hook says where its transcript is; only files inside the Claude folder are read.
function readTranscriptUsage(id, file) {
  try {
    const real = fleet.safeTranscriptPath(file);
    if (!real) return;
    const u = fleet.transcriptUsage(fleet.readTail(real));
    if (u.messages) send('fleet:transcript', id, u);
    if (captureOn()) { // the shape of a few real transcript lines that carry token usage
      let n = 0;
      for (const line of fleet.readTail(real).split('\n').reverse()) { if (n >= 3) break; if (!line.includes('"usage"')) continue; try { capture.record('transcript', JSON.parse(line)); n++; } catch { /* a cut line */ } }
    }
  } catch (e) { dbg('hook', `could not read the transcript for terminal ${id}: ${e.message}`); }
}
// ---------- IPC ----------
// capture of real traffic (opt-in, see core/capture.js): shapes of what Claude Code, model servers and ACP agents really send, to become test fixtures
const captureCore = require('../core/capture');
const capture = new captureCore.Capture({
  dir: path.join(app.getPath('userData'), 'capture'),
  enabled: () => captureOn(),
  info: () => ({ app: app.getVersion(), platform: process.platform, arch: process.arch, electron: process.versions.electron, node: process.versions.node }),
});
let capCache = { at: 0, on: false };
function captureOn() { const n = Date.now(); if (n - capCache.at > 1500) capCache = { at: n, on: readSettings().capture === true }; return capCache.on; }
/** A model request or reply seen by the tool-call helper; the reply arrives as raw text and is cut into sanitized frames here. */
const recordModel = captureCore.modelRecorder(capture);
function captureModel(kind, data, meta) { if (captureOn()) recordModel(kind, data, meta); }
const driftCore = require('../core/drift');
const jevCore = require('../core/jev');
const healthCore = require('../core/health');
const copilotCore = require('../core/copilot');
const insightsCore = require('../core/insights');
const friendlyCore = require('../core/friendly');
const extEditor = require('../core/externaleditor');
const awayCore = require('../core/awaysummary');
const { StartupWatch } = require('../core/startupwatch');
const openaiAdapter = require('../core/openaiadapter');
const githookCore = require('../core/githook');
const secrets = () => new SecretStore(userFile('secrets.json'), { available: () => safeStorage.isEncryptionAvailable(), encrypt: (t) => safeStorage.encryptString(t), decrypt: (b) => safeStorage.decryptString(b) });
let hookSeenAt = 0;
const jevKey = () => { try { return secrets().get('jev') || ''; } catch { return ''; } };
const drift = new driftCore.Drift({ file: userFile('claude-code.json'), notify: (text) => { dbg('hook', text); send('drift:notice', text); } });
const hookServer = new HookServer({
  log: (t) => dbg('hook', t),
  onRaw: (event, payload, meta) => { hookSeenAt = Date.now(); capture.record('hook', payload, { event, ...meta }); drift.noteHook(event, payload); },
  onEvent: (id, event, p) => {
    if (event === 'stop') { dbg('hook', `terminal ${id}: Stop (Claude Code finished responding)${p.last_assistant_message ? `: ${String(p.last_assistant_message).replace(/\s+/g, ' ').slice(0, 160)}` : ''}`); ptys.hookIdle(id); readTranscriptUsage(id, p.transcript_path); }
    else if (event === 'notification') {
      const kind = String(p.notification_type || '');
      dbg('hook', `terminal ${id}: Notification ${kind || '?'}: ${String(p.message || '').slice(0, 160)}`);
      if (/permission|elicitation/i.test(kind) || /permission/i.test(String(p.message || ''))) ptys.hookPrompt(id, p.message);
    } else if (event === 'substart' || event === 'substop') {
      const clip = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').slice(0, n);
      const sub = { kind: event, agentId: clip(p.agent_id, 80), type: clip(p.agent_type, 60), text: event === 'substop' ? clip(p.last_assistant_message, 300) : '' };
      dbg('hook', `terminal ${id}: subagent ${event === 'substart' ? 'started' : 'finished'}: ${sub.type || '?'} (${sub.agentId || 'no id'})${sub.text ? `: ${sub.text.slice(0, 120)}` : ''}`);
      send('fleet:subagent', id, sub);
    } else dbg('hook', `terminal ${id}: got its task (UserPromptSubmit)`);
  },
});
const fleet = require('../core/fleet');
const updatesCore = require('../core/updater');
const { OtelReceiver } = require('../core/otel');
const { BazingaMcp } = require('../core/mcpserver');
const acpCore = require('../core/acp');
const fleetSettings = () => { const f = loadConfigSafe(root).fleet || {}; return { staleMinutes: Math.min(120, Math.max(1, Number(f.staleMinutes) || 5)), prices: f.prices && typeof f.prices === 'object' ? f.prices : {} }; };
const otelReceiver = new OtelReceiver({
  log: (t) => dbg('hook', `telemetry: ${t}`),
  onRaw: (info) => { const { body, ...meta } = info; capture.record('telemetry', body || {}, meta); const v = driftCore.versionFromTelemetry(body); if (v) drift.noteVersion(v); },
  onUpdate: (id, snapshot, activity) => { send('fleet:otel', id, snapshot, activity); rememberUsage(id, snapshot); },
});
// what each agent terminal has used, added up per run and stored in the run (the scorecard's cost per merged run)
const { UsageTally } = require('../core/usagetally');
const usageTally = new UsageTally({
  estimate: (snap) => fleet.estimateCost({ input: snap.input, output: snap.output, cacheRead: snap.cacheRead, cacheCreate: snap.cacheCreation }, snap.model, fleetSettings().prices),
  save: (r, sum) => { runs.recordStats(r, (st) => runstats.setUsage(st, sum)); },
});
function rememberUsage(id, snap) {
  try { const t = fixloop && fixloop.terms && fixloop.terms.get(id); if (t) usageTally.update(id, t.root, snap); } catch { /* usage numbers never break the window */ }
}
// Bazinga as an MCP server for agents (opt-in): the real work (run list, confirmation dialog, starting a run) happens in the window
const pendingCalls = new Map(); let callSeq = 0;
function rendererCall(method, args, timeoutMs = 60000) {
  return new Promise((resolve) => {
    const id = ++callSeq;
    const timer = setTimeout(() => { pendingCalls.delete(id); resolve({ error: 'Bazinga did not answer in time.' }); }, timeoutMs);
    pendingCalls.set(id, (v) => { clearTimeout(timer); resolve(v); });
    send('mcp:call', id, method, args);
  });
}
const mcpServer = new BazingaMcp({
  log: (t) => dbg('hook', `mcp: ${t}`),
  handlers: {
    listRuns: (caller) => rendererCall('listRuns', { caller }),
    runStatus: (caller, id) => rendererCall('runStatus', { caller, id }),
    startRun: (caller, args) => rendererCall('startRun', { caller, ...args }, 5 * 60000),
  },
});
const mcpOpts = () => ((loadConfigSafe(root).mcp || {}).server === true ? { server: mcpServer, dir: path.join(app.getPath('userData'), 'mcp') } : null);
const otelOpts = () => (loadConfigSafe(root).telemetry || {}).otel === false ? null : { server: otelReceiver };
const limitsFile = () => userFile('claude-limits.json');
// opt-in: Claude Code runs this command to draw its status line; it also leaves the plan-limit numbers where Bazinga can read them
const hooksOpts = (config) => ({ server: hookServer, dir: path.join(app.getPath('userData'), 'hook-settings'), statusLine: config && config.insights && config.insights.claudeLimits === true ? `node "${path.join(__dirname, '..', '..', 'bin', 'statusline.js')}" "${limitsFile()}"` : undefined });

function registerIpc() {
  setupFixLoop(tryAutoMerge);
  ipcMain.handle('workflow:selfcheck', (_e, st) => (st ? { verdict: wfselfcheck.verdict(st) } : { workflow: wfselfcheck.WORKFLOW }));
  ipcMain.handle('agent:printCommand', (_e, cmd, shell) => printmode.printCommand(cmd, ['ps', 'cmd', 'posix'].includes(shell) ? shell : 'posix'));
  ipcMain.handle('fleet:settings', () => fleetSettings());
  ipcMain.handle('fleet:view', (_e, terms, opts) => safe(async () => fleet.view(Array.isArray(terms) ? terms.slice(0, 200) : [], { ...fleetSettings(), filter: opts && opts.filter, sort: opts && opts.sort, text: String((opts && opts.text) || '').slice(0, 100) })));
  ipcMain.handle('hooks:bind', (_e, token, id) => { hookServer.bind(token, id); return true; });
  ipcMain.handle('mcp:bind', (_e, token, id) => { mcpServer.bind(token, id); return true; });
  ipcMain.handle('mcp:reply', (_e, id, value) => { const f = pendingCalls.get(id); if (f) { pendingCalls.delete(id); f(value); } return true; });
  ipcMain.handle('otel:bind', (_e, token, id) => { otelReceiver.bind(token, id); return true; });
  ptys = new PtyManager((ch, ...args) => { if (ch === 'pty:exit') { hookServer.unbind(args[0]); otelReceiver.unbind(args[0]); mcpServer.unbind(args[0]); dbg('pty', `terminal ${args[0]} exited with code ${args[1]}`); fixloop.unregister(args[0]); } send(ch, ...args); }, { onIdle: (id, busyMs, info) => { handleIdle(id, busyMs, info).catch(() => {}); },
    onPrompt: (id, p) => { const t = fixloop.terms.get(id); dbg('prompt', `terminal ${id}: permission prompt detected: ${String(p.text || '').replace(/\s+/g, ' ').slice(0, 200)}`); notify('agent-prompt', `${(t && t.label) || 'Agent'} needs your approval`, p.text || 'The agent is asking for permission.'); send('agent:prompt', id, p.text); } });

  debug.file = userFile('debug.log');
  ipcMain.handle('debug:log', (_e, source, text) => { debug.add(String(source || 'app'), String(text || '')); return true; });
  ipcMain.handle('debug:get', (_e, since = 0) => debug.since(Number(since) || 0));
  ipcMain.handle('debug:clear', () => { debug.clear(); return true; });
  ipcMain.handle('debug:save', async () => {
    const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), 'bazinga-debug.log'), filters: [{ name: 'Log', extensions: ['log', 'txt'] }] });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, debug.text()); return r.filePath;
  });

  ipcMain.handle('project:get', () => describeProject());

  const pickFolder = async () => {
    const res = await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: 'Open project folder' });
    return res.canceled || !res.filePaths[0] ? null : res.filePaths[0];
  };
  const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
  ipcMain.handle('project:open', async (_e, dir) => {
    const target = dir ? String(dir) : await pickFolder();
    if (!target || !isDir(target)) return describeProject();
    ptys.killAll();
    setRoot(target);
    return describeProject();
  });
  ipcMain.handle('project:recent', () => pruneRecent(readState().recent, isDir).filter((p) => p !== root));
  // a second window is a second process: it has its own project, terminals and agents, so nothing running here is touched
  ipcMain.handle('project:openWindow', async (_e, dir) => {
    const target = dir ? String(dir) : await pickFolder();
    if (!target || !isDir(target)) return false;
    const { spawn } = require('node:child_process');
    const session = path.join(app.getPath('userData'), 'windows', String(Date.now()));
    const args = [...(app.isPackaged ? [] : [app.getAppPath()]), target, `--session-data=${session}`];
    const child = spawn(process.execPath, args, { detached: true, stdio: 'ignore', env: { ...process.env } });
    child.unref();
    const st = readState(); st.recent = addRecent(st.recent, target); writeState(st);
    return true;
  });
  ipcMain.handle('project:running', () => ptys.count ? ptys.count() : 0);

  // files
  ipcMain.handle('fs:list', (_e, rel) => {
    const abs = resolveInRoot(rel);
    const entries = fs.readdirSync(abs, { withFileTypes: true })
      .filter((d) => d.name !== '.git' && !(d.isDirectory() && IGNORED_DIRS.has(d.name)))
      .map((d) => ({ name: d.name, rel: toPosix(path.relative(requireRoot(), path.join(abs, d.name))), dir: d.isDirectory() }));
    entries.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
    return entries;
  });

  ipcMain.handle('fs:read', (_e, rel) => {
    const abs = resolveInRoot(rel);
    let stat;
    try { stat = fs.statSync(abs); } catch { return { missing: true, content: '' }; }
    if (stat.size > MAX_FILE_BYTES) return { tooLarge: true, size: stat.size, content: '' };
    const buf = fs.readFileSync(abs);
    if (buf.subarray(0, 8000).includes(0)) return { binary: true, size: stat.size, content: '' };
    return { content: buf.toString('utf8'), size: stat.size };
  });

  ipcMain.handle('fs:write', async (_e, rel, content) => {
    const abs = resolveInRoot(rel);
    try { await lhBaseline(requireRoot(), toPosix(rel)); } catch { /* history is best effort */ }
    fs.writeFileSync(abs, content, 'utf8');
    try { getLocalHistory().record(requireRoot(), toPosix(rel), content, { label: 'saved in the IDE' }); } catch { /* best effort */ }
    return true;
  });

  ipcMain.handle('fs:create', (_e, rel, opts) => safe(async () => {
    const r = requireRoot();
    const abs = resolveInRoot(rel);
    if (fs.existsSync(abs)) return { error: 'A file or folder with that name already exists.' };
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    if (opts && opts.dir) fs.mkdirSync(abs);
    else {
      fs.writeFileSync(abs, '');
      try { getLocalHistory().record(r, toPosix(rel), '', { label: 'created' }); } catch { /* best effort */ }
    }
    return { ok: true };
  }));

  // Snapshots every file under `abs` into local history (best effort) before a delete, so it stays recoverable
  // even for files that were never tracked by git.
  function snapshotBeforeDelete(r, abs, rel) {
    try {
      const stat = fs.statSync(abs);
      if (stat.isDirectory()) {
        for (const name of fs.readdirSync(abs)) {
          if (name === '.git' || IGNORED_DIRS.has(name)) continue;
          snapshotBeforeDelete(r, path.join(abs, name), toPosix(path.join(rel, name)));
        }
        return;
      }
      if (stat.size > MAX_FILE_BYTES) return;
      const buf = fs.readFileSync(abs);
      if (buf.subarray(0, 8000).includes(0)) return; // binary: skip the snapshot, the delete still proceeds
      getLocalHistory().record(r, rel, buf.toString('utf8'), { label: 'before delete' });
    } catch { /* best effort */ }
  }

  ipcMain.handle('fs:delete', (_e, rel) => safe(async () => {
    const r = requireRoot();
    const abs = resolveInRoot(rel);
    if (abs === r) return { error: 'Cannot delete the project root.' };
    if (!fs.existsSync(abs)) return { error: 'Already gone.' };
    snapshotBeforeDelete(r, abs, toPosix(rel));
    fs.rmSync(abs, { recursive: true });
    return { ok: true };
  }));

  ipcMain.handle('fs:rename', (_e, fromRel, toRel) => safe(async () => {
    const r = requireRoot();
    const from = resolveInRoot(fromRel);
    const to = resolveInRoot(toRel);
    if (from === r) return { error: 'Cannot rename the project root.' };
    if (!fs.existsSync(from)) return { error: 'Not found.' };
    if (fs.existsSync(to)) return { error: 'A file or folder with that name already exists.' };
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(from, to);
    return { ok: true };
  }));

  ipcMain.handle('fs:duplicate', (_e, rel) => safe(async () => {
    const r = requireRoot();
    const from = resolveInRoot(rel);
    if (from === r) return { error: 'Cannot duplicate the project root.' };
    if (!fs.existsSync(from)) return { error: 'Not found.' };
    const dir = path.dirname(from);
    const base = path.basename(from);
    const isFile = fs.statSync(from).isFile();
    const dot = base.lastIndexOf('.');
    const [stem, ext] = isFile && dot > 0 ? [base.slice(0, dot), base.slice(dot)] : [base, ''];
    let candidate = `${stem} copy${ext}`;
    for (let n = 2; fs.existsSync(path.join(dir, candidate)); n++) candidate = `${stem} copy ${n}${ext}`;
    const to = path.join(dir, candidate);
    fs.cpSync(from, to, { recursive: true });
    return { ok: true, rel: toPosix(path.relative(r, to)) };
  }));

  ipcMain.handle('search:replace', (_e, opts) => safe(async () => {
    const r = requireRoot();
    const found = await search(r, opts, 20000);
    if (found.error) return { error: found.error };
    const files = [...new Set((found.results || []).map((h) => h.file))];
    let changedFiles = 0;
    let replacements = 0;
    for (const rel of files) {
      const abs = resolveInRoot(rel);
      let buf;
      try { buf = fs.readFileSync(abs); } catch { continue; }
      if (buf.subarray(0, 8000).includes(0)) continue; // binary
      const res = replaceInText(buf.toString('utf8'), opts);
      if (res.error) return res;
      if (!res.count) continue;
      try { await lhBaseline(r, rel); } catch { /* best effort */ }
      fs.writeFileSync(abs, res.content, 'utf8');
      try { getLocalHistory().record(r, rel, res.content, { label: 'replace in files' }); } catch { /* best effort */ }
      changedFiles++;
      replacements += res.count;
    }
    return { files: changedFiles, replacements };
  }));

  // local history
  ipcMain.handle('localhistory:list', (_e, rel) => safe(async () => { resolveInRoot(rel); return { entries: getLocalHistory().list(requireRoot(), toPosix(rel)) }; }));
  ipcMain.handle('localhistory:read', (_e, rel, id) => safe(async () => { resolveInRoot(rel); return { content: getLocalHistory().read(requireRoot(), toPosix(rel), id) }; }));
  ipcMain.handle('localhistory:restore', (_e, rel, id) => safe(async () => {
    const r = requireRoot(); const abs = resolveInRoot(rel); const lh = getLocalHistory();
    const content = lh.read(r, toPosix(rel), id);
    try { lh.record(r, toPosix(rel), fs.readFileSync(abs, 'utf8'), { label: 'before restore' }); } catch { /* file did not exist */ }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
    lh.record(r, toPosix(rel), content, { label: 'restored' });
    return { restored: true };
  }));

  ipcMain.handle('files:all', () => safe(async () => ({ files: await G.projectFiles(requireRoot()) })));

  ipcMain.handle('search:run', (_e, opts) => safe(() => search(requireRoot(), opts)));

  ipcMain.handle('todos:scan', () => safe(() => todos.scan(requireRoot())));

  ipcMain.handle('rest:send', (_e, req) => safe(() => {
    const id = req && req.id;
    const ac = new AbortController();
    if (id) restAborts.set(id, ac);
    const vars = environments.activeVars(requireRoot());
    return restclient.send({ ...req, vars }, undefined, ac.signal).finally(() => { if (id) restAborts.delete(id); });
  }));
  ipcMain.handle('rest:cancel', (_e, id) => { const ac = restAborts.get(id); if (ac) ac.abort(); return true; });
  ipcMain.handle('rest:list', () => safe(() => restclient.loadCollection(requireRoot())));
  ipcMain.handle('rest:save', (_e, reqs) => safe(() => restclient.saveCollection(requireRoot(), reqs)));

  ipcMain.handle('env:list', () => safe(() => environments.load(requireRoot())));
  ipcMain.handle('env:save', (_e, state) => safe(() => environments.save(requireRoot(), state)));
  ipcMain.handle('env:activeVars', () => safe(() => environments.activeVars(requireRoot())));

  // git
  // null = git failed just now (index busy, repository mid-operation): the UI keeps the list it has instead of showing "no changes"
  ipcMain.handle('git:changes', async () => {
    if (!root) return [];
    try { return await G.changedFilesStrict(root); } catch { return (await G.isRepo(root)) ? null : []; }
  });
  ipcMain.handle('git:head', async (_e, rel) => G.headContent(requireRoot(), rel));
  ipcMain.handle('git:stage', (_e, paths) => safe(() => G.stage(requireRoot(), paths)));
  ipcMain.handle('git:unstage', (_e, paths) => safe(() => G.unstage(requireRoot(), paths)));
  ipcMain.handle('git:stageAll', () => safe(() => G.stageAll(requireRoot())));
  ipcMain.handle('git:commit', (_e, message) => safe(async () => ({ output: await G.commit(requireRoot(), message) })));
  ipcMain.handle('git:revert', (_e, rel) => safe(async () => { resolveInRoot(rel); return { result: await G.revertFile(requireRoot(), rel) }; }));
  // agent runs (git worktrees)
  ipcMain.handle('runs:list', () => safe(async () => {
    const base = requireRoot();
    const got = await runs.listRuns(base);
    // kind + autoMergeArmed: cheap (keyword classifier, not the async Jev one) so the Fleet dashboard can show at a
    // glance which runs might merge themselves - "armed" means auto-merge is on and applies to this kind of task,
    // not that the gates are clean right now (that still needs guardForRun, done only when you open the run).
    const list = (got.runs || []).map((r) => {
      const kind = scorecard.kindOf(r.task);
      const cfg = withDefaults(loadConfigSafe(r.root), 'autoMerge');
      const autoMergeArmed = !!cfg.enabled && (!Array.isArray(cfg.kinds) || !cfg.kinds.length || cfg.kinds.includes(kind));
      return { ...r, kind, autoMergeArmed };
    });
    return { ...got, runs: list, current: base };
  }));
  ipcMain.handle('runs:create', (_e, opts = {}) => safe(async () => {
    const base = requireRoot();
    let linkDirs = [];
    try { linkDirs = loadConfig(base, readSettings()).runLinkDirs || []; } catch { /* defaults */ }
    const run = await runs.createRun(base, { name: opts.name, task: opts.task, agent: opts.agent, allow: opts.allow, linkDirs });
    const state = readState();
    if ((state.trusted || []).includes(base) && !(state.trusted || []).includes(run.root)) { state.trusted.push(run.root); writeState(state); }
    runs.journalEvent(run.root, { kind: 'created', text: `${run.agent || 'agent'}: ${String(run.task || run.name).slice(0, 200)}` });
    return { run };
  }));
  ipcMain.handle('runs:journal', (_e, id) => safe(async () => { const ev = await runs.readJournal(requireRoot(), id); return { events: ev, text: journalCore.format(ev) }; }));
  // session replay: the run's journal merged with its commits (while prepareReview has not yet folded them away)
  ipcMain.handle('runs:replay', (_e, id) => safe(async () => {
    const base = requireRoot();
    const [events, commits] = await Promise.all([runs.readJournal(base, id), runs.runCommits(base, id)]);
    return { steps: replay.buildTimeline({ events, commits }) };
  }));
  // ---------- agent runs in a Docker container ----------
  ipcMain.handle('container:check', () => safe(async () => {
    const cfg = loadConfigSafe(root).agentContainer || {};
    const settings = containerCore.normalizeSettings(cfg);
    return { enabled: settings.enabled, docker: !!which('docker'), image: settings.image };
  }));
  // one-click setup: is Docker there, is the image built; build it from the files shipped with the app
  const dockerRun = (args, timeoutMs) => new Promise((resolve) => {
    const proc = require('node:child_process').spawn('docker', args, { windowsHide: true });
    let out = ''; const add = (d) => { out = (out + d).slice(-4000); };
    proc.stdout.on('data', add); proc.stderr.on('data', add);
    const timer = setTimeout(() => { try { proc.kill(); } catch { /* gone */ } }, timeoutMs);
    proc.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, out: e.message }); });
    proc.on('close', (code) => { clearTimeout(timer); resolve({ code, out }); });
  });
  ipcMain.handle('container:setup', (_e, opts = {}) => safe(async () => {
    const cfg = loadConfigSafe(root).agentContainer || {};
    const settings = containerCore.normalizeSettings({ ...cfg, ...(opts.image ? { image: opts.image } : {}) });
    const docker = !!which('docker');
    const image = docker ? (await dockerRun(['image', 'inspect', settings.image], 20000)).code === 0 : false;
    if (opts.action !== 'build') return { docker, image, imageName: settings.image, ...containerCore.setupStep({ docker, image, enabled: settings.enabled }) };
    if (!docker) return { docker, image, imageName: settings.image, ...containerCore.setupStep({ docker, image, enabled: settings.enabled }) };
    const dir = path.join(app.getPath('userData'), 'docker-agent');
    fs.mkdirSync(dir, { recursive: true });
    for (const f of containerCore.CONTEXT_FILES) fs.writeFileSync(path.join(dir, f), fs.readFileSync(path.join(__dirname, '..', '..', 'docker', 'agent', f)));
    const r = await dockerRun(containerCore.buildArgs(settings.image, dir), 20 * 60000);
    return { docker, image: r.code === 0, imageName: settings.image, log: r.out, ...containerCore.setupStep({ docker, image: r.code === 0, enabled: settings.enabled }), ...(r.code === 0 ? {} : { text: `The build failed (exit ${r.code}). Last output:\n${r.out.split('\n').slice(-8).join('\n')}` }) };
  }));
  ipcMain.handle('container:plan', (_e, opts = {}) => safe(async () => {
    const base = requireRoot();
    const { run } = await runs.findRun(base, opts.runId);
    const settings = containerCore.normalizeSettings(loadConfigSafe(run.root).agentContainer);
    const commonGitDir = await runs.commonGitDir(run.root);
    const worktreeGitDir = path.resolve(run.root, (await G.git(run.root, ['rev-parse', '--git-dir'])).trim());
    const user = process.platform === 'linux' && process.getuid ? { uid: process.getuid(), gid: process.getgid() } : null;
    const args = containerCore.buildRunArgs({ settings, worktree: run.root, commonGitDir, worktreeGitDir, user, runId: run.id });
    const gitVal = async (k) => { try { return (await G.git(run.root, ['config', k])).trim(); } catch { return ''; } };
    const [name, email] = [await gitVal('user.name'), await gitVal('user.email')];
    const env = { BAZINGA_TASK: String(opts.task || ''), BAZINGA_AGENT_CMD: containerCore.agentCommandFor({ command: opts.agentCommand }, opts.taskTemplate) };
    if (name) { env.GIT_AUTHOR_NAME = name; env.GIT_COMMITTER_NAME = name; }
    if (email) { env.GIT_AUTHOR_EMAIL = email; env.GIT_COMMITTER_EMAIL = email; }
    runs.journalEvent(run.root, { kind: 'container', text: `${settings.image}, network ${settings.network}, ${settings.memory}, ${settings.cpus} cpu` });
    return { command: containerCore.toShellLine(args, ['ps', 'cmd', 'posix'].includes(opts.shell) ? opts.shell : 'posix'), env, hostEnv: settings.passEnv, image: settings.image };
  }));

  // ---------- skills (two levels: IDE = ~/<skillsDir>, project = <project>/<skillsDir>) ----------
  const skillCheckouts = new Map();
  const dropCheckout = (token) => { const c = skillCheckouts.get(token); if (c) { fs.rmSync(c.tmp, { recursive: true, force: true }); skillCheckouts.delete(token); } };
  const skillHome = () => process.env.BAZINGA_HOME || (SMOKE ? USER_DATA_OVERRIDE : os.homedir());
  const skillDirs = (level) => { const c = loadConfigSafe(root); return skillsCore.levelDirs(level, { root, home: skillHome(), skillsDir: c.skillsDir, mirrors: c.skillsMirrors }); };
  const skillDir = (level) => skillDirs(level)[0];
  // Shipped inside the app itself (same pattern as the docker/agent/<f> read above) - no git fetch, so these
  // install as a local copy and never show an "Update" button (their freshness tracks Bazinga's own version).
  const bundledSkillsDir = () => path.join(__dirname, '..', '..', 'bundled-skills');
  /** Agents without skill support read AGENTS.md: keep its managed block in step with the project's skills. */
  function refreshSkillIndex() {
    if (!root) return null;
    const c = loadConfigSafe(root);
    if (c.skillsIndex === false) return null;
    const file = path.join(root, 'AGENTS.md');
    let cur = ''; try { cur = fs.readFileSync(file, 'utf8'); } catch { /* none yet */ }
    const next = skillindex.applyBlock(cur, skillsCore.listInstalled(skillDir('project')), String(c.skillsDir || '.claude/skills').replace(/\\/g, '/'));
    if (next === null) return null;
    if (next === '') { try { fs.unlinkSync(file); } catch { /* already gone */ } return 'AGENTS.md'; } // the file only held our block
    fs.writeFileSync(file, next);
    return 'AGENTS.md';
  }
  // Folders marked as source / tests (core/folderroles.js): saved in .ide/config.json, told to the agents, listed in AGENTS.md.
  const projectFolders = () => folderroles.fromConfig(readJsonSafe(path.join(requireRoot(), '.ide', 'config.json')));
  function refreshFolderIndex(folders) {
    if (!root || loadConfigSafe(root).foldersIndex === false) return null;
    const file = path.join(root, 'AGENTS.md');
    let cur = ''; try { cur = fs.readFileSync(file, 'utf8'); } catch { /* none yet */ }
    const next = folderroles.applyBlock(cur, folderroles.existing(root, folders));
    if (next === null) return null;
    if (next === '') { try { fs.unlinkSync(file); } catch { /* already gone */ } return 'AGENTS.md'; }
    fs.writeFileSync(file, next);
    return 'AGENTS.md';
  }
  ipcMain.handle('folders:mark', (_e, rel, role) => safe(async () => {
    const abs = resolveInRoot(rel);
    if (!fs.statSync(abs).isDirectory()) throw new Error('Only folders can be marked.');
    const folders = folderroles.save(requireRoot(), folderroles.mark(projectFolders(), toPosix(path.relative(requireRoot(), abs)), role || null));
    return { folders, index: refreshFolderIndex(folders) };
  }));
  ipcMain.handle('folders:detect', () => safe(async () => {
    const before = projectFolders();
    const merged = folderroles.mergeDetected(before, folderroles.detect(requireRoot()));
    const added = [...merged.source, ...merged.tests].filter((f) => ![...before.source, ...before.tests].includes(f));
    if (!added.length) return { folders: before, added };
    const folders = folderroles.save(requireRoot(), merged);
    return { folders, added, index: refreshFolderIndex(folders) };
  }));
  ipcMain.handle('skills:list', () => safe(async () => {
    const ide = skillsCore.listInstalled(skillDir('ide'));
    const project = root ? skillsCore.listInstalled(skillDir('project')) : [];
    return { ide, project, effective: skillsCore.effectiveSkills({ ide, project }), dirs: { ide: skillDir('ide'), project: root ? skillDir('project') : null }, also: { ide: skillDirs('ide').slice(1), project: root ? skillDirs('project').slice(1) : [] } };
  }));
  // older installs exist in the primary folder only: copy them to the other agents' folders
  ipcMain.handle('skills:sync', () => safe(async () => {
    const copied = [...skillsCore.syncMirrors(skillDirs('ide')), ...(root ? skillsCore.syncMirrors(skillDirs('project')) : [])];
    return { copied, index: root ? refreshSkillIndex() : null };
  }));
  // a small, curated list bundled with the app itself - see bundled-skills/
  ipcMain.handle('skills:listBundled', () => safe(async () => ({
    skills: skillsCore.findSkills(bundledSkillsDir()).map((k) => ({ name: k.name, description: k.description })),
  })));
  ipcMain.handle('skills:installBundled', (_e, opts = {}) => safe(async () => {
    const targets = skillDirs(opts.level);
    const res = skillsCore.installBundled(bundledSkillsDir(), opts.name, targets, { replace: !!opts.replace });
    if (opts.level === 'project') refreshSkillIndex();
    return { installed: res.name, dir: targets[0], alsoIn: targets.slice(1) };
  }));
  ipcMain.handle('skills:search', (_e, query, owner) => skillsearch.search(query, { owner }));
  ipcMain.handle('skills:fetch', (_e, source) => safe(async () => {
    const parsed = skillsCore.parseSource(source);
    if (parsed.error) throw new Error(parsed.error);
    const got = await skillsCore.fetchSource(parsed);
    const found = skillsCore.findSkills(got.checkout, parsed.subpath);
    if (!found.length) { fs.rmSync(got.tmp, { recursive: true, force: true }); throw new Error(`No SKILL.md found in ${parsed.label}${parsed.subpath ? `/${parsed.subpath}` : ''}.`); }
    const token = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    skillCheckouts.set(token, { ...got, parsed });
    setTimeout(() => dropCheckout(token), 15 * 60 * 1000).unref();
    const skills = found.map((k) => {
      let preview = '';
      try { preview = fs.readFileSync(path.join(got.checkout, k.dir, 'SKILL.md'), 'utf8').slice(0, 4000); } catch { /* unreadable */ }
      // Read-only scan of this candidate's own files - run before anyone installs anything, see core/skillscan.js.
      const findings = skillscan.scanSkillFiles(path.join(got.checkout, k.dir), k.files);
      return { name: k.name, description: k.description, files: k.files.slice(0, 40), fileCount: k.files.length, hasScripts: k.hasScripts, bytes: k.bytes, preview, findings };
    });
    return { token, label: parsed.label, commit: got.commit, skills };
  }));
  ipcMain.handle('skills:install', (_e, opts = {}) => safe(async () => {
    const c = skillCheckouts.get(opts.token);
    if (!c) throw new Error('The download expired. Fetch the source again.');
    const targets = skillDirs(opts.level);
    const found = skillsCore.findSkills(c.checkout, c.parsed.subpath);
    const installed = [];
    for (const name of opts.names || []) {
      const k = found.find((x) => x.name === name);
      if (!k) continue;
      installed.push(skillsCore.installEverywhere(c.checkout, k, targets, { replace: !!opts.replace, source: { label: c.parsed.label, url: c.parsed.url, branch: c.parsed.branch || '', commit: c.commit } }).name);
    }
    dropCheckout(opts.token);
    if (opts.level === 'project') refreshSkillIndex();
    return { installed, dir: targets[0], alsoIn: targets.slice(1) };
  }));
  ipcMain.handle('skills:cancel', (_e, token) => { dropCheckout(token); return true; });
  ipcMain.handle('skills:remove', (_e, opts = {}) => safe(async () => { const removed = skillsCore.removeEverywhere(skillDirs(opts.level), String(opts.name || '')); if (opts.level === 'project') refreshSkillIndex(); return { removed }; }));
  ipcMain.handle('skills:update', (_e, opts = {}) => safe(async () => {
    const target = skillDir(opts.level);
    const cur = skillsCore.listInstalled(target).find((x) => x.name === opts.name);
    if (!cur || !cur.provenance || !cur.provenance.url) throw new Error('This skill has no recorded source, so it cannot be updated.');
    const prov = cur.provenance;
    // Re-fetching is the same "something else changed since we last trusted this" moment `skills:fetch`
    // scans for - an update is not exempt just because this skill was trusted before (its upstream repo,
    // or its maintainer's account, can turn over after the fact). Findings pause here (same token-based
    // "fetched but not yet installed" handoff `skills:fetch`/`skills:install` already use) until the
    // caller re-sends `force: true`.
    let got;
    let token = opts.token;
    if (token && skillCheckouts.has(token)) got = skillCheckouts.get(token);
    else {
      got = await skillsCore.fetchSource({ url: prov.url, branch: prov.branch, label: prov.label });
      token = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      skillCheckouts.set(token, got);
      setTimeout(() => dropCheckout(token), 15 * 60 * 1000).unref();
    }
    const k = skillsCore.findSkills(got.checkout).find((x) => x.dir === prov.skillDir);
    if (!k) { dropCheckout(token); throw new Error('The skill is no longer in its source repository.'); }
    if (got.commit === prov.commit) { dropCheckout(token); return { unchanged: true }; }
    const findings = skillscan.scanSkillFiles(path.join(got.checkout, k.dir), k.files);
    if (findings.length && !opts.force) return { findings, token, from: prov.commit, to: got.commit };
    skillsCore.installEverywhere(got.checkout, { ...k, name: opts.name }, skillDirs(opts.level), { replace: true, source: { label: prov.label, url: prov.url, branch: prov.branch, commit: got.commit } });
    dropCheckout(token);
    if (opts.level === 'project') refreshSkillIndex();
    return { updated: true, from: prov.commit, to: got.commit };
  }));
  // ---------- agent configuration (MCP servers, skills, agents, hooks, instructions) across every runner found in the project ----------
  ipcMain.handle('agentconfig:scan', () => safe(() => agentconfig.scanAll(root)));
  ipcMain.handle('runs:prepareReview', (_e, id) => safe(() => runs.prepareReview(requireRoot(), id)));
  ipcMain.handle('runs:merge', (_e, opts = {}) => safe(async () => {
    const base = requireRoot();
    const { run } = await runs.findRun(base, opts.id);
    const result = await runs.mergeRun(base, opts.id, { message: opts.message, squash: opts.squash !== false });
    await recordOutcome(run, 'merged');
    if (Array.isArray(opts.overriddenItems) && opts.overriddenItems.length) guardoverrides.recordOverride(userFile('guardoverrides.json'), opts.overriddenItems);
    runs.journalEvent(run.root, { kind: 'merged', text: `into ${result && result.into}` }).catch(() => {});
    return { result };
  }));
  // adaptive guard rules: offer to relax a rule once it has been overridden past `THRESHOLD` times
  ipcMain.handle('guardoverrides:get', () => safe(() => {
    const base = requireRoot();
    const cfg = loadConfigSafe(base);
    const eff = require('../core/ciguard').effectivePolicy(base, { mergeGuard: cfg.mergeGuard, protectedPaths: cfg.protectedPaths });
    const store = guardoverrides.load(userFile('guardoverrides.json'));
    return { suggestions: guardoverrides.suggestions(store, eff.policy), counts: store.counts };
  }));
  ipcMain.handle('guardoverrides:dismiss', (_e, ruleId) => safe(() => guardoverrides.dismiss(userFile('guardoverrides.json'), ruleId)));
  ipcMain.handle('guardoverrides:reset', (_e, ruleId) => safe(() => guardoverrides.resetCount(userFile('guardoverrides.json'), ruleId)));
  ipcMain.handle('guardoverrides:relax', (_e, ruleId) => safe(() => {
    const base = requireRoot();
    const settings = readSettings();
    const cfg = loadConfigSafe(base);
    const eff = require('../core/ciguard').effectivePolicy(base, { mergeGuard: cfg.mergeGuard, protectedPaths: cfg.protectedPaths });
    const current = eff.policy[ruleId] || 'warn';
    const next = { ...settings, mergeGuard: { ...(settings.mergeGuard || {}), [ruleId]: guardoverrides.relax(current) } };
    writeJson('settings.json', next);
    guardoverrides.dismiss(userFile('guardoverrides.json'), ruleId);
    return { level: next.mergeGuard[ruleId] };
  }));
  // same relax step, but written into the project's own .ide/config.json instead of the IDE-level settings
  ipcMain.handle('guardoverrides:relaxProject', (_e, ruleId) => safe(() => {
    const base = requireRoot();
    const cfg = loadConfigSafe(base);
    const eff = require('../core/ciguard').effectivePolicy(base, { mergeGuard: cfg.mergeGuard, protectedPaths: cfg.protectedPaths });
    const current = eff.policy[ruleId] || 'warn';
    const next = guardoverrides.relax(current);
    guardoverrides.relaxProject(base, ruleId, next);
    guardoverrides.dismiss(userFile('guardoverrides.json'), ruleId);
    return { level: next };
  }));
  ipcMain.handle('runs:discard', (_e, id, why) => safe(async () => {
    const base = requireRoot();
    const { run } = await runs.findRun(base, id);
    if (why !== 'skip') await recordOutcome(run, why === 'lost' ? 'lost' : 'discarded'); // 'skip': a self-check's throw-away run
    await runs.journalEvent(run.root, { kind: 'discarded' });
    return runs.removeRun(base, id);
  }));
  // compare two runs (same task, two agents): files, size, and the gate result of each
  ipcMain.handle('runs:compare', (_e, opts = {}) => safe(async () => {
    const base = requireRoot();
    if (!opts.a || !opts.b || opts.a === opts.b) throw new Error('Pick two different runs to compare.');
    const [ra, rb] = [(await runs.findRun(base, opts.a)).run, (await runs.findRun(base, opts.b)).run];
    const sums = [await compare.summarizeRun(ra), await compare.summarizeRun(rb)];
    if (opts.gates !== false) {
      for (const [i, r] of [ra, rb].entries()) {
        const g = await runGatesFor(r.root, { tier: 'fast' });
        sums[i].gates = g.error ? { error: g.error } : { errors: relevantFindings(g, 'error').length, warnings: relevantFindings(g, 'warning').length - relevantFindings(g, 'error').length };
      }
    }
    return { comparison: compare.compareSummaries(sums[0], sums[1]) };
  }));
  // best of N: summaries (files, size, optionally the gate result) of several runs, for the ranking
  ipcMain.handle('runs:summaries', (_e, opts = {}) => safe(async () => {
    const base = requireRoot();
    const ids = Array.isArray(opts.ids) ? [...new Set(opts.ids.map(String))].slice(0, 6) : [];
    if (ids.length < 2) throw new Error('Pick at least two runs.');
    const sums = [];
    for (const id of ids) {
      const run = (await runs.findRun(base, id)).run;
      const sum = await compare.summarizeRun(run);
      if (opts.gates !== false) {
        const g = await runGatesFor(run.root, { tier: 'fast' });
        sum.gates = g.error ? { error: g.error } : { errors: relevantFindings(g, 'error').length, warnings: relevantFindings(g, 'warning').length - relevantFindings(g, 'error').length };
      }
      sums.push(sum);
    }
    return { sums };
  }));
  // pull request status (gh / az) + work items mentioned by the run; network, so only on request
  ipcMain.handle('runs:status', (_e, id) => safe(async () => {
    const base = requireRoot();
    let jiraBaseUrl;
    try { const c = loadConfig(base, readSettings()); jiraBaseUrl = (c.workItems || {}).jiraBaseUrl || (c.jira || {}).baseUrl; } catch { /* defaults */ }
    return { status: await prstatus.fetchStatus(base, id, { jiraBaseUrl }) };
  }));
  // work items from Azure Boards (az boards) or Jira (REST), to hand to an agent as its task; read-only
  const jiraCfg = (base) => loadConfig(base || root || app.getPath('userData'), readSettings());
  ipcMain.handle('workitems:providers', () => safe(async () => {
    const base = requireRoot();
    const cfg = jiraCfg(base);
    let azure = false;
    try { azure = !!workitems.target(await require('../core/pr').remoteInfo(base), cfg); } catch { /* no remote */ }
    const conn = jira.connection(cfg);
    return { azure, jira: !!(conn && secrets().has('jira')), jiraSettings: { baseUrl: (conn && conn.baseUrl) || '', email: (conn && conn.email) || '', project: (conn && conn.project) || '', flavor: (conn && conn.flavor) || 'cloud', hasToken: secrets().has('jira') }, secure: secrets().available() };
  }));
  ipcMain.handle('workitems:list', (_e, o = {}) => safe(async () => {
    const base = requireRoot();
    const cfg = loadConfig(base, readSettings());
    if (o.provider === 'jira') return jira.list({ cfg, token: secrets().get('jira'), scope: o.scope === 'sprint' ? 'sprint' : 'mine' });
    return workitems.list(base, { scope: o.scope === 'sprint' ? 'sprint' : 'mine', cfg });
  }));
  ipcMain.handle('workitems:show', (_e, id, provider) => safe(async () => {
    const base = requireRoot();
    const cfg = loadConfig(base, readSettings());
    if (provider === 'jira') return jira.show({ cfg, token: secrets().get('jira'), key: id });
    return workitems.show(base, id, { cfg });
  }));
  ipcMain.handle('workitems:comment', (_e, o = {}) => safe(async () => {
    const base = requireRoot();
    const cfg = loadConfig(base, readSettings());
    const r = o.provider === 'jira' ? await jira.comment({ cfg, token: secrets().get('jira'), key: o.id, text: o.text }) : await workitems.comment(base, o.id, o.text, { cfg });
    dbg('workflow', `comment on ${o.provider} ${o.id}: ${r.error ? `failed (${r.error})` : 'posted'}`);
    return r;
  }));
  // saves the connection (not secret) in the IDE settings and the token in the OS key store; returns who the token belongs to
  ipcMain.handle('jira:save', (_e, o = {}) => safe(async () => {
    const conn = { baseUrl: String(o.baseUrl || '').trim().replace(/\/+$/, ''), email: String(o.email || '').trim(), project: String(o.project || '').trim().toUpperCase(), flavor: o.flavor === 'server' ? 'server' : 'cloud' };
    if (!/^https:\/\/[^\s/]+/i.test(conn.baseUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)/i.test(conn.baseUrl)) return { error: 'The base URL must start with https:// (for example https://yourorg.atlassian.net).' };
    if (conn.flavor === 'cloud' && !conn.email) return { error: 'Jira Cloud needs the email address of your Atlassian account.' };
    const store = secrets();
    const token = String(o.token || '').trim() || store.get('jira');
    if (!token) return { error: 'Paste an API token (Jira Cloud: id.atlassian.com → Security → API tokens; Server: a personal access token).' };
    const who = await jira.whoami({ cfg: { jira: conn }, token });
    if (who.error) return { error: who.error };
    if (String(o.token || '').trim()) store.set('jira', token);
    const settings = readSettings(); settings.jira = conn; writeJson('settings.json', settings);
    return { name: who.name };
  }));
  ipcMain.handle('jira:forget', () => safe(async () => { secrets().delete('jira'); return true; }));
  // semantic diff across every changed text file of a run (not just the one open in the editor) - backs the merge
  // dialog's "N symbol changes" line and the AI review prompt's symbol-changes section. findSymbols()/treesitter
  // return [] for a language they don't know, so nothing here needs to guess which files are "code"; a file that
  // errors or is too large just contributes nothing. A second pass pairs each file's leftover 'removed'/'added'
  // entries against every *other* file's, so a function moved (and maybe renamed) across files shows as one entry
  // instead of a spurious removed+added pair - see semanticdiff.crossFileMoves().
  async function allSymbolChanges(root, files) {
    const cfgSym = loadConfigSafe(root).symbolParser;
    const symbolsOf = async (rel, content) => (cfgSym === 'regex' ? null : await treesitter.symbols(rel, content)) || symbols.findSymbols(rel, content);
    const perFile = [];
    for (const f of files) {
      if (f.status === 'D' || f.status === 'U') continue;
      let modified;
      try {
        const abs = path.join(root, f.path);
        if (fs.statSync(abs).size > 2 * 1024 * 1024) continue;
        modified = fs.readFileSync(abs, 'utf8');
      } catch { continue; }
      if (modified.includes('\u0000')) continue; // binary
      const original = await G.headContent(root, f.path);
      try {
        const [oldSymbols, newSymbols] = await Promise.all([symbolsOf(f.path, original), symbolsOf(f.path, modified)]);
        const changes = semanticdiff.diffSymbols(original, modified, oldSymbols, newSymbols);
        perFile.push({ path: f.path, changes, original, modified, oldSymbols: oldSymbols || [], newSymbols: newSymbols || [] });
      } catch { /* one file's parser hiccup should not sink the rest */ }
    }
    const removals = [];
    const additions = [];
    for (const pf of perFile) {
      for (const c of pf.changes) {
        if (c.type === 'removed') { const sym = pf.oldSymbols.find((s) => s.kind === c.kind && s.name === c.name && s.line === c.oldLine); if (sym) removals.push({ path: pf.path, sym, content: pf.original }); }
        if (c.type === 'added') { const sym = pf.newSymbols.find((s) => s.kind === c.kind && s.name === c.name && s.line === c.newLine); if (sym) additions.push({ path: pf.path, sym, content: pf.modified }); }
      }
    }
    const moves = semanticdiff.crossFileMoves(removals, additions);
    const movedRemovals = new Set(moves.map((m) => `${m.fromPath}\u0000${m.kind}\u0000${m.name}\u0000${m.oldLine}`));
    const movedAdditions = new Set(moves.map((m) => `${m.toPath}\u0000${m.kind}\u0000${m.newName || m.name}\u0000${m.newLine}`));
    const out = [];
    for (const pf of perFile) {
      for (const c of pf.changes) {
        if (c.type === 'removed' && movedRemovals.has(`${pf.path}\u0000${c.kind}\u0000${c.name}\u0000${c.oldLine}`)) continue;
        if (c.type === 'added' && movedAdditions.has(`${pf.path}\u0000${c.kind}\u0000${c.name}\u0000${c.newLine}`)) continue;
        out.push({ ...c, path: pf.path });
      }
    }
    return [...out, ...moves];
  }
  async function symbolChangesForRun(root, files) { return (await allSymbolChanges(root, files)).length; }
  // merge guard: gates + scope analysis of one run, judged by the project's policy
  async function guardForRun(base, run, opts = {}) {
    await runs.prepareReview(base, run.id);
    const cfg = loadConfigSafe(run.root);
    const res = await runGatesFor(run.root, { tier: 'fast' });
    const gateError = res && res.error ? res.error : null;
    const changed = (await G.changedFiles(run.root)).filter((c) => !c.path.startsWith('.ide/'));
    const analysis = await scope.analyzeScope({
      root: run.root, changed, baseline: null, allow: opts.allow !== undefined ? opts.allow : run.allow, summary: opts.summary,
      knownFiles: opts.summary ? await G.projectFiles(run.root) : undefined,
    });
    const eff = require('../core/ciguard').effectivePolicy(run.root, { mergeGuard: cfg.mergeGuard, protectedPaths: cfg.protectedPaths });
    // nobody is there to tick files as reviewed or to write a summary: those two rules cannot apply to an unattended merge
    const policy = opts.unattended ? { ...eff.policy, unreviewed: 'off', summary: 'off' } : eff.policy;
    const guard = evaluateMerge({ result: gateError ? null : res, gateError, scope: analysis, reviewed: opts.reviewed || [], policy, task: run.task, branch: run.branch, protectedGlobs: eff.protectedGlobs });
    runs.journalEvent(run.root, { kind: 'guard', text: guard.clean ? 'clean' : `${guard.blockers} blocker(s), ${guard.warnings} warning(s): ${guard.items.map((i) => i.id).join(', ')}` });
    // the same fused judgment auto-merge uses, shown whether or not auto-merge itself is on or qualifies - see verdict.js
    const kind = (await jevCore.kindOf(run.task, cfg.jev, { key: jevKey() })).kind;
    const scorecardRows = scorecard.summarize(scorecard.load(userFile('scorecard.json')));
    const mergeVerdict = verdict.mergeVerdict({ guard, scorecardRows, agent: run.agent || 'agent', kind, autoMergeCfg: withDefaults(cfg, 'autoMerge') });
    const symbolChanges = await symbolChangesForRun(run.root, analysis.files);
    return { guard, counts: gateError ? null : res.counts, files: analysis.files.length, changed, verdict: mergeVerdict, symbolChanges };
  }
  // auto-merge: called when the fix loop's gates come back clean (see setupFixLoop's `onDone`). Off unless the project opted
  // in, and even then only for an (agent, kind of task) pairing with enough scorecard history at a high win rate - see automerge.js.
  async function tryAutoMerge(termRoot) {
    try {
      const base = requireRoot();
      const { main, runs: list } = await runs.listRuns(base);
      const run = list.find((r) => termRoot === r.root || termRoot.startsWith(r.root + path.sep));
      if (!run) return;
      const cfg = withDefaults(loadConfigSafe(run.root), 'autoMerge');
      if (!cfg.enabled) return;
      // guardForRun already computes the exact same guard+scorecard verdict (forced "as if enabled" there, which is
      // moot here since cfg.enabled is already real-true) - reuse it instead of asking the scorecard twice.
      const { verdict: v } = await guardForRun(base, run, { unattended: true });
      if (!v.autoMergeEligible) { dbg('automerge', `${run.name}: not auto-merged (${v.detail})`); return; }
      if (cfg.dryRun) {
        runs.journalEvent(run.root, { kind: 'automerge-dryrun', text: `Would auto-merge: ${v.detail}` });
        dbg('automerge', `${run.name}: dry run, not actually merged (${v.detail})`);
        notify('fixloop', `Dry run: “${run.name}” would be auto-merged`, `${v.detail}. Not merged - auto-merge dry run is on.`);
        return;
      }
      const result = await runs.mergeRun(base, run.id, { message: `Auto-merged: ${run.name}`, squash: true });
      await recordOutcome(run, 'merged');
      dbg('automerge', `${run.name}: auto-merged into ${result.into} - ${v.detail}`);
      notify('fixloop', `Auto-merged “${run.name}”`, `${v.detail}. Merged into ${result.into}. You can undo this from the run list.`);
      send('run:automerged', { id: run.id, name: run.name, root: run.root, mainRoot: main.root, into: result.into });
    } catch (err) { dbg('automerge', `failed: ${err.message}`); }
  }
  // end of a workflow with `finish: merge`: every run of the workflow is merged, but only while the merge guard has nothing to say
  ipcMain.handle('workflow:finish', (_e, opts = {}) => safe(async () => {
    const base = requireRoot();
    const merged = [];
    for (const id of [...new Set((opts.runIds || []).map(String))]) {
      let run;
      try { ({ run } = await runs.findRun(base, id)); } catch (err) { return { merged, stopped: id, reason: `the run ${id} is gone (${err.message})` }; }
      const { guard } = await guardForRun(base, run, { unattended: true });
      dbg('workflow', `finish: merge guard for ${run.name}: ${guard.clean ? 'clean' : `${guard.blockers} blocker(s), ${guard.warnings} warning(s): ${guard.items.map((i) => i.id).join(', ')}`}`);
      if (!guard.clean) return { merged, stopped: id, name: run.name, reason: guard.items.map((i) => `${i.level}: ${i.text}`).slice(0, 5).join(' · ') || 'the merge guard is not clean' };
      try {
        const result = await runs.mergeRun(base, id, { message: `${opts.name || run.name}`.slice(0, 120), squash: true });
        await recordOutcome(run, 'merged');
        runs.journalEvent(run.root, { kind: 'merged', text: `into ${result && result.into} (workflow finish)` }).catch(() => {});
        merged.push({ id, name: run.name, into: result && result.into });
      } catch (err) { return { merged, stopped: id, name: run.name, reason: err.message }; }
    }
    return { merged };
  }));
  ipcMain.handle('capture:status', () => capture.status());
  ipcMain.handle('jev:status', () => { const j = jevCore.settings(loadConfigSafe(root).jev); return { enabled: j.enabled, keyEnv: j.keyEnv, hasKey: !!(jevKey() || process.env[j.keyEnv]) }; });
  ipcMain.handle('jev:toggle', (_e, on) => { const cur = readSettings(); const j = { ...(cur.jev || {}), enabled: typeof on === 'boolean' ? on : !(cur.jev && cur.jev.enabled) }; writeJson('settings.json', { ...cur, jev: j }); const st = jevCore.settings(j); return { enabled: st.enabled, keyEnv: st.keyEnv, hasKey: !!(jevKey() || process.env[st.keyEnv]) }; });
  ipcMain.handle('jev:save-key', (_e, o = {}) => safe(async () => {
    const key = String(o.key || '').trim();
    if (!key) return { error: 'Paste your TypeSafe API key first.' };
    if (/\s/.test(key) || key.length < 8) return { error: 'That does not look like a key (it should be one long word without spaces).' };
    if (!secrets().available()) return { error: 'This computer cannot store secrets safely (no system keychain), so the key was not saved. You can set the TYPESAFE_API_KEY environment variable instead.' };
    secrets().set('jev', key);
    const cur = readSettings(); writeJson('settings.json', { ...cur, jev: { ...(cur.jev || {}), enabled: o.enable !== false } });
    return { ok: true };
  }));
  ipcMain.handle('jev:forget', () => safe(async () => { secrets().delete('jev'); const cur = readSettings(); writeJson('settings.json', { ...cur, jev: { ...(cur.jev || {}), enabled: false } }); return { ok: true }; }));
  const cliPath = () => path.join(__dirname, '..', '..', 'bin', 'bazinga.js');
  ipcMain.handle('hook:install', () => safe(async () => { const r = await githookCore.install(requireRoot(), { cliPath: cliPath(), base: 'origin/main' }); return { ok: r.installed.length > 0, skipped: r.skipped }; }));
  ipcMain.handle('hook:remove', () => safe(async () => { await githookCore.uninstall(requireRoot()); return { ok: true }; }));
  // Setup & health: gather the facts (nothing is started or changed), the wording is decided in core/health.js
  ipcMain.handle('health:get', () => safe(async () => {
    const cfg = loadConfigSafe(root);
    const rep = await doctor.runDoctor({ shell: PtyManager.defaultShell(cfg).shell });
    const tools = {}; for (const r of rep.results) tools[r.id] = { ok: r.ok, version: r.version };
    const localAgents = [];
    for (const a of cfg.agents || []) { const t = ollama.localTarget(a); if (t) localAgents.push({ agent: a.name, model: t.model, openai: !!t.openai, baseUrl: t.baseUrl }); }
    const ollamaUrl = (cfg.ollama && cfg.ollama.baseUrl) || ollama.DEFAULT_URL;
    const firstOllama = localAgents.find((a) => !a.openai);
    const o = firstOllama ? await ollama.status(firstOllama.baseUrl || ollamaUrl) : { running: false, installed: [] };
    await Promise.all(localAgents.filter((a) => a.openai).map(async (a) => { try { const s = await openaiAdapter.status(a.baseUrl); a.reachable = !!(s && (s.running !== false)); } catch { a.reachable = false; } }));
    let docker = { docker: !!which('docker'), image: false, enabled: false };
    try { const st = containerCore.normalizeSettings(cfg.agentContainer); docker.enabled = st.enabled; if (docker.docker) docker.image = (await dockerRun(['image', 'inspect', st.image], 15000)).code === 0; } catch { /* invalid settings: shown in the settings row */ }
    let gitHook = null;
    if (root) { try { gitHook = await githookCore.status(root, cliPath()); } catch { gitHook = null; } }
    const dr = drift.status();
    return healthCore.evaluate({
      tools, localAgents, ollama: o, docker, hooksOn: cfg.agentHooks !== false, hookSeen: hookSeenAt > 0,
      copilot: copilotCore.settings(cfg.copilot),
      jev: { enabled: jevCore.settings(cfg.jev).enabled, hasKey: !!(jevKey() || process.env[jevCore.settings(cfg.jev).keyEnv]) },
      captureOn: readSettings().capture === true, drift: { version: dr.version, tested: dr.tested, newer: dr.newer }, gitHook,
      configProblems: (() => { try { return require('../core/configschema').problems(cfg).map((p) => (typeof p === 'string' ? p : p.message || String(p))); } catch { return []; } })(),
    });
  }));
  ipcMain.handle('drift:status', () => drift.status());
  ipcMain.handle('drift:confirm', () => { drift.confirm(); return drift.status(); });
  ipcMain.handle('capture:toggle', (_e, on) => { const next = on === undefined ? !captureOn() : !!on; writeJson('settings.json', { ...readSettings(), capture: next }); capCache = { at: 0, on: false }; return capture.status(); });
  ipcMain.handle('capture:bundle', () => { const file = capture.bundle(); if (file) shell.showItemInFolder(file); else shell.openPath(capture.dir).catch(() => {}); return { file, status: capture.status() }; });
  ipcMain.handle('capture:clear', () => { capture.clear(); return capture.status(); });
  ipcMain.handle('scorecard:get', () => safe(async () => {
    const records = scorecard.load(userFile('scorecard.json'));
    const rows = scorecard.summarize(records);
    const recs = {};
    for (const k of scorecard.KINDS) { const r = scorecard.recommend(rows, k); if (r) recs[k] = r.text; }
    return { rows, recs, total: records.length, kinds: scorecard.KINDS, labels: scorecard.LABELS, minRuns: scorecard.MIN_RUNS };
  }));
  ipcMain.handle('scorecard:clear', () => safe(async () => { try { fs.rmSync(userFile('scorecard.json'), { force: true }); } catch { /* gone */ } return { ok: true }; }));
  ipcMain.handle('scorecard:kind', async (_e, task) => (await jevCore.kindOf(task, loadConfigSafe(root).jev, { key: jevKey() })).kind);
  ipcMain.handle('runs:guard', (_e, opts = {}) => safe(async () => {
    const base = requireRoot();
    const { run } = await runs.findRun(base, opts.id);
    const { changed, ...rest } = await guardForRun(base, run, opts);
    return rest;
  }));

  // ---------- workflows: chained agent steps with gates and approvals (core/workflow.js) ----------
  const wfDirs = () => [
    { source: 'project', dir: path.join(requireRoot(), '.ide', 'workflows') },
    { source: 'ide', dir: path.join(app.getPath('userData'), 'workflows') },
  ];
  ipcMain.handle('workflow:list', () => safe(async () => {
    const out = workflowCore.BUILTIN.map((text, i) => ({ id: `built-in:${i}`, source: 'built-in', ...workflowCore.parse(text, 'built-in') }));
    for (const { source, dir } of wfDirs()) {
      let names = [];
      try { names = fs.readdirSync(dir).filter((f) => /\.ya?ml$/i.test(f)).sort(); } catch { /* none */ }
      for (const f of names) {
        let text = '';
        try { text = fs.readFileSync(path.join(dir, f), 'utf8'); } catch { continue; }
        out.push({ id: `${source}:${f}`, source, file: f, ...workflowCore.parse(text, f) });
      }
    }
    return { workflows: out.map((w) => ({ id: w.id, source: w.source, file: w.file, name: w.workflow && w.workflow.name, description: w.workflow && w.workflow.description, workflow: w.workflow || null, errors: w.errors })) };
  }));
  const wfStateDir = async () => path.join(await runs.commonGitDir(requireRoot()), 'bazinga-workflows');
  const wfIdOk = (id) => /^[A-Za-z0-9._-]{1,60}$/.test(String(id || ''));
  ipcMain.handle('workflow:load', () => safe(async () => {
    const dir = await wfStateDir();
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { /* none */ }
    const states = [];
    for (const f of files) { try { states.push(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))); } catch { /* skip */ } }
    return { states: states.sort((a, b) => (b.created || 0) - (a.created || 0)).slice(0, 20) };
  }));
  ipcMain.handle('workflow:save', (_e, st) => safe(async () => {
    if (!st || !wfIdOk(st.id)) throw new Error('Invalid workflow id.');
    const dir = await wfStateDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${st.id}.json`), JSON.stringify(st, null, 2));
    return true;
  }));
  ipcMain.handle('workflow:remove', (_e, id) => safe(async () => {
    if (!wfIdOk(id)) throw new Error('Invalid workflow id.');
    try { fs.rmSync(path.join(await wfStateDir(), `${id}.json`)); } catch { /* gone */ }
    return true;
  }));
  ipcMain.handle('workflow:layout', (_e, steps) => safe(async () => ({ layout: workflowCore.layout((Array.isArray(steps) ? steps : []).map((x) => ({ id: String(x.id || ''), needs: Array.isArray(x.needs) ? x.needs.map(String) : [] }))) })));
  ipcMain.handle('workflow:validate', (_e, wf) => safe(async () => ({ errors: workflowCore.validate(wf || {}) })));
  ipcMain.handle('workflow:saveFile', (_e, o = {}) => safe(async () => {
    const errors = workflowCore.validate(o.workflow || {});
    if (errors.length) throw new Error(errors.join(' '));
    const where = wfDirs().find((d) => d.source === o.scope);
    if (!where) throw new Error('Choose where to save it: project or IDE.');
    const file = o.file && /^[a-z0-9._-]+\.ya?ml$/i.test(o.file) ? o.file : workflowCore.fileName(o.workflow.name);
    fs.mkdirSync(where.dir, { recursive: true });
    fs.writeFileSync(path.join(where.dir, file), workflowCore.serialize(o.workflow));
    return { file, source: where.source };
  }));
  ipcMain.handle('workflow:deleteFile', (_e, o = {}) => safe(async () => {
    const where = wfDirs().find((d) => d.source === o.source);
    if (!where || !/^[a-z0-9._-]+\.ya?ml$/i.test(String(o.file || ''))) throw new Error('Not a workflow file.');
    fs.rmSync(path.join(where.dir, o.file), { force: true });
    return true;
  }));
  ipcMain.handle('workflow:plan', (_e, st) => safe(async () => {
    const steps = (st && st.workflow && st.workflow.steps) || [];
    const nx = workflowCore.nextSteps(steps, (st && st.steps) || {});
    return { start: nx.start.map((id) => { const stp = steps.find((x) => x.id === id); return { ...stp, rendered: workflowCore.renderTask(stp, { input: st.input }) }; }), reason: nx.reason };
  }));
  ipcMain.handle('workflow:after', (_e, o = {}) => safe(async () => workflowCore.afterGate(o.step, { gatePassed: !!o.gatePassed, attempts: o.attempts, approvalDefault: !!o.approvalDefault })));
  ipcMain.handle('workflow:gate', (_e, opts = {}) => safe(async () => {
    const base = requireRoot();
    const { run } = await runs.findRun(base, opts.runId);
    let files; let guard = null;
    if (opts.gate === 'guard') {
      const g = await guardForRun(base, run, {});
      files = g.changed; guard = g.guard;
    } else {
      await runs.prepareReview(base, run.id);
      files = (await G.changedFiles(run.root)).filter((c) => !c.path.startsWith('.ide/'));
    }
    const res = workflowCore.checkGate(opts.gate || 'none', { files, guard });
    runs.journalEvent(run.root, { kind: 'workflow-gate', text: `${opts.step || ''} ${opts.gate}: ${res.passed ? 'passed' : `failed (${res.why || ''})`}` });
    dbg('workflow', `gate ${opts.gate} for ${opts.step || '?'} in ${run.root}: ${res.passed ? 'passed' : `failed (${res.why || ''})`}; changed files: ${files.map((f) => `${f.status} ${f.path}`).slice(0, 12).join(', ') || 'none'}`);
    return { ...res, files: files.map((f) => f.path), findings: guard ? guard.items.map((i) => `${i.level}: ${i.text}`).slice(0, 10) : [] };
  }));
  ipcMain.handle('runs:remote', () => safe(async () => {
    const { main } = await runs.listRuns(requireRoot());
    const remote = await pr.remoteInfo(main.top);
    const bin = remote.host === 'github' ? 'gh' : remote.host === 'azure' ? 'az' : null;
    return { remote: { host: remote.host, hasOrigin: !!remote.name, cli: bin, cliFound: bin ? !!which(bin) : false } };
  }));
  ipcMain.handle('runs:pr', (_e, opts = {}) => safe(async () => ({ result: await pr.createPr(requireRoot(), opts.id, { title: opts.title, body: opts.body, base: opts.base, draft: !!opts.draft }) })));
  ipcMain.handle('app:openExternal', (_e, url) => { if (/^https:\/\//.test(String(url))) { shell.openExternal(String(url)); return true; } return false; });
  ipcMain.handle('fs:diagnostics', async () => ({
    version: app.getVersion(), platform: process.platform, root, rootReal: root ? (() => { try { return fs.realpathSync(root); } catch { return null; } })() : null,
    isRepo: root ? await G.isRepo(root) : false, watching: watcherOk, retries: watcherRetries, focused: !!(win && win.isFocused()), ...watchStats,
  }));
  // Before an agent starts: its standing instructions go into a file for --append-system-prompt-file, and a local model is
  // checked (server running, model installed, context big enough) and loaded, so the first request is not the slow one.
  ipcMain.handle('agent:prepare', async (_e, agent = {}, opts = {}) => {
    let config = {};
    try { config = loadConfig(root || app.getPath('userData'), readSettings()); } catch { /* defaults */ }
    const prep = await agentprep.prepare(agent, { root, hintDir: agentprep.hintDirFor(app.getPath('userData')), config, proxies: toolProxies, inUse: Array.isArray(opts.inUse) ? opts.inUse.map(String) : [], hooks: config.agentHooks === false || opts.noHooks ? null : hooksOpts(config), otel: otelOpts(), mcp: mcpOpts(), onLog: (line) => dbg('model', line), onUsage: (u) => send('fleet:usage', u), onCapture: captureModel });
    try {
      const l = prep.local;
      dbg('agent', `prepare ${agent.name || agent.command}: ${l ? `local model ${l.model || ''}, context ${l.context || '?'}, restricted tools ${l.restricted ? 'yes' : 'no'}, proxy ${l.proxy ? l.proxy.url : 'none'}, problems ${(l.problems || []).map((p) => p.kind).join(',') || 'none'}` : 'not a local model'}; command: ${String(prep.command).slice(0, 300)}`);
    } catch { /* logging only */ }
    return prep;
  });
  // Self-test of an agent on a local model: send a file, read one, write one (checked on disk). See core/modeltest.js.
  let modelTestJob = null;
  ipcMain.handle('agent:test', async (_e, agent = {}) => {
    if (modelTestJob) return { error: 'A model test is already running.' };
    if (!ollama.isClaudeCommand(agent.command)) return { error: 'The test is for Claude Code agents (the command starts with “claude”).' };
    let config = {};
    try { config = loadConfig(root || app.getPath('userData'), readSettings()); } catch { /* defaults */ }
    send('agent:testProgress', { id: 'prepare', state: 'running' });
    const prep = await agentprep.prepare(agent, { root, hintDir: agentprep.hintDirFor(app.getPath('userData')), config, proxies: toolProxies, onLog: (line) => dbg('model', line), onCapture: captureModel });
    const fail = (p) => ({ ok: false, steps: [{ id: 'server', label: 'Model server', ok: false, detail: p.text }], advice: [], output: '', seconds: 0, server: prep.local });
    if (prep.local) {
      const blocking = prep.local.problems.find((p) => p.kind === 'not-running' || p.kind === 'missing-model');
      if (blocking) return fail(blocking);
    }
    send('agent:testProgress', { id: 'prepare', state: 'done', ok: true, detail: prep.local && prep.local.contextLabel ? `Model loaded with a ${prep.local.contextLabel} context.` : 'Ready.' });
    const ae = config.agentEnv || {};
    const sc = scrubEnv(process.env, { enabled: ae.scrub !== false, allow: ae.allow || [] });
    const env = { ...sc.env, ...(prep.env || {}), ...(agent.env || {}), ...(prep.envForce || {}) };
    const proxy = prep.local && prep.local.proxy ? toolProxies.byUrl(prep.local.proxy.url) : null;
    const minutes = Math.min(120, Math.max(2, Number((config.ollama || {}).testMinutes) || 15));
    modelTestJob = modeltest.start({ command: prep.command, env, timeoutMs: minutes * 60000, proxy, onProgress: (p) => send('agent:testProgress', p) });
    try { const res = await modelTestJob.promise; return { ...res, server: prep.local }; } finally { modelTestJob = null; }
  });
  ipcMain.handle('agent:testCancel', () => { if (modelTestJob) modelTestJob.cancel(); return true; });
  ipcMain.handle('ollama:list', async (_e, baseUrl) => ollama.status(baseUrl || ollama.DEFAULT_URL));
  ipcMain.handle('ollama:warm', async (_e, { baseUrl, model, keepAlive } = {}) => { try { await ollama.warm(baseUrl || ollama.DEFAULT_URL, String(model || ''), String(keepAlive || '15m'), 60000); return { ok: true }; } catch (err) { return { ok: false, error: err.message }; } });
  // AI inline completion (ghost text): off unless a project turns it on. Empty baseUrl/model in settings = use the
  // first configured agent that already talks to an Ollama-style server, the same target the agent terminal uses.
  ipcMain.handle('ai:complete', (_e, { prefix, suffix } = {}) => safe(async () => {
    const r = requireRoot();
    const cfg = loadConfigSafe(r);
    const ic = withDefaults(cfg, 'inlineCompletion');
    if (!ic.enabled) return { skip: true };
    let { baseUrl, model } = ic;
    if (!baseUrl || !model) {
      const found = (cfg.agents || []).map((a) => ollama.localTarget(a)).find((t) => t && t.model);
      if (!found) return { skip: true, reason: 'No agent in Settings points at an Ollama-style model server, and no baseUrl/model is set under inlineCompletion.' };
      baseUrl = baseUrl || found.baseUrl; model = model || found.model;
    }
    try { return await ollama.complete(baseUrl, { model, prompt: String(prefix || ''), suffix: String(suffix || '') }); } catch (err) { return { error: err.message }; }
  }));
  // updates (electron-updater): checks by default, then download on request, then restart to install - never automatic past the check
  let autoUpdater = null;
  const updateState = { status: 'idle', info: null };
  const sendUpdate = (ev, info) => { updateState.status = ev; updateState.info = info || null; send('updates:event', ev, info || {}, updatesCore.describe(ev, info)); };
  function updaterReady() {
    const cfg = loadConfigSafe(root);
    const blocker = updatesCore.installBlocker({ platform: process.platform, packaged: app.isPackaged, portable: !!process.env.PORTABLE_EXECUTABLE_DIR, signed: process.platform === 'darwin' ? undefined : true });
    const f = updatesCore.feedFor(cfg);
    const embedded = app.isPackaged && fs.existsSync(path.join(process.resourcesPath || '', 'app-update.yml')); // written by electron-builder from the repository the release was built in
    if (f.error && !(embedded && !(cfg.updates && (cfg.updates.github || cfg.updates.url)))) return { error: f.error };
    if (blocker && process.platform !== 'darwin') return { error: blocker };
    if (!autoUpdater) {
      ({ autoUpdater } = require('electron-updater'));
      autoUpdater.autoDownload = false; autoUpdater.autoInstallOnAppQuit = false; autoUpdater.allowPrerelease = (cfg.updates || {}).channel === 'beta';
      autoUpdater.on('checking-for-update', () => sendUpdate('checking'));
      autoUpdater.on('update-not-available', () => sendUpdate('none'));
      autoUpdater.on('update-available', (i) => sendUpdate('available', { version: i && i.version }));
      autoUpdater.on('download-progress', (p) => sendUpdate('progress', { percent: p && p.percent, version: updateState.info && updateState.info.version }));
      autoUpdater.on('update-downloaded', (i) => sendUpdate('downloaded', { version: i && i.version }));
      autoUpdater.on('error', (e) => sendUpdate('error', { message: e && e.message }));
    }
    if (f.feed) autoUpdater.setFeedURL(f.feed);
    return { ok: true, note: blocker };
  }
  ipcMain.handle('updates:check', () => safe(async () => { const r = updaterReady(); if (r.error) return { error: r.error }; await autoUpdater.checkForUpdates(); return { ok: true, note: r.note || '' }; }));
  ipcMain.handle('updates:download', () => safe(async () => { if (!autoUpdater || updateState.status !== 'available') return { error: 'There is no update to download. Check first.' }; await autoUpdater.downloadUpdate(); return { ok: true }; }));
  ipcMain.handle('updates:install', () => safe(async () => { if (!autoUpdater || updateState.status !== 'downloaded') return { error: 'No update has been downloaded.' }; setImmediate(() => autoUpdater.quitAndInstall()); return { ok: true }; }));
  ipcMain.handle('app:memory', () => ({ mb: Math.round(app.getAppMetrics().reduce((a, m) => a + ((m.memory && m.memory.workingSetSize) || 0), 0) / 1024) }));
  ipcMain.handle('app:notify', (_e, { kind, title, body } = {}) => notify(kind, String(title || ''), String(body || '')));

  // hunk staging, history, blame, stash
  ipcMain.handle('git:stageHunk', (_e, rel, line) => safe(async () => { resolveInRoot(rel); return { result: await G.stageHunk(requireRoot(), rel, line) }; }));
  ipcMain.handle('git:unstageHunk', (_e, rel, line) => safe(async () => { resolveInRoot(rel); return { result: await G.unstageHunk(requireRoot(), rel, line) }; }));
  ipcMain.handle('history:log', (_e, opts = {}) => safe(async () => {
    const r = requireRoot();
    if (!(await G.isRepo(r))) return { commits: [], rows: [], stashes: [] };
    const commits = await history.log(r, { limit: Math.min(Number(opts.limit) || 300, 2000), skip: Number(opts.skip) || 0 });
    return { commits, rows: history.layoutGraph(commits), stashes: await history.stashList(r) };
  }));
  ipcMain.handle('history:info', (_e, sha) => safe(async () => ({ info: await history.commitInfo(requireRoot(), sha) })));
  ipcMain.handle('history:diff', (_e, sha, rel, oldPath) => safe(async () => ({ diff: await history.commitDiff(requireRoot(), sha, rel, oldPath) })));
  ipcMain.handle('history:blame', (_e, rel) => safe(async () => { resolveInRoot(rel); return { lines: await history.blame(requireRoot(), rel) }; }));
  ipcMain.handle('history:stash', (_e, action, arg) => safe(async () => {
    const r = requireRoot();
    if (action === 'push') return { output: await history.stashPush(r, arg) };
    if (action === 'apply') return { output: await history.stashApply(r, arg) };
    if (action === 'pop') return { output: await history.stashPop(r, arg) };
    if (action === 'drop') return { output: await history.stashDrop(r, arg) };
    throw new Error('Unknown stash action.');
  }));

  // language servers: the renderer keeps documents in sync and asks for hover / definition / references / completion / signature help
  ipcMain.handle('lsp:status', () => safe(async () => ({ status: ensureLsp().status() })));
  ipcMain.handle('lsp:open', (_e, rel, text) => safe(async () => { resolveInRoot(rel); return ensureLsp().open(String(rel), String(text)); }));
  ipcMain.on('lsp:change', (_e, rel, text) => { if (lsp) lsp.change(String(rel), String(text)); });
  ipcMain.on('lsp:close', (_e, rel) => { if (lsp) lsp.close(String(rel)); });
  ipcMain.handle('lsp:request', (_e, rel, kind, pos) => safe(async () => ({ result: await ensureLsp().request(String(rel), String(kind), pos || {}, { includeDeclaration: pos && pos.includeDeclaration, newName: pos && pos.newName }) })));
  ipcMain.handle('lsp:workspaceSymbols', (_e, query) => safe(async () => ({ result: await ensureLsp().workspaceSymbols(String(query || '')) })));

  // real debugger (breakpoints, step, call stack, variables), via the Debug Adapter Protocol - one session at a
  // time. Python only for now (debugpy.adapter, spawned directly; see core/dap.js). Every DAP event is pushed to
  // the renderer as-is on 'dap:event'; it decides what a 'stopped'/'terminated'/'output' event means for the UI.
  ipcMain.handle('dap:start', (_e, { rel } = {}) => safe(async () => {
    const r = requireRoot();
    const abs = resolveInRoot(rel);
    if (!/\.py$/i.test(String(rel))) return { error: 'Debugging is only wired up for Python right now (debugpy.adapter). Other languages still get "Debug this test" (Settings → a Debug lens), which waits for your own IDE’s debugger to attach.' };
    if (dapSession) { await dapSession.stop().catch(() => {}); dapSession = null; }
    const session = new dap.DapSession();
    session.on('event', (event, body) => send('dap:event', event, body));
    dapSession = session;
    try {
      const res = await session.start({ adapter: dap.pythonAdapter(process.platform), program: abs, cwd: r });
      return { ok: true, capabilities: res.capabilities };
    } catch (err) { dapSession = null; return { error: err.message }; }
  }));
  const requireDap = () => { if (!dapSession) throw new Error('No debug session is running.'); return dapSession; };
  ipcMain.handle('dap:setBreakpoints', (_e, { rel, lines } = {}) => safe(async () => ({ breakpoints: await requireDap().setBreakpoints(resolveInRoot(rel), (lines || []).map(Number)) })));
  ipcMain.handle('dap:configurationDone', () => safe(async () => { await requireDap().configurationDone(); return { ok: true }; }));
  ipcMain.handle('dap:continue', (_e, threadId) => safe(async () => { await requireDap().continue_(threadId); return { ok: true }; }));
  ipcMain.handle('dap:next', (_e, threadId) => safe(async () => { await requireDap().next(threadId); return { ok: true }; }));
  ipcMain.handle('dap:stepIn', (_e, threadId) => safe(async () => { await requireDap().stepIn(threadId); return { ok: true }; }));
  ipcMain.handle('dap:stepOut', (_e, threadId) => safe(async () => { await requireDap().stepOut(threadId); return { ok: true }; }));
  ipcMain.handle('dap:pause', (_e, threadId) => safe(async () => { await requireDap().pause(threadId); return { ok: true }; }));
  ipcMain.handle('dap:threads', () => safe(async () => ({ threads: await requireDap().threads() })));
  ipcMain.handle('dap:stackTrace', (_e, threadId) => safe(async () => ({ frames: await requireDap().stackTrace(threadId) })));
  ipcMain.handle('dap:scopes', (_e, frameId) => safe(async () => ({ scopes: await requireDap().scopes(frameId) })));
  ipcMain.handle('dap:variables', (_e, variablesReference) => safe(async () => ({ variables: await requireDap().variables(variablesReference) })));
  ipcMain.handle('dap:stop', () => safe(async () => { if (dapSession) { await dapSession.stop(); dapSession = null; } return { ok: true }; }));

  // run-this-test
  ipcMain.handle('tests:find', (_e, rel, content) => { const dbgOk = testcmd.canDebug(String(rel), String(content)); return testcmd.findTests(String(rel), String(content)).map((t) => ({ line: t.line, name: t.name, kind: t.kind, suite: t.suite, debuggable: dbgOk && t.kind === 'test' })); });
  ipcMain.handle('tests:command', (_e, opts = {}) => safe(async () => {
    const r = requireRoot();
    resolveInRoot(opts.rel);
    const shellKind = shellKindOf(loadConfigSafe(r));
    const c = opts.debug
      ? testcmd.debugCommand(r, opts.rel, { name: opts.name, kind: opts.kind, suite: opts.suite, line: opts.line }, { shellKind, content: opts.content })
      : opts.all
        ? testcmd.fileTestCommand(r, opts.rel, { shellKind, content: opts.content })
        : testcmd.testCommand(r, opts.rel, { name: opts.name, kind: opts.kind, suite: opts.suite, line: opts.line }, { shellKind, content: opts.content });
    if (!c) throw new Error(opts.debug ? 'Debugging from here works for pytest, JUnit (Maven/Gradle), node:test, go test, dotnet test (C#/F#), PHPUnit, RSpec/Minitest and dart/flutter test. For Vitest, Jest, cargo test or sbt testOnly, use your IDE’s debugger.' : 'No test runner found for this file (looked for Maven, Gradle, Vitest, Jest, node:test, pytest, go test, cargo test, dotnet test, PHPUnit, RSpec, Minitest, dart/flutter test and sbt testOnly).');
    return { command: c.command, label: c.label, cwd: path.join(r, c.cwd || ''), note: c.note || '' };
  }));
  // run the test inside the app (not in a terminal) and report one verdict: passed / failed / nothing ran / runner missing
  ipcMain.handle('tests:run', (_e, opts = {}) => safe(async () => {
    const r = requireRoot();
    resolveInRoot(opts.rel);
    const shellKind = process.platform === 'win32' ? 'cmd' : 'posix'; // runShell uses the OS default shell, not the terminal's
    const c = opts.all
      ? testcmd.fileTestCommand(r, opts.rel, { shellKind, content: opts.content })
      : testcmd.testCommand(r, opts.rel, { name: opts.name, kind: opts.kind, suite: opts.suite, line: opts.line }, { shellKind, content: opts.content });
    if (!c) throw new Error('No test runner found for this file (looked for Maven, Gradle, Vitest, Jest, node:test, pytest, go test, cargo test and dotnet test).');
    const res = await runShell(c.command, { cwd: path.join(r, c.cwd || ''), timeoutMs: 5 * 60 * 1000 });
    const v = testrun.summarize(res);
    return { ...v, output: v.output.slice(-60000), command: c.command, label: c.label, cwd: path.join(r, c.cwd || ''), durationMs: res.durationMs };
  }));
  // While you were away: what happened to the agent runs since the window was last in front
  ipcMain.handle('runs:away', (_e, opts = {}) => safe(async () => {
    const base = requireRoot();
    const since = Number(opts.since) || Number(readSettings().awaySeenAt) || 0;
    const [journals, listing] = await Promise.all([runs.allJournals(base), runs.listRuns(base)]);
    const live = (listing.runs || []).map((r) => ({ id: r.id, name: r.name, files: r.files, commits: r.commits }));
    const s = awayCore.summarize({ journals, live, since, now: Date.now() });
    return { ...s, headline: awayCore.headline(s) };
  }));
  ipcMain.handle('runs:awaySeen', () => { writeJson('settings.json', { ...readSettings(), awaySeenAt: Date.now() }); return true; });
  ipcMain.handle('runs:merged', () => safe(async () => ({ merged: await runs.listMerged(requireRoot()) })));
  ipcMain.handle('runs:undo', (_e, commit) => safe(async () => {
    const base = requireRoot();
    const r = await runs.undoMerged(base, String(commit));
    send('fs:changed', { poll: true });
    return r;
  }));
  // What's new: the changelog that ships with the app; "unseen" once per change so it can be shown a single time
  ipcMain.handle('app:changelog', () => safe(async () => {
    let text = '';
    try { text = fs.readFileSync(path.join(__dirname, '..', '..', 'CHANGELOG.md'), 'utf8'); } catch { return { text: '', unseen: false }; }
    const head = text.split('\n').slice(0, 40).join('\n');
    const hash = require('node:crypto').createHash('sha1').update(head).digest('hex').slice(0, 12);
    return { text, hash, unseen: readSettings().changelogSeen !== hash, version: app.getVersion() };
  }));
  ipcMain.handle('app:changelogSeen', (_e, hash) => { writeJson('settings.json', { ...readSettings(), changelogSeen: String(hash).slice(0, 40) }); return true; });
  // open the file in VS Code / IntelliJ (the one that suits the project unless the setting says otherwise)
  const findEditorBin = (id) => {
    const e = extEditor.EDITORS[id];
    for (const b of e.bins) { const p = which(b); if (p) return { bin: p }; }
    if (process.platform === 'darwin') for (const p of e.mac) if (fs.existsSync(p)) return { bin: p };
    return null;
  };
  ipcMain.handle('editor:open', (_e, opts = {}) => safe(async () => {
    const r = requireRoot(); resolveInRoot(opts.rel);
    const cfg = loadConfigSafe(r);
    const available = Object.keys(extEditor.EDITORS).filter((id) => findEditorBin(id));
    const hasJavaBuild = ['pom.xml', 'build.gradle', 'build.gradle.kts'].some((f) => fs.existsSync(path.join(r, f)));
    const id = opts.which === 'vscode' || opts.which === 'idea' ? opts.which : extEditor.pick(cfg.externalEditor, { hasJavaBuild, available });
    const cmd = extEditor.command(id, findEditorBin(id), { root: r, rel: String(opts.rel), line: opts.line, column: opts.column });
    if (cmd.error) throw new Error(cmd.error);
    const child = require('node:child_process').spawn(cmd.bin, cmd.args, { detached: true, stdio: 'ignore', windowsHide: true, shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(cmd.bin) });
    child.on('error', (err) => dbg('app', `open in ${id}: ${err.message}`));
    child.unref();
    return { opened: extEditor.EDITORS[id].label };
  }));
  // Usage & insights: fast facts on open, slow or networked ones only when asked. Every parser hides what it cannot read.
  const fetchJson = async (url, headers = {}, ms = 6000) => { const r = await fetch(url, { headers, signal: AbortSignal.timeout(ms) }); if (!r.ok) throw new Error(`${r.status} ${r.statusText}`.trim()); return r.json(); };
  const postJson = async (url, body, ms = 15000) => { const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms) }); if (!r.ok) throw new Error(`${r.status} ${r.statusText}`.trim()); return r.json(); };
  // OSV.dev: free, keyless, no local CVE database to download (unlike the OWASP dependency-check Maven plugin) -
  // the batch call gives ids only, so a bounded number of individual lookups fill in severity.
  const checkOsv = async (deps, label) => {
    try {
      const hits = insightsCore.parseOsvBatch(await postJson('https://api.osv.dev/v1/querybatch', insightsCore.osvBatchBody(deps)), deps);
      const ids = [...new Set(hits.map((h) => h.id))].slice(0, 30);
      const severityById = {};
      for (const id of ids) { try { severityById[id] = insightsCore.parseOsvSeverity(await fetchJson(`https://api.osv.dev/v1/vulns/${id}`, {}, 8000)); } catch { severityById[id] = 'unknown'; } }
      return { vulns: insightsCore.summarizeOsv(hits.map((h) => ({ ...h, severity: severityById[h.id] || 'unknown' })), label) };
    } catch (e) { return { vulnsError: `OSV.dev did not answer (${e.message}).` }; }
  };
  ipcMain.handle('insights:get', () => safe(async () => {
    const cfg = loadConfigSafe(root);
    const ins = { ...(cfg.insights || {}) };
    const records = scorecard.load(userFile('scorecard.json'));
    const snap = readJsonSafe(limitsFile());
    const o = await ollama.status(((cfg.ollama && cfg.ollama.baseUrl) || ollama.DEFAULT_URL), 1500);
    return {
      limitsOn: ins.claudeLimits === true,
      limits: insightsCore.describeLimits(snap && snap.at ? snap : null),
      totals: insightsCore.totals(records), time: insightsCore.timeByKind(records),
      models: o.running ? insightsCore.modelHealth(o.loaded) : null,
      sonarProject: ins.sonarProject || '', actuatorUrl: ins.actuatorUrl || 'http://localhost:8080/actuator',
      hasPackageJson: !!root && fs.existsSync(path.join(root, 'package.json')),
      hasSonarToken: !!process.env.SONAR_TOKEN,
    };
  }));
  ipcMain.handle('insights:run', (_e, what, arg) => safe(async () => {
    const r = requireRoot(); const cfg = loadConfigSafe(r); const ins = cfg.insights || {};
    if (what === 'deps') {
      const out = {};
      if (fs.existsSync(path.join(r, 'package.json'))) {
        const res = await runShell('npm audit --json', { cwd: r, timeoutMs: 90000 });
        let j = null; try { j = JSON.parse(res.stdout); } catch { /* offline or not an npm project */ }
        out.npm = insightsCore.parseNpmAudit(j) || { text: 'npm audit gave no answer (offline, or no lock file yet).' };
      }
      if (which('gh')) {
        const res = await runShell('gh api "repos/{owner}/{repo}/dependabot/alerts?state=open&per_page=100"', { cwd: r, timeoutMs: 30000 });
        let j = null; try { j = JSON.parse(res.stdout); } catch { /* not on GitHub, or alerts are off */ }
        const d = insightsCore.parseDependabot(j); if (d) out.dependabot = d;
      }
      if (fs.existsSync(path.join(r, 'pom.xml'))) {
        const deps = insightsCore.parseMavenDeps(fs.readFileSync(path.join(r, 'pom.xml'), 'utf8'));
        out.maven = { deps, ...(await checkOsv(deps, 'Maven')) };
      } else {
        const gradleFile = ['build.gradle', 'build.gradle.kts'].find((f) => fs.existsSync(path.join(r, f)));
        if (gradleFile) {
          const deps = insightsCore.parseGradleDeps(fs.readFileSync(path.join(r, gradleFile), 'utf8'));
          out.gradle = { deps, ...(await checkOsv(deps, 'Gradle')) };
        }
      }
      return out;
    }
    if (what === 'actuator') {
      const base = String(arg || ins.actuatorUrl || 'http://localhost:8080/actuator').replace(/\/$/, '');
      if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(base) && !/^https:\/\//.test(base)) throw new Error('The Actuator address must be http://localhost:… or https://…');
      let health; try { health = await fetchJson(`${base}/health`); } catch (e) { return { down: `Nothing answered at ${base}/health (${e.message}). Is the app running with the actuator on?` }; }
      const h = insightsCore.parseActuatorHealth(health);
      const metrics = [];
      for (const [name, label, kind] of insightsCore.METRICS) { try { metrics.push({ label, value: insightsCore.formatMetric(kind, insightsCore.metricValue(await fetchJson(`${base}/metrics/${name}`, {}, 3000))) }); } catch { /* not exposed: skipped */ } }
      return { health: h || { text: 'The address answered, but not with Actuator health JSON.' }, metrics: metrics.filter((m) => m.value !== '?') };
    }
    if (what === 'sonar') {
      const key = String(arg || ins.sonarProject || '');
      if (!key) throw new Error('Set the SonarCloud project key first.');
      const branch = await G.branch(r).catch(() => '');
      const headers = process.env.SONAR_TOKEN ? { Authorization: `Basic ${Buffer.from(`${process.env.SONAR_TOKEN}:`).toString('base64')}` } : {};
      let j; try { j = await fetchJson(insightsCore.sonarUrl(key, { branch: branch && branch !== 'HEAD' ? branch : undefined }), headers, 10000); } catch (e) { return { text: `SonarCloud did not answer (${e.message}). Private projects need SONAR_TOKEN in the environment.` }; }
      return { branch, gate: insightsCore.parseSonarGate(j) || { text: 'SonarCloud answered, but not with a quality gate for this project/branch.' } };
    }
    throw new Error('unknown insight');
  }));
  const covCache = { file: '', mtime: 0, map: null };
  ipcMain.handle('insights:coverage', (_e, rel) => safe(async () => {
    const r = requireRoot(); resolveInRoot(rel);
    const file = insightsCore.COVERAGE_FILES.map((f) => path.join(r, f)).find((f) => fs.existsSync(f));
    if (!file) return { none: true };
    const mt = fs.statSync(file).mtimeMs;
    if (covCache.file !== file || covCache.mtime !== mt) { covCache.map = insightsCore.parseCoverage(fs.readFileSync(file, 'utf8')); covCache.file = file; covCache.mtime = mt; }
    const c = insightsCore.coverageFor(covCache.map, rel);
    return { file: path.relative(r, file), at: mt, ...(c || { covered: [], missed: [], pct: null }) };
  }));
  // lenses above classes and methods: usages (by name, whole project) and the last change (git blame of the method's lines)
  ipcMain.handle('symbols:info', (_e, rel, content, opts = {}) => safe(async () => {
    const r = requireRoot();
    resolveInRoot(rel);
    const cfgSym = loadConfigSafe(r).symbolParser;
    const syms = (cfgSym === 'regex' ? null : await treesitter.symbols(String(rel), String(content))) || symbols.findSymbols(String(rel), String(content));
    if (!syms.length) return { symbols: [] };
    const lenses = withDefaults(loadConfigSafe(r), 'symbolLenses');
    let blame = null;
    if (lenses.blame && !opts.dirty && await G.isRepo(r)) { try { blame = await history.blame(r, rel); } catch { blame = null; } } // untracked file: nothing to show
    if (lenses.usages) {
      if (!usageIndex) usageIndex = new UsageIndex(r, () => G.projectFiles(r));
      await usageIndex.refresh();
    }
    const declared = new Map();
    for (const s of syms) declared.set(s.name, (declared.get(s.name) || 0) + 1);
    let spring = { endpoints: [], impls: {} };
    if (lenses.spring !== false && /\.(java|kt)$/i.test(rel)) { const si = getSpringIndex(r); await si.refresh(); spring = si.lensInfo(toPosix(rel)); }
    // exact counts from the language server when one is configured for this file; null per symbol = could not answer (fall back to the name count)
    let exact = new Map();
    const srcLines = String(content).split('\n');
    if (lenses.usages && lspConfigFor(r).enabled && lspSupports(rel)) {
      const lines = srcLines;
      const targets = syms.map((s) => ({ key: `${s.line}`, line: s.line - 1, character: symbols.nameColumn(lines[s.line - 1] || '', s.name, s.kind) })).filter((t) => t.character >= 0);
      try { exact = await ensureLsp().usageCounts(String(rel), String(content), targets); } catch { exact = new Map(); }
    }
    return { symbols: syms.map((s) => ({
      name: s.name, kind: s.kind, line: s.line,
      exactUsages: exact.has(`${s.line}`) ? exact.get(`${s.line}`) : null,
      column: symbols.nameColumn(srcLines[s.line - 1] || '', s.name, s.kind),
      endpoints: spring.endpoints.filter((e) => e.line === s.line).map((e) => ({ method: e.method, path: e.path })),
      impls: spring.impls[s.line] || null,
      usages: lenses.usages ? usageIndex.usages(s.name, { declarations: declared.get(s.name) }).count : null,
      blame: blame ? symbols.symbolBlame(blame, s) : null,
    })) };
  }));
  // "Go to symbol in workspace" (quick open): every class/method/function in the project, built once and kept
  // fresh by the same file-watcher invalidation as the usages index; the renderer fuzzy-filters the flat list.
  ipcMain.handle('symbols:workspaceAll', () => safe(async () => {
    const r = requireRoot();
    const idx = getSymbolIndex(r);
    await idx.refresh();
    return { symbols: idx.all() };
  }));
  // semantic diff: what happened to each class/method/function between two versions of a file - added, removed,
  // renamed, moved or changed - instead of raw line deletes and inserts. Pure text in, so it works for any diff
  // source (a commit, local history, the live Changes tab); no file is read.
  ipcMain.handle('symbols:diff', (_e, { rel, original, modified } = {}) => safe(async () => {
    const cfgSym = loadConfigSafe(requireRoot()).symbolParser;
    const symbolsOf = async (content) => (cfgSym === 'regex' ? null : await treesitter.symbols(String(rel), String(content))) || symbols.findSymbols(String(rel), String(content));
    const [oldSymbols, newSymbols] = await Promise.all([symbolsOf(original || ''), symbolsOf(modified || '')]);
    return { changes: semanticdiff.diffSymbols(original || '', modified || '', oldSymbols, newSymbols) };
  }));

  // files dropped on a terminal / images pasted into it -> text for the prompt (nothing is read)
  ipcMain.handle('drop:format', (_e, paths, opts = {}) => safe(async () => ({ text: dropinsert.formatDropPaths(paths, { root: requireRoot(), shellKind: shellKindOf(loadConfigSafe(root)), agent: !!opts.agent, at: !!opts.at }) })));
  ipcMain.handle('drop:saveImage', (_e, base64, ext) => safe(async () => ({ path: dropinsert.saveImage(dropinsert.defaultDropDir(app.getPath('userData')), base64, ext) })));

  // review comments on diff lines -> one prompt for the agent
  ipcMain.handle('review:format', (_e, comments) => safe(async () => ({ text: reviewcomments.formatComments(comments) })));

  // Spring: endpoints, @Bean methods and stereotype classes of the project (found by pattern)
  ipcMain.handle('spring:overview', () => safe(async () => {
    const r = requireRoot();
    const si = getSpringIndex(r);
    await si.refresh();
    return si.overview();
  }));

  // environment check (the same as `npm run doctor`)
  ipcMain.handle('doctor:run', () => safe(async () => {
    const cwd = root || process.cwd();
    const get = (key) => G.git(cwd, ['config', '--get', key]).then((o) => String(o).trim(), () => '');
    return doctor.runDoctor({ shell: PtyManager.defaultShell(loadConfigSafe(root)).shell, gitIdentity: async () => ({ name: await get('user.name'), email: await get('user.email') }) });
  }));

  // saved run configurations (.ide/run.json)
  ipcMain.handle('runconfigs:list', () => safe(async () => ({ configs: runconfig.loadRunConfigs(requireRoot()) })));
  ipcMain.handle('runconfigs:save', (_e, cfg) => safe(async () => ({ config: runconfig.saveRunConfig(requireRoot(), cfg) })));
  ipcMain.handle('runconfigs:delete', (_e, name) => safe(async () => ({ removed: runconfig.deleteRunConfig(requireRoot(), String(name)) })));

  // Spring Boot / Maven / Gradle
  ipcMain.handle('spring:detect', () => safe(async () => spring.detect(requireRoot())));
  ipcMain.handle('spring:command', (_e, opts = {}) => safe(async () => {
    const r = requireRoot();
    const mod = spring.detect(r).modules.find((m) => m.dir === String(opts.dir || ''));
    if (!mod) throw new Error('That build module no longer exists.');
    const shellKind = shellKindOf(loadConfigSafe(r));
    const command = opts.task ? spring.taskCommand(mod, String(opts.task), { shellKind }) : spring.runCommand(mod, { profile: opts.profile, jvmArgs: opts.jvmArgs, debugPort: opts.debugPort, shellKind });
    const env = spring.parseEnv(opts.env);
    // the wrapper scripts (mvnw, gradlew) and build files of the project are code: ask for trust like for scripts
    if (!(await ensureTrusted())) throw new Error('Project not trusted: the build was not started.');
    return { command, env, cwd: resolveInRoot(mod.dir || '.'), label: opts.task || 'Spring Boot' };
  }));
  ipcMain.handle('project:switch', (_e, target) => safe(async () => {
    const abs = path.resolve(String(target || ''));
    // list from the target, not the current root: the current root can be a run's worktree that was just removed
    // out from under it (e.g. auto-merge, while that run was the active project) - git can no longer run from a
    // deleted cwd, so validating against it would always fail "not a known run" even switching back to a real main.
    const { main, runs: list } = await runs.listRuns(abs);
    const known = [main && main.root, ...list.map((r) => r.root)].filter(Boolean);
    if (!known.includes(abs)) throw new Error('Not a known agent run of this repository.');
    setRoot(abs);
    return describeProject();
  }));

  // task scope
  ipcMain.handle('scope:snapshot', () => safe(async () => ({ baseline: scope.snapshot(requireRoot(), await G.changedFiles(requireRoot())) })));
  ipcMain.handle('scope:analyze', (_e, opts = {}) => safe(async () => {
    const r = requireRoot();
    const analysis = await scope.analyzeScope({
      root: r, changed: await G.changedFiles(r), baseline: opts.baseline, allow: opts.allow, summary: opts.summary,
      knownFiles: opts.summary ? await G.projectFiles(r) : undefined,
    });
    return { analysis, summaryPrompt: scope.SUMMARY_PROMPT };
  }));
  ipcMain.handle('checkpoint:create', (_e, label) => safe(async () => ({ checkpoint: await G.createCheckpoint(requireRoot(), label || 'manual') })));
  ipcMain.handle('checkpoint:list', () => safe(async () => ({ checkpoints: root && await G.isRepo(root) ? await G.listCheckpoints(root) : [] })));
  ipcMain.handle('checkpoint:restore', (_e, id) => safe(async () => ({ result: await G.restoreCheckpoint(requireRoot(), id) })));
  ipcMain.handle('checkpoint:delete', (_e, id) => safe(() => G.deleteCheckpoint(requireRoot(), id)));

  // quality gates
  ipcMain.handle('checks:run', async (_e, opts = {}) => {
    requireRoot();
    if (checksRunning) return { error: 'Checks are already running.' };
    let custom = false;
    try { custom = loadChecksConfig(root).custom; } catch (err) { return { error: err.message }; }
    if (custom && !(await ensureTrusted())) return { error: 'Project not trusted: custom checks were not run.' };
    checksRunning = true;
    checksAbort = new AbortController();
    const startedAt = Date.now();
    try {
      return await runChecks(root, {
        tier: opts.tier || 'fast',
        files: opts.files || 'changed',
        changedLinesOnly: opts.changedLinesOnly !== false,
        signal: checksAbort.signal,
        onProgress: (evt) => send('checks:progress', evt),
      });
    } catch (err) {
      return { error: err.message };
    } finally {
      checksRunning = false;
      checksAbort = null;
      if (Date.now() - startedAt > 8000) notify('checks-done', 'Quality gates finished', 'Open Bazinga to see the findings.');
    }
  });
  ipcMain.handle('checks:cancel', () => { if (checksAbort) checksAbort.abort(); return true; });

  // AI review
  ipcMain.handle('review:run', async (_e, { findings } = {}) => {
    requireRoot();
    if (reviewAbort) return { error: 'A review is already running.' };
    let config;
    try { config = loadConfig(root, readSettings()); } catch (err) { return { error: err.message }; }
    reviewAbort = new AbortController();
    // what moved/was renamed/added/removed, structurally - so the reviewer model gets "renamed X→Y" instead of
    // having to infer it from a messy line diff. A hiccup here should never block the review itself.
    let symbolSummary = '';
    try {
      const changed = (await G.changedFiles(root)).filter((c) => !c.path.startsWith('.ide/'));
      symbolSummary = semanticdiff.summarizeSymbolChanges(await allSymbolChanges(root, changed));
    } catch { /* the diff itself still goes out */ }
    try { return await runReview(root, { command: config.reviewCommand, findings: findings || [], reviewRules: config.reviewRules, symbolSummary, signal: reviewAbort.signal }); } finally { reviewAbort = null; }
  });
  ipcMain.handle('review:cancel', () => { if (reviewAbort) reviewAbort.abort(); return true; });

  // scripts + terminals
  ipcMain.handle('scripts:prepare', async (_e, name) => {
    requireRoot();
    const script = loadScripts(root).find((s) => s.name === name);
    if (!script) return { error: `Unknown script: ${name}` };
    if (!(await ensureTrusted())) return { error: 'Project not trusted: script was not run.' };
    return { command: script.command, cwd: resolveInRoot(script.cwd) };
  });

  ipcMain.handle('pty:create', async (_e, opts = {}) => {
    const base = requireRoot();
    let cwd = base;
    if (opts.cwd) {
      const abs = path.resolve(opts.cwd);
      if (abs === base || abs.startsWith(base + path.sep)) cwd = abs;
      else {
        // an agent run's worktree is a sibling folder of the repository: allowed when it really is one of its runs
        const { runs: list } = await runs.listRuns(base).catch(() => ({ runs: [] }));
        if (!list.some((r) => abs === r.root || abs.startsWith(r.root + path.sep))) return { error: 'Path is outside the project.' };
        cwd = abs;
      }
    }
    let config;
    try { config = loadConfig(cwd, readSettings()); } catch { config = null; }
    const env = {};
    for (const [k, v] of Object.entries(opts.env || {})) if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) env[k] = String(v);
    // variables a container run passes on by name (docker -e NAME): only those the settings list, taken from the real environment here, never from the renderer
    if (Array.isArray(opts.hostEnv) && config) {
      let allowed = [];
      try { allowed = containerCore.normalizeSettings(config.agentContainer).passEnv; } catch { /* invalid settings: pass nothing */ }
      for (const n of opts.hostEnv) if (allowed.includes(n) && process.env[n] !== undefined) env[n] = process.env[n];
    }
    const fl = withDefaults(config || {}, 'fixLoop');
    let baseEnv;
    let scrubbed = [];
    if (opts.watch) { // agent terminals only: your own shells keep your environment
      const ae = (config && config.agentEnv) || {};
      const sc = scrubEnv(process.env, { enabled: ae.scrub !== false, allow: ae.allow || [] });
      baseEnv = sc.env; scrubbed = sc.removed;
    }
    // the agent's own variables are also put in front of its command: the login shell's startup files would otherwise override them
    let initialInput = opts.initialInput;
    if (opts.watch && opts.inlineEnv && initialInput) {
      try { initialInput = envinline.applyTo(initialInput, opts.inlineEnv, envinline.shellKindFor(config && config.shell, process.platform)); } catch { initialInput = opts.initialInput; }
    }
    const res = ptys.create({ cwd, config, baseEnv, cols: opts.cols, rows: opts.rows, initialInput, env, watch: !!opts.watch, idleMs: Math.max(2, Number(fl.idleSeconds) || 8) * 1000 });
    if (opts.watch && res && res.id) fixloop.register(res.id, { root: cwd, label: opts.label, escalated: !!opts.noEscalate });
    if (res && res.id && scrubbed.length) res.scrubbed = scrubbed;
    if (opts.watch && res && res.id) runs.journalEvent(cwd, { kind: 'agent-started', text: opts.label || 'agent', data: scrubbed.length ? { scrubbedEnv: scrubbed } : undefined });
    return res;
  });

  // ACP agents (Agent Client Protocol): a headless session per run; the window shows the transcript, "idle" and "needs permission" are exact
  const acpRuns = new Map(); // id -> { run, turnStart }
  ipcMain.handle('acp:start', (_e, opts = {}) => safe(async () => {
    const base = requireRoot();
    const id = String(opts.id || '');
    if (!/^acp-\d+$/.test(id) || acpRuns.has(id)) throw new Error('Invalid session id.');
    let cwd = base;
    if (opts.cwd) {
      const abs = path.resolve(opts.cwd);
      if (abs === base || abs.startsWith(base + path.sep)) cwd = abs;
      else {
        const { runs: list } = await runs.listRuns(base).catch(() => ({ runs: [] }));
        if (!list.some((r) => abs === r.root || abs.startsWith(r.root + path.sep))) throw new Error('Path is outside the project.');
        cwd = abs;
      }
    }
    const config = loadConfig(cwd, readSettings());
    const agent = (config.agents || []).find((a) => a.name === String(opts.agent) && a.protocol === 'acp'); // the command always comes from the settings, never from the window
    if (!agent) throw new Error(`“${opts.agent}” is not an ACP agent in the settings.`);
    const [command, ...args] = acpCore.splitCommand(agent.command);
    if (!command) throw new Error('The ACP agent has no command.');
    const ae = config.agentEnv || {};
    const { env: baseEnv } = scrubEnv(process.env, { enabled: ae.scrub !== false, allow: ae.allow || [] });
    const policy = ['ask', 'allow', 'reject'].includes(opts.policy) ? opts.policy : (['ask', 'allow', 'reject'].includes(agent.policy) ? agent.policy : 'ask');
    const entry = { run: null, turnStart: 0 };
    entry.run = new acpCore.AcpRun({
      onWire: (dir, msg) => capture.record('acp', msg, { dir }),
      command, args, cwd, baseEnv, env: agent.env || {}, policy,
      onEvent: (e) => {
        if (e.type !== 'text' && e.type !== 'thought') dbg('agent', `acp ${id}: ${e.type}${e.title ? ` ${e.title}` : e.message ? ` ${e.message}` : e.reason ? ` ${e.reason}` : ''}`.slice(0, 220));
        send('acp:event', id, e);
        if (e.type === 'permission') { notify('agent-prompt', `${agent.name} needs your approval`, e.title); send('agent:prompt', id, e.title); }
        else if (e.type === 'stop') { const busy = entry.turnStart ? Date.now() - entry.turnStart : 0; entry.turnStart = 0; handleIdle(id, busy, { hook: true }).catch(() => {}); }
        else if (e.type === 'exit') { acpRuns.delete(id); send('pty:exit', id, e.code === null || e.code === undefined ? 0 : e.code); }
      },
    });
    acpRuns.set(id, entry);
    try { const ready = await entry.run.open(); if (opts.task) { entry.turnStart = Date.now(); entry.run.send(String(opts.task)); } return { ok: true, ...ready }; } catch (err) { acpRuns.delete(id); entry.run.close(); throw new Error(`The ACP agent did not start: ${err.message}`); }
  }));
  ipcMain.handle('acp:send', (_e, id, text) => { const e = acpRuns.get(String(id)); if (!e || !String(text || '').trim()) return false; e.turnStart = e.turnStart || Date.now(); return e.run.send(String(text).slice(0, 100000)); });
  ipcMain.handle('acp:answer', (_e, id, permId, optionId) => { const e = acpRuns.get(String(id)); return e ? e.run.answer(Number(permId), optionId ? String(optionId) : null) : false; });
  ipcMain.handle('acp:cancel', async (_e, id) => { const e = acpRuns.get(String(id)); return e ? e.run.cancel() : false; });
  ipcMain.on('pty:write', (_e, id, data) => { fixloop.userInput(id); ptys.write(id, data); });
  ipcMain.on('pty:resize', (_e, id, cols, rows) => ptys.resize(id, cols, rows));
  ipcMain.on('pty:kill', (_e, id) => { if (acpRuns.has(String(id))) { acpRuns.get(String(id)).run.close(); return; } fixloop.unregister(id); ptys.kill(id); });

  // settings + session
  ipcMain.handle('settings:get', () => ({ templatesMd: taskTemplates.toMarkdown(readSettings().taskTemplates), settings: readSettings(), defaults: { ...DEFAULT_CONFIG, mergeGuardDefaults: DEFAULT_POLICY, oversightLevels: Object.fromEntries(oversightCore.ids().map((i) => [i, { label: oversightCore.LEVELS[i].label, summary: oversightCore.LEVELS[i].summary }])) } }));
  ipcMain.handle('settings:save', (_e, settings) => {
    settings = { ...(settings || {}) };
    if (typeof settings.taskTemplatesMd === 'string') {
      const list = taskTemplates.parseMarkdown(settings.taskTemplatesMd).filter((t) => t.text);
      if (list.length) settings.taskTemplates = list; else delete settings.taskTemplates;
      delete settings.taskTemplatesMd;
    }
    writeJson('settings.json', settings); applyNativeTheme(); return true; });
  ipcMain.handle('theme:derive', (_e, seed) => require('../core/custompalette').deriveTheme(seed || {}));
  ipcMain.handle('theme:contrast', (_e, vars) => require('../core/custompalette').contrastReport(vars || {}));
  ipcMain.handle('review:anchor', (_e, comments) => {
    const r = root; if (!r) return [];
    return commentanchor.anchorAll(comments, (rel) => fs.readFileSync(resolveInRoot(rel), 'utf8'));
  });
  ipcMain.handle('session:get', () => {
    const all = readJson('session.json', { ui: {}, projects: {} });
    const project = (root && all.projects && all.projects[root]) || null;
    // what to reopen: computed here because the paths are checked against the project folder
    if (project) project.terminalPlan = termsession.planRestore(project.terminals, { root, agents: loadConfigSafe(root).agents || [] });
    return { ui: all.ui || {}, project };
  });
  ipcMain.handle('session:save', (_e, data = {}) => {
    const all = readJson('session.json', { ui: {}, projects: {} });
    if (data.ui) all.ui = { ...(all.ui || {}), ...data.ui };
    if (data.project && root) {
      all.projects = all.projects || {};
      const project = { ...data.project };
      // the renderer sends its live terminals; only what restoreTerminals needs is kept
      if (Array.isArray(project.terminals)) project.terminals = termsession.toRecords(project.terminals, root);
      all.projects[root] = project;
    }
    writeJson('session.json', all);
    return true;
  });

  ipcMain.handle('app:copy', (_e, text) => { clipboard.writeText(String(text)); return true; });

  ipcMain.handle('smoke:shot', async (_e, name) => {
    if (!SHOTS || !win) return false;
    fs.mkdirSync(SHOTS, { recursive: true });
    fs.writeFileSync(path.join(SHOTS, `${String(name).replace(/[^\w.-]/g, '_')}.png`), (await win.webContents.capturePage()).toPNG());
    return true;
  });

  // smoke only: write a file from a separate process, like an external agent does, to prove the IDE notices
  ipcMain.handle('smoke:external-write', (_e, rel, text) => {
    if (!SMOKE || !root) return false;
    require('node:child_process').execFileSync(process.execPath, ['-e', 'const fs=require("fs");if(process.argv[2]==="__BZ_DELETE__")fs.unlinkSync(process.argv[1]);else fs.writeFileSync(process.argv[1],process.argv[2])', path.join(root, rel), text === null ? '__BZ_DELETE__' : text], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
    return true;
  });
  ipcMain.on('app:ready', () => { if (startupWatch) startupWatch.ready(); });
  ipcMain.on('smoke:step', (_e, name) => { if (SMOKE) console.log(`[smoke] ${Math.round(process.uptime())}s step: ${name}`); });
  ipcMain.on('smoke:done', async (_e, report) => {
    console.log(`SMOKE_RESULT ${JSON.stringify(report)}`);
    const shot = process.env.BAZINGA_SHOT; // optional: save a screenshot of the final UI state
    if (shot && win) {
      try { fs.writeFileSync(shot, (await win.webContents.capturePage()).toPNG()); } catch (err) { console.log(`screenshot failed: ${err.message}`); }
    }
    app.exit(report && report.ok ? 0 : 1);
  });
}

// ---------- window ----------
// one clear message when the window cannot start, instead of an empty or frozen window
let startupWatch = null;
function watchStartup(w) {
  startupWatch = new StartupWatch({ onProblem: ({ reason, details }) => {
    const text = `${reason}\n\n${details.length ? `What the window reported:\n${details.join('\n')}\n\n` : ''}Log file: ${debug.file || '(none)'}`;
    dbg('app', `startup problem: ${reason} ${details.join(' | ')}`);
    dialog.showMessageBox(w && !w.isDestroyed() ? w : undefined, { type: 'error', title: 'Bazinga did not start properly', message: 'Bazinga did not start properly', detail: `${text}\n\nTry “Reload”. If it keeps happening, send me the details.`, buttons: ['Reload', 'Copy details', 'Open log folder', 'Quit'], defaultId: 0, cancelId: 3 })
      .then(({ response }) => {
        if (response === 0 && w && !w.isDestroyed()) { startupWatch.start(); w.reload(); }
        else if (response === 1) clipboard.writeText(text);
        else if (response === 2) { shell.showItemInFolder(debug.file || app.getPath('userData')); }
        else if (response === 3) app.quit();
      }).catch(() => {});
  } });
  const wc = w.webContents;
  wc.on('did-fail-load', (_e, code, desc, url, isMain) => { if (isMain) startupWatch.fail(`The window could not load (${desc || code}).`); });
  wc.on('render-process-gone', (_e, d) => startupWatch.fail(`The window crashed while starting (${(d && d.reason) || 'unknown reason'}).`));
  wc.on('preload-error', (_e, p, err) => startupWatch.note(`preload ${path.basename(String(p))}: ${err && err.message}`));
  wc.on('console-message', (_e, level, message, line, source) => { if (level >= 3) startupWatch.note(`${message} (${path.basename(String(source || ''))}:${line})`); });
  startupWatch.start();
}

function createWindow() {
  win = new BrowserWindow({
    icon: path.join(__dirname, '..', '..', 'build', 'icon.png'), // window/taskbar icon on Windows and Linux
    width: SHOTS ? 1440 : 1500,
    height: SHOTS ? 900 : 950,
    useContentSize: !!SHOTS,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#14161a' : '#ffffff',
    title: 'Bazinga',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: SMOKE ? ['--smoke', ...(SHOTS ? ['--shots'] : []), ...(process.env.BAZINGA_THEME ? ['--theme=' + process.env.BAZINGA_THEME] : [])] : [],
    },
  });
  if (!SMOKE) watchStartup(win);
  // a window spawned as a background child process (smoke.js) never becomes the OS's active app on its own -
  // document.hasFocus() stays false forever, breaking every focus-restore check regardless of how long they poll.
  // Real users launch this app directly (Dock/Finder/shell foreground), where that's already true; forcing it
  // is scoped to SMOKE so it never steals focus from something else during normal use.
  if (SMOKE) win.once('ready-to-show', () => { win.show(); win.focus(); if (process.platform === 'darwin') app.focus({ steal: true }); });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.on('focus', () => {
    try { win.flashFrame(false); } catch { /* ignore */ }
    // coming back to the window: whatever an agent did meanwhile (even if the watcher missed it) shows up now
    if (root && !SMOKE) { send('fs:changed', { poll: true }); rebaseline(); }
  });
  let blurredAt = 0;
  win.on('blur', () => { blurredAt = Date.now(); if (!SMOKE) { try { writeJson('settings.json', { ...readSettings(), awaySeenAt: blurredAt }); } catch { /* best effort */ } } });
  win.on('focus', () => { if (blurredAt && Date.now() - blurredAt > 15 * 60 * 1000 && !SMOKE) send('away:maybe'); blurredAt = 0; });
  win.on('closed', () => { win = null; });
}

app.whenReady().then(() => {
  // macOS: the dock shows the Electron icon when running from source; a packaged build uses build/icon.icns
  if (process.platform === 'darwin' && app.dock) { try { app.dock.setIcon(path.join(__dirname, '..', '..', 'build', 'icon.png')); } catch { /* cosmetic */ } }
  if (!SMOKE) fixPath();
  if (!SMOKE) { // which Claude Code is on this machine (telemetry adds the version of the one that really runs, also in containers)
    try { require('node:child_process').execFile('claude', ['--version'], { timeout: 8000, windowsHide: true, shell: process.platform === 'win32' }, (err, out) => { if (!err) drift.noteVersion(out); }); } catch { /* not installed */ }
  }
  setTimeout(() => { try { getLocalHistory().pruneTotal(); } catch { /* best effort */ } }, 15000).unref();
  applyNativeTheme();
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
  ]));
  const initial = pickInitialRoot();
  if (initial) setRoot(initial);
  registerIpc();
  createWindow();
});

app.on('window-all-closed', () => { stopWatcher(); if (ptys) ptys.killAll(); app.quit(); });
app.on('before-quit', () => { toolProxies.closeAll().catch(() => {}); stopWatcher(); if (ptys) ptys.killAll(); if (lsp) lsp.dispose().catch(() => {}); if (dapSession) dapSession.stop().catch(() => {}); });
