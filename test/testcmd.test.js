'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const T = require('../src/core/testcmd');

const tmp = (files) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bazinga-tc-'));
  for (const f of files) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), ''); }
  return dir;
};

const JAVA = `package a;
import org.junit.jupiter.api.Test;
class OrderServiceTest {
    @Test
    void createsOrder() {}

    @Test
    @DisplayName("x")
    public void rejectsEmpty() {}

    void helper() {}
}
`;

test('java: finds @Test methods (not helpers) and the class', () => {
  const t = T.findTests('src/test/java/a/OrderServiceTest.java', JAVA);
  assert.deepStrictEqual(t.map((x) => [x.kind, x.name, x.line]), [['suite', 'OrderServiceTest', 3], ['test', 'createsOrder', 5], ['test', 'rejectsEmpty', 9]]);
});

test('java: maven command in the nearest module, quoted for each shell', () => {
  const root = tmp(['pom.xml', 'svc/pom.xml', 'svc/src/test/java/a/OrderServiceTest.java']);
  const rel = 'svc/src/test/java/a/OrderServiceTest.java';
  const [suite, m] = T.findTests(rel, JAVA);
  const c = T.testCommand(root, rel, m, { shellKind: 'posix' });
  assert.strictEqual(c.cwd, 'svc');
  assert.match(c.command, /^mvn -B test -Dtest='OrderServiceTest#createsOrder'/);
  assert.match(T.testCommand(root, rel, suite, { shellKind: 'powershell' }).command, /-Dtest='OrderServiceTest'/);
  assert.match(T.fileTestCommand(root, rel, { content: JAVA }).command, /-Dtest='OrderServiceTest'/);
});

test('java: gradle with wrapper', () => {
  const root = tmp(['build.gradle', 'gradlew', 'src/test/java/FooTest.java']);
  const rel = 'src/test/java/FooTest.java';
  const [t] = T.findTests(rel, '@Test\nvoid a() {}\nclass FooTest {}');
  const c = T.testCommand(root, rel, { kind: 'test', name: 'a', suite: 'FooTest' }, { shellKind: 'posix' });
  assert.match(c.command, /^\.\/gradlew test --tests '\*FooTest\.a'/);
  assert.ok(t);
});

const JS = `import { describe, it, expect } from 'vitest';
describe('validate (postcode)', () => {
  it('accepts a complete address', () => {});
  test.skip("rejects 'bad' input", () => {});
  it.only(\`template name\`, () => {});
});
`;

test('js: finds describe/it/test with quotes and modifiers', () => {
  const t = T.findTests('a.test.js', JS);
  assert.deepStrictEqual(t.map((x) => [x.kind, x.name]), [['suite', 'validate (postcode)'], ['test', 'accepts a complete address'], ['test', "rejects 'bad' input"], ['test', 'template name']]);
});

test('js: vitest by default, regex-escaped and shell-quoted names; jest and node:test detected', () => {
  const root = tmp(['package.json', 'node_modules/.bin/vitest', 'web/package.json', 'web/node_modules/.bin/jest', 'web/a.test.js']);
  const c = T.testCommand(root, 'a.test.js', { kind: 'suite', name: 'validate (postcode)' }, { shellKind: 'posix' });
  assert.strictEqual(c.command, "npx --no-install vitest run 'a.test.js' -t 'validate \\(postcode\\)'");
  const q = T.testCommand(root, 'a.test.js', { kind: 'test', name: "rejects 'bad' input" }, { shellKind: 'posix' });
  assert.ok(q.command.endsWith(`-t 'rejects '\\''bad'\\'' input'`), q.command);
  const ps = T.testCommand(root, 'a.test.js', { kind: 'test', name: "rejects 'bad' input" }, { shellKind: 'powershell' });
  assert.ok(ps.command.endsWith(`-t 'rejects ''bad'' input'`), ps.command);
  const jest = T.testCommand(root, 'web/a.test.js', { kind: 'test', name: 'x' }, { shellKind: 'posix' });
  assert.strictEqual(jest.cwd, 'web');
  assert.match(jest.command, /^npx --no-install jest 'a\.test\.js' -t 'x'/);
  const node = T.testCommand(root, 'a.test.js', { kind: 'test', name: 'x y' }, { shellKind: 'posix', content: "const test = require('node:test');" });
  assert.match(node.command, /^node --test --test-name-pattern='x y' 'a\.test\.js'/);
});

test('js: whole-file command drops the name filter', () => {
  const root = tmp(['package.json', 'node_modules/.bin/vitest', 'a.test.js']);
  assert.strictEqual(T.fileTestCommand(root, 'a.test.js', { content: JS, shellKind: 'posix' }).command, "npx --no-install vitest run 'a.test.js'");
});

const PY = `import pytest

def test_top():
    pass

class TestAddress:
    def test_valid(self):
        pass

    def helper(self):
        pass

def test_after_class():
    pass
`;

