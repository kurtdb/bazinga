'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const S = require('../src/core/skillsearch');

const BODY = { skills: [
  { id: 'vercel-labs/skills/find-skills', name: 'find-skills', source: 'vercel-labs/skills', installs: 900 },
  { id: 'a/b/react-tips', name: 'react-tips', source: 'a/b', installs: 12000 },
  { id: 'mintlify.com/mintlify', name: 'mintlify', source: 'mintlify.com', installs: 50 },
  { id: 'x/y/evil', name: 'ev\u001b[31mil\nname', source: 'x/y; rm -rf', installs: 'lots' },
  { id: 'q/r/noname', source: 'q/r', installs: 1 },
] };

test('parse: most installed first, nameless dropped, only owner/repo sources are installable, control characters removed', () => {
  const r = S.parse(BODY);
  assert.deepStrictEqual(r.map((s) => s.name), ['react-tips', 'find-skills', 'mintlify', 'ev [31mil name']);
  assert.deepStrictEqual(r.map((s) => s.installable), [true, true, false, false]);
  assert.strictEqual(r[0].slug, 'react-tips'); assert.strictEqual(r[0].url, 'https://skills.sh/a/b/react-tips');
  assert.strictEqual(r[3].installs, 0);
  // eslint-disable-next-line no-control-regex
  assert.ok(!/[\u0000-\u001f]/.test(r[3].name));
});

test('search against a fake skills.sh: the CLI\'s endpoint and parameters, the owner filter, short queries refused', async () => {
  const seen = [];
  const server = http.createServer((req, res) => { seen.push(req.url); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(BODY)); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const r = await S.search('react native', { owner: 'expo', limit: 5, base });
  assert.strictEqual(r.results[0].name, 'react-tips');
  const u = new URL(seen[0], 'http://x');
  assert.strictEqual(u.pathname, '/api/search');
  assert.deepStrictEqual([u.searchParams.get('q'), u.searchParams.get('limit'), u.searchParams.get('owner')], ['react native', '5', 'expo']);
  await S.search('abc', { owner: 'bad owner;', base });
  assert.ok(!new URL(seen[1], 'http://x').searchParams.has('owner'), 'an odd owner is not sent');
  assert.match((await S.search('a', { base })).error, /at least 2/);
  assert.strictEqual(seen.length, 2);
  server.close();
});

test('search: errors are readable (429, 500, not JSON, unreachable)', async () => {
  const mk = (status, body) => ({ fetchFn: async () => ({ ok: status < 300, status, json: async () => { if (body === 'bad') throw new Error('x'); return body; } }) });
  assert.match((await S.search('react', mk(429, {}))).error, /slow down/);
  assert.match((await S.search('react', mk(500, {}))).error, /error \(500\)/);
  assert.match((await S.search('react', mk(200, 'bad'))).error, /not JSON/);
  assert.match((await S.search('react', { fetchFn: async () => { const e = new Error('x'); e.cause = { code: 'ENOTFOUND' }; throw e; } })).error, /could not be reached/);
  assert.deepStrictEqual((await S.search('react', mk(200, {}))).results, []);
});
