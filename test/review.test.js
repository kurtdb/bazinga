'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildReviewPrompt, runReview } = require('../src/core/review');
const { repo, write } = require('./helpers');

const node = (code) => `"${process.execPath}" -e "${code}"`;

test('prompt = instructions + non-legacy findings + diff + new files', async () => {
  const root = repo({ 'a.js': 'let a = 1;\n' });
  write(root, 'a.js', 'let a = 2;\n');
  write(root, 'new.js', 'export const added = true;\n');
  const prompt = await buildReviewPrompt(root, { findings: [
    { file: 'a.js', line: 1, tool: 'ESLint', rule: 'no-var', message: 'real finding' },
    { file: 'old.js', line: 9, tool: 'ESLint', message: 'legacy one', legacy: true },
    { tool: 'Gate', message: 'project level' },
  ] });
  assert.match(prompt, /strict but fair senior reviewer/);
  assert.match(prompt, /a\.js:1 \[ESLint no-var\] real finding/);
  assert.doesNotMatch(prompt, /legacy one/);
  assert.match(prompt, /\(project\) \[Gate\] project level/);
  assert.match(prompt, /-let a = 1;\n\+let a = 2;/);
  assert.match(prompt, /## New file: new\.js\nexport const added = true;/);
});

test('symbolSummary, when given, gets its own section ahead of the raw diff', async () => {
  const root = repo({ 'a.js': 'let a = 1;\n' });
  const prompt = await buildReviewPrompt(root, { symbolSummary: 'renamed function foo → bar (a.js)' });
  assert.match(prompt, /## Symbol changes.*\n+renamed function foo → bar \(a\.js\)/);
  assert.ok(prompt.indexOf('## Symbol changes') < prompt.indexOf('## Diff against HEAD'));
});

test('no symbolSummary: no Symbol changes section at all', async () => {
  const root = repo({ 'a.js': 'let a = 1;\n' });
  assert.doesNotMatch(await buildReviewPrompt(root), /## Symbol changes/);
});

test('no changes: says so; repo without commits does not throw', async () => {
  const root = repo({ 'a.txt': 'x\n' });
  assert.match(await buildReviewPrompt(root), /\(no tracked changes\)/);
  const empty = repo({}, { commit: false });
  write(empty, 'f.txt', 'hello\n');
  assert.match(await buildReviewPrompt(empty), /## New file: f\.txt/);
});

test('binary and oversized new files are skipped; long diffs are truncated to the budget', async () => {
  const root = repo({ 'a.txt': 'x\n' });
  fs.writeFileSync(path.join(root, 'blob.bin'), Buffer.from([1, 2, 0, 3, 4]));
  fs.writeFileSync(path.join(root, 'huge.txt'), 'y'.repeat(250000));
  write(root, 'a.txt', Array.from({ length: 4000 }, (_, i) => `line ${i}`).join('\n'));
  const prompt = await buildReviewPrompt(root, { maxChars: 6000 });
  assert.doesNotMatch(prompt, /blob\.bin/); assert.doesNotMatch(prompt, /huge\.txt/);
  assert.match(prompt, /\[diff truncated\]/);
  assert.ok(prompt.length < 7000, `prompt length ${prompt.length}`);
});

test('too many new files for the budget: the rest are reported as omitted', async () => {
  const root = repo({ 'a.txt': 'x\n' });
  for (let i = 0; i < 30; i++) write(root, `n${i}.txt`, 'z'.repeat(400));
  const prompt = await buildReviewPrompt(root, { maxChars: 3000 });
  assert.match(prompt, /\[further new files omitted\]/);
});

test('a long new file is cut to 300 lines', async () => {
  const root = repo({ 'a.txt': 'x\n' });
  write(root, 'long.txt', Array.from({ length: 500 }, (_, i) => `row${i}`).join('\n'));
  const prompt = await buildReviewPrompt(root);
  assert.match(prompt, /row299/); assert.doesNotMatch(prompt, /row300/);
});

test('runReview: no command configured', async () => {
  assert.match((await runReview(repo(), {})).error, /No review command/);
});

test('runReview pipes the prompt to the command and returns its output', async () => {
  const root = repo({ 'a.txt': 'x\n' });
  write(root, 'a.txt', 'changed\n');
  const res = await runReview(root, { command: node("process.stdin.pipe(process.stdout)") });
  assert.match(res.output, /strict but fair senior reviewer/);
  assert.match(res.output, /\+changed/);
  assert.ok(res.promptChars > 100);
});

test('runReview: empty output, failing command, timeout and cancellation', async () => {
  const root = repo();
  assert.match((await runReview(root, { command: node('0') })).output, /produced no output/);
  const failed = await runReview(root, { command: node("console.error('bad key'); process.exit(4)") });
  assert.match(failed.error, /failed \(exit 4\)/); assert.match(failed.error, /bad key/);
  // a failure that still printed something is reported as output (some CLIs exit non-zero after answering)
  assert.equal((await runReview(root, { command: node("console.log('partial'); process.exit(1)") })).output, 'partial');
  assert.match((await runReview(root, { command: node('setTimeout(()=>{},30000)'), timeoutMs: 400 })).error, /timed out/);
  const ac = new AbortController();
  const p = runReview(root, { command: node('setTimeout(()=>{},30000)'), signal: ac.signal });
  setTimeout(() => ac.abort(), 300);
  assert.deepEqual(await p, { cancelled: true });
});

test('loadReviewRules: IDE rules first, project REVIEW.md after, both end up in the prompt', async () => {
  const { loadReviewRules, buildReviewPrompt } = require('../src/core/review');
  const dir = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'rv-'));
  require('node:fs').writeFileSync(require('node:path').join(dir, 'REVIEW.md'), '# Rules\nNo System.out in services.\n');
  const rules = loadReviewRules(dir, 'Every endpoint needs authz.');
  assert.deepStrictEqual(rules.map((r) => r.source), ['IDE settings', 'REVIEW.md']);
  const prompt = await buildReviewPrompt(dir, { reviewRules: 'Every endpoint needs authz.' });
  assert.ok(prompt.indexOf('Every endpoint needs authz.') < prompt.indexOf('No System.out in services.'));
  assert.deepStrictEqual(loadReviewRules(dir, ''), [rules[1]]);
  assert.deepStrictEqual(loadReviewRules(require('node:os').tmpdir() + '/__nope__', ''), []);
});
