'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { diffSymbols, crossFileMoves, summarizeSymbolChanges } = require('../src/core/semanticdiff');

test('an unchanged symbol (same body, same line) is not reported', () => {
  const content = 'function foo(x) {\n  return x + 1;\n}\n';
  const syms = [{ name: 'foo', kind: 'function', line: 1, endLine: 3 }];
  assert.deepEqual(diffSymbols(content, content, syms, syms), []);
});

test('renamed: same body modulo its own name is a rename, not a remove+add', () => {
  const oldContent = 'function foo(x) {\n  return foo(x - 1) + 1;\n}\n';
  const newContent = 'function bar(x) {\n  return bar(x - 1) + 1;\n}\n';
  const oldSyms = [{ name: 'foo', kind: 'function', line: 1, endLine: 3 }];
  const newSyms = [{ name: 'bar', kind: 'function', line: 1, endLine: 3 }];
  const changes = diffSymbols(oldContent, newContent, oldSyms, newSyms);
  assert.deepEqual(changes, [{ type: 'renamed', kind: 'function', name: 'foo', newName: 'bar', oldLine: 1, newLine: 1 }]);
});

test('moved: same name, body and kind but a different line is a move, not a change', () => {
  const oldContent = 'function foo() {\n  return 1;\n}\n';
  const newContent = '// a new comment up here\nfunction foo() {\n  return 1;\n}\n';
  const oldSyms = [{ name: 'foo', kind: 'function', line: 1, endLine: 3 }];
  const newSyms = [{ name: 'foo', kind: 'function', line: 2, endLine: 4 }];
  const changes = diffSymbols(oldContent, newContent, oldSyms, newSyms);
  assert.deepEqual(changes, [{ type: 'moved', kind: 'function', name: 'foo', oldLine: 1, newLine: 2 }]);
});

test('modified: same name, kind and line but a different body', () => {
  const oldContent = 'function foo() {\n  return 1;\n}\n';
  const newContent = 'function foo() {\n  return 2;\n}\n';
  const oldSyms = [{ name: 'foo', kind: 'function', line: 1, endLine: 3 }];
  const newSyms = [{ name: 'foo', kind: 'function', line: 1, endLine: 3 }];
  const changes = diffSymbols(oldContent, newContent, oldSyms, newSyms);
  assert.deepEqual(changes, [{ type: 'modified', kind: 'function', name: 'foo', oldLine: 1, newLine: 1 }]);
});

test('a rename that also changes behaviour is not claimed as "just a rename": falls back to removed+added', () => {
  const oldContent = 'function foo() {\n  return 1;\n}\n';
  const newContent = 'function bar() {\n  return 2;\n}\n';
  const oldSyms = [{ name: 'foo', kind: 'function', line: 1, endLine: 3 }];
  const newSyms = [{ name: 'bar', kind: 'function', line: 1, endLine: 3 }];
  const changes = diffSymbols(oldContent, newContent, oldSyms, newSyms);
  assert.deepEqual(changes.map((c) => c.type).sort(), ['added', 'removed']);
});

test('added and removed: no plausible partner on the other side', () => {
  const oldContent = 'function foo() {\n  return 1;\n}\n';
  const newContent = 'function bar() {\n  return "totally different";\n}\n';
  const oldSyms = [{ name: 'foo', kind: 'function', line: 1, endLine: 3 }];
  const newSyms = [{ name: 'bar', kind: 'function', line: 1, endLine: 3 }];
  const changes = diffSymbols(oldContent, newContent, oldSyms, newSyms);
  assert.deepEqual(changes, [{ type: 'removed', kind: 'function', name: 'foo', oldLine: 1 }, { type: 'added', kind: 'function', name: 'bar', newLine: 1 }]);
});

test('same name but different kind (a function becomes a class) does not match: removed+added', () => {
  const oldSyms = [{ name: 'Box', kind: 'function', line: 1, endLine: 3 }];
  const newSyms = [{ name: 'Box', kind: 'class', line: 1, endLine: 5 }];
  const changes = diffSymbols('a', 'b', oldSyms, newSyms);
  assert.deepEqual(changes.map((c) => c.type).sort(), ['added', 'removed']);
});

