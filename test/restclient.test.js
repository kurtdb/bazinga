'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { send, loadCollection, saveCollection } = require('../src/core/restclient');

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

test('send omits a body for GET/HEAD even when one is passed', async () => {
  let seen;
  await withFetch(async (u, opts) => { seen = opts; return { status: 204, statusText: 'No Content', headers: new Map(), text: async () => '' }; }, async () => {
    await send({ method: 'GET', url: 'https://example.test/x', body: 'should be dropped' });
  });
  assert.equal(seen.body, undefined);
});

test('saveCollection then loadCollection round-trips requests, filtering out entries with no name/url', () => {
  const root = tmpRoot();
  const { saved } = saveCollection(root, [
    { name: 'Get widgets', method: 'get', url: 'https://example.test/widgets', headers: { Accept: 'application/json' }, body: '' },
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
  assert.ok(fs.existsSync(path.join(root, '.ide', 'requests.yaml')));
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
