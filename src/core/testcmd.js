'use strict';
/**
 * "Run this test" for the editor: find tests in a file (Java/JUnit, JS/TS: vitest, jest, node:test, Python: pytest,
 * Go: go test, Rust: cargo test, C#: xUnit/NUnit/MSTest via dotnet test, PHP: PHPUnit, Ruby: RSpec/Minitest, Dart:
 * dart/flutter test, F#: xUnit via dotnet test, Scala: ScalaTest/MUnit `test(...)` via sbt) and build the shell
 * command that runs just that test. Commands are typed into a terminal, so arguments are quoted for its shell.
 */
const fs = require('node:fs');
const path = require('node:path');
const { toPosix } = require('./util');
const { prefixFor } = require('./envinline');

const ext = (rel) => path.posix.extname(toPosix(rel)).toLowerCase();
const LANG = {
  '.java': 'java', '.kt': 'java', '.js': 'js', '.jsx': 'js', '.mjs': 'js', '.cjs': 'js', '.ts': 'js', '.tsx': 'js', '.py': 'py',
  '.go': 'go', '.rs': 'rust', '.cs': 'csharp', '.php': 'php', '.rb': 'ruby', '.dart': 'dart', '.fs': 'fsharp', '.fsx': 'fsharp', '.scala': 'scala', '.sc': 'scala',
};

