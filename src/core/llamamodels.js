'use strict';
// Downloading and tracking GGUF model files for llama.cpp. llama.cpp has no pull/registry of its own (unlike
// Ollama, which ollama.js talks to) - this is that missing layer, backed by Hugging Face's public model hub.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { safeFetch } = require('./safeFetch');

const HF_API = 'https://huggingface.co/api/models';
const MANIFEST_FILE = 'manifest.json';

const slug = (repo) => repo.replace(/[^A-Za-z0-9._-]/g, '__');
const idOf = (repo, file) => `${repo}/${file}`;
const localFileName = (repo, file) => `${slug(repo)}__${file}`;

function manifestPath(modelsDir) { return path.join(modelsDir, MANIFEST_FILE); }

function readManifest(modelsDir) {
  try { return JSON.parse(fs.readFileSync(manifestPath(modelsDir), 'utf8')); } catch { return {}; }
}

function writeManifest(modelsDir, manifest) {
  fs.mkdirSync(modelsDir, { recursive: true });
  fs.writeFileSync(manifestPath(modelsDir), JSON.stringify(manifest, null, 2));
}

/** Installed models: [{ id, repo, file, path, size, sha256, downloadedAt }]. */
function list(modelsDir) {
  const manifest = readManifest(modelsDir);
  return Object.values(manifest).filter((m) => fs.existsSync(m.path));
}

function remove(modelsDir, id) {
  const manifest = readManifest(modelsDir);
  const entry = manifest[id];
  if (!entry) return false;
  delete manifest[id];
  writeManifest(modelsDir, manifest);
  try { fs.rmSync(entry.path, { force: true }); } catch { /* already gone */ }
  return true;
}

/** Searches Hugging Face's model hub for repos likely to carry GGUF files, ranked by downloads. */
async function searchHub(query, { limit = 20, fetchImpl = fetch } = {}) {
  const url = `${HF_API}?search=${encodeURIComponent(query)}&filter=gguf&sort=downloads&direction=-1&limit=${limit}`;
  const { body } = await safeFetch(url, { headers: { 'user-agent': 'bazinga' } }, 'json', fetchImpl);
  return (Array.isArray(body) ? body : []).map((m) => ({ repo: m.id || m.modelId, downloads: m.downloads || 0, likes: m.likes || 0 }));
}

/**
 * The .gguf files in a repo, with real size + sha256 where Hugging Face tracks the file via git-lfs (every GGUF
 * worth downloading is - they're too large not to be), via the tree API rather than the plainer /api/models/<repo>
 * listing, because the tree API is the one that reports lfs.oid (the sha256) and size per entry.
 */
async function listRepoFiles(repo, { revision = 'main', fetchImpl = fetch } = {}) {
  const url = `${HF_API}/${repo}/tree/${revision}`;
  const { body } = await safeFetch(url, { headers: { 'user-agent': 'bazinga' } }, 'json', fetchImpl);
  return (Array.isArray(body) ? body : [])
    .filter((e) => e.type === 'file' && /\.gguf$/i.test(e.path))
    .map((e) => ({ file: e.path, sizeBytes: e.size || (e.lfs && e.lfs.size) || 0, sha256: e.lfs && e.lfs.oid && /^[0-9a-f]{64}$/i.test(e.lfs.oid) ? e.lfs.oid : null }));
}

function diskSpaceOk(dir, neededBytes) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const st = fs.statfsSync(dir);
    return st.bsize * st.bavail >= neededBytes;
  } catch { return true; } // statfs not available on this platform/Node build - don't block the download over it
}

const downloads = new Map(); // id -> AbortController, for cancel()

function cancel(repo, file) {
  const ctrl = downloads.get(idOf(repo, file));
  if (!ctrl) return false;
  ctrl.abort();
  return true;
}

/**
 * Streams a GGUF file to disk with resume (Range, keyed to the ETag seen at the start of this attempt - if the
 * server's copy changed, the partial download is discarded rather than silently stitched onto a different file)
 * and sha256 verification when the hub reported one. Not routed through safeFetch for the body itself: safeFetch
 * reads the whole response into memory via one of res.json/text/etc, which doesn't fit a multi-GB file - this
 * keeps the same "always drain or destroy the response body" discipline by hand instead (crbug 378822137).
 */
async function download(modelsDir, repo, file, { sizeBytes = 0, sha256 = null, revision = 'main', onProgress, fetchImpl = fetch } = {}) {
  const id = idOf(repo, file);
  if (!diskSpaceOk(modelsDir, sizeBytes)) throw new Error(`not enough free disk space for ${file} (${sizeBytes} bytes needed)`);
  fs.mkdirSync(modelsDir, { recursive: true });
  const destPath = path.join(modelsDir, localFileName(repo, file));
  const partPath = `${destPath}.part`;
  const metaPath = `${destPath}.part.meta`;
  const url = `https://huggingface.co/${repo}/resolve/${revision}/${file}`;
  const ctrl = new AbortController();
  downloads.set(id, ctrl);
  try {
    let startAt = 0;
    let expectEtag = null;
    if (fs.existsSync(partPath) && fs.existsSync(metaPath)) {
      try { expectEtag = JSON.parse(fs.readFileSync(metaPath, 'utf8')).etag || null; } catch { /* treat as fresh */ }
      if (expectEtag) startAt = fs.statSync(partPath).size;
    }
    const headers = { 'user-agent': 'bazinga' };
    if (startAt > 0) headers.range = `bytes=${startAt}-`;
    const res = await fetchImpl(url, { headers, signal: ctrl.signal });
    if (!res.ok && res.status !== 206) { await res.body?.cancel?.().catch(() => {}); throw new Error(`download failed: HTTP ${res.status}`); }
    const etag = res.headers.get('etag');
    const resumed = res.status === 206 && startAt > 0 && etag && etag === expectEtag;
    if (!resumed && startAt > 0) startAt = 0; // the file on the server moved on - start over instead of corrupting the resume
    fs.writeFileSync(metaPath, JSON.stringify({ etag: etag || null }));
    const total = sizeBytes || Number(res.headers.get('content-length')) + (resumed ? startAt : 0) || 0;
    const out = fs.createWriteStream(partPath, { flags: resumed ? 'a' : 'w' });
    const hash = sha256 ? crypto.createHash('sha256') : null;
    if (hash && resumed && startAt > 0) { hash.update(fs.readFileSync(partPath)); } // re-hash the part we already had, once, before appending more
    let got = resumed ? startAt : 0;
    try {
      for await (const chunk of res.body) {
        got += chunk.length;
        out.write(chunk);
        if (hash) hash.update(chunk);
        if (onProgress) onProgress({ bytesDownloaded: got, totalBytes: total });
      }
    } finally {
      await new Promise((r) => out.end(r));
    }
    if (hash) {
      const digest = hash.digest('hex');
      if (digest !== sha256) { fs.rmSync(partPath, { force: true }); fs.rmSync(metaPath, { force: true }); throw new Error(`checksum mismatch for ${file}: expected ${sha256}, got ${digest}`); }
    }
    fs.renameSync(partPath, destPath);
    fs.rmSync(metaPath, { force: true });
    const manifest = readManifest(modelsDir);
    manifest[id] = { id, repo, file, path: destPath, size: got, sha256: sha256 || null, downloadedAt: new Date().toISOString() };
    writeManifest(modelsDir, manifest);
    return manifest[id];
  } finally {
    downloads.delete(id);
  }
}

module.exports = { list, remove, searchHub, listRepoFiles, download, cancel, diskSpaceOk, idOf, manifestPath };
