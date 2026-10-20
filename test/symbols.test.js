'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../src/core/symbols');
const { UsageIndex, countIdentifiers } = require('../src/core/usages');
const H = require('../src/core/history');
const G = require('../src/core/git');
const { repo, write, sh } = require('./helpers');

const brief = (rel, text) => S.findSymbols(rel, text).map((s) => `${s.kind}:${s.name}@${s.line}-${s.endLine}`);

test('java: classes, interfaces, constructors and methods; calls and statements are not symbols', () => {
  const src = `package a;
@Service
public class OrderService {
    private final Repo repo;
    public OrderService(Repo repo) { this.repo = repo; }
    @Transactional
    public Order create(String id, int qty) throws Exception {
        if (qty > 0) {
            return repo.save(new Order(id));
        }
        helper(1);
        this.go(2);
        Order x = new Order(id);
        return null;
    }
    private static <T> List<T> all() {
        return foo(bar);
    }
    abstract void declared();
    int one() { return 1; }
}
interface Api { void call(); }`;
  assert.deepEqual(brief('A.java', src), [
    'class:OrderService@3-21', 'method:OrderService@5-5', 'method:create@7-15', 'method:all@16-18', 'method:one@20-20', 'class:Api@22-22',
  ]);
});

test('typescript / javascript: classes, methods, functions and arrow functions assigned to a const', () => {
  const src = `export class Foo {
  constructor(a) { this.a = a; }
  async load(id) {
    if (id) { return 1; }
  }
  static make() {
    return new Foo();
  }
}
export function top(a, b) {
  return a + b;
}
const arrow = async (x) => {
  return x;
};
const val = 5;`;
  assert.deepEqual(brief('a.ts', src), ['class:Foo@1-9', 'method:load@3-5', 'method:make@6-8', 'function:top@10-12', 'function:arrow@13-15']);
});

test('python: classes, methods (indented) and functions; end of block by indentation', () => {
  const src = 'class A:\n    def f(self):\n        return 1\n\n    async def g(self):\n        pass\n\ndef top():\n    pass\n';
  assert.deepEqual(brief('a.py', src), ['class:A@1-6', 'method:f@2-3', 'method:g@5-6', 'function:top@8-9']);
});

test('kotlin: fun declarations including extension and generic functions', () => {
  assert.deepEqual(brief('a.kt', 'class Foo {\n    fun bar(x: Int): Int {\n        return x\n    }\n    suspend fun <T> List<T>.baz() {\n    }\n}\n'),
    ['class:Foo@1-7', 'method:bar@2-4', 'method:baz@5-6']);
});

test('comments, keywords and unknown file types give nothing; braces in strings do not confuse the end of a block', () => {
  assert.deepEqual(brief('a.txt', 'class X {}'), []);
  assert.deepEqual(brief('A.java', '// public void commented() {\n/* class Fake */\n'), []);
  const tricky = 'function f() {\n  const s = "}}}";\n  // }\n  return 1;\n}\nfunction g() {}\n';
  assert.deepEqual(brief('a.js', tricky), ['function:f@1-5', 'function:g@6-6']);
});

test('blame of a symbol: newest committed change in its lines wins; uncommitted lines are reported', () => {
  const lines = [
    { line: 1, sha: 'a'.repeat(40), author: 'Old', time: 100, summary: 'first', committed: true },
    { line: 2, sha: 'b'.repeat(40), author: 'New', time: 900, summary: 'tweak', committed: true },
    { line: 3, sha: '0'.repeat(40), author: 'Not Committed Yet', time: 999, summary: '', committed: false },
    { line: 9, sha: 'c'.repeat(40), author: 'Other', time: 5000, summary: 'elsewhere', committed: true },
  ];
  assert.deepEqual(S.symbolBlame(lines, { line: 1, endLine: 2 }), { author: 'New', time: 900, sha: 'b'.repeat(40), summary: 'tweak', uncommitted: false });
  assert.equal(S.symbolBlame(lines, { line: 1, endLine: 3 }).uncommitted, true);
  assert.equal(S.symbolBlame(lines, { line: 1, endLine: 3 }).author, 'New');
  assert.deepEqual(S.symbolBlame(lines, { line: 3, endLine: 3 }), { author: '', time: 0, sha: '', summary: '', uncommitted: true });
  assert.equal(S.symbolBlame(lines, { line: 20, endLine: 30 }), null);
  assert.equal(S.symbolBlame(undefined, { line: 1, endLine: 2 }), null);
});

