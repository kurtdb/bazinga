'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const jira = require('../src/core/jira');
const { SecretStore } = require('../src/core/keystore');

const ADF = { type: 'doc', version: 1, content: [
  { type: 'paragraph', content: [{ type: 'text', text: 'Login fails when ' }, { type: 'text', text: 'the name has a quote', marks: [{ type: 'strong' }] }] },
  { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }] }, { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'two' }] }] }] },
  { type: 'orderedList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'first' }] }] }] },
  { type: 'codeBlock', content: [{ type: 'text', text: 'x = 1' }] },
  { type: 'paragraph', content: [{ type: 'text', text: 'a' }, { type: 'hardBreak' }, { type: 'text', text: 'b' }, { type: 'mention', attrs: { text: '@kurt' } }] },
] };

function fakeJira() {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ url: req.url, auth: req.headers.authorization });
    const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/rest/api/3/search/jql' || u.pathname === '/rest/api/2/search') {
      if (req.headers.authorization === 'Basic ' + Buffer.from('me@x.be:BAD').toString('base64')) return send(401, {});
      return send(200, { issues: [{ key: 'PROJ-12', fields: { summary: 'Fix login', issuetype: { name: 'Bug' }, status: { name: 'In Progress' }, assignee: { displayName: 'Kurt' }, labels: ['web', 'urgent'] } }, { fields: {} }] });
    }
    if (u.pathname === '/rest/api/3/issue/PROJ-12') return send(200, { key: 'PROJ-12', fields: { summary: 'Fix login', issuetype: { name: 'Bug' }, status: { name: 'Open' }, description: ADF, labels: [] } });
    if (u.pathname === '/rest/api/2/issue/PROJ-12') return send(200, { key: 'PROJ-12', fields: { summary: 'Fix login', issuetype: { name: 'Bug' }, status: { name: 'Open' }, description: 'plain *wiki* text' } });
    if (u.pathname === '/rest/api/3/myself') return send(200, { displayName: 'Kurt Du Bois' });
    return send(404, {});
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, seen, url: `http://127.0.0.1:${server.address().port}` })));
}

test('JQL: mine / sprint, project filter, quotes escaped', () => {
  assert.match(jira.jql('mine', 'PROJ'), /^project = "PROJ" AND assignee = currentUser\(\) AND statusCategory != Done ORDER BY/);
  assert.match(jira.jql('sprint', ''), /^sprint in openSprints\(\) AND statusCategory != Done/);
  assert.ok(jira.jql('mine', 'A"B').includes('project = "A\\"B"'));
});

test('connection: needs a base URL; flavor decides the API version; the old jiraBaseUrl still works', () => {
  assert.strictEqual(jira.connection({}), null);
  assert.strictEqual(jira.connection({ jira: { baseUrl: 'not a url' } }), null);
  const c = jira.connection({ jira: { baseUrl: 'https://o.atlassian.net/', email: ' a@b.c ', project: 'proj' } });
  assert.deepStrictEqual([c.baseUrl, c.api, c.email, c.project, c.flavor], ['https://o.atlassian.net', 3, 'a@b.c', 'PROJ', 'cloud']);
  assert.strictEqual(jira.connection({ jira: { baseUrl: 'https://j.corp', flavor: 'server' } }).api, 2);
  assert.strictEqual(jira.connection({ workItems: { jiraBaseUrl: 'https://old.example' } }).baseUrl, 'https://old.example');
});

test('ADF descriptions become readable text', () => {
  const t = jira.adfToText(ADF);
  assert.match(t, /Login fails when the name has a quote/);
  assert.match(t, /- one\n- two/);
  assert.match(t, /1\. first/);
  assert.match(t, /```\nx = 1\n```/);
  assert.match(t, /a\nb@kurt/);
});

test('list and show against a fake Jira Cloud: Basic auth, v3 endpoints, items parsed, the empty issue dropped', async () => {
  const f = await fakeJira();
  const cfg = { jira: { baseUrl: f.url, email: 'me@x.be', project: 'PROJ' } };
  const l = await jira.list({ cfg, token: 'TOK' });
  assert.deepStrictEqual(l.items.map((i) => [i.id, i.title, i.type, i.state, i.assignedTo, i.tags]), [['PROJ-12', 'Fix login', 'Bug', 'In Progress', 'Kurt', 'web urgent']]);
  assert.strictEqual(f.seen[0].auth, 'Basic ' + Buffer.from('me@x.be:TOK').toString('base64'));
  assert.match(f.seen[0].url, /^\/rest\/api\/3\/search\/jql\?jql=project%20%3D%20%22PROJ%22/);
  const s = await jira.show({ cfg, token: 'TOK', key: 'proj-12' });
  assert.strictEqual(s.item.key, 'PROJ-12');
  assert.match(s.text, /^Bug PROJ-12: Fix login\n\nLogin fails when/);
  assert.strictEqual(s.item.url, `${f.url}/browse/PROJ-12`);
  assert.deepStrictEqual(await jira.whoami({ cfg, token: 'TOK' }), { name: 'Kurt Du Bois' });
  f.server.close();
});

