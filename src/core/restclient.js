'use strict';
const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');

const ideDir = (root) => path.join(root, '.ide');
const collectionFile = (root) => path.join(ideDir(root), 'requests.yaml');

/**
 * Fires one HTTP request. Never throws/rejects - network failure, a bad URL, or a timeout all come back
 * as { ok: false, error } so the renderer never needs its own try/catch around this.
 * -> { ok: true, status, statusText, headers, body, timeMs } | { ok: false, error, timeMs }
 */
async function send({ method, url, headers, body } = {}, timeoutMs = 20000) {
  const u = String(url || '');
  if (!/^https?:\/\//i.test(u)) return { ok: false, error: 'URL must start with http:// or https://' };
  const m = String(method || 'GET').toUpperCase();
  const started = Date.now();
  try {
    const res = await fetch(u, {
      method: m,
      headers: headers && typeof headers === 'object' ? headers : undefined,
      body: !/^(GET|HEAD)$/.test(m) && body ? body : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    const outHeaders = {};
    for (const [k, v] of res.headers) outHeaders[k] = v;
    return { ok: true, status: res.status, statusText: res.statusText, headers: outHeaders, body: text, timeMs: Date.now() - started };
  } catch (e) {
    const timedOut = e.name === 'TimeoutError' || e.name === 'AbortError';
    return { ok: false, error: timedOut ? `Timed out after ${timeoutMs}ms` : String((e && e.message) || e), timeMs: Date.now() - started };
  }
}

function normalizeRequests(requests) {
  return (Array.isArray(requests) ? requests : []).filter((r) => r && r.name && r.url).map((r) => ({
    name: String(r.name),
    method: String(r.method || 'GET').toUpperCase(),
    url: String(r.url),
    headers: r.headers && typeof r.headers === 'object' ? r.headers : {},
    body: r.body ? String(r.body) : '',
  }));
}

/**
 * Saved requests live in .ide/requests.yaml (an array of {name, method, url, headers, body}) - a
 * project-level, git-shareable collection file, the same precedent as .ide/scripts.yaml/.ide/checks.yaml
 * already being checked in.
 */
function loadCollection(root) {
  let text;
  try { text = fs.readFileSync(collectionFile(root), 'utf8'); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  let doc;
  try { doc = YAML.parse(text); } catch (e) { throw new Error(`Invalid YAML in .ide/requests.yaml: ${e.message}`); }
  return normalizeRequests(Array.isArray(doc) ? doc : doc && doc.requests);
}

function saveCollection(root, requests) {
  const list = normalizeRequests(requests);
  fs.mkdirSync(ideDir(root), { recursive: true });
  fs.writeFileSync(collectionFile(root), YAML.stringify({ requests: list }), 'utf8');
  return { saved: list.length };
}

module.exports = { send, loadCollection, saveCollection };
