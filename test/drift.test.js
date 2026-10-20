'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const d = require('../src/core/drift');

const file = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'drift-')), 'cc.json');

test('parseVersion and compareVersions', () => {
  assert.equal(d.parseVersion('2.1.3 (Claude Code)'), '2.1.3');
  assert.equal(d.parseVersion('v10.0.12-beta.1'), '10.0.12-beta.1');
  assert.equal(d.parseVersion('command not found'), '');
  assert.equal(d.compareVersions('2.10.0', '2.9.9'), 1, 'numbers, not text');
  assert.equal(d.compareVersions('2.1.3', '2.1.3-beta'), 0);
  assert.equal(d.compareVersions('1.9.9', '2.0.0'), -1);
});

test('a version newer than the confirmed one warns once; the confirmed one and older do not', () => {
  const told = [];
  const dr = new d.Drift({ file: file(), notify: (t) => told.push(t) });
  dr.noteVersion('2.1.0 (Claude Code)');
  assert.equal(told.length, 0, 'nothing is confirmed yet: nothing to compare with');
  dr.confirm();
  dr.noteVersion('2.1.0'); dr.noteVersion('2.0.9');
  assert.equal(told.length, 0);
  dr.noteVersion('2.2.0'); dr.noteVersion('2.2.0');
  assert.equal(told.length, 1); assert.match(told[0], /updated to 2\.2\.0.*confirmed 2\.1\.0/);
  assert.equal(dr.status().newer, true);
  dr.noteVersion('2.3.0');
  assert.equal(told.length, 2, 'a different new version is a new notice');
  dr.confirm('2.3.0'); assert.equal(dr.status().newer, false);
});

test('unknown hook fields: names are kept (never values), warned once, known fields are silent', () => {
  const told = []; const f = file();
  const dr = new d.Drift({ file: f, notify: (t) => told.push(t) });
  dr.noteVersion('2.1.0');
  assert.deepEqual(dr.noteHook('stop', { session_id: 'x', transcript_path: 'p', cwd: 'c', hook_event_name: 'Stop', last_assistant_message: 'hi' }), []);
  assert.deepEqual(dr.noteHook('stop', { session_id: 'x', brand_new_field: 'SECRET VALUE', 'bad key/with slash': 1 }), ['brand_new_field']);
  assert.deepEqual(dr.noteHook('stop', { brand_new_field: 'again' }), [], 'not reported twice');
  assert.equal(told.length, 1); assert.match(told[0], /does not use yet/); assert.ok(!/brand_new_field/.test(told[0]), 'the notice stays in plain words');
  assert.ok(!fs.readFileSync(f, 'utf8').includes('SECRET VALUE'));
  assert.deepEqual(dr.noteHook('stop', null), []); assert.deepEqual(dr.noteHook('stop', [1]), []);
  // survives a restart; confirming clears the list
  const again = new d.Drift({ file: f });
  assert.equal(again.status().unknown[0].field, 'brand_new_field'); assert.equal(again.status().version, '2.1.0');
  again.confirm(); assert.equal(again.status().unknown.length, 0);
});

test('a notify callback that throws never breaks the caller; a damaged file is ignored', () => {
  const f = file(); fs.writeFileSync(f, '{nope');
  const dr = new d.Drift({ file: f, notify: () => { throw new Error('boom'); } });
  dr.confirm('1.0.0');
  assert.doesNotThrow(() => dr.noteVersion('1.1.0'));
});

test('versionFromTelemetry reads service.version of a Claude Code resource only', () => {
  const body = (name, ver) => ({ resourceMetrics: [{ resource: { attributes: [{ key: 'service.name', value: { stringValue: name } }, { key: 'service.version', value: { stringValue: ver } }] } }] });
  assert.equal(d.versionFromTelemetry(body('claude-code', '2.4.1')), '2.4.1');
  assert.equal(d.versionFromTelemetry(body('something-else', '9.9.9')), '');
  assert.equal(d.versionFromTelemetry({}), '');
});

test('every field the hook handlers read is in the known list (so our own fields never raise a notice)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
  const used = new Set([...src.matchAll(/\bp\.(\w+)/g)].map((m) => m[1]));
  const reads = [...used].filter((k) => /_/.test(k));
  for (const k of reads) assert.ok(d.KNOWN_FIELDS.has(k), `${k} is read from hook reports but not listed as known`);
});
