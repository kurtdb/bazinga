'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { LspManager, DEFAULT_SERVERS, MONACO_LANGUAGE } = require('../src/core/lsp');

const FAKE = path.join(__dirname, 'fixtures', 'fake-lsp.js');
const waitFor = async (fn, ms = 4000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 30)); } return null; };

function project(servers, enabled = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bazinga-lsp-'));
  fs.writeFileSync(path.join(root, 'a.py'), 'def target():\n    return BAD\ntarget()\n');
  const mgr = new LspManager({ root, workspaceDir: path.join(root, '.ws'), getConfig: () => ({ enabled, servers }) });
  return { root, mgr };
}
const fakeServer = { python: { command: process.execPath, args: [FAKE], extensions: ['py'] } };

test('disabled by default: no servers, nothing started', async () => {
  const { mgr } = project({}, false);
  assert.strictEqual(mgr.status().enabled, false);
  assert.deepStrictEqual(mgr.status().servers, []);
  assert.deepStrictEqual(await mgr.open('a.py', 'x'), { ok: false, reason: 'no server' });
});

test('status lists the default servers when enabled, with the Monaco languages to register providers for', () => {
  const { mgr } = project({});
  const st = mgr.status();
  assert.deepStrictEqual(st.servers.map((s) => s.name).sort(), Object.keys(DEFAULT_SERVERS).sort());
  assert.ok(st.languages.includes('java') && st.languages.includes('python') && st.languages.includes('typescript') && st.languages.includes('javascript'));
  assert.ok(Object.values(MONACO_LANGUAGE).length > 5);
});

test('open → diagnostics, hover, definition (outside-project results dropped), references, completion, signature help', async () => {
  const { root, mgr } = project(fakeServer);
  const diags = [];
  mgr.on('diagnostics', (rel, list) => diags.push({ rel, list }));
  const res = await mgr.open('a.py', fs.readFileSync(path.join(root, 'a.py'), 'utf8'));
  assert.deepStrictEqual(res, { ok: true, server: 'python' });
  assert.ok(await waitFor(() => diags.length), 'diagnostics arrive');
  assert.strictEqual(diags[0].rel, 'a.py');
  assert.strictEqual(diags[0].list[0].message, 'fake: BAD found');
  const hover = await mgr.request('a.py', 'hover', { line: 0, character: 5 });
  assert.match(hover.contents.value, /fake\*\*: target/);
  const def = await mgr.request('a.py', 'definition', { line: 2, character: 1 });
  assert.deepStrictEqual(def.map((d) => d.rel), ['a.py']);       // the /outside/project location is dropped
  assert.strictEqual((await mgr.request('a.py', 'references', { line: 0, character: 5 })).length, 2);
  assert.strictEqual((await mgr.request('a.py', 'completion', { line: 0, character: 0 })).items[0].label, 'fakeCompletion');
  assert.strictEqual((await mgr.request('a.py', 'signatureHelp', { line: 0, character: 0 })).signatures[0].label, 'fake(a, b)');
  await mgr.dispose();
});

test('changes are synchronised: fixing the text clears the diagnostic', async () => {
  const { mgr } = project(fakeServer);
  const seen = [];
  mgr.on('diagnostics', (rel, list) => seen.push(list.length));
  await mgr.open('a.py', 'x = BAD\n');
  await waitFor(() => seen.length >= 1);
  mgr.change('a.py', 'x = 1\n');
  assert.ok(await waitFor(() => seen.length >= 2 && seen[seen.length - 1] === 0));
  assert.strictEqual(seen[0], 1);
  mgr.close('a.py');
  assert.strictEqual(await mgr.request('a.py', 'hover', { line: 0, character: 0 }), null, 'closed documents are not queried');
  await mgr.dispose();
});