test('results are sorted by where they sit in the file', () => {
  const oldContent = 'function z() { return 1; }\nfunction c() { return "a totally distinct, unmatched body"; }\n';
  const newContent = 'function z() { return 2; }\nfunction b() { return "another, equally distinct body"; }\n';
  const oldSyms = [{ name: 'z', kind: 'function', line: 1, endLine: 1 }, { name: 'c', kind: 'function', line: 2, endLine: 2 }];
  const newSyms = [{ name: 'z', kind: 'function', line: 1, endLine: 1 }, { name: 'b', kind: 'function', line: 2, endLine: 2 }];
  const changes = diffSymbols(oldContent, newContent, oldSyms, newSyms);
  // z (modified, line 1) sorts before c/b (removed/added, line 2); removed is listed before added at the same line
  assert.deepEqual(changes.map((c) => c.name), ['z', 'c', 'b']);
});

test('empty symbol lists give an empty diff', () => {
  assert.deepEqual(diffSymbols('a', 'b', [], []), []);
  assert.deepEqual(diffSymbols('a', 'b', null, null), []);
});

test('crossFileMoves: a function cut from one file and pasted into another under a new name is a rename', () => {
  const oldSym = { name: 'foo', kind: 'function', line: 1, endLine: 3 };
  const newSym = { name: 'bar', kind: 'function', line: 10, endLine: 12 };
  const removals = [{ path: 'a.js', sym: oldSym, content: 'function foo(x) {\n  return foo(x - 1) + 1;\n}\n' }];
  const additions = [{ path: 'b.js', sym: newSym, content: '\n\n\n\n\n\n\n\n\nfunction bar(x) {\n  return bar(x - 1) + 1;\n}\n' }];
  assert.deepEqual(crossFileMoves(removals, additions), [{ type: 'renamed', kind: 'function', name: 'foo', newName: 'bar', fromPath: 'a.js', toPath: 'b.js', oldLine: 1, newLine: 10 }]);
});

test('crossFileMoves: same name across files is a move, not a rename', () => {
  const oldSym = { name: 'foo', kind: 'function', line: 1, endLine: 3 };
  const newSym = { name: 'foo', kind: 'function', line: 1, endLine: 3 };
  const removals = [{ path: 'a.js', sym: oldSym, content: 'function foo() {\n  return 1;\n}\n' }];
  const additions = [{ path: 'b.js', sym: newSym, content: 'function foo() {\n  return 1;\n}\n' }];
  assert.deepEqual(crossFileMoves(removals, additions), [{ type: 'moved', kind: 'function', name: 'foo', fromPath: 'a.js', toPath: 'b.js', oldLine: 1, newLine: 1 }]);
});

test('crossFileMoves: never pairs removals/additions from the same file - that is diffSymbols’ own job', () => {
  const sym = { name: 'foo', kind: 'function', line: 1, endLine: 3 };
  const removals = [{ path: 'a.js', sym, content: 'function foo() {\n  return 1;\n}\n' }];
  const additions = [{ path: 'a.js', sym, content: 'function foo() {\n  return 1;\n}\n' }];
  assert.deepEqual(crossFileMoves(removals, additions), []);
});

test('crossFileMoves: no match leaves the lists untouched', () => {
  const removals = [{ path: 'a.js', sym: { name: 'foo', kind: 'function', line: 1, endLine: 3 }, content: 'function foo() {\n  return 1;\n}\n' }];
  const additions = [{ path: 'b.js', sym: { name: 'bar', kind: 'function', line: 1, endLine: 3 }, content: 'function bar() {\n  return "totally different";\n}\n' }];
  assert.deepEqual(crossFileMoves(removals, additions), []);
});

test('summarizeSymbolChanges: one line per change, cross-file moves show both paths', () => {
  const changes = [
    { type: 'added', kind: 'function', name: 'f', path: 'x.js' },
    { type: 'renamed', kind: 'function', name: 'foo', newName: 'bar', fromPath: 'a.js', toPath: 'b.js' },
  ];
  const text = summarizeSymbolChanges(changes);
  assert.match(text, /added function f \(x\.js\)/);
  assert.match(text, /renamed function foo → bar \(a\.js → b\.js\)/);
});

test('summarizeSymbolChanges: caps the list and says how many were omitted', () => {
  const changes = Array.from({ length: 60 }, (_, i) => ({ type: 'added', kind: 'function', name: `f${i}`, path: 'x.js' }));
  const text = summarizeSymbolChanges(changes);
  assert.equal(text.split('\n').length, 51); // 50 lines + the omitted-count line
  assert.match(text, /10 more symbol changes omitted/);
});
