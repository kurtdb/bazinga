'use strict';
/**
 * Searching the skills.sh directory. This is the public search endpoint the official `skills` CLI uses (`npx skills find`):
 *   GET https://skills.sh/api/search?q=<text>&limit=<n>[&owner=<github owner>]  ->  { skills: [{ id, name, source, installs }] }
 * (The documented /api/v1 endpoints need a Vercel token, which a desktop app does not have.) Nothing is installed here: a result only
 * names a GitHub repository, which then goes through the normal fetch, preview and confirm steps.
 */
const BASE = 'https://skills.sh';
const REPO_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
const clean = (s, n = 120) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

/** API body -> [{ name, slug, source, installs, installable, url }], most installed first. Entries without a name are dropped. */
function parse(body, base = BASE) {
  const list = Array.isArray(body && body.skills) ? body.skills : [];
  return list.map((s) => {
    const source = clean(s && s.source, 140);
    const id = clean(s && (s.id || s.slug), 200);
    const slug = id.includes('/') ? id.split('/').pop() : id;
    return { name: clean(s && s.name, 80), slug: clean(slug, 100), source, installs: Number.isFinite(Number(s && s.installs)) ? Number(s.installs) : 0, installable: REPO_RE.test(source), url: id ? `${base}/${id.split('/').map(encodeURIComponent).join('/')}` : base };
  }).filter((s) => s.name).sort((a, b) => b.installs - a.installs);
}

async function search(query, { owner = '', limit = 20, fetchFn = fetch, base = BASE } = {}) {
  const q = String(query || '').trim();
  if (q.length < 2) return { error: 'Type at least 2 characters.' };
  const params = new URLSearchParams({ q, limit: String(Math.min(50, Math.max(1, limit))) });
  if (/^[A-Za-z0-9-]{1,39}$/.test(String(owner || ''))) params.set('owner', owner);
  let res;
  try { res = await fetchFn(`${base}/api/search?${params}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) }); } catch (err) {
    const code = err && (err.cause && err.cause.code || err.code);
    return { error: code === 'ENOTFOUND' || code === 'EAI_AGAIN' ? 'skills.sh could not be reached. Check your network or proxy.' : `skills.sh could not be reached (${String((err && err.message) || err).slice(0, 100)}).` };
  }
  if (res.status === 429) return { error: 'skills.sh asks to slow down (429). Try again in a minute.' };
  if (!res.ok) return { error: `skills.sh answered with an error (${res.status}).` };
  let body;
  try { body = await res.json(); } catch { return { error: 'skills.sh answered with something that is not JSON.' }; }
  return { results: parse(body, base) };
}

module.exports = { search, parse, REPO_RE, BASE };
