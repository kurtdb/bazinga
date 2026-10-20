'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { prefixFor, applyTo, shellKindFor } = require('../src/core/envinline');

test('envinline: posix puts the variables after env, an empty value stays empty, odd values are quoted', () => {
  assert.equal(prefixFor({ ANTHROPIC_BASE_URL: 'http://localhost:11434', ANTHROPIC_AUTH_TOKEN: 'ollama', ANTHROPIC_API_KEY: '' }),
    "env ANTHROPIC_BASE_URL=http://localhost:11434 ANTHROPIC_AUTH_TOKEN=ollama ANTHROPIC_API_KEY='' ");
  assert.equal(prefixFor({ A: "it's a b" }), "env A='it'\\''s a b' ");
});

test('envinline: PowerShell and cmd', () => {
  assert.equal(prefixFor({ A: "it's", B: '' }, 'ps'), "$env:A='it''s'; $env:B=''; ");
  assert.equal(prefixFor({ A: 'x', B: '' }, 'cmd'), 'set "A=x" && set "B=" && ');
  assert.throws(() => prefixFor({ A: 'a&b' }, 'cmd'), /cmd\.exe/);
});

test('envinline: nothing to set, bad names and empty lines are left alone', () => {
  assert.equal(prefixFor({}), '');
  assert.equal(prefixFor({ 'bad name': 'x', 'a;b': 'y' }), '');
  assert.equal(applyTo('claude\r', {}, 'posix'), 'claude\r');
  assert.equal(applyTo('', { A: '1' }, 'posix'), '');
  assert.equal(applyTo('claude --model m\r', { A: '1' }, 'posix'), 'env A=1 claude --model m\r');
});

test('envinline: the shell kind follows the configured shell, then the platform', () => {
  assert.equal(shellKindFor('C:\\Program Files\\PowerShell\\7\\pwsh.exe', 'win32'), 'ps');
  assert.equal(shellKindFor('cmd.exe', 'win32'), 'cmd');
  assert.equal(shellKindFor('', 'win32'), 'ps');
  assert.equal(shellKindFor('/bin/zsh', 'darwin'), 'posix');
});
