'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { evaluateMerge } = require('../src/core/guard');

const scope = (o = {}) => ({ files: [{ path: 'a.js' }, { path: 'b.js' }], outOfScope: [], testEdits: [], report: null, ...o });
const clean = { findings: [], files: ['a.js', 'b.js'] };

test('a clean, reviewed run has no items', () => {
  const g = evaluateMerge({ result: clean, scope: scope(), reviewed: ['a.js', 'b.js'] });
  assert.deepStrictEqual(g.items, []);
  assert.ok(g.ok && g.clean);
});

test('gate errors block; warnings and legacy findings do not', () => {
  const g = evaluateMerge({ result: { findings: [{ severity: 'error', file: 'a.js' }, { severity: 'error', file: 'x.js', legacy: true }, { severity: 'warning', file: 'a.js' }] }, scope: scope(), reviewed: ['a.js', 'b.js'] });
  assert.strictEqual(g.blockers, 1);
  assert.deepStrictEqual(g.items[0].files, ['a.js']);
  assert.strictEqual(g.ok, false);
});

test('weakened tests block, new or untouched tests do not', () => {
  const weak = evaluateMerge({ result: clean, scope: scope({ testEdits: [{ path: 't.test.js', status: 'M', removedAssertions: 2 }] }), reviewed: ['a.js', 'b.js'] });
  assert.strictEqual(weak.blockers, 1);
  const del = evaluateMerge({ result: clean, scope: scope({ testEdits: [{ path: 't.test.js', status: 'D', removedAssertions: 0 }] }), reviewed: ['a.js', 'b.js'] });
  assert.strictEqual(del.blockers, 1);
  const edited = evaluateMerge({ result: clean, scope: scope({ testEdits: [{ path: 't.test.js', status: 'M', removedAssertions: 0 }] }), reviewed: ['a.js', 'b.js'] });
  assert.strictEqual(edited.items.length, 0);
});

test('scope, unreviewed and summary mismatches warn but allow the merge', () => {
  const g = evaluateMerge({ result: clean, scope: scope({ outOfScope: ['b.js'], report: { unexplained: ['b.js'] } }), reviewed: ['a.js'] });
  assert.deepStrictEqual(g.items.map((i) => i.id).sort(), ['scope', 'summary', 'unreviewed']);
  assert.ok(g.ok);
  assert.strictEqual(g.warnings, 3);
});

test('gates that could not run are surfaced, never read as "clean"', () => {
  const g = evaluateMerge({ result: null, gateError: 'Project not trusted', scope: scope(), reviewed: ['a.js', 'b.js'] });
  assert.strictEqual(g.clean, false);
  assert.match(g.items[0].text, /could not be run: Project not trusted/);
});

test('policy can turn a rule off or make it blocking; .ide files are ignored', () => {
  const g = evaluateMerge({ result: clean, scope: scope({ files: [{ path: '.ide/config.json' }, { path: 'a.js' }] }), reviewed: [], policy: { unreviewed: 'block' } });
  assert.strictEqual(g.blockers, 1);
  assert.match(g.items[0].text, /1 of 1 changed file/);
  const off = evaluateMerge({ result: { findings: [{ severity: 'error', file: 'a' }] }, scope: scope(), reviewed: ['a.js', 'b.js'], policy: { errors: 'off' } });
  assert.strictEqual(off.items.length, 0);
});