test('Jira Server: Bearer token and the v2 endpoints, description kept as text', async () => {
  const f = await fakeJira();
  const cfg = { jira: { baseUrl: f.url, flavor: 'server' } };
  const l = await jira.list({ cfg, token: 'PAT' });
  assert.strictEqual(l.items.length, 1);
  assert.strictEqual(f.seen[0].auth, 'Bearer PAT');
  assert.match(f.seen[0].url, /^\/rest\/api\/2\/search\?/);
  assert.match((await jira.show({ cfg, token: 'PAT', key: 'PROJ-12' })).text, /plain \*wiki\* text/);
  f.server.close();
});

test('errors are readable: wrong token, unknown issue, bad key, not set up, nothing listening', async () => {
  const f = await fakeJira();
  const cfg = { jira: { baseUrl: f.url, email: 'me@x.be' } };
  assert.match((await jira.list({ cfg, token: 'BAD' })).error, /rejected the email or API token \(401\)/);
  assert.match((await jira.show({ cfg, token: 'T', key: 'NOPE-1' })).error, /does not know that \(404\)/);
  assert.match((await jira.show({ cfg, token: 'T', key: 'drop table' })).error, /Not a Jira issue key/);
  assert.match((await jira.list({ cfg: {}, token: 'T' })).error, /not set up/);
  assert.match((await jira.list({ cfg: { jira: { baseUrl: f.url } }, token: 'T' })).error, /not set up/, 'Cloud needs the email too');
  f.server.close();
  assert.match((await jira.list({ cfg: { jira: { baseUrl: 'http://127.0.0.1:1', email: 'a@b.c' } }, token: 'T' })).error, /Could not reach Jira|fetch failed/);
});

test('secret store: encrypted on disk, round trip, refuses without a key store, delete', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-'));
  const fake = { available: () => true, encrypt: (s) => Buffer.from(s.split('').reverse().join('')), decrypt: (b) => b.toString().split('').reverse().join('') };
  const st = new SecretStore(path.join(dir, 's.json'), fake);
  st.set('jira', 'SuperSecret');
  assert.ok(!fs.readFileSync(path.join(dir, 's.json'), 'utf8').includes('SuperSecret'), 'never in clear text');
  assert.strictEqual(st.get('jira'), 'SuperSecret'); assert.ok(st.has('jira')); assert.strictEqual(st.get('other'), null);
  st.delete('jira'); assert.strictEqual(st.get('jira'), null);
  const none = new SecretStore(path.join(dir, 't.json'), { ...fake, available: () => false });
  assert.throws(() => none.set('jira', 'x'), /no secure key store/);
  assert.ok(!fs.existsSync(path.join(dir, 't.json')), 'nothing written');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('comment: v3 posts a document, v2 plain text, a rejected token is reported, bad keys and empty text are refused', async () => {
  const posts = [];
  const server = http.createServer((req, res) => {
    let data = ''; req.on('data', (c) => { data += c; });
    req.on('end', () => {
      posts.push({ method: req.method, url: req.url, body: data ? JSON.parse(data) : null, ct: req.headers['content-type'] });
      if (req.headers.authorization === 'Basic ' + Buffer.from('me@x.be:BAD').toString('base64')) { res.writeHead(401); return res.end('{}'); }
      res.writeHead(201, { 'content-type': 'application/json' }); res.end('{}');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const cloud = { jira: { baseUrl: url, email: 'me@x.be' } };
  assert.deepStrictEqual(await jira.comment({ cfg: cloud, token: 'T', key: 'proj-12', text: 'Finished.\n\nAll steps passed.' }), { ok: true });
  assert.strictEqual(posts[0].method, 'POST'); assert.strictEqual(posts[0].url, '/rest/api/3/issue/PROJ-12/comment'); assert.strictEqual(posts[0].ct, 'application/json');
  assert.deepStrictEqual(posts[0].body.body.content.map((p) => p.content[0].text), ['Finished.', 'All steps passed.']);
  await jira.comment({ cfg: { jira: { baseUrl: url, flavor: 'server' } }, token: 'PAT', key: 'PROJ-12', text: 'plain' });
  assert.deepStrictEqual(posts[1].body, { body: 'plain' }); assert.strictEqual(posts[1].url, '/rest/api/2/issue/PROJ-12/comment');
  assert.match((await jira.comment({ cfg: cloud, token: 'BAD', key: 'PROJ-12', text: 'x' })).error, /401/);
  const n = posts.length;
  assert.match((await jira.comment({ cfg: cloud, token: 'T', key: 'x; drop', text: 'x' })).error, /Not a Jira issue key/);
  assert.match((await jira.comment({ cfg: cloud, token: 'T', key: 'PROJ-1', text: '  ' })).error, /Nothing to post/);
  assert.strictEqual(posts.length, n, 'nothing was sent for refused input');
  server.close();
});
