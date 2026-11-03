'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { markdown, detect, post } = require('../src/core/prcomment');

const CLEAN = { guard: { clean: true, blockers: 0, warnings: 0, items: [] }, files: ['a.js'], base: 'main' };
const BLOCKED = {
  guard: { clean: false, blockers: 1, warnings: 1, items: [
    { level: 'block', id: 'tests-untouched', text: 'no tests touched', files: Array.from({ length: 8 }, (_, i) => `f${i}.js`) },
    { level: 'warn', id: 'big-diff', text: 'large diff', files: [] },
  ] },
  files: ['a.js', 'b.js'], base: 'develop',
};

test('markdown: clean guard, and a blocked one with a truncated file list', () => {
  const clean = markdown(CLEAN);
  assert.match(clean, /^<!-- bazinga-guard -->\n### ✅ Bazinga guard: clean/);
  assert.match(clean, /1 changed file\(s\) compared with main\./);

  const blocked = markdown(BLOCKED);
  assert.match(blocked, /### ⛔ Bazinga guard: 1 blocker\(s\), 1 warning\(s\)/);
  assert.match(blocked, /- \*\*BLOCK\*\* `tests-untouched` no tests touched — `f0\.js`, `f1\.js`, `f2\.js`, `f3\.js`, `f4\.js`, `f5\.js` …/);
  assert.match(blocked, /- warn `big-diff` large diff\n/);
});

test('detect: Azure and GitHub pipeline variables, and neither', () => {
  assert.strictEqual(detect({}), null);
  const az = detect({
    SYSTEM_PULLREQUEST_PULLREQUESTID: '5', SYSTEM_COLLECTIONURI: 'https://dev.azure.com/o/', SYSTEM_TEAMPROJECT: 'My Project',
    BUILD_REPOSITORY_ID: 'repo-id', SYSTEM_ACCESSTOKEN: 'tok',
  });
  assert.deepStrictEqual(az, { kind: 'azure', base: 'https://dev.azure.com/o/My%20Project/_apis/git/repositories/repo-id/pullRequests/5', token: 'tok' });
  // Azure vars present but no repo id/name at all - detect() must not crash, just say "not in a PR"
  assert.strictEqual(detect({ SYSTEM_PULLREQUEST_PULLREQUESTID: '5', SYSTEM_COLLECTIONURI: 'https://dev.azure.com/o/', SYSTEM_TEAMPROJECT: 'P' }), null);

  const gh = detect({ GITHUB_REF: 'refs/pull/12/merge', GITHUB_REPOSITORY: 'k/r', GITHUB_TOKEN: 'ghtok' });
  assert.deepStrictEqual(gh, { kind: 'github', base: 'https://api.github.com/repos/k/r/issues/12', token: 'ghtok' });
  assert.strictEqual(detect({ GITHUB_REF: 'refs/heads/main', GITHUB_REPOSITORY: 'k/r' }), null);
});

test('post: not in a pipeline, and missing-token reasons for both hosts', async () => {
  assert.deepStrictEqual(await post(CLEAN, { env: {} }), { posted: false, reason: 'Not running in a pull request pipeline.' });
  const az = await post(CLEAN, { env: { SYSTEM_PULLREQUEST_PULLREQUESTID: '1', SYSTEM_COLLECTIONURI: 'https://dev.azure.com/o/', SYSTEM_TEAMPROJECT: 'P', BUILD_REPOSITORY_ID: 'r' } });
  assert.strictEqual(az.posted, false);
  assert.match(az.reason, /SYSTEM_ACCESSTOKEN/);
  const gh = await post(CLEAN, { env: { GITHUB_REF: 'refs/pull/1/merge', GITHUB_REPOSITORY: 'k/r' } });
  assert.strictEqual(gh.posted, false);
  assert.match(gh.reason, /GITHUB_TOKEN/);
});

test('post (github, fake request): creates a new comment, then updates the existing one on a second run', async () => {
  const env = { GITHUB_REF: 'refs/pull/9/merge', GITHUB_REPOSITORY: 'k/r', GITHUB_TOKEN: 't' };
  const calls = [];
  let existing = [];
  const request = async (method, url, token, kind, body) => {
    calls.push({ method, url, token, kind, body });
    if (method === 'GET') return existing;
    if (method === 'POST') { existing = [{ id: 1, body: body.body }]; return {}; }
    if (method === 'PATCH') { existing[0].body = body.body; return {}; }
    throw new Error(`unexpected ${method}`);
  };
  const r1 = await post(CLEAN, { env, request });
  assert.deepStrictEqual(r1, { posted: true, updated: false });
  assert.ok(calls.some((c) => c.method === 'POST' && c.url === 'https://api.github.com/repos/k/r/issues/9/comments'));

  const r2 = await post(BLOCKED, { env, request });
  assert.deepStrictEqual(r2, { posted: true, updated: true });
  assert.ok(calls.some((c) => c.method === 'PATCH' && c.url === 'https://api.github.com/repos/k/r/issues/comments/1'));
  assert.match(existing[0].body, /blocker/);
});

test('post (azure, fake request): creates a thread, then updates it (and its status) on a second run', async () => {
  const env = { SYSTEM_PULLREQUEST_PULLREQUESTID: '3', SYSTEM_COLLECTIONURI: 'https://dev.azure.com/o/', SYSTEM_TEAMPROJECT: 'P', BUILD_REPOSITORY_ID: 'r', SYSTEM_ACCESSTOKEN: 't' };
  let threads = [];
  const request = async (method, url, token, kind, body) => {
    if (method === 'GET') return { value: threads };
    if (method === 'POST') { threads = [{ id: 7, comments: [{ id: 1, content: body.comments[0].content }] }]; return {}; }
    if (method === 'PATCH' && /\/comments\//.test(url)) { threads[0].comments[0].content = body.content; return {}; }
    if (method === 'PATCH') { threads[0].status = body.status; return {}; }
    throw new Error(`unexpected ${method}`);
  };
  const r1 = await post(BLOCKED, { env, request });
  assert.deepStrictEqual(r1, { posted: true, updated: false });

  const r2 = await post(CLEAN, { env, request });
  assert.deepStrictEqual(r2, { posted: true, updated: true });
  assert.match(threads[0].comments[0].content, /clean/);
  assert.strictEqual(threads[0].status, 'closed');
});

test('post: a thrown request surfaces as a reason, not an exception', async () => {
  const env = { GITHUB_REF: 'refs/pull/1/merge', GITHUB_REPOSITORY: 'k/r', GITHUB_TOKEN: 't' };
  const request = async () => { throw new Error('ECONNRESET'); };
  assert.deepStrictEqual(await post(CLEAN, { env, request }), { posted: false, reason: 'Could not post the comment: ECONNRESET' });
});

// ---- the real HTTP transport (realRequest), not the injected fake above - a tiny local server standing in for GitHub's API
test('post against a real local HTTP server exercises the default request() implementation', async () => {
  const seen = [];
  const server = http.createServer((req, res) => {
    const parts = []; req.on('data', (c) => parts.push(c));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, body: parts.length ? JSON.parse(Buffer.concat(parts)) : null });
      res.setHeader('content-type', 'application/json');
      if (req.method === 'GET') { res.end('[]'); return; }
      res.end('{}');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const env = { GITHUB_REF: 'refs/pull/4/merge', GITHUB_REPOSITORY: 'k/r', GITHUB_TOKEN: 't', GITHUB_API_URL: `http://127.0.0.1:${port}` };
    const r = await post(CLEAN, { env });
    assert.deepStrictEqual(r, { posted: true, updated: false });
    assert.ok(seen.some((c) => c.method === 'GET' && c.url === `/repos/k/r/issues/4/comments?per_page=100`));
    assert.ok(seen.some((c) => c.method === 'POST' && c.body && c.body.body.includes('bazinga-guard')));
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('post against a real local HTTP server surfaces a non-2xx response as a reason', async () => {
  const server = http.createServer((req, res) => { res.statusCode = 403; res.end(JSON.stringify({ message: 'Resource not accessible' })); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const env = { GITHUB_REF: 'refs/pull/4/merge', GITHUB_REPOSITORY: 'k/r', GITHUB_TOKEN: 't', GITHUB_API_URL: `http://127.0.0.1:${port}` };
    const r = await post(CLEAN, { env });
    assert.strictEqual(r.posted, false);
    assert.match(r.reason, /HTTP 403.*Resource not accessible/);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
