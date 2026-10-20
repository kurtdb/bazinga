'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { mergeTemplates, BUILTIN } = require('../src/core/tasktemplates');
const T = require('../src/core/tasktemplates');

test('templates: built-ins first, IDE adds, project overrides by name', () => {
  const t = mergeTemplates({ ide: [{ name: 'Add a feature', text: 'IDE feature' }, { name: 'Mine', text: 'x' }], project: [{ name: 'add a FEATURE', text: 'Project feature', allow: 'src/**' }] });
  const feature = t.find((x) => x.name.toLowerCase() === 'add a feature');
  assert.strictEqual(feature.text, 'Project feature');
  assert.strictEqual(feature.source, 'project');
  assert.strictEqual(feature.allow, 'src/**');
  assert.ok(t.some((x) => x.name === 'Mine' && x.source === 'ide'));
  assert.strictEqual(t.length, BUILTIN.length + 1);
});

test('templates: junk entries are dropped, long text is clipped', () => {
  const t = mergeTemplates({ builtin: false, ide: [null, 'x', { name: '', text: 'a' }, { name: 'n', text: '   ' }, { name: 'ok', text: 'y'.repeat(9000) }], project: 'nope' });
  assert.strictEqual(t.length, 1);
  assert.strictEqual(t[0].text.length, 8000);
});

test('templates: markdown round trip with allow line', () => {
  const { parseMarkdown, toMarkdown } = require('../src/core/tasktemplates');
  const list = parseMarkdown('intro ignored\n## Billing fix\nallow: src/billing/**\nFix <what>\nsecond line\n\n## Other\nbody');
  assert.deepStrictEqual(list, [{ name: 'Billing fix', allow: 'src/billing/**', text: 'Fix <what>\nsecond line' }, { name: 'Other', allow: '', text: 'body' }]);
  assert.deepStrictEqual(parseMarkdown(toMarkdown(list)), list);
  assert.deepStrictEqual(parseMarkdown(''), []);
});

test('regression: "Write missing tests" only allows new test files, and says so in its text', () => {
  const t = T.mergeTemplates({}).find((x) => x.name === 'Write missing tests');
  assert.equal(t.allow, '@new-tests');
  assert.match(t.text, /new test files only/);
  assert.equal(T.parseMarkdown(T.toMarkdown([t]))[0].allow, '@new-tests', 'survives the settings round trip');
});
