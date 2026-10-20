'use strict';
/**
 * "Run this test" for the editor: find tests in a file (Java/JUnit, JS/TS: vitest, jest, node:test, Python: pytest)
 * and build the shell command that runs just that test. Commands are typed into a terminal, so arguments are quoted for its shell.
 */
const fs = require('node:fs');
const path = require('node:path');
const { toPosix } = require('./util');

const ext = (rel) => path.posix.extname(toPosix(rel)).toLowerCase();
const LANG = { '.java': 'java', '.kt': 'java', '.js': 'js', '.jsx': 'js', '.mjs': 'js', '.cjs': 'js', '.ts': 'js', '.tsx': 'js', '.py': 'py' };

/** @returns {Array<{line:number, name:string, kind:'test'|'suite', suite?:string}>} 1-based lines */
function findTests(rel, content) {
  const lang = LANG[ext(rel)];
  const lines = String(content).split('\n');
  const out = [];
  if (lang === 'java') {
    const cls = path.posix.basename(toPosix(rel)).replace(/\.[^.]+$/, '');
    let pending = false;
    lines.forEach((l, i) => {
      if (/^\s*@(Test|ParameterizedTest|RepeatedTest|TestFactory)\b/.test(l)) pending = true;
      const m = /^\s*(?:public\s+|protected\s+|private\s+|static\s+|final\s+)*(?:void|fun)\s+([A-Za-z_]\w*)\s*\(/.exec(l);
      if (pending && m) { out.push({ line: i + 1, name: m[1], kind: 'test', suite: cls }); pending = false; }
      else if (pending && /^\s*(public\s+)?class\b/.test(l)) pending = false;
    });
    const c = lines.findIndex((l) => new RegExp(`\\bclass\\s+${cls}\\b`).test(l));
    if (out.length && c >= 0) out.unshift({ line: c + 1, name: cls, kind: 'suite', suite: cls });
  } else if (lang === 'js') {
    const re = /^\s*(describe|it|test)(?:\.(?:only|skip|concurrent|each\([^)]*\)))*\s*\(\s*(['"`])((?:\\.|(?!\2).)+)\2/;
    lines.forEach((l, i) => {
      const m = re.exec(l);
      if (m) out.push({ line: i + 1, name: m[3], kind: m[1] === 'describe' ? 'suite' : 'test' });
    });
  } else if (lang === 'py') {
    let cls = null; let clsIndent = -1;
    lines.forEach((l, i) => {
      const c = /^(\s*)class\s+(Test\w*)\b/.exec(l);
      if (c) { cls = c[2]; clsIndent = c[1].length; out.push({ line: i + 1, name: cls, kind: 'suite' }); return; }
      const f = /^(\s*)(?:async\s+)?def\s+(test\w*)\s*\(/.exec(l);
      if (f) {
        if (cls && f[1].length <= clsIndent) cls = null;
        out.push({ line: i + 1, name: f[2], kind: 'test', suite: cls || undefined });
      } else if (cls && /^\S/.test(l) && !/^\s*(#|$)/.test(l)) cls = null;
    });
  }
  return out;
}

/** Quote one argument for the terminal's shell: 'powershell' | 'cmd' | 'posix'. */
function quote(shellKind, s) {
  const str = String(s);
  if (shellKind === 'powershell') return `'${str.replace(/'/g, "''")}'`;
  if (shellKind === 'cmd') return `"${str.replace(/"/g, '\\"')}"`;
  return `'${str.replace(/'/g, `'\\''`)}'`;
}
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function nearestUp(root, rel, names) {
  let dir = path.posix.dirname(toPosix(rel));
  for (;;) {
    for (const n of names) if (fs.existsSync(path.join(root, dir === '.' ? '' : dir, n))) return { dir: dir === '.' ? '' : dir, file: n };
    if (dir === '.' || dir === '') return null;
    dir = path.posix.dirname(dir);
  }
}

/**
 * @returns {{ command: string, cwd: string, label: string } | null}  cwd is relative to root
 */
function testCommand(root, rel, test, { shellKind = 'posix', content = '' } = {}) {
  const lang = LANG[ext(rel)];
  const q = (s) => quote(shellKind, s);
  rel = toPosix(rel);
  if (lang === 'java') {
    const gradle = nearestUp(root, rel, ['build.gradle', 'build.gradle.kts']);
    const maven = nearestUp(root, rel, ['pom.xml']);
    const sel = test.kind === 'suite' ? test.name : `${test.suite}#${test.name}`;
    if (maven && (!gradle || maven.dir.length >= gradle.dir.length)) return { cwd: maven.dir, label: `mvn test ${sel}`, command: `mvn -B test -Dtest=${q(sel)} -DfailIfNoTests=false -Dsurefire.failIfNoSpecifiedTests=false` };
    if (gradle) {
      const wrapper = fs.existsSync(path.join(root, gradle.dir, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew'));
      const bin = wrapper ? (shellKind === 'posix' ? './gradlew' : '.\\gradlew') : 'gradle';
      return { cwd: gradle.dir, label: `gradle test ${sel}`, command: `${bin} test --tests ${q(`*${sel.replace('#', '.')}`)}` };
    }
    return null;
  }
  if (lang === 'js') {
    const pkg = nearestUp(root, rel, ['package.json']);
    const cwd = pkg ? pkg.dir : '';
    const file = cwd ? rel.slice(cwd.length + 1) : rel;
    const name = escapeRegex(test.name);
    const bins = (b) => fs.existsSync(path.join(root, cwd, 'node_modules', '.bin', b)) || fs.existsSync(path.join(root, cwd, 'node_modules', '.bin', `${b}.cmd`));
    if (/node:test/.test(content)) return { cwd, label: `node --test ${test.name}`, command: `node --test --test-name-pattern=${q(name)} ${q(file)}` };
    if (bins('jest') && !bins('vitest')) return { cwd, label: `jest ${test.name}`, command: `npx --no-install jest ${q(file)} -t ${q(name)}` };
    return { cwd, label: `vitest ${test.name}`, command: `npx --no-install vitest run ${q(file)} -t ${q(name)}` };
  }
  if (lang === 'py') {
    const proj = nearestUp(root, rel, ['pytest.ini', 'pyproject.toml', 'setup.cfg', 'tox.ini']);
    const cwd = proj ? proj.dir : '';
    const file = cwd ? rel.slice(cwd.length + 1) : rel;
    const id = test.kind === 'suite' ? `${file}::${test.name}` : `${file}::${test.suite ? `${test.suite}::` : ''}${test.name}`;
    return { cwd, label: `pytest ${id}`, command: `python -m pytest ${q(id)}` };
  }
  return null;
}

/** Command for every test in the file. */
function fileTestCommand(root, rel, opts = {}) {
  const lang = LANG[ext(rel)];
  const tests = findTests(rel, opts.content || '');
  if (!tests.length) return null;
  if (lang === 'java') { const s = tests.find((t) => t.kind === 'suite'); return s ? testCommand(root, rel, s, opts) : null; }
  if (lang === 'py') {
    const proj = nearestUp(root, rel, ['pytest.ini', 'pyproject.toml', 'setup.cfg', 'tox.ini']);
    const cwd = proj ? proj.dir : '';
    return { cwd, label: `pytest ${rel}`, command: `python -m pytest ${quote(opts.shellKind || 'posix', cwd ? rel.slice(cwd.length + 1) : rel)}` };
  }
  const first = tests.find((t) => t.kind === 'test') || tests[0];
  const c = testCommand(root, rel, first, opts);
  if (!c) return null;
  return { ...c, label: `all tests in ${path.posix.basename(rel)}`, command: c.command.replace(/ (-t|--test-name-pattern=)\S+( |$)/, ' ').replace(/ -t '[^']*'| -t "[^"]*"| --test-name-pattern='[^']*'/, '').trim() };
}

/** Can this test be started in debug mode from a terminal? (pytest --pdb, JUnit waiting for a debugger, node:test with --inspect-brk) */
function canDebug(rel, content = '') {
  const lang = LANG[ext(rel)];
  return lang === 'py' || lang === 'java' || (lang === 'js' && /node:test/.test(content));
}

/**
 * Same test, started so that a debugger can look at it. Returns the command plus a plain sentence about what to do next.
 * Python: stops at the first failure in the terminal's own debugger (pdb). Java: the build waits on port 5005 for an IDE to attach.
 * node:test: waits on port 9229. Other runners (Vitest, Jest): null, nothing reliable to offer.
 */
function debugCommand(root, rel, test, opts = {}) {
  if (!canDebug(rel, opts.content || '')) return null;
  const c = testCommand(root, rel, test, opts);
  if (!c) return null;
  const lang = LANG[ext(rel)];
  if (lang === 'py') return { ...c, label: `debug ${c.label}`, command: `${c.command} --pdb -s`, note: 'Stops at the first failing line in the terminal below. Type “l” to see the code, “p name” to show a value, “c” to continue, “q” to quit.' };
  if (lang === 'java') {
    const gradle = / test --tests /.test(c.command);
    return { ...c, label: `debug ${c.label}`, command: gradle ? `${c.command} --debug-jvm` : `${c.command} -Dmaven.surefire.debug`, note: 'The build now waits for a debugger on port 5005. In IntelliJ: Run → Edit Configurations → + → Remote JVM Debug (port 5005), put a breakpoint, then press the bug button.' };
  }
  return { ...c, label: `debug ${c.label}`, command: c.command.replace('node --test', 'node --inspect-brk --test'), note: 'Waiting for a debugger on port 9229. In VS Code: Run → Attach to Node Process. In Chrome: open chrome://inspect.' };
}

module.exports = { findTests, testCommand, fileTestCommand, debugCommand, canDebug, quote };
