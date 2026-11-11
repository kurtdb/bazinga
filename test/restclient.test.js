'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { send, loadCollection, saveCollection } = require('../src/core/restclient');
const atob = (b64) => Buffer.from(b64, 'base64').toString('utf8');

const tmpRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bazinga-rest-'));

function withFetch(impl, fn) {
  const orig = global.fetch;
  global.fetch = impl;
  return fn().finally(() => { global.fetch = orig; });
}

test('send rejects a non-http(s) URL without making a network call', async () => {
  await withFetch(() => { throw new Error('should not be called'); }, async () => {
    const r = await send({ method: 'GET', url: 'file:///etc/passwd' });
    assert.equal(r.ok, false);
    assert.match(r.error, /http/i);
  });
});

test('send returns status, headers and body text on success', async () => {
  await withFetch(async () => ({
    status: 200,
    statusText: 'OK',
    headers: new Map([['content-type', 'application/json']]),
    text: async () => '{"hello":"world"}',
  }), async () => {
    const r = await send({ method: 'GET', url: 'https://example.test/x' });
    assert.equal(r.ok, true);
    assert.equal(r.status, 200);
    assert.equal(r.headers['content-type'], 'application/json');
    assert.equal(r.body, '{"hello":"world"}');
    assert.equal(typeof r.timeMs, 'number');
  });
});

test('send never throws on a network failure - reports { ok: false, error }', async () => {
  await withFetch(async () => { throw new Error('getaddrinfo ENOTFOUND'); }, async () => {
    const r = await send({ method: 'GET', url: 'https://nope.invalid/x' });
    assert.equal(r.ok, false);
    assert.match(r.error, /ENOTFOUND/);
  });
});

test('send reports a timeout distinctly from other errors', async () => {
  await withFetch(async () => { const e = new Error('timeout'); e.name = 'TimeoutError'; throw e; }, async () => {
    const r = await send({ method: 'GET', url: 'https://example.test/x' }, 50);
    assert.equal(r.ok, false);
    assert.match(r.error, /Timed out after 50ms/);
  });
});

test('send reports a caller-triggered cancel distinctly from a timeout', async () => {
  const ac = new AbortController();
  await withFetch(async (u, opts) => new Promise((_resolve, reject) => {
    opts.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); });
  }), async () => {
    const p = send({ method: 'GET', url: 'https://example.test/x' }, 5000, ac.signal);
    ac.abort();
    const r = await p;
    assert.equal(r.ok, false);
    assert.equal(r.error, 'Cancelled');
  });
});

test('send omits a body for GET/HEAD even when one is passed', async () => {
  let seen;
  await withFetch(async (u, opts) => { seen = opts; return { status: 204, statusText: 'No Content', headers: new Map(), text: async () => '' }; }, async () => {
    await send({ method: 'GET', url: 'https://example.test/x', body: 'should be dropped' });
  });
  assert.equal(seen.body, undefined);
});

test('send substitutes {{var}} tokens in the URL, headers and body, leaving an unresolved one untouched', async () => {
  let seen;
  await withFetch(async (u, opts) => { seen = { url: u, opts }; return { status: 200, statusText: 'OK', headers: new Map(), text: async () => '' }; }, async () => {
    await send({ method: 'POST', url: 'https://{{host}}/widgets', headers: { 'X-Env': '{{env}}', 'X-Unknown': '{{nope}}' }, body: '{"id":"{{id}}"}', vars: { host: 'api.test', env: 'staging', id: '42' } });
  });
  assert.equal(seen.url, 'https://api.test/widgets');
  assert.equal(seen.opts.headers['X-Env'], 'staging');
  assert.equal(seen.opts.headers['X-Unknown'], '{{nope}}');
  assert.equal(seen.opts.body, '{"id":"42"}');
});

test('send applies basic auth as a base64 Authorization header, after substituting its fields', async () => {
  let seen;
  await withFetch(async (u, opts) => { seen = opts; return { status: 200, statusText: 'OK', headers: new Map(), text: async () => '' }; }, async () => {
    await send({ method: 'GET', url: 'https://example.test/x', auth: { type: 'basic', username: '{{user}}', password: 'secret' }, vars: { user: 'alice' } });
  });
  assert.equal(atob(seen.headers.Authorization.replace('Basic ', '')), 'alice:secret');
});

test('send applies bearer auth as an Authorization header', async () => {
  let seen;
  await withFetch(async (u, opts) => { seen = opts; return { status: 200, statusText: 'OK', headers: new Map(), text: async () => '' }; }, async () => {
    await send({ method: 'GET', url: 'https://example.test/x', auth: { type: 'bearer', token: 'tok123' } });
  });
  assert.equal(seen.headers.Authorization, 'Bearer tok123');
});

test('send applies an apiKey auth as a custom header, or as a query param when asked', async () => {
  let seenHeader;
  await withFetch(async (u, opts) => { seenHeader = opts; return { status: 200, statusText: 'OK', headers: new Map(), text: async () => '' }; }, async () => {
    await send({ method: 'GET', url: 'https://example.test/x', auth: { type: 'apiKey', key: 'X-API-Key', value: 'abc', in: 'header' } });
  });
  assert.equal(seenHeader.headers['X-API-Key'], 'abc');

  let seenUrl;
  await withFetch(async (u) => { seenUrl = u; return { status: 200, statusText: 'OK', headers: new Map(), text: async () => '' }; }, async () => {
    await send({ method: 'GET', url: 'https://example.test/x', auth: { type: 'apiKey', key: 'key', value: 'abc', in: 'query' } });
  });
  assert.equal(seenUrl, 'https://example.test/x?key=abc');
});

test('saveCollection then loadCollection round-trips requests, filtering out entries with no name/url', () => {
  const root = tmpRoot();
  const { saved } = saveCollection(root, [
    { name: 'Get widgets', method: 'get', url: 'https://example.test/widgets', headers: { Accept: 'application/json' }, body: '', folder: 'Billing', auth: { type: 'bearer', token: 'x' } },
    { name: '', url: 'https://example.test/dropped-no-name' },
    { url: 'https://example.test/dropped-no-name-2' },
    { name: 'dropped-no-url' },
  ]);
  assert.equal(saved, 1);
  const loaded = loadCollection(root);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].name, 'Get widgets');
  assert.equal(loaded[0].method, 'GET');
  assert.equal(loaded[0].headers.Accept, 'application/json');
  assert.equal(loaded[0].folder, 'Billing');
  assert.deepEqual(loaded[0].auth, { type: 'bearer', token: 'x' });
  assert.ok(fs.existsSync(path.join(root, '.ide', 'requests.yaml')));
});

test('saveCollection normalizes an unrecognized auth type to none rather than persisting garbage', () => {
  const root = tmpRoot();
  saveCollection(root, [{ name: 'x', url: 'https://example.test/x', auth: { type: 'oauth2', clientSecret: 'nope' } }]);
  assert.deepEqual(loadCollection(root)[0].auth, { type: 'none' });
});

test('loadCollection returns an empty array when the collection file does not exist yet', () => {
  const root = tmpRoot();
  assert.deepEqual(loadCollection(root), []);
});

test('loadCollection raises a clear error on invalid YAML rather than a raw parser exception', () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, '.ide'), { recursive: true });
  fs.writeFileSync(path.join(root, '.ide', 'requests.yaml'), 'requests: [this: is: not: valid\n');
  assert.throws(() => loadCollection(root), /Invalid YAML/);
});
