'use strict';
/**
 * Spring Boot / Maven / Gradle support for the Scripts tab:
 *  - detect() finds build modules (pom.xml, build.gradle[.kts]), the @SpringBootApplication class and the profiles that have
 *    an application-<profile>.yml/.yaml/.properties file;
 *  - runCommand() / taskCommand() build the command that is typed into a terminal, quoted for that terminal's shell.
 * The profile and the environment come from the UI, so they are validated here and never pasted into a command unquoted.
 */
const fs = require('node:fs');
const path = require('node:path');
const { toPosix } = require('./util');
const { quote } = require('./testcmd');

const SKIP = new Set(['node_modules', '.git', 'target', 'build', 'out', 'dist', '.gradle', '.idea', '.ide', '.cache']);
const MAX_DEPTH = 3;
const MAX_SOURCE_FILES = 600;
const PROFILE_RE = /^[A-Za-z0-9_.-]+(,[A-Za-z0-9_.-]+)*$/;
const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

const MAVEN_TASKS = [
  { name: 'Clean', args: ['clean'] },
  { name: 'Compile', args: ['compile'] },
  { name: 'Test', args: ['test'] },
  { name: 'Verify', args: ['verify'] },
  { name: 'Package (skip tests)', args: ['package', '-DskipTests'] },
  { name: 'Dependency tree', args: ['dependency:tree'] },
];
const GRADLE_TASKS = [
  { name: 'Clean', args: ['clean'] },
  { name: 'Build', args: ['build'] },
  { name: 'Test', args: ['test'] },
  { name: 'Build (skip tests)', args: ['build', '-x', 'test'] },
  { name: 'Dependencies', args: ['dependencies'] },
];

const exists = (...p) => fs.existsSync(path.join(...p));

function* walkDirs(root, rel = '', depth = 0) {
  yield rel;
  if (depth >= MAX_DEPTH) return;
  let entries = [];
  try { entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (!e.isDirectory() || SKIP.has(e.name) || e.name.startsWith('.') || e.name.endsWith('.worktrees')) continue;
    yield* walkDirs(root, rel ? `${rel}/${e.name}` : e.name, depth + 1);
  }
}

/** Source files below src/main that declare @SpringBootApplication -> [{ mainClass, file }] */
function findApplications(moduleAbs) {
  const out = [];
  let seen = 0;
  const base = path.join(moduleAbs, 'src', 'main');
  const visit = (dir, pkg) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (seen > MAX_SOURCE_FILES) return;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { visit(full, pkg === null ? (/^(java|kotlin)$/.test(e.name) ? '' : null) : (pkg ? `${pkg}.${e.name}` : e.name)); continue; }
      if (pkg === null || !/\.(java|kt)$/.test(e.name)) continue;
      seen++;
      let text = '';
      try { text = fs.readFileSync(full, 'utf8'); } catch { continue; }
      if (!/@SpringBootApplication\b/.test(text)) continue;
      const cls = e.name.replace(/\.(java|kt)$/, '');
      const declared = /^\s*package\s+([\w.]+)/m.exec(text);
      out.push({ mainClass: `${declared ? declared[1] : pkg}.${cls}`, file: toPosix(path.relative(moduleAbs, full)) });
    }
  };
  // start at src/main: the first level (java / kotlin) sets the package root
  let top = [];
  try { top = fs.readdirSync(base, { withFileTypes: true }); } catch { return out; }
  for (const e of top) if (e.isDirectory() && /^(java|kotlin)$/.test(e.name)) visit(path.join(base, e.name), '');
  return out;
}

function findProfiles(moduleAbs) {
  const set = new Set();
  for (const dir of [path.join(moduleAbs, 'src', 'main', 'resources'), path.join(moduleAbs, 'src', 'main', 'resources', 'config'), path.join(moduleAbs, 'config')]) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const n of names) { const m = /^application-([A-Za-z0-9_.-]+)\.(ya?ml|properties)$/.exec(n); if (m) set.add(m[1]); }
  }
  return [...set].sort();
}

/** @returns {{ modules: Array<{ dir, tool, wrapper, spring, apps, profiles, tasks }> }} dir is relative to root ('' = root) */
function detect(root) {
  const modules = [];
  for (const rel of walkDirs(root)) {
    const abs = path.join(root, rel);
    const gradleFile = ['build.gradle', 'build.gradle.kts'].find((f) => exists(abs, f));
    const hasPom = exists(abs, 'pom.xml');
    if (!hasPom && !gradleFile) continue;
    const tool = hasPom ? 'maven' : 'gradle';
    let buildText = '';
    try { buildText = fs.readFileSync(path.join(abs, hasPom ? 'pom.xml' : gradleFile), 'utf8'); } catch { /* unreadable */ }
    const apps = findApplications(abs);
    const spring = apps.length > 0 || /spring-boot/.test(buildText);
    // a parent pom that only lists modules has nothing to run itself, but its tasks (verify, ...) are still useful
    modules.push({
      dir: rel,
      tool,
      wrapper: tool === 'maven' ? exists(abs, 'mvnw') || exists(abs, 'mvnw.cmd') : exists(abs, 'gradlew') || exists(abs, 'gradlew.bat'),
      spring,
      apps,
      profiles: findProfiles(abs),
      tasks: (tool === 'maven' ? MAVEN_TASKS : GRADLE_TASKS).map((t) => t.name),
    });
  }
  return { modules };
}

