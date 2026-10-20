'use strict';
const test = require('node:test');
const assert = require('node:assert');
const T = require('../src/core/treesitter');
const { findSymbols } = require('../src/core/symbols');

const names = (syms) => syms.map((s) => `${s.kind}:${s.name}@${s.line}-${s.endLine}`);

test('Java: a signature over several lines, annotations on their own line, constructors, nested classes, enums, records', async () => {
  const src = ['public class Outer {', '  @Override', '  @Deprecated', '  public String describe(', '      int a,', '      int b) {', '    return "x";', '  }', '  Outer() { }', '  static class Inner { void go() { } }', '  enum Mode { A, B }', '}', 'record Pair(int a, int b) { }', ''].join('\n');
  assert.deepStrictEqual(names(await T.symbols('Outer.java', src)), ['class:Outer@1-12', 'method:describe@4-8', 'method:Outer@9-9', 'class:Inner@10-10', 'method:go@10-10', 'class:Mode@11-11', 'class:Pair@13-13']);
});

test('the parser finds what the line patterns cannot (and the line patterns stay as the fallback)', async () => {
  const src = 'class A {\n  @Override\n  public\n  void\n  f(\n    int x) {\n  }\n}\n';
  const viaTree = await T.symbols('A.java', src);
  assert.ok(viaTree.some((s) => s.name === 'f' && s.line === 5));
  assert.ok(!findSymbols('A.java', src).some((s) => s.name === 'f'), 'the line patterns miss a signature split over four lines');
});

test('Kotlin, TypeScript (arrow functions, interfaces), JavaScript, Python (decorators, methods vs functions)', async () => {
  assert.deepStrictEqual(names(await T.symbols('K.kt', 'class K {\n  fun g(x: Int): Int { return x }\n}\nfun top() {}\n')), ['class:K@1-3', 'method:g@2-2', 'function:top@4-4']);
  assert.deepStrictEqual(names(await T.symbols('a.ts', 'export class C { m(): void {} }\nconst arrow = (x: number) => x;\nfunction f() {}\ninterface I { a: number }\n')), ['class:C@1-1', 'method:m@1-1', 'function:arrow@2-2', 'function:f@3-3', 'class:I@4-4']);
  assert.deepStrictEqual(names(await T.symbols('a.js', 'const f = function () {};\nclass Z { constructor() {} }\n')), ['function:f@1-1', 'class:Z@2-2', 'method:constructor@2-2']);
  assert.deepStrictEqual(names(await T.symbols('a.py', 'class P:\n    @dec\n    def m(self):\n        pass\ndef top():\n    pass\n')), ['class:P@1-4', 'method:m@3-4', 'function:top@5-6']);
});

test('Go, Rust and C# are covered too', async () => {
  assert.deepStrictEqual(names(await T.symbols('a.go', 'package main\ntype S struct{}\nfunc (s S) M() {}\nfunc F() {}\n')), ['class:S@2-2', 'method:M@3-3', 'function:F@4-4']);
  assert.deepStrictEqual(names(await T.symbols('a.rs', 'struct S;\nimpl S { fn m(&self) {} }\nfn f() {}\n')), ['class:S@1-1', 'method:m@2-2', 'function:f@3-3']);
  assert.deepStrictEqual(names(await T.symbols('a.cs', 'class C {\n  void M() {}\n}\n')), ['class:C@1-3', 'method:M@2-2']);
});

test('broken code still gives the symbols around the error; unsupported files, empty input and huge input give null or nothing', async () => {
  const broken = await T.symbols('B.java', 'class B {\n  void ok() { }\n  void bad( {{{\n  void after() { }\n}\n');
  assert.ok(broken.some((s) => s.name === 'ok'));
  assert.strictEqual(await T.symbols('notes.txt', 'class X {}'), null);
  assert.strictEqual(await T.symbols('big.java', 'x'.repeat(3 * 1024 * 1024)), null);
  assert.deepStrictEqual(await T.symbols('E.java', ''), []);
  assert.strictEqual(T.supported('src/A.JAVA'), 'java'); assert.strictEqual(T.supported('Makefile'), null);
});

test('many parses in a row do not leak or break (trees are freed)', async () => {
  for (let i = 0; i < 200; i++) assert.strictEqual((await T.symbols('A.java', `class A${i} { void f() { } }`)).length, 2);
});
