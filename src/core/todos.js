'use strict';
const { search } = require('./search');

const TAG_RE = /\b(TODO|FIXME|HACK|XXX)\b:?\s*(.*)$/i;

/**
 * Project-wide TODO/FIXME/HACK/XXX comments, reusing the same ripgrep-first/JS-fallback engine as the
 * Search panel (core/search.js) rather than a separate file walker.
 * -> { items: [{ tag, file, line, column, text }], truncated } | { error }
 */
async function scan(root) {
  const res = await search(root, { query: '\\b(TODO|FIXME|HACK|XXX)\\b', regex: true, caseSensitive: false }, 2000);
  if (res.error) return res;
  const items = [];
  for (const r of res.results) {
    const m = TAG_RE.exec(r.text);
    if (!m) continue;
    items.push({ tag: m[1].toUpperCase(), file: r.file, line: r.line, column: r.column, text: m[2].trim() || r.text });
  }
  return { items, truncated: res.truncated };
}

module.exports = { scan };