function binary(tool, wrapper, shellKind) {
  if (tool === 'maven') return wrapper ? (shellKind === 'posix' ? './mvnw' : '.\\mvnw') : 'mvn';
  return wrapper ? (shellKind === 'posix' ? './gradlew' : '.\\gradlew') : 'gradle';
}

function checkProfile(profile) {
  if (profile === undefined || profile === null || profile === '') return '';
  const p = String(profile).trim();
  if (!PROFILE_RE.test(p)) throw new Error(`Not a valid Spring profile name: "${p}" (letters, digits, "_", "-", "." and commas only).`);
  return p;
}

/** Parse "KEY=value" lines (blank lines and # comments skipped). Throws on a bad name so nothing odd reaches the shell. */
function parseEnv(text) {
  const env = {};
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i <= 0) throw new Error(`Environment line must be NAME=value: "${line}"`);
    const name = line.slice(0, i).trim();
    if (!ENV_NAME_RE.test(name)) throw new Error(`Not a valid environment variable name: "${name}"`);
    env[name] = line.slice(i + 1).trim();
  }
  return env;
}

const JVM_ARGS_RE = /^[A-Za-z0-9_.:=,@/\\ +*\-]*$/;

/** JVM options typed in the UI: only plain option characters (no quotes, $, ;, &, |, <, >, backticks), so they are safe inside one quoted argument. */
function checkJvmArgs(text) {
  const t = String(text || '').trim();
  if (!JVM_ARGS_RE.test(t)) throw new Error('JVM arguments may only contain letters, digits and . : = , @ / \\ + * - and spaces (no quotes or shell characters).');
  return t;
}

function checkDebugPort(port) {
  if (port === undefined || port === null || port === '' || port === 0 || port === '0') return 0;
  const n = Number(port);
  if (!Number.isInteger(n) || n < 1024 || n > 65535) throw new Error('Debug port must be a whole number between 1024 and 65535.');
  return n;
}

/**
 * Command that starts the Spring Boot app of a module.
 * debugPort: Maven starts the JVM with a JDWP listener on that port (suspend=n: the app does not wait for the debugger);
 * Gradle's bootRun can only use `--debug-jvm` (fixed port 5005, waits for the debugger), so another port is refused instead of ignored.
 */
function runCommand(mod, { profile = '', jvmArgs = '', debugPort = 0, shellKind = 'posix' } = {}) {
  const p = checkProfile(profile);
  const jvm = checkJvmArgs(jvmArgs);
  const port = checkDebugPort(debugPort);
  const q = (s) => quote(shellKind, s);
  const bin = binary(mod.tool, mod.wrapper, shellKind);
  if (mod.tool === 'maven') {
    const jvmAll = [port ? `-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=*:${port}` : '', jvm].filter(Boolean).join(' ');
    return [`${bin} spring-boot:run`, p && q(`-Dspring-boot.run.profiles=${p}`), jvmAll && q(`-Dspring-boot.run.jvmArguments=${jvmAll}`)].filter(Boolean).join(' ');
  }
  if (jvm) throw new Error('JVM arguments are not supported for Gradle runs here: set them in build.gradle (bootRun { jvmArgs ... }).');
  if (port && port !== 5005) throw new Error('Gradle\'s bootRun can only debug on port 5005 (--debug-jvm).');
  return [`${bin} bootRun`, port && '--debug-jvm', p && `--args=${q(`--spring.profiles.active=${p}`)}`].filter(Boolean).join(' ');
}

/** Command for one of the listed Maven / Gradle tasks (by name). */
function taskCommand(mod, taskName, { shellKind = 'posix' } = {}) {
  const list = mod.tool === 'maven' ? MAVEN_TASKS : GRADLE_TASKS;
  const t = list.find((x) => x.name === taskName);
  if (!t) throw new Error(`Unknown task: ${taskName}`);
  const q = (s) => quote(shellKind, s);
  return [binary(mod.tool, mod.wrapper, shellKind), ...t.args.map((a) => (/[.]/.test(a) ? q(a) : a))].join(' ');
}

module.exports = { detect, runCommand, taskCommand, parseEnv, checkProfile, checkJvmArgs, checkDebugPort, MAVEN_TASKS, GRADLE_TASKS };
