'use strict';
/**
 * Every network call in this codebase goes through here instead of calling fetch() directly (enforced by
 * eslint's no-restricted-syntax rule for a bare `fetch(...)` call - see eslint.config.js).
 *
 * Why: a Chromium bug (crbug 378822137) leaks a file descriptor for every fetch() whose response body is
 * never read - with cache: 'no-store' and a non-empty body, the leak is permanent until the process restarts,
 * so a long-running renderer (or, here, the main process - it embeds the same //net stack) slowly exhausts
 * its fd table and freezes after days of uptime. The fix has nothing to do with *what* the body contains:
 * it is "always call a body-reading method, on every response, before deciding what the caller does with it" -
 * the leak only happens on the paths that check `res.ok` and return/throw *before* touching the body at all.
 *
 * `fetchImpl` defaults to the global fetch but stays overridable so call sites that already accept an
 * injected fetch-like function for tests (jira.js, skillsearch.js) can keep doing so unchanged - the
 * consumption guarantee lives here regardless of what actually performs the request.
 */

/** Best-effort: leaves nothing dangling when the read itself threw before finishing (e.g. invalid JSON, an abort mid-stream). */
async function drain(res) {
  if (!res || !res.body || res.bodyUsed) return;
  try { await res.body.cancel(); } catch { /* already closed/cancelled by the runtime - nothing left to leak */ }
}

/**
 * @param {string} url
 * @param {object} [init] - standard fetch init
 * @param {'json'|'text'|'arrayBuffer'|'blob'|'none'} [read] - 'none' drains the body without parsing it (fire-and-forget calls)
 * @param {typeof fetch} [fetchImpl]
 * -> { res, body } for ANY response, 2xx or not - the caller decides what counts as an error, same as before
 */
async function safeFetch(url, init, read = 'json', fetchImpl = fetch) {
  const res = await fetchImpl(url, init);
  if (read === 'none') { await drain(res); return { res, body: undefined }; }
  try {
    const body = await res[read]();
    return { res, body };
  } catch (err) {
    await drain(res);
    throw err;
  }
}

module.exports = { safeFetch, drain };
