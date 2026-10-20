'use strict';
const path = require('node:path');

/** Most recent first, no duplicates (compared case-insensitively on Windows/macOS-style paths too), capped. */
function addRecent(list, dir, max = 12) {
  const key = (p) => path.resolve(p).toLowerCase();
  const out = [dir, ...(Array.isArray(list) ? list : []).filter((p) => typeof p === 'string' && key(p) !== key(dir))];
  return out.slice(0, max);
}

/** Drop folders that no longer exist; `exists` is injected so this stays testable. */
function pruneRecent(list, exists) {
  return (Array.isArray(list) ? list : []).filter((p) => { try { return exists(p); } catch { return false; } });
}

module.exports = { addRecent, pruneRecent };
