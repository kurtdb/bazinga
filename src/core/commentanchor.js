'use strict';
/**
 * Pending review comments are saved with the line number and the text of that line. When the project is opened again the
 * file may have changed meanwhile (the agent kept working), so each comment is attached to the nearest line that still
 * has the same text; when no such line exists the comment is dropped rather than pinned to unrelated code.
 */
function anchorLine(fileText, { line, code }) {
  const lines = String(fileText).split(/\r?\n/);
  const want = String(code === undefined || code === null ? '' : code).trim();
  const at = (n) => (n >= 1 && n <= lines.length ? lines[n - 1].trim() : null);
  if (!want) return at(line) === '' ? line : null; // a blank line carries no identity: only the same place counts
  if (at(line) === want) return line;
  let best = null;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== want) continue;
    const d = Math.abs(i + 1 - line);
    if (best === null || d < best.d) best = { n: i + 1, d };
  }
  return best ? best.n : null;
}

/** Keep valid entries only and return them with their new line numbers; `read(rel)` returns the file text or null. */
function anchorAll(comments, read) {
  const out = [];
  const cache = new Map();
  for (const c of Array.isArray(comments) ? comments : []) {
    if (!c || typeof c.rel !== 'string' || typeof c.text !== 'string' || !c.text.trim() || !Number.isInteger(c.line)) continue;
    if (!cache.has(c.rel)) { let t = null; try { t = read(c.rel); } catch { t = null; } cache.set(c.rel, t); }
    const text = cache.get(c.rel);
    if (text === null || text === undefined) continue;
    const line = anchorLine(text, c);
    if (line) out.push({ rel: c.rel, line, text: c.text.trim() });
  }
  return out;
}

module.exports = { anchorLine, anchorAll };
