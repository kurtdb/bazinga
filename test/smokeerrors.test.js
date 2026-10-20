'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { classify, apply } = require('../src/core/smokeerrors');

// the error seen in the flaky smoke runs, verbatim
const WORKER = "Uncaught NetworkError: Failed to execute 'importScripts' on 'WorkerGlobalScope': The script at 'file:///home/x/node_modules/monaco-editor/min/vs/assets/editor.worker-_vAIFJDs.js' failed to load.";

test('regression: Monaco\'s worker failing to load under load is a warning, other page errors stay fatal', () => {
  const c = classify([WORKER, 'Uncaught TypeError: x is not a function']);
  assert.deepStrictEqual(c.transient, [WORKER]);
  assert.deepStrictEqual(c.fatal, ['Uncaught TypeError: x is not a function']);
});
test('apply: only the worker error and all steps ok = ok; a failed step or another error = not ok', () => {
  const steps = { a: 'ok', b: 'ok' };
  const r = apply({ ok: false, errors: [WORKER], steps });
  assert.strictEqual(r.ok, true); assert.deepStrictEqual(r.warnings, [WORKER]); assert.deepStrictEqual(r.errors, []);
  assert.strictEqual(apply({ ok: false, errors: [WORKER], steps: { a: 'ok', b: 'expected 3' } }).ok, false);
  assert.strictEqual(apply({ ok: false, errors: [WORKER, 'boom'], steps }).ok, false);
  assert.strictEqual(apply({ ok: true, errors: [], steps }).ok, true);
  assert.strictEqual(apply({ ok: false, errors: [], steps }).ok, false, 'a report that was not ok for another reason stays not ok');
});
