'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { problems } = require('../src/core/configschema');
const { configProblems, DEFAULT_CONFIG } = require('../src/core/config');

test('the defaults and an empty config have no problems', () => {
  assert.deepStrictEqual(problems(DEFAULT_CONFIG), []);
  assert.deepStrictEqual(problems({}), []);
  assert.deepStrictEqual(problems(null), []);
});

test('wrong types and values are named in plain words, with the place', () => {
  const p = problems({ theme: 'blue', fixLoop: { maxRounds: 'three' }, agents: [{ name: 'A' }], editorFontSize: 2, fleet: { prices: { sonnet: [3] } }, mergeGuard: { summary: 'maybe' } });
  assert.ok(p.some((t) => /theme must be one of: system, light, dark/.test(t)), p.join('|'));
  assert.ok(p.some((t) => /fixLoop\.maxRounds must be a whole number/.test(t)));
  assert.ok(p.some((t) => /agents\[0\] is missing “command”/.test(t)));
  assert.ok(p.some((t) => /editorFontSize must be at least 8/.test(t)));
  assert.ok(p.some((t) => /fleet\.prices\.sonnet must have exactly 2 numbers/.test(t)));
  assert.ok(p.some((t) => /mergeGuard\.summary must be one of: block, warn, off/.test(t)));
});

test('a typo of a real key gets a suggestion; unknown keys that look like nothing are allowed', () => {
  const p = problems({ agentHook: false, fixloop: {}, myOwnTool: { a: 1 }, taskTemplates: [] });
  assert.deepStrictEqual(p.sort(), ['“agentHook” is not a setting; did you mean “agentHooks”?', '“fixloop” is not a setting; did you mean “fixLoop”?'].sort());
});

test('nullable settings accept null and reject other kinds with one clear sentence', () => {
  assert.deepStrictEqual(problems({ shell: null, oversight: null, protectedPaths: null }), []);
  assert.deepStrictEqual(problems({ shell: 5 }), ['shell has the wrong kind of value']);
  assert.deepStrictEqual(problems([]), ['the file must contain a JSON object ({ … })']);
});

test('configProblems reads the project file: missing = fine, broken JSON is reported, never throws', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-'));
  assert.deepStrictEqual(configProblems(root), []);
  fs.mkdirSync(path.join(root, '.ide'));
  fs.writeFileSync(path.join(root, '.ide', 'config.json'), '{ "theme": "x" ');
  assert.match(configProblems(root)[0], /not valid JSON/);
  fs.writeFileSync(path.join(root, '.ide', 'config.json'), '{ "theme": "x" }');
  assert.match(configProblems(root)[0], /theme must be one of/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('memory.enabled accepts a boolean and rejects anything else', () => {
  assert.deepStrictEqual(problems({ memory: { enabled: true } }), []);
  assert.deepStrictEqual(problems({ memory: { enabled: 'yes' } }), ['memory.enabled must be a boolean']);
});

test('agents may say api: "openai" and a context size; other values are reported', () => {
  const { problems } = require('../src/core/configschema');
  assert.deepEqual(problems({ agents: [{ name: 'LM', command: 'claude', api: 'openai', context: 65536 }] }), []);
  assert.ok(problems({ agents: [{ name: 'LM', command: 'claude', api: 'grpc' }] }).length > 0);
});
