'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const go = require('../src/core/guardoverrides');

function tmpFile() { return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bz-go-')), 'guardoverrides.json'); }
function tmpRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'bz-go-root-')); }

test('relax: one step down, never tightens', () => {
  assert.equal(go.relax('block'), 'warn');
  assert.equal(go.relax('warn'), 'off');
  assert.equal(go.relax('off'), 'off');
});

test('load: a missing or broken file reads as empty', () => {
  assert.deepEqual(go.load(path.join(os.tmpdir(), 'does-not-exist-bz.json')), { counts: {}, dismissed: [] });
  const file = tmpFile();
  fs.writeFileSync(file, 'not json');
  assert.deepEqual(go.load(file), { counts: {}, dismissed: [] });
});

test('recordOverride: counts accumulate per rule id, across calls', () => {
  const file = tmpFile();
  go.recordOverride(file, ['scope', 'summary']);
  go.recordOverride(file, ['scope']);
  const store = go.load(file);
  assert.equal(store.counts.scope, 2);
  assert.equal(store.counts.summary, 1);
});

test('recordOverride: tolerates an empty or missing list', () => {
  const file = tmpFile();
  go.recordOverride(file, []);
  go.recordOverride(file, undefined);
  assert.deepEqual(go.load(file), { counts: {}, dismissed: [] });
});

test('suggestions: only rules overridden at least THRESHOLD times, still "block" in the policy, and not dismissed', () => {
  const policy = { scope: 'block', summary: 'block', unreviewed: 'warn' };
  const store = { counts: { scope: go.THRESHOLD, summary: go.THRESHOLD - 1, unreviewed: go.THRESHOLD + 5 }, dismissed: [] };
  const got = go.suggestions(store, policy);
  assert.deepEqual(got.map((s) => s.id), ['scope']); // summary: under threshold; unreviewed: already 'warn', nothing to relax
  assert.equal(got[0].count, go.THRESHOLD);
  assert.equal(got[0].next, 'warn');
});

test('suggestions: a dismissed rule is never offered again, even past the threshold', () => {
  const policy = { scope: 'block' };
  const store = { counts: { scope: go.THRESHOLD + 10 }, dismissed: ['scope'] };
  assert.deepEqual(go.suggestions(store, policy), []);
});

test('suggestions: most-overridden first', () => {
  const policy = { scope: 'block', summary: 'block' };
  const store = { counts: { scope: go.THRESHOLD, summary: go.THRESHOLD * 3 }, dismissed: [] };
  const got = go.suggestions(store, policy);
  assert.deepEqual(got.map((s) => s.id), ['summary', 'scope']);
});

test('dismiss: persists and is idempotent', () => {
  const file = tmpFile();
  go.dismiss(file, 'scope');
  go.dismiss(file, 'scope');
  assert.deepEqual(go.load(file).dismissed, ['scope']);
});

test('resetCount: clears the count and un-dismisses, so it can resurface', () => {
  const file = tmpFile();
  go.recordOverride(file, ['scope', 'scope', 'scope']);
  go.dismiss(file, 'scope');
  go.resetCount(file, 'scope');
  const store = go.load(file);
  assert.equal(store.counts.scope, undefined);
  assert.deepEqual(store.dismissed, []);
});

test('resetCount: leaves other rules alone', () => {
  const file = tmpFile();
  go.recordOverride(file, ['scope', 'summary']);
  go.resetCount(file, 'scope');
  assert.equal(go.load(file).counts.summary, 1);
});

test('relaxProject: writes mergeGuard into .ide/config.json, leaving other keys untouched', () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, '.ide'));
  fs.writeFileSync(path.join(root, '.ide', 'config.json'), JSON.stringify({ agents: ['x'], mergeGuard: { tests: 'block' } }));
  go.relaxProject(root, 'scope', 'warn');
  const cfg = JSON.parse(fs.readFileSync(path.join(root, '.ide', 'config.json'), 'utf8'));
  assert.deepEqual(cfg.mergeGuard, { tests: 'block', scope: 'warn' });
  assert.deepEqual(cfg.agents, ['x']);
});

test('relaxProject: creates .ide/config.json when the project has none yet', () => {
  const root = tmpRoot();
  go.relaxProject(root, 'scope', 'off');
  const cfg = JSON.parse(fs.readFileSync(path.join(root, '.ide', 'config.json'), 'utf8'));
  assert.deepEqual(cfg.mergeGuard, { scope: 'off' });
});

test('relaxProject: throws on invalid JSON instead of clobbering it', () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, '.ide'));
  fs.writeFileSync(path.join(root, '.ide', 'config.json'), 'not json');
  assert.throws(() => go.relaxProject(root, 'scope', 'warn'), /not valid JSON/);
});
