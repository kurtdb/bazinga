'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const O = require('../src/core/oversight');
const { loadConfig, DEFAULT_CONFIG } = require('../src/core/config');
const { DEFAULT_POLICY } = require('../src/core/guard');
const { shouldNotify } = require('../src/core/notify');
const { tmpdir, write } = require('./helpers');

const project = (cfg) => { const root = tmpdir(); if (cfg) write(root, '.ide/config.json', JSON.stringify(cfg)); return root; };

test('four levels, each with a label, a summary and only known guard rules', () => {
  assert.deepEqual(O.ids(), ['autonomous', 'supervised', 'guided', 'stepwise']);
  for (const id of O.ids()) {
    const l = O.LEVELS[id];
    assert.ok(l.label && l.summary);
    for (const k of Object.keys(l.config.mergeGuard)) assert.ok(k in DEFAULT_POLICY, `${id}: unknown guard rule ${k}`);
    for (const v of Object.values(l.config.mergeGuard)) assert.ok(['block', 'warn', 'off'].includes(v));
  }
});

test('the levels get stricter: autonomous loops alone, guided and step-by-step wait for you', () => {
  assert.equal(O.presetFor('autonomous').fixLoop.enabled, true);
  assert.equal(O.presetFor('guided').fixLoop.enabled, false);
  assert.match(O.presetFor('guided').taskPrefix, /plan/);
  assert.match(O.presetFor('stepwise').taskPrefix, /step/);
  assert.equal(O.presetFor('autonomous').taskPrefix, '');
  const rank = { off: 0, warn: 1, block: 2 };
  const score = (id) => Object.values(O.presetFor(id).mergeGuard).reduce((a, v) => a + rank[v], 0);
  assert.ok(score('autonomous') < score('supervised') && score('supervised') < score('guided') && score('guided') < score('stepwise'));
  assert.deepEqual(O.presetFor('nonsense'), {});
  assert.deepEqual(O.presetFor(undefined), {});
});

test('no level anywhere: the config is exactly what it was before levels existed', () => {
  const cfg = loadConfig(project(null), {});
  assert.equal(cfg.fixLoop.enabled, false);
  assert.deepEqual(cfg.mergeGuard, {});
  assert.equal(cfg.oversight, null);
  assert.deepEqual(cfg.oversightEffective, { level: null, source: null });
});

test('IDE level applies to every project; an explicit IDE setting beats the IDE level', () => {
  const root = project(null);
  const cfg = loadConfig(root, { oversight: 'guided' });
  assert.equal(cfg.fixLoop.enabled, false);
  assert.equal(cfg.mergeGuard.unreviewed, 'block');
  assert.deepEqual(cfg.oversightEffective, { level: 'guided', source: 'ide' });
  const cfg2 = loadConfig(root, { oversight: 'guided', mergeGuard: { unreviewed: 'warn' }, fixLoop: { enabled: true } });
  assert.equal(cfg2.mergeGuard.unreviewed, 'warn', 'explicit setting wins over its own level');
  assert.equal(cfg2.mergeGuard.scope, 'block', 'the rest of the level still applies');
  assert.equal(cfg2.fixLoop.enabled, true);
});

test('the project level takes precedence over the IDE level and over IDE explicit settings', () => {
  const root = project({ oversight: 'stepwise' });
  const cfg = loadConfig(root, { oversight: 'autonomous', fixLoop: { enabled: true, maxRounds: 9 }, mergeGuard: { summary: 'off' } });
  assert.equal(cfg.fixLoop.enabled, false, 'project level beats IDE explicit');
  assert.equal(cfg.mergeGuard.summary, 'block');
  assert.match(cfg.taskPrefix, /small steps/);
  assert.deepEqual(cfg.oversightEffective, { level: 'stepwise', source: 'project' });
  assert.equal(cfg.fixLoop.maxRounds, 9, 'fields the project level does not set keep the IDE value (deep merge)');
});

test('explicit project config beats the project level; unknown levels are ignored', () => {
  const cfg = loadConfig(project({ oversight: 'guided', fixLoop: { enabled: true, maxRounds: 2 }, mergeGuard: { scope: 'warn' } }), {});
  assert.equal(cfg.fixLoop.enabled, true); assert.equal(cfg.fixLoop.maxRounds, 2);
  assert.equal(cfg.mergeGuard.scope, 'warn'); assert.equal(cfg.mergeGuard.errors, 'block');
  const bad = loadConfig(project({ oversight: 'yolo' }), { oversight: 'also-bad' });
  assert.deepEqual(bad.oversightEffective, { level: null, source: null });
  assert.equal(bad.fixLoop.enabled, false);
});

test('a project without a level keeps the IDE level; describe() says where the level comes from and what it overrides', () => {
  assert.deepEqual(O.effectiveLevel({ oversight: 'guided' }, {}), { level: 'guided', source: 'ide' });
  assert.deepEqual(O.effectiveLevel({ oversight: 'guided' }, { oversight: 'autonomous' }), { level: 'autonomous', source: 'project' });
  const d = O.describe({ oversight: 'guided' }, { oversight: 'autonomous' });
  assert.equal(d.label, 'Autonomous'); assert.equal(d.source, 'project'); assert.equal(d.overridesIde, 'guided');
  assert.equal(O.describe({}, {}).label, 'Custom');
});

test('other config keys keep replacing as a whole (lsp, agents), only fixLoop and mergeGuard merge field by field', () => {
  const cfg = loadConfig(project({ lsp: { enabled: true } }), { lsp: { enabled: false, servers: { x: {} } } });
  assert.deepEqual(cfg.lsp, { enabled: true });
  assert.ok(Array.isArray(cfg.agents) && cfg.agents.length >= 2);
});

test('autonomous defaults auto-merge on; the user\'s own minWinRate/dryRun/kinds still apply (deep merge)', () => {
  assert.equal(O.presetFor('autonomous').autoMerge.enabled, true);
  assert.equal(O.presetFor('supervised').autoMerge, undefined, 'only autonomous opts auto-merge in');
  const cfg = loadConfig(project(null), { oversight: 'autonomous', autoMerge: { minWinRate: 0.95, dryRun: true } });
  assert.equal(cfg.autoMerge.enabled, true);
  assert.equal(cfg.autoMerge.minWinRate, 0.95);
  assert.equal(cfg.autoMerge.dryRun, true);
});

test('an explicit autoMerge.enabled: false beats the autonomous level\'s default', () => {
  const cfg = loadConfig(project(null), { oversight: 'autonomous', autoMerge: { enabled: false } });
  assert.equal(cfg.autoMerge.enabled, false);
});

test('notification kinds follow the level', () => {
  const base = { enabled: true, focused: false };
  assert.equal(shouldNotify({ ...base, kind: 'agent-idle', kinds: O.presetFor('autonomous').notifyKinds }), false);
  assert.equal(shouldNotify({ ...base, kind: 'agent-prompt', kinds: O.presetFor('autonomous').notifyKinds }), true);
  assert.equal(shouldNotify({ ...base, kind: 'agent-idle', kinds: O.presetFor('guided').notifyKinds }), true);
  assert.equal(shouldNotify({ ...base, kind: 'agent-idle', kinds: null }), true);
});
