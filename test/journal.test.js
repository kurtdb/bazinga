'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const journal = require('../src/core/journal');
const { scrubEnv, isSecretName } = require('../src/core/envscrub');
const budget = require('../src/core/budget');

test('journal: append, read back, format, survive torn lines', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lj-'));
  assert.ok(journal.append(dir, 'run-1', { kind: 'created', text: 'task: fix it' }));
  assert.ok(journal.append(dir, 'run-1', { kind: 'idle', data: { busyMs: 5 } }));
  fs.appendFileSync(journal.fileFor(dir, 'run-1'), '{"torn');
  const ev = journal.read(dir, 'run-1');
  assert.strictEqual(ev.length, 2);
  assert.match(journal.format(ev), /created {2}task: fix it/);
  assert.deepStrictEqual(journal.read(dir, 'nope'), []);
});

test('journal: run ids cannot escape the directory; text is cleaned and capped', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lj-'));
  journal.append(dir, '../../evil', { kind: 'x', text: 'a\u0007b'.repeat(400) });
  assert.ok(fs.readdirSync(dir).every((f) => !f.includes('/')) && fs.readdirSync(dir).length === 1);
  const [e] = journal.read(dir, '../../evil');
  assert.ok(e.text.length <= 300 && !e.text.includes('\u0007'));
  assert.strictEqual(journal.append(dir, '', { kind: 'x' }), false);
});

test('scrubEnv: removes credentials, keeps PATH/HOME and allow-listed names', () => {
  const base = { PATH: '/bin', HOME: '/h', GITHUB_TOKEN: 'x', NPM_TOKEN: 'y', AWS_SECRET_ACCESS_KEY: 'z', MY_API_KEY: 'k', DB_PASSWORD: 'p', JAVA_HOME: '/j', EDITOR: 'vi', ANTHROPIC_BASE_URL: 'http://l' };
  const { env, removed } = scrubEnv(base, { allow: ['npm_token'] });
  assert.deepStrictEqual(Object.keys(env).sort(), ['ANTHROPIC_BASE_URL', 'EDITOR', 'HOME', 'JAVA_HOME', 'NPM_TOKEN', 'PATH']);
  assert.deepStrictEqual(removed, ['AWS_SECRET_ACCESS_KEY', 'DB_PASSWORD', 'GITHUB_TOKEN', 'MY_API_KEY']);
  assert.strictEqual(scrubEnv(base, { enabled: false }).removed.length, 0);
  assert.ok(!isSecretName('TERMINAL_EMULATOR') && !isSecretName('AUTHOR_NAME') && isSecretName('AUTH_TOKEN'));
});

test('budget: disabled, nearing, exceeded', () => {
  assert.strictEqual(budget.check({ activeMs: 9e9 }, 0).enabled, false);
  assert.strictEqual(budget.check({ activeMs: 9 * 60000 }, 10).nearing, true);
  const b = budget.check({ activeMs: 10 * 60000 }, 10);
  assert.ok(b.exceeded && !b.nearing && b.usedMin === 10);
  assert.ok(!budget.check({ activeMs: 60000 }, 10).nearing);
});
