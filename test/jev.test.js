'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const jev = require('../src/core/jev');
const scorecard = require('../src/core/scorecard');

const ON = { enabled: true };
const env = { TYPESAFE_API_KEY: 'k-123' };
const fresh = () => jev._cache.clear();

test('off by default: the keyword rules answer and nothing is sent', async () => {
  fresh(); let called = 0;
  const r = await jev.kindOf('Fix the NullPointerException in login', {}, { env, request: async () => { called++; } });
  assert.deepEqual([r.kind, r.source, called], ['bugfix', 'rules', 0]);
});

test('on, with a key: the request carries the task text and the kinds, nothing else; the answer is used', async () => {
  fresh(); let seen;
  const r = await jev.kindOf('Please tidy up the order service', ON, { env, request: async (url, key, body) => { seen = { url, key, body }; return { kind: { choice: 'refactor', confidence: 0.92, probabilities: { refactor: 0.92 } } }; } });
  assert.deepEqual([r.kind, r.source, r.confidence], ['refactor', 'jev', 0.92]);
  assert.equal(seen.url, jev.DEFAULTS.endpoint); assert.equal(seen.key, 'k-123');
  assert.deepEqual(Object.keys(seen.body).sort(), ['model', 'questions', 'state']);
  assert.equal(seen.body.state, 'Please tidy up the order service');
  assert.deepEqual(Object.keys(seen.body.questions.kind.criteria), scorecard.KINDS);
  assert.equal(seen.body.questions.kind.type, 'choice');
});

test('the text is cut at 2000 characters', () => {
  assert.equal(jev.buildRequest('x'.repeat(5000), jev.settings({})).state.length, 2000);
});

test('every failure falls back to the rules, with a reason: no key, bad endpoint, error, unknown layout, unsure, unknown option', async () => {
  const run = (cfg, e, request) => { fresh(); return jev.kindOf('Add a postcode check to the form', cfg, { env: e, request }); };
  const ok = async () => ({ kind: { choice: 'feature', confidence: 0.99 } });
  let r = await run(ON, {}, ok); assert.deepEqual([r.source, r.kind], ['rules', 'feature']); assert.match(r.note, /no key/);
  r = await run({ ...ON, endpoint: 'http://evil.example/x' }, env, ok); assert.match(r.note, /https/);
  r = await run(ON, env, async () => { throw new Error('HTTP 429'); }); assert.equal(r.source, 'rules'); assert.match(r.note, /429/);
  r = await run(ON, env, async () => ({ something: 'else' })); assert.match(r.note, /layout/);
  r = await run(ON, env, async () => ({ kind: { choice: 'docs', confidence: 0.3 } })); assert.equal(r.kind, 'feature'); assert.match(r.note, /not sure/);
  r = await run(ON, env, async () => ({ kind: { choice: 'astrology', confidence: 0.9 } })); assert.match(r.note, /layout/);
  r = await jev.kindOf('short', ON, { env, request: ok }); assert.equal(r.source, 'rules', 'too short to ask about');
});

test('parseChoice accepts the plausible answer layouts', () => {
  const o = scorecard.KINDS;
  assert.deepEqual(jev.parseChoice('bugfix', o), { choice: 'bugfix', confidence: null });
  assert.deepEqual(jev.parseChoice({ option: 'tests', confidence: 0.8 }, o), { choice: 'tests', confidence: 0.8 });
  assert.deepEqual(jev.parseChoice({ probabilities: { docs: 0.2, review: 0.7, other: 0.1 } }, o), { choice: 'review', confidence: 0.7 });
  assert.equal(jev.parseChoice({ choice: 'nope' }, o), null);
  assert.equal(jev.parseChoice(null, o), null); assert.equal(jev.parseChoice(7, o), null);
});

test('answers are remembered: the same task is asked once', async () => {
  fresh(); let n = 0;
  const req = async () => { n++; return { kind: { choice: 'docs', confidence: 0.9 } }; };
  await jev.kindOf('Update the README with the new flags', ON, { env, request: req });
  await jev.kindOf('Update the README with the new flags', ON, { env, request: req });
  assert.equal(n, 1);
});

test('end to end over HTTP against a fake Jev server (key sent as a bearer token, a slow server times out)', async () => {
  fresh();
  let auth = ''; let delay = 0;
  const srv = http.createServer((req, res) => { auth = req.headers.authorization; req.resume(); req.on('end', () => setTimeout(() => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ model: 'jev-1.13.0', kind: { choice: 'tests', confidence: 0.95 }, usage: { input_tokens: 9, output_tokens: 0 } })); }, delay)); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const cfg = { enabled: true, endpoint: `http://127.0.0.1:${srv.address().port}/v1/systemone`, timeoutMs: 600 };
  try {
    const a = await jev.kindOf('Cover the invoice calculator with specs', cfg, { env });
    assert.deepEqual([a.source, a.kind, auth], ['jev', 'tests', 'Bearer k-123']);
    fresh(); delay = 1500;
    const b = await jev.kindOf('Cover the invoice calculator with specs', cfg, { env });
    assert.equal(b.source, 'rules'); assert.match(b.note, /too long|socket|hang/i);
  } finally { srv.closeAllConnections && srv.closeAllConnections(); srv.close(); }
});

test('the settings are validated and clamped', () => {
  const s = jev.settings({ minConfidence: 5, timeoutMs: 1 });
  assert.equal(s.minConfidence, 1); assert.equal(s.timeoutMs, 500);
  const { problems } = require('../src/core/configschema');
  assert.deepEqual(problems({ jev: { enabled: true, minConfidence: 0.5 } }), []);
  assert.ok(problems({ jev: { enabled: 'yes' } }).length > 0, 'a wrong type is reported');
});

test('the key never appears in a fallback note', async () => {
  fresh();
  const r = await jev.kindOf('Add a postcode check to the form', ON, { env, request: async () => { throw new Error('rejected key k-123 by server'); } });
  assert.equal(r.source, 'rules'); assert.ok(!r.note.includes('k-123')); assert.match(r.note, /\*\*\*/);
});

test('a key stored in Bazinga is used, and wins over the environment', async () => {
  fresh(); let seen;
  const r = await jev.kindOf('Add a postcode check to the form', ON, { env, key: 'stored-1', request: async (u, k) => { seen = k; return { kind: { choice: 'feature', confidence: 0.9 } }; } });
  assert.equal(seen, 'stored-1'); assert.equal(r.source, 'jev');
  fresh();
  const none = await jev.kindOf('Add a postcode check to the form', ON, { env: {}, key: 'only-stored', request: async () => ({ kind: { choice: 'docs', confidence: 0.9 } }) });
  assert.equal(none.source, 'jev', 'no environment variable needed');
});