test('python: tests, classes, and test names after a class do not inherit it', () => {
  const t = T.findTests('tests/test_x.py', PY);
  assert.deepStrictEqual(t.map((x) => [x.kind, x.name, x.suite || null]), [['test', 'test_top', null], ['suite', 'TestAddress', null], ['test', 'test_valid', 'TestAddress'], ['test', 'test_after_class', null]]);
  const root = tmp(['pyproject.toml', 'tests/test_x.py']);
  assert.strictEqual(T.testCommand(root, 'tests/test_x.py', t[2], { shellKind: 'posix' }).command, "python -m pytest 'tests/test_x.py::TestAddress::test_valid'");
  assert.strictEqual(T.fileTestCommand(root, 'tests/test_x.py', { content: PY, shellKind: 'cmd' }).command, 'python -m pytest "tests/test_x.py"');
});

const GO = `package pkg

func helper() {}

func TestFoo(t *testing.T) {
}

func TestBar(t *testing.T) {
}
`;

test('go: finds Test funcs (not helpers), builds a scoped -run command, and the whole-package file command', () => {
  const t = T.findTests('svc/pkg/foo_test.go', GO);
  assert.deepStrictEqual(t.map((x) => [x.kind, x.name, x.line]), [['test', 'TestFoo', 5], ['test', 'TestBar', 8]]);
  const root = tmp(['go.mod', 'svc/go.mod', 'svc/pkg/foo_test.go']);
  const rel = 'svc/pkg/foo_test.go';
  const c = T.testCommand(root, rel, t[0], { shellKind: 'posix' });
  assert.strictEqual(c.cwd, 'svc');
  assert.strictEqual(c.command, "go test -run '^TestFoo$' -v ./pkg");
  assert.strictEqual(T.fileTestCommand(root, rel, { content: GO }).command, 'go test -v ./pkg');
});

const RUST = `#[cfg(test)]
mod tests {
    fn helper() {}

    #[test]
    fn adds() {
        assert_eq!(1, 1);
    }

    #[test]
    #[should_panic]
    fn panics() {
        panic!();
    }
}
`;

test('rust: finds #[test] fns (stacked attributes included, helpers excluded), substring cargo test', () => {
  const t = T.findTests('src/lib.rs', RUST);
  assert.deepStrictEqual(t.map((x) => [x.kind, x.name, x.line]), [['test', 'adds', 6], ['test', 'panics', 12]]);
  const root = tmp(['Cargo.toml', 'src/lib.rs']);
  const c = T.testCommand(root, 'src/lib.rs', t[0], { shellKind: 'posix' });
  assert.strictEqual(c.cwd, '');
  assert.strictEqual(c.command, "cargo test 'adds'");
  // a unit-test module inlined in src/ cannot be scoped to "just this file" - cargo has no selector for that
  assert.strictEqual(T.fileTestCommand(root, 'src/lib.rs', { content: RUST }), null);
});

test('rust: an integration test file (tests/*.rs) is its own cargo target, so the whole file CAN be scoped', () => {
  const root = tmp(['Cargo.toml', 'tests/smoke.rs']);
  const rel = 'tests/smoke.rs';
  const t = [{ kind: 'test', name: 'it_works' }];
  const c = T.testCommand(root, rel, t[0], { shellKind: 'posix' });
  assert.strictEqual(c.command, "cargo test --test 'smoke' 'it_works'");
  assert.strictEqual(T.fileTestCommand(root, rel, { content: '#[test]\nfn it_works() {}\n' }).command, "cargo test --test 'smoke'");
});

const CSHARP = `using Xunit;
public class OrderServiceTests {
    [Fact]
    public void CreatesOrder() {}

    [Theory]
    [InlineData(1)]
    public void RejectsEmpty(int x) {}

    void Helper() {}
}
`;

test('c#: finds [Fact]/[Theory] methods (stacked attributes, helpers excluded) and the class, dotnet test --filter', () => {
  const t = T.findTests('tests/OrderServiceTests.cs', CSHARP);
  assert.deepStrictEqual(t.map((x) => [x.kind, x.name, x.line]), [['suite', 'OrderServiceTests', 2], ['test', 'CreatesOrder', 4], ['test', 'RejectsEmpty', 8]]);
  const root = tmp(['Tests.csproj', 'tests/OrderServiceTests.cs']);
  const rel = 'tests/OrderServiceTests.cs';
  const c = T.testCommand(root, rel, t[1], { shellKind: 'posix' });
  assert.strictEqual(c.cwd, '');
  assert.strictEqual(c.command, "dotnet test --filter 'FullyQualifiedName~OrderServiceTests.CreatesOrder'");
  assert.strictEqual(T.fileTestCommand(root, rel, { content: CSHARP }).command, "dotnet test --filter 'FullyQualifiedName~OrderServiceTests'");
});

test('go/rust/c# tests cannot be started in debug mode (no reliable "wait for a debugger" flag)', () => {
  assert.strictEqual(T.canDebug('a_test.go'), false);
  assert.strictEqual(T.canDebug('lib.rs'), false);
  assert.strictEqual(T.canDebug('FooTests.cs'), false);
});

test('quoting cannot be broken out of', () => {
  assert.strictEqual(T.quote('posix', "a'; rm -rf /; '"), `'a'\\''; rm -rf /; '\\'''`);
  assert.strictEqual(T.quote('powershell', "a'; Remove-Item x; '"), "'a''; Remove-Item x; '''");
  assert.strictEqual(T.findTests('README.md', 'it("x", () => {})').length, 0);
});