test('blame of a symbol from a real repository', async () => {
  const root = repo({ 'A.java': 'class A {\n    void one() {\n        x();\n    }\n    void two() {\n    }\n}\n' });
  write(root, 'A.java', 'class A {\n    void one() {\n        x();\n    }\n    void two() {\n        y();\n    }\n}\n');
  sh(root, 'add', '.');
  require('node:child_process').execFileSync('git', ['-c', 'user.name=Second Dev', '-c', 'user.email=s@s', 'commit', '-q', '-m', 'touch two'], { cwd: root, env: { ...process.env, GIT_AUTHOR_DATE: '2031-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2031-01-01T00:00:00Z' } }); // clearly later than the first commit
  write(root, 'A.java', 'class A {\n    void one() {\n        x();\n        z();\n    }\n    void two() {\n        y();\n    }\n}\n');
  const text = require('node:fs').readFileSync(require('node:path').join(root, 'A.java'), 'utf8');
  const blame = await H.blame(root, 'A.java');
  const [, one, two] = S.findSymbols('A.java', text);
  assert.equal(S.symbolBlame(blame, one).uncommitted, true, 'one() has an uncommitted line');
  assert.equal(S.symbolBlame(blame, one).author, 't');
  assert.equal(S.symbolBlame(blame, two).author, 'Second Dev');
  assert.equal(S.symbolBlame(blame, two).summary, 'touch two');
  void G;
});

// ---------------------------------------------------------------- usages
test('identifier counting', () => {
  const c = countIdentifiers('foo(bar); foo.baz(foo) // a\n$x = _y + a1');
  assert.equal(c.get('foo'), 3); assert.equal(c.get('bar'), 1); assert.equal(c.get('$x'), 1); assert.equal(c.get('_y'), 1);
  assert.equal(c.has('a'), false, 'one-letter names are not indexed');
});

test('usage index: counts across files minus the declaration, follows edits and deletions, skips non-code and big files', async () => {
  const root = repo({
    'src/A.java': 'class Alpha { void run() {} }\n',
    'src/B.java': 'class B { void go(Alpha a) { a.run(); a.run(); } }\n',
    'notes.md': 'run run run run\n',
    'big.js': `${'run '.repeat(120000)}\n`, // > 400 KB
  });
  const idx = new UsageIndex(root, () => G.projectFiles(root));
  await idx.refresh();
  assert.deepEqual(idx.usages('run'), { count: 2, files: 2, exact: false });
  assert.equal(idx.usages('nothingHere').count, 0);
  assert.equal(idx.usages('Alpha').count, 1, 'the use as a parameter type');
  // edit B: one more call
  await new Promise((r) => setTimeout(r, 15));
  write(root, 'src/B.java', 'class B { void go(Alpha a) { a.run(); a.run(); a.run(); } }\n');
  idx.invalidate(); await idx.refresh();
  assert.equal(idx.usages('run').count, 3);
  // delete B
  require('node:fs').rmSync(require('node:path').join(root, 'src/B.java'));
  idx.invalidate(); await idx.refresh();
  assert.equal(idx.usages('run').count, 0);
  // unchanged files are not read again
  const before = idx.files.get('src/A.java');
  idx.invalidate(); await idx.refresh();
  assert.equal(idx.files.get('src/A.java'), before);
});

test('concurrent refreshes share one build', async () => {
  const root = repo({ 'a.js': 'foo foo\n' });
  let calls = 0;
  const idx = new UsageIndex(root, async () => { calls++; return ['a.js']; });
  await Promise.all([idx.refresh(), idx.refresh(), idx.refresh()]);
  assert.equal(calls, 1);
  assert.equal(idx.usages('foo', { declarations: 0 }).count, 2);
});

test('nameColumn finds the declared name for language server requests', () => {
  const { nameColumn } = require('../src/core/symbols');
  assert.strictEqual(nameColumn('    public static void helper(int x) {', 'helper', 'method'), 23);
  assert.strictEqual(nameColumn('export class Box extends Box2 {', 'Box', 'class'), 13);
  assert.strictEqual(nameColumn('class Box:', 'Box', 'class'), 6);
  assert.strictEqual(nameColumn('def helper(a):', 'helper', 'function'), 4);
  assert.strictEqual(nameColumn('const f = (x) => x', 'f', 'function'), 6);
  assert.strictEqual(nameColumn('nothing here', 'helper', 'method'), -1);
});
