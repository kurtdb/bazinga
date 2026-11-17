'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const M = require('../src/core/llamamodels');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'llamamodels-'));
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** A fake Hugging Face: search, a repo's file tree (with lfs.oid for the sha256), and resolve downloads with Range/ETag support. */
function fakeHub(files, { failFirstByte = null, slow = null } = {}) {
  let failedOnce = false;
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/api/models') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify([{ id: 'acme/model', downloads: 10, likes: 1 }])); }
    const tree = /^\/api\/models\/(.+)\/tree\/main$/.exec(u.pathname);
    if (tree) {
      const repo = tree[1];
      const entries = Object.entries(files).filter(([k]) => k.startsWith(`${repo}/`)).map(([k, v]) => ({ type: 'file', path: k.slice(repo.length + 1), size: v.content.length, lfs: v.sha256 ? { oid: v.sha256 } : undefined }));
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify(entries));
    }
    const resolve = /^\/(.+)\/resolve\/main\/(.+)$/.exec(u.pathname);
    if (resolve) {
      const key = `${resolve[1]}/${resolve[2]}`;
      const f = files[key];
      if (!f) { res.statusCode = 404; return res.end(); }
      res.setHeader('etag', f.etag || 'etag-1');
      const range = req.headers.range;
      const start = range ? Number(/bytes=(\d+)-/.exec(range)[1]) : 0;
      if (key === failFirstByte && !failedOnce) {
        failedOnce = true;
        res.statusCode = range ? 206 : 200;
        res.write(f.content.slice(start, start + Math.floor(f.content.length / 2)));
        return res.socket.destroy(); // simulate a dropped connection mid-download
      }
      if (key === slow) {
        res.statusCode = range ? 206 : 200;
        res.write(f.content.slice(start, start + 4));
        setTimeout(() => { res.write(f.content.slice(start + 4)); res.end(); }, 150);
        return undefined;
      }
      res.statusCode = range ? 206 : 200;
      res.setHeader('content-length', String(f.content.length - start));
      return res.end(f.content.slice(start));
    }
    res.statusCode = 404; return res.end();
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({ srv, base: `http://127.0.0.1:${srv.address().port}` })));
}
const rewire = (base) => (url, opts) => { const u = new URL(url); return fetch(`${base}${u.pathname}${u.search}`, opts); };

test('searchHub: returns repo ids ranked by the hub, downloads/likes passed through', async () => {
  const h = await fakeHub({});
  try {
    const got = await M.searchHub('qwen', { fetchImpl: rewire(h.base) });
    assert.deepEqual(got, [{ repo: 'acme/model', downloads: 10, likes: 1 }]);
  } finally { h.srv.close(); }
});

test('listRepoFiles: only .gguf entries, with real size and the lfs sha256 when the hub reports one', async () => {
  const content = Buffer.from('hello world');
  const files = { 'acme/model/weights.gguf': { content, sha256: sha256(content) }, 'acme/model/README.md': { content: Buffer.from('#readme') } };
  const h = await fakeHub(files);
  try {
    const got = await M.listRepoFiles('acme/model', { fetchImpl: rewire(h.base) });
    assert.deepEqual(got, [{ file: 'weights.gguf', sizeBytes: content.length, sha256: sha256(content) }]);
  } finally { h.srv.close(); }
});

test('download: fresh download, verifies checksum, lands in list(), remove() deletes it', async () => {
  const content = Buffer.from('a'.repeat(5000));
  const files = { 'acme/model/weights.gguf': { content, sha256: sha256(content) } };
  const h = await fakeHub(files);
  const dir = tmp();
  try {
    const entry = await M.download(dir, 'acme/model', 'weights.gguf', { sizeBytes: content.length, sha256: sha256(content), fetchImpl: rewire(h.base) });
    assert.equal(fs.readFileSync(entry.path).equals(content), true);
    assert.deepEqual(M.list(dir).map((m) => m.id), [entry.id]);
    assert.equal(M.remove(dir, entry.id), true);
    assert.equal(fs.existsSync(entry.path), false);
    assert.deepEqual(M.list(dir), []);
    assert.equal(M.remove(dir, entry.id), false, 'removing an already-removed id is reported, not thrown');
  } finally { h.srv.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('download: a dropped connection leaves a resumable .part, a second attempt resumes via Range and still checksums correctly', async () => {
  const content = Buffer.from(Array.from({ length: 20000 }, (_, i) => (i % 256)));
  const key = 'acme/model/weights.gguf';
  const files = { [key]: { content, sha256: sha256(content) } };
  const h = await fakeHub(files, { failFirstByte: key });
  const dir = tmp();
  try {
    await assert.rejects(M.download(dir, 'acme/model', 'weights.gguf', { sizeBytes: content.length, sha256: sha256(content), fetchImpl: rewire(h.base) }));
    const entry = await M.download(dir, 'acme/model', 'weights.gguf', { sizeBytes: content.length, sha256: sha256(content), fetchImpl: rewire(h.base) });
    assert.equal(fs.readFileSync(entry.path).equals(content), true, 'the resumed file is byte-identical to the original, not just the tail');
  } finally { h.srv.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('download: a checksum mismatch is rejected and leaves no partial file or manifest entry behind', async () => {
  const content = Buffer.from('real content');
  const files = { 'acme/model/weights.gguf': { content } };
  const h = await fakeHub(files);
  const dir = tmp();
  try {
    await assert.rejects(
      M.download(dir, 'acme/model', 'weights.gguf', { sizeBytes: content.length, sha256: 'f'.repeat(64), fetchImpl: rewire(h.base) }),
      /checksum mismatch/,
    );
    assert.deepEqual(M.list(dir), []);
    assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.part') || f.endsWith('.part.meta')), []);
  } finally { h.srv.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('cancel(): aborts an in-flight download, a repeat cancel reports false', async () => {
  const content = Buffer.from('x'.repeat(5000));
  const key = 'acme/model/weights.gguf';
  const files = { [key]: { content } };
  const h = await fakeHub(files, { slow: key });
  const dir = tmp();
  try {
    const p = M.download(dir, 'acme/model', 'weights.gguf', { sizeBytes: content.length, fetchImpl: rewire(h.base) });
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(M.cancel('acme/model', 'weights.gguf'), true);
    await assert.rejects(p);
    assert.equal(M.cancel('acme/model', 'weights.gguf'), false);
  } finally { h.srv.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('diskSpaceOk: false when asking for more than the volume has, true for a trivial amount', () => {
  const dir = tmp();
  assert.equal(M.diskSpaceOk(dir, 1), true);
  assert.equal(M.diskSpaceOk(dir, Number.MAX_SAFE_INTEGER), false);
  fs.rmSync(dir, { recursive: true, force: true });
});