/** RSpec (describe/context/it blocks) vs Minitest (plain test_ methods on a class) - very different shapes, same .rb extension. */
const isRspecFile = (content) => /^\s*(RSpec\.)?describe\b/m.test(content) || /^\s*it\s*(['"])/m.test(content);

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
  } else if (lang === 'go') {
    const re = /^func\s+(Test\w+)\s*\(\s*\w+\s*\*testing\.T\s*\)/;
    lines.forEach((l, i) => { const m = re.exec(l); if (m) out.push({ line: i + 1, name: m[1], kind: 'test' }); });
  } else if (lang === 'rust') {
    let pending = false;
    lines.forEach((l, i) => {
      if (/^\s*#\[test\]\s*$/.test(l)) { pending = true; return; }
      if (pending && /^\s*#\[/.test(l)) return; // another attribute stacked on its own line, e.g. #[should_panic]
      const m = /^\s*(?:pub\s+)?(?:async\s+)?fn\s+(\w+)\s*\(/.exec(l);
      if (pending && m) out.push({ line: i + 1, name: m[1], kind: 'test' });
      if (pending) pending = false;
    });
  } else if (lang === 'csharp') {
    const cls = path.posix.basename(toPosix(rel)).replace(/\.[^.]+$/, '');
    let pending = false;
    lines.forEach((l, i) => {
      if (/^\s*\[(Fact|Theory|Test|TestMethod)\b/.test(l)) { pending = true; return; }
      if (pending && /^\s*\[/.test(l)) return; // a stacked attribute, e.g. [InlineData(1)]
      const m = /^\s*(?:public\s+|private\s+|internal\s+|protected\s+|static\s+|async\s+)*(?:void|Task)\s+(\w+)\s*\(/.exec(l);
      if (pending && m) out.push({ line: i + 1, name: m[1], kind: 'test', suite: cls });
      if (pending) pending = false;
    });
    const c = lines.findIndex((l) => new RegExp(`\\bclass\\s+${cls}\\b`).test(l));
    if (out.length && c >= 0) out.unshift({ line: c + 1, name: cls, kind: 'suite', suite: cls });
  } else if (lang === 'php') {
    const cls = path.posix.basename(toPosix(rel)).replace(/\.[^.]+$/, '');
    let pending = false;
    lines.forEach((l, i) => {
      if (/^\s*#\[[\w\\]*Test\]/.test(l) || /^\s*\*\s*@test\b/.test(l)) { pending = true; return; }
      if (pending && /^\s*(#\[|\*)/.test(l)) return; // a stacked attribute, or another docblock line
      const m = /^\s*(?:public\s+|protected\s+|private\s+|static\s+|final\s+|abstract\s+)*function\s+(\w+)\s*\(/.exec(l);
      if (m && (pending || /^test/.test(m[1]))) { out.push({ line: i + 1, name: m[1], kind: 'test', suite: cls }); pending = false; }
      else if (pending && m) pending = false;
    });
    const c = lines.findIndex((l) => new RegExp(`\\bclass\\s+${cls}\\b`).test(l));
    if (out.length && c >= 0) out.unshift({ line: c + 1, name: cls, kind: 'suite', suite: cls });
  } else if (lang === 'ruby') {
    if (isRspecFile(content)) {
      lines.forEach((l, i) => {
        // `describe` takes either a quoted description or a bare constant/class (RSpec.describe Order do ... end).
        const d = /^\s*(?:RSpec\.)?describe\s*(?:\(\s*)?(?:(['"])((?:\\.|(?!\1).)+)\1|([\w:]+))/.exec(l);
        if (d) { out.push({ line: i + 1, name: d[2] || d[3], kind: 'suite' }); return; }
        const it = /^\s*it\s*(?:\(\s*)?(['"])((?:\\.|(?!\1).)+)\1/.exec(l);
        if (it) out.push({ line: i + 1, name: it[2], kind: 'test' });
      });
    } else {
      let cls = null; let clsIndent = -1;
      lines.forEach((l, i) => {
        const c = /^(\s*)class\s+(\w+)/.exec(l);
        if (c) { cls = c[2]; clsIndent = c[1].length; out.push({ line: i + 1, name: cls, kind: 'suite' }); return; }
        const m = /^(\s*)def\s+(test_\w+)/.exec(l);
        if (m) {
          if (cls && m[1].length <= clsIndent) cls = null;
          out.push({ line: i + 1, name: m[2], kind: 'test', suite: cls || undefined });
        } else if (cls && /^\S/.test(l)) cls = null;
      });
    }
  } else if (lang === 'dart') {
    const re = /^\s*(group|test|testWidgets)\s*\(\s*(['"])((?:\\.|(?!\2).)+)\2/;
    lines.forEach((l, i) => {
      const m = re.exec(l);
      if (m) out.push({ line: i + 1, name: m[3], kind: m[1] === 'group' ? 'suite' : 'test' });
    });
  } else if (lang === 'fsharp') {
    let pending = false;
    lines.forEach((l, i) => {
      if (/^\s*\[<\s*(Fact|Theory|Test|TestMethod)\b/.test(l)) { pending = true; return; }
      if (pending && /^\s*\[</.test(l)) return; // a stacked attribute
      const m = /^\s*let\s+(?:rec\s+)?(``[^`]+``|\w+)[^=]*=/.exec(l);
      if (pending && m) { out.push({ line: i + 1, name: m[1].replace(/^``|``$/g, ''), kind: 'test' }); pending = false; }
      else if (pending) pending = false;
    });
  } else if (lang === 'scala') {
    const cls = path.posix.basename(toPosix(rel)).replace(/\.[^.]+$/, '');
    const re = /^\s*test\s*\(\s*(['"])((?:\\.|(?!\1).)+)\1\s*\)/;
    lines.forEach((l, i) => { const m = re.exec(l); if (m) out.push({ line: i + 1, name: m[2], kind: 'test', suite: cls }); });
    const c = lines.findIndex((l) => new RegExp(`\\bclass\\s+${cls}\\b`).test(l));
    if (out.length && c >= 0) out.unshift({ line: c + 1, name: cls, kind: 'suite', suite: cls });
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

/** Like nearestUp, but for a project file whose exact name is not known up front (every project names its own differently). */
function nearestProjFile(root, rel, suffix) {
  let dir = path.posix.dirname(toPosix(rel));
  for (;;) {
    let entries = [];
    try { entries = fs.readdirSync(path.join(root, dir === '.' ? '' : dir)); } catch { /* unreadable */ }
    const file = entries.find((f) => f.endsWith(suffix));
    if (file) return { dir: dir === '.' ? '' : dir, file };
    if (dir === '.' || dir === '') return null;
    dir = path.posix.dirname(dir);
  }
}
const nearestCsproj = (root, rel) => nearestProjFile(root, rel, '.csproj');

/** Flutter projects run tests through `flutter test` (it wires up package:flutter_test); plain Dart uses `dart test`. */
function dartUsesFlutter(root, proj) {
  if (!proj) return false;
  try { return /flutter_test:|sdk:\s*flutter/.test(fs.readFileSync(path.join(root, proj.dir, 'pubspec.yaml'), 'utf8')); } catch { return false; }
}

/** The package directory of a Go file, relative to its module root (as `go test` wants it: "." or "./sub/dir"). */
function goPackageDir(rel, modDir) {
  const dir = path.posix.dirname(rel);
  const sub = modDir ? (dir === modDir ? '' : dir.slice(modDir.length + 1)) : dir === '.' ? '' : dir;
  return sub ? `./${sub}` : '.';
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
      // A standard Gradle wrapper setup ships both scripts together; check for either rather than picking by the
      // host's own platform, which does not have to match shellKind (the platform the command is generated for).
      const wrapper = fs.existsSync(path.join(root, gradle.dir, 'gradlew')) || fs.existsSync(path.join(root, gradle.dir, 'gradlew.bat'));
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
  if (lang === 'go') {
    const mod = nearestUp(root, rel, ['go.mod']);
    const cwd = mod ? mod.dir : '';
    const pkg = goPackageDir(rel, cwd);
    const name = escapeRegex(test.name);
    return { cwd, label: `go test ${test.name}`, command: `go test -run ${q(`^${name}$`)} -v ${pkg}` };
  }
  if (lang === 'rust') {
    const manifest = nearestUp(root, rel, ['Cargo.toml']);
    const cwd = manifest ? manifest.dir : '';
    const dir = path.posix.dirname(rel);
    const relDir = cwd ? (dir === cwd ? '' : dir.slice(cwd.length + 1)) : (dir === '.' ? '' : dir);
    const isIntegration = relDir === 'tests' || relDir.startsWith('tests/');
    const target = isIntegration ? `--test ${q(path.posix.basename(rel, '.rs'))} ` : '';
    // Substring match on the bare function name, like Vitest/Jest's -t above: cargo has no concept of "this file",
    // and tracking each test's enclosing `mod` path (to get an exact, unambiguous name) is not worth it for this.
    return { cwd, label: `cargo test ${test.name}`, command: `cargo test ${target}${q(test.name)}` };
  }
  if (lang === 'csharp') {
    const proj = nearestCsproj(root, rel);
    const cwd = proj ? proj.dir : '';
    const sel = test.kind === 'suite' ? test.name : `${test.suite}.${test.name}`;
    return { cwd, label: `dotnet test ${sel}`, command: `dotnet test --filter ${q(`FullyQualifiedName~${sel}`)}` };
  }
  if (lang === 'fsharp') {
    const proj = nearestProjFile(root, rel, '.fsproj');
    const cwd = proj ? proj.dir : '';
    return { cwd, label: `dotnet test ${test.name}`, command: `dotnet test --filter ${q(`FullyQualifiedName~${test.name}`)}` };
  }
  if (lang === 'php') {
    const proj = nearestUp(root, rel, ['phpunit.xml', 'phpunit.xml.dist', 'composer.json']);
    const cwd = proj ? proj.dir : '';
    const file = cwd ? rel.slice(cwd.length + 1) : rel;
    // PHPUnit's --filter is a regex matched against "Class::method"; a plain method/class name works as a substring,
    // same imprecision already accepted for Vitest/Jest/cargo.
    return { cwd, label: `phpunit ${test.name}`, command: `php vendor/bin/phpunit --filter ${q(test.name)} ${q(file)}` };
  }
  if (lang === 'ruby') {
    const proj = nearestUp(root, rel, ['Gemfile', 'Rakefile', '.rspec']);
    const cwd = proj ? proj.dir : '';
    const file = cwd ? rel.slice(cwd.length + 1) : rel;
    // RSpec's file:LINE selector runs whichever example or group starts at that line - works for both a `describe`
    // (suite) and an `it` (test) line, so no suite/test branching is needed here the way Minitest needs below.
    if (isRspecFile(content)) return { cwd, label: `rspec ${file}:${test.line}`, command: `bundle exec rspec ${q(`${file}:${test.line}`)}` };
    if (test.kind === 'suite') return { cwd, label: `ruby ${file}`, command: `ruby -Itest ${q(file)}` };
    return { cwd, label: `minitest ${test.name}`, command: `ruby -Itest ${q(file)} -n ${q(test.name)}` };
  }
  if (lang === 'dart') {
    const proj = nearestUp(root, rel, ['pubspec.yaml']);
    const cwd = proj ? proj.dir : '';
    const file = cwd ? rel.slice(cwd.length + 1) : rel;
    const bin = dartUsesFlutter(root, proj) ? 'flutter test' : 'dart test';
    if (test.kind === 'suite') return { cwd, label: `${bin} ${file}`, command: `${bin} ${q(file)}` };
    return { cwd, label: `${bin} ${test.name}`, command: `${bin} --plain-name ${q(test.name)} ${q(file)}` };
  }
  if (lang === 'scala') {
    const proj = nearestUp(root, rel, ['build.sbt']);
    const cwd = proj ? proj.dir : '';
    const cls = test.suite || test.name;
    // Wildcard class match (`*Cls`) avoids having to parse the file's `package` declaration for a fully-qualified
    // name. Only ScalaTest's/MUnit's plain `test("name") { }` shape is recognised (findTests above) - BDD styles
    // like FlatSpec's `"x" should "y" in { }` are a different shape and are left for a later slice.
    if (test.kind === 'suite') return { cwd, label: `sbt testOnly *${cls}`, command: `sbt ${q(`testOnly *${cls}`)}` };
    return { cwd, label: `sbt testOnly *${cls} -z ${test.name}`, command: `sbt ${q(`testOnly *${cls} -- -z "${test.name.replace(/"/g, '\\"')}"`)}` };
  }
  return null;
}

/** Command for every test in the file. */
function fileTestCommand(root, rel, opts = {}) {
  const lang = LANG[ext(rel)];
  const tests = findTests(rel, opts.content || '');
  if (!tests.length) return null;
  if (lang === 'java' || lang === 'csharp' || lang === 'php' || lang === 'scala') { const s = tests.find((t) => t.kind === 'suite'); return s ? testCommand(root, rel, s, opts) : null; }
  if (lang === 'fsharp') {
    const proj = nearestProjFile(root, rel, '.fsproj');
    const cwd = proj ? proj.dir : '';
    const names = tests.filter((t) => t.kind === 'test').map((t) => t.name);
    if (!names.length) return null;
    const filter = names.map((n) => `FullyQualifiedName~${n}`).join('|');
    return { cwd, label: `all tests in ${path.posix.basename(rel)}`, command: `dotnet test --filter ${quote(opts.shellKind || 'posix', filter)}` };
  }
  if (lang === 'ruby') {
    const proj = nearestUp(root, rel, ['Gemfile', 'Rakefile', '.rspec']);
    const cwd = proj ? proj.dir : '';
    const file = cwd ? rel.slice(cwd.length + 1) : rel;
    const q = (s) => quote(opts.shellKind || 'posix', s);
    return { cwd, label: `all tests in ${path.posix.basename(rel)}`, command: isRspecFile(opts.content || '') ? `bundle exec rspec ${q(file)}` : `ruby -Itest ${q(file)}` };
  }
  if (lang === 'dart') {
    const proj = nearestUp(root, rel, ['pubspec.yaml']);
    const cwd = proj ? proj.dir : '';
    const file = cwd ? rel.slice(cwd.length + 1) : rel;
    const bin = dartUsesFlutter(root, proj) ? 'flutter test' : 'dart test';
    return { cwd, label: `all tests in ${path.posix.basename(rel)}`, command: `${bin} ${quote(opts.shellKind || 'posix', file)}` };
  }
  if (lang === 'py') {
    const proj = nearestUp(root, rel, ['pytest.ini', 'pyproject.toml', 'setup.cfg', 'tox.ini']);
    const cwd = proj ? proj.dir : '';
    return { cwd, label: `pytest ${rel}`, command: `python -m pytest ${quote(opts.shellKind || 'posix', cwd ? rel.slice(cwd.length + 1) : rel)}` };
  }
  if (lang === 'go') {
    const mod = nearestUp(root, rel, ['go.mod']);
    const cwd = mod ? mod.dir : '';
    return { cwd, label: `all tests in ${path.posix.basename(rel)}`, command: `go test -v ${goPackageDir(rel, cwd)}` };
  }
  if (lang === 'rust') {
    const manifest = nearestUp(root, rel, ['Cargo.toml']);
    const cwd = manifest ? manifest.dir : '';
    const dir = path.posix.dirname(rel);
    const relDir = cwd ? (dir === cwd ? '' : dir.slice(cwd.length + 1)) : (dir === '.' ? '' : dir);
    // Only an integration test file (its own binary under tests/) can be scoped to "just this file" - a unit-test
    // module inlined in a src/ file cannot, since cargo has no per-source-file selector for the lib/bin target.
    if (relDir !== 'tests' && !relDir.startsWith('tests/')) return null;
    return { cwd, label: `all tests in ${path.posix.basename(rel)}`, command: `cargo test --test ${quote(opts.shellKind || 'posix', path.posix.basename(rel, '.rs'))}` };
  }
  const first = tests.find((t) => t.kind === 'test') || tests[0];
  const c = testCommand(root, rel, first, opts);
  if (!c) return null;
  return { ...c, label: `all tests in ${path.posix.basename(rel)}`, command: c.command.replace(/ (-t|--test-name-pattern=)\S+( |$)/, ' ').replace(/ -t '[^']*'| -t "[^"]*"| --test-name-pattern='[^']*'/, '').trim() };
}

/** Can this test be started in debug mode from a terminal? (pytest --pdb, JUnit/dlv/vstest waiting for a debugger, node:test with --inspect-brk) */
function canDebug(rel, content = '') {
  const lang = LANG[ext(rel)];
  return lang === 'py' || lang === 'java' || lang === 'go' || lang === 'csharp' || lang === 'fsharp' || lang === 'php' || lang === 'ruby' || lang === 'dart'
    || (lang === 'js' && /node:test/.test(content));
}

const SHELL_ENV_KIND = { powershell: 'ps', cmd: 'cmd', posix: 'posix' };

/**
 * Same test, started so that a debugger can look at it. Returns the command plus a plain sentence about what to do next.
 * Python: stops at the first failure in the terminal's own debugger (pdb). Java: the build waits on port 5005 for an IDE
 * to attach. node:test: waits on port 9229. Go: run under Delve, headless, listening on 127.0.0.1:2345 (needs `dlv`
 * installed separately - unlike the other three, it is not part of the toolchain). C#: `VSTEST_HOST_DEBUG=1` makes the
 * test host print its process id and wait, the same "attach by id" flow Visual Studio/Rider/VS Code already support for
 * `dotnet test`. Other runners (Vitest, Jest, cargo test - no reliable "wait for a debugger" flag): null.
 */
function debugCommand(root, rel, test, opts = {}) {
  if (!canDebug(rel, opts.content || '')) return null;
  const c = testCommand(root, rel, test, opts);
  if (!c) return null;
  rel = toPosix(rel);
  const lang = LANG[ext(rel)];
  const q = (s) => quote(opts.shellKind || 'posix', s);
  if (lang === 'py') return { ...c, label: `debug ${c.label}`, command: `${c.command} --pdb -s`, note: 'Stops at the first failing line in the terminal below. Type “l” to see the code, “p name” to show a value, “c” to continue, “q” to quit.' };
  if (lang === 'java') {
    const gradle = / test --tests /.test(c.command);
    return { ...c, label: `debug ${c.label}`, command: gradle ? `${c.command} --debug-jvm` : `${c.command} -Dmaven.surefire.debug`, note: 'The build now waits for a debugger on port 5005. In IntelliJ: Run → Edit Configurations → + → Remote JVM Debug (port 5005), put a breakpoint, then press the bug button.' };
  }
  if (lang === 'go') {
    const mod = nearestUp(root, rel, ['go.mod']);
    const cwd = mod ? mod.dir : '';
    const pkg = goPackageDir(rel, cwd);
    const name = escapeRegex(test.name);
    return {
      ...c, label: `debug ${c.label}`,
      command: `dlv test ${pkg} --headless --listen=127.0.0.1:2345 --api-version=2 -- -test.run ${q(`^${name}$`)} -test.v`,
      note: 'Waiting for a debugger on 127.0.0.1:2345 (needs dlv: go install github.com/go-delve/delve/cmd/dlv@latest). In VS Code (Go extension): Run and Debug → add a “Go: Connect to server” configuration for that port. In GoLand: Run → Edit Configurations → Go Remote, host localhost, port 2345.',
    };
  }
  if (lang === 'csharp' || lang === 'fsharp') {
    const kind = SHELL_ENV_KIND[opts.shellKind || 'posix'] || 'posix';
    return {
      ...c, label: `debug ${c.label}`,
      command: `${prefixFor({ VSTEST_HOST_DEBUG: '1' }, kind)}${c.command}`,
      note: 'The test host now prints “Waiting for debugger attach... Process Id: <pid>” and pauses. Attach to that process id from Visual Studio, Rider or VS Code (C# Dev Kit: Debug → Attach to Process), then continue.',
    };
  }
  if (lang === 'php') {
    const kind = SHELL_ENV_KIND[opts.shellKind || 'posix'] || 'posix';
    return {
      ...c, label: `debug ${c.label}`,
      command: `${prefixFor({ XDEBUG_MODE: 'debug', XDEBUG_TRIGGER: '1' }, kind)}${c.command}`,
      note: 'Only pauses if an IDE is already listening for Xdebug on port 9003 (Xdebug 3 default) - start that first: VS Code’s PHP Debug extension → Start Listening for Xdebug; PhpStorm → the phone icon (Start Listening for PHP Debug Connections). Then run this.',
    };
  }
  if (lang === 'ruby') {
    return {
      ...c, label: `debug ${c.label}`,
      command: `rdbg --open --port=12345 -c -- ${c.command}`,
      note: 'Waiting for a debugger on 127.0.0.1:12345 (needs the debug gem - bundled with Ruby 3.1+, or gem install debug). In VS Code: install the “rdbg Debugger” extension, Run → Add Configuration → “Attach with rdbg”, port 12345.',
    };
  }
  if (lang === 'dart') {
    return {
      ...c, label: `debug ${c.label}`,
      command: c.command.replace(/^(dart|flutter) test /, '$1 test --pause-after-load '),
      note: 'Pauses after loading the test, before running it, and prints a “Dart VM service” URL in the terminal above. Open that URL, or in VS Code use the Dart/Flutter extension’s “Attach to Process”, then continue.',
    };
  }
  return { ...c, label: `debug ${c.label}`, command: c.command.replace('node --test', 'node --inspect-brk --test'), note: 'Waiting for a debugger on port 9229. In VS Code: Run → Attach to Node Process. In Chrome: open chrome://inspect.' };
}

module.exports = { findTests, testCommand, fileTestCommand, debugCommand, canDebug, quote };
