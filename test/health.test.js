'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluate } = require('../src/core/health');

const base = () => ({ tools: { claude: { ok: true, version: '2.1.0' } }, localAgents: [], ollama: { running: false, installed: [] }, docker: { docker: false, image: false, enabled: false }, hooksOn: true, jev: {}, drift: {}, captureOn: false });
const get = (r, id) => r.rows.find((x) => x.id === id);

test('a plain machine with Claude Code: everything used works, nothing is shouted about', () => {
  const r = evaluate(base());
  assert.equal(r.bad, 0); assert.match(r.summary, /works/);
  assert.equal(get(r, 'claude').state, 'ok');
  assert.equal(get(r, 'docker').state, 'off', 'unused is off, not a problem');
});

test('missing Claude Code is a problem with something to copy', () => {
  const f = base(); f.tools.claude = { ok: false };
  const row = get(evaluate(f), 'claude');
  assert.equal(row.state, 'bad'); assert.match(row.action.copy, /claude-code/);
});

test('Ollama: not running / model missing / fine - each says what to do', () => {
  const f = base(); f.localAgents = [{ agent: 'Qwen', model: 'qwen3:14b', openai: false }];
  let row = get(evaluate(f), 'ollama'); assert.equal(row.state, 'bad'); assert.match(row.text, /Qwen/); assert.equal(row.action.copy, 'ollama serve');
  f.ollama = { running: true, installed: [{ name: 'llama3:8b' }] };
  row = get(evaluate(f), 'ollama'); assert.match(row.text, /qwen3:14b/); assert.equal(row.action.copy, 'ollama pull qwen3:14b');
  f.ollama = { running: true, installed: [{ name: 'qwen3:14b' }] };
  assert.equal(get(evaluate(f), 'ollama').state, 'ok');
  f.localAgents[0].model = 'qwen3'; f.ollama = { running: true, installed: [{ name: 'qwen3:latest' }] };
  assert.equal(get(evaluate(f), 'ollama').state, 'ok', 'a :latest tag counts as the model');
});

test('an OpenAI-style server that does not answer is reported by agent name', () => {
  const f = base(); f.localAgents = [{ agent: 'LM', openai: true, baseUrl: 'http://localhost:1234', reachable: false }];
  const row = get(evaluate(f), 'server-LM'); assert.equal(row.state, 'bad'); assert.match(row.text, /localhost:1234/);
  f.localAgents[0].reachable = true; assert.equal(get(evaluate(f), 'server-LM').state, 'ok');
});

test('Docker walks: none -> build -> use -> on', () => {
  const f = base();
  assert.equal(get(evaluate(f), 'docker').action, null);
  f.docker = { docker: true, image: false, enabled: false }; assert.equal(get(evaluate(f), 'docker').action.id, 'build-image');
  f.docker = { docker: true, image: true, enabled: false }; assert.equal(get(evaluate(f), 'docker').action.id, 'container-on');
  f.docker = { docker: true, image: true, enabled: true }; const r = get(evaluate(f), 'docker'); assert.deepEqual([r.state, r.action.id], ['ok', 'container-off']);
});

test('Jev: off, on without key (warn), on with key', () => {
  const f = base();
  assert.equal(get(evaluate(f), 'jev').state, 'off');
  f.jev = { enabled: true, hasKey: false }; assert.equal(get(evaluate(f), 'jev').state, 'warn');
  f.jev = { enabled: true, hasKey: true }; assert.equal(get(evaluate(f), 'jev').state, 'ok');
  assert.ok(!/api\.typesafe/.test(JSON.stringify(evaluate(f))), 'no addresses or keys in the wording');
});

test('capture on is a warning (it should not stay on), the version row asks for a confirmation when newer', () => {
  const f = base(); f.captureOn = true; f.drift = { version: '2.2.0', tested: '2.1.0', newer: true };
  const r = evaluate(f);
  assert.equal(get(r, 'capture').state, 'warn'); assert.equal(get(r, 'version').state, 'warn'); assert.equal(get(r, 'version').action.id, 'confirm-version');
  assert.equal(r.bad, 0); assert.match(r.summary, /worth a look/);
});

test('git hook row: installable, installed, impossible (packaged app); settings problems are listed', () => {
  const f = base();
  assert.equal(get(evaluate(f), 'githook'), undefined, 'no project open: no row');
  f.gitHook = { installed: false, possible: true }; assert.equal(get(evaluate(f), 'githook').action.id, 'hook-install');
  f.gitHook = { installed: true, possible: true }; assert.equal(get(evaluate(f), 'githook').action.id, 'hook-remove');
  f.gitHook = { installed: false, possible: false }; assert.equal(get(evaluate(f), 'githook').action, null);
  f.configProblems = ['fleet.staleMinuts is not known']; assert.equal(get(evaluate(f), 'config').state, 'warn');
});

test('every row has plain text, an id and a valid state; no jargon words leak into the wording', () => {
  const f = base(); f.localAgents = [{ agent: 'A', model: 'm', openai: false }]; f.docker = { docker: true, image: true, enabled: false }; f.gitHook = { installed: false, possible: true }; f.captureOn = true; f.jev = { enabled: true, hasKey: false }; f.drift = { version: '2.2.0', tested: '2.1.0', newer: true };
  for (const r of evaluate(f).rows) {
    assert.ok(r.id && r.label && r.text.length > 10, r.id);
    assert.ok(['ok', 'off', 'warn', 'bad'].includes(r.state), r.id);
    assert.ok(!/payload|schema|fixture|telemetry|JSON|env var/i.test(r.text), `${r.id}: ${r.text}`);
  }
});

test('Copilot usage row is optional: quiet and in "advanced" without a licence, a usage button once switched on', () => {
  const base = { tools: { claude: { ok: true } }, localAgents: [] };
  const off = evaluate({ ...base }).rows.find((r) => r.id === 'copilot');
  assert.strictEqual(off.state, 'off');
  assert.strictEqual(off.group, 'advanced');
  assert.strictEqual(off.action.id, 'copilot-on');
  assert.strictEqual(evaluate({ ...base }).bad, 0);
  const on = evaluate({ ...base, copilot: { enabled: true } }).rows.find((r) => r.id === 'copilot');
  assert.strictEqual(on.state, 'ok');
  assert.strictEqual(on.group, 'main');
  assert.strictEqual(on.action.id, 'copilot-usage');
});
test('copilot settings: off unless exactly true; the URL the app opens is the one in core', () => {
  const c = require('../src/core/copilot');
  assert.strictEqual(c.settings(undefined).enabled, false);
  assert.strictEqual(c.settings({ enabled: 'yes' }).enabled, false);
  assert.strictEqual(c.settings({ enabled: true }).enabled, true);
  assert.strictEqual(require('../src/core/config').DEFAULT_CONFIG.copilot.enabled, false);
  const app = require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/renderer/app.js'), 'utf8');
  assert.ok(app.includes(`'${c.USAGE_URL}'`));
});