test('a server that is not installed is reported once, clearly, and does not hang or retry', async () => {
  const { mgr } = project({ python: { command: 'definitely-not-an-lsp-server-xyz', args: [], extensions: ['py'] } });
  const states = [];
  mgr.on('state', (s) => states.push(s.state));
  const t0 = Date.now();
  const res = await mgr.open('a.py', 'x');
  assert.strictEqual(res.ok, false);
  assert.ok(Date.now() - t0 < 5000);
  assert.ok(states.includes('unavailable'));
  assert.match(mgr.status().servers.find((s) => s.name === 'python').reason, /not installed|ENOENT|exited/);
  const again = await mgr.open('a.py', 'x');
  assert.strictEqual(again.ok, false);
  assert.strictEqual(states.filter((s) => s === 'starting').length, 1, 'no restart loop');
});

test('a project-defined server needs approval before it is started', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bazinga-lsp-'));
  let asked = 0;
  const mk = (ok) => new LspManager({ root, workspaceDir: root, getConfig: () => ({ enabled: true, servers: { python: { command: process.execPath, args: [FAKE], extensions: ['py'], fromProject: true } } }), approve: async () => { asked++; return ok; } });
  const denied = mk(false);
  assert.deepStrictEqual(await denied.open('a.py', 'x'), { ok: false, reason: 'not approved' });
  assert.strictEqual(asked, 1);
  const allowed = mk(true);
  assert.strictEqual((await allowed.open('a.py', 'x')).ok, true);
  await allowed.dispose();
});

test('server housekeeping requests are answered (workspace/configuration) and a crash is handled', async () => {
  const { mgr } = project(fakeServer);
  const states = [];
  mgr.on('state', (s) => states.push(s.state));
  await mgr.open('a.py', 'x');
  assert.ok(states.includes('ready'));
  const entry = mgr.servers.get('python');
  entry.client.child.kill();
  assert.ok(await waitFor(() => states.includes('exited')));
  assert.strictEqual(mgr.docs.size, 0);
  assert.strictEqual((await mgr.open('a.py', 'x')).ok, true, 'restarts on the next open');
  await mgr.dispose();
});

test('unsupported request kinds are rejected', async () => {
  const { mgr } = project(fakeServer);
  await mgr.open('a.py', 'x');
  await assert.rejects(() => mgr.request('a.py', 'rename', { line: 0, character: 0 }), /Unsupported/);
  await mgr.dispose();
});

test('usageCounts: exact counts without the declaration, cached per content, null when the server cannot answer', async () => {
  const { root, mgr } = project(fakeServer);
  const text = fs.readFileSync(path.join(root, 'a.py'), 'utf8');
  const t = [{ key: 'target', line: 0, character: 4 }];
  const first = await mgr.usageCounts('a.py', text, t);
  assert.strictEqual(first.get('target'), 1); // declaration excluded
  let asked = 0;
  const orig = mgr.request.bind(mgr);
  mgr.request = (...a) => { asked++; return orig(...a); };
  assert.strictEqual((await mgr.usageCounts('a.py', text, t)).get('target'), 1);
  assert.strictEqual(asked, 0, 'same content: answered from the cache');
  await mgr.usageCounts('a.py', `${text}\n# changed`, t);
  assert.strictEqual(asked, 1, 'changed content: asked again');
  // a language without a server, and a disabled manager
  assert.strictEqual((await mgr.usageCounts('x.rb', 'x', [{ key: 'k', line: 0, character: 0 }])).get('k'), null);
  const off = project({}, false).mgr;
  assert.strictEqual((await off.usageCounts('a.py', text, t)).get('target'), null);
  await mgr.dispose();
});

test('usageCounts: a slow server gives null within the budget, and the answer is there on the next ask', async () => {
  process.env.FAKE_LSP_SLOW = '600';
  try {
    const { root, mgr } = project(fakeServer);
    const text = fs.readFileSync(path.join(root, 'a.py'), 'utf8');
    const t = [{ key: 'target', line: 0, character: 4 }];
    const started = Date.now();
    const early = await mgr.usageCounts('a.py', text, t, { budgetMs: 150 });
    assert.strictEqual(early.get('target'), null);
    assert.ok(Date.now() - started < 590, 'did not wait for the slow answer');
    await new Promise((r) => setTimeout(r, 900));
    assert.strictEqual((await mgr.usageCounts('a.py', text, t, { budgetMs: 150 })).get('target'), 1);
    await mgr.dispose();
  } finally { delete process.env.FAKE_LSP_SLOW; }
});
