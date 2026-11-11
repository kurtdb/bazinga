'use strict';
const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');

const ideDir = (root) => path.join(root, '.ide');
const collectionFile = (root) => path.join(ideDir(root), 'requests.yaml');

/** {{name}} tokens in the URL, headers, body and auth fields - left untouched (not blanked) when unset, so a typo or a missing environment is visible in the sent request rather than silently sending an empty string. */
function substitute(str, vars) {
  if (typeof str !== 'string' || !vars) return str;
  return str.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (whole, name) => (Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : whole));
}

function normalizeAuth(auth) {
  const type = auth && ['basic', 'bearer', 'apiKey'].includes(auth.type) ? auth.type : 'none';
  if (type === 'none') return { type: 'none' };
  if (type === 'basic') return { type, username: String(auth.username || ''), password: String(auth.password || '') };
  if (type === 'bearer') return { type, token: String(auth.token || '') };
  return { type, key: String(auth.key || ''), value: String(auth.value || ''), in: auth.in === 'query' ? 'query' : 'header' };
}

/** Computes the Authorization header/query param a request's auth config implies - not a real OAuth2 grant flow (no redirect listener, no token storage), just the same header-shorthand Basic/Bearer/API-key auth every HTTP client offers. */
function applyAuth(headers, url, auth) {
  const h = { ...(headers || {}) };
  if (!auth || auth.type === 'none') return { headers: h, url };
  if (auth.type === 'basic') { h.Authorization = `Basic ${Buffer.from(`${auth.username || ''}:${auth.password || ''}`).toString('base64')}`; return { headers: h, url }; }
  if (auth.type === 'bearer') { if (auth.token) h.Authorization = `Bearer ${auth.token}`; return { headers: h, url }; }
  if (auth.type === 'apiKey' && auth.key) {
    if (auth.in === 'query') {
      try { const u = new URL(url); u.searchParams.set(auth.key, auth.value || ''); return { headers: h, url: u.toString() }; } catch { /* invalid base URL - fetch reports it */ }
    } else h[auth.key] = auth.value || '';
  }
  return { headers: h, url };
}

/**
 * Fires one HTTP request. Never throws/rejects - network failure, a bad URL, or a timeout all come back
 * as { ok: false, error } so the renderer never needs its own try/catch around this.
 * `vars` is the active environment's variables (see environments.js); `auth` is a per-request auth helper
 * config (none/basic/bearer/apiKey) - both are resolved here, not in the renderer.
 * -> { ok: true, status, statusText, headers, body, timeMs } | { ok: false, error, timeMs }
 */
async function send({ method, url, headers, body, auth, vars } = {}, timeoutMs = 20000, signal) {
  const sub = (s) => substitute(s, vars);
  const u = sub(String(url || ''));
  if (!/^https?:\/\//i.test(u)) return { ok: false, error: 'URL must start with http:// or https://' };
  const m = String(method || 'GET').toUpperCase();
  const subHeaders = {};
  if (headers && typeof headers === 'object') for (const [k, v] of Object.entries(headers)) subHeaders[sub(k)] = sub(v);
  const subAuth = auth ? { ...auth, username: sub(auth.username), password: sub(auth.password), token: sub(auth.token), key: sub(auth.key), value: sub(auth.value) } : auth;
  const { headers: finalHeaders, url: finalUrl } = applyAuth(subHeaders, u, subAuth);
  const started = Date.now();
  try {
    const res = await fetch(finalUrl, {
      method: m,
      headers: finalHeaders,
      body: !/^(GET|HEAD)$/.test(m) && body ? sub(body) : undefined,
      signal: signal ? AbortSignal.any([AbortSignal.timeout(timeoutMs), signal]) : AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    const outHeaders = {};
    for (const [k, v] of res.headers) outHeaders[k] = v;
    return { ok: true, status: res.status, statusText: res.statusText, headers: outHeaders, body: text, timeMs: Date.now() - started };
  } catch (e) {
    // the timeout and a caller-triggered cancel both abort the same combined signal - only AbortSignal.timeout's
    // reason carries the TimeoutError name, so a plain AbortError here can only mean the caller cancelled it.
    const timedOut = e.name === 'TimeoutError';
    return { ok: false, error: timedOut ? `Timed out after ${timeoutMs}ms` : e.name === 'AbortError' ? 'Cancelled' : String((e && e.message) || e), timeMs: Date.now() - started };
  }
}

function normalizeRequests(requests) {
  return (Array.isArray(requests) ? requests : []).filter((r) => r && r.name && r.url).map((r) => ({
    name: String(r.name),
    method: String(r.method || 'GET').toUpperCase(),
    url: String(r.url),
    headers: r.headers && typeof r.headers === 'object' ? r.headers : {},
    body: r.body ? String(r.body) : '',
    folder: r.folder ? String(r.folder) : '',
    auth: normalizeAuth(r.auth),
  }));
}

/**
 * Saved requests live in .ide/requests.yaml (an array of {name, method, url, headers, body, folder, auth}) - a
 * project-level, git-shareable collection file, the same precedent as .ide/scripts.yaml/.ide/checks.yaml
 * already being checked in. `folder` is a plain string tag used to group the saved-requests list in the UI,
 * not a real nested-collections model - there is nothing to create or delete, a folder exists exactly as long
 * as some request names it.
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

module.exports = { send, loadCollection, saveCollection, substitute, normalizeAuth, applyAuth };
