'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { runChecks } = require('../src/core/checks');
const { findDuplicateComponents, parseComponents } = require('../src/core/dupes');
const { reportParsers } = require('../src/core/parsers');
const { which } = require('../src/core/util');

const sh = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' });
const write = (root, rel, t) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), t); };
function repo(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bazinga-d-'));
  sh(root, 'init', '-q'); sh(root, 'config', 'user.email', 't@t'); sh(root, 'config', 'user.name', 't');
  for (const [k, v] of Object.entries(files)) write(root, k, v);
  sh(root, 'add', '.'); sh(root, 'commit', '-q', '-m', 'init');
  return root;
}

const BUTTON = `import React from 'react';\nexport function Button({ children, ...p }) {\n  return <button className="btn" {...p}>{children}</button>;\n}\n`;
const files = (root) => require('../src/core/util').listAllFiles(root);

test('parseComponents finds function, arrow, memo and class components; ignores constants and non-JSX files', () => {
  const src = `export function Foo() { return <div/>; }\nexport const Bar = () => <span/>;\nconst Baz = React.memo(() => <i/>);\nclass Qux extends React.Component { render() { return <b/>; } }\nconst MAX_SIZE = () => 3;\nexport default function Page() { return <p/>; }`;
  assert.deepEqual(parseComponents('a.jsx', src).map((c) => c.name).sort(), ['Bar', 'Baz', 'Foo', 'Qux']);
  assert.deepEqual(parseComponents('a.ts', 'export function Helper() { return 1; }'), []);
});

test('a new SubmitButton that does not use the shared Button is flagged; one that wraps it is not', () => {
  const root = repo({
    'src/ui/Button.jsx': BUTTON,
    'src/forms/OkButton.jsx': `import { Button } from '../ui/Button';\nexport function OkButton() { return <Button>OK</Button>; }\n`,
  });
  write(root, 'src/forms/SubmitButton.jsx', `export function SubmitButton({ label }) {\n  return <button className="x">{label}</button>;\n}\n`);
  const out = findDuplicateComponents({ root, allFiles: files(root), changed: ['src/forms/SubmitButton.jsx', 'src/forms/OkButton.jsx'] });
  const submit = out.filter((f) => f.file === 'src/forms/SubmitButton.jsx');
  assert.ok(submit.some((f) => f.rule === 'reimplements' && f.severity === 'error'));
  assert.ok(submit.some((f) => f.rule === 'raw-element'));
  assert.ok(!out.some((f) => f.file === 'src/forms/OkButton.jsx'));
});

test('same component name in two files is flagged on the changed file only; pages are exempt', () => {
  const root = repo({
    'src/a/Card.jsx': 'export function Card() { return <div>a</div>; }\n',
    'app/x/page.jsx': 'export default function Page() { return <div/>; }\n',
    'app/y/page.jsx': 'export default function Page() { return <div/>; }\n',
  });
  write(root, 'src/b/Card.jsx', 'export function Card() { return <div>b</div>; }\n');
  const out = findDuplicateComponents({ root, allFiles: files(root), changed: ['src/b/Card.jsx', 'app/y/page.jsx'] });
  assert.deepEqual(out.map((f) => [f.file, f.rule]), [['src/b/Card.jsx', 'duplicate-name']]);
});

test('several variants and no shared base: warning', () => {
  const root = repo({
    'a/PrimaryButton.jsx': 'export const PrimaryButton = () => <button>a</button>;\n',
    'b/SaveButton.jsx': 'export const SaveButton = () => <button>b</button>;\n',
  });
  const out = findDuplicateComponents({ root, allFiles: files(root), changed: ['a/PrimaryButton.jsx', 'b/SaveButton.jsx'] });
  assert.equal(out.length, 2);
  assert.ok(out.every((f) => f.rule === 'many-variants' && f.severity === 'warning'));
});

test('quality gate: "Duplicate components" produces errors via runChecks, unchanged files stay quiet', async () => {
  const root = repo({ 'src/ui/Button.jsx': BUTTON, 'src/old/Legacy.jsx': 'export function Legacy() { return <button>x</button>; }\n' });
  write(root, 'src/new/SaveButton.jsx', `export function SaveButton() { return <button>save</button>; }\n`);
  const res = await runChecks(root, { tier: 'fast', only: ['Duplicate components'] });
  const files = new Set(res.findings.map((f) => f.file));
  assert.ok(files.has('src/new/SaveButton.jsx'));
  assert.ok(!files.has('src/old/Legacy.jsx'));
  assert.ok(res.counts.error >= 1);
});

test('jscpd parser reports both sides of a clone', () => {
  const report = JSON.stringify({ duplicates: [{ lines: 12, firstFile: { name: 'a.js', start: 3, end: 14 }, secondFile: { name: 'b.js', start: 20, end: 31 } }] });
  const out = reportParsers.jscpd(report);
  assert.deepEqual(out.map((f) => [f.file, f.line, f.endLine]), [['a.js', 3, 14], ['b.js', 20, 31]]);
  assert.match(out[0].message, /b\.js:20-31/);
});

test('jscpd gate end to end (only when jscpd is installed)', { skip: !which('jscpd') && 'jscpd not installed' }, async () => {
  const code = (n) => Array.from({ length: 30 }, (_, i) => `  const value${i} = compute(${i}, input) + offset${i} * ${i + 1};`).join('\n').replace('compute', n);
  const root = repo({ 'src/a.js': `function one(input) {\n${code('compute')}\n  return value0;\n}\n` });
  write(root, 'src/b.js', `function two(input) {\n${code('compute')}\n  return value1;\n}\n`);
  const res = await runChecks(root, { tier: 'slow', only: ['Duplicate code'] });
  assert.ok(res.findings.some((f) => f.file === 'src/b.js' && f.rule === 'duplicate-code' && !f.legacy), JSON.stringify(res.runs));
  assert.ok(!res.findings.some((f) => f.file === 'src/a.js'), 'unchanged side is not reported');
});

test('a checks.yaml entry with an existing name only overrides the fields it gives', () => {
  const { loadChecksConfig } = require('../src/core/config');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bazinga-c-'));
  write(root, '.ide/checks.yaml', 'checks:\n  - name: Duplicate components\n    severity: warning\n');
  const c = loadChecksConfig(root).checks.find((x) => x.name === 'Duplicate components');
  assert.equal(c.severity, 'warning');
  assert.equal(c.native, 'duplicate-components');
});
