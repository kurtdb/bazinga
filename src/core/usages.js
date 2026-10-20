'use strict';
/**
 * "How often is this name used in the project?" without a language server: every identifier of every code file is
 * counted once (re-read only when a file's size or mtime changed), then any name is a map lookup.
 * It counts the name wherever it appears (also in comments and in unrelated classes that use the same name), so the
 * number is an approximation: the UI shows it as "≈ N usages" when it cannot be sure.
 */
const fs = require('node:fs');
const path = require('node:path');
const { toPosix } = require('./util');

const CODE = /\.(java|kt|kts|js|jsx|mjs|cjs|ts|tsx|py|vue|svelte|cs|go|rb|php|rs|scala|groovy|swift|c|h|cpp|hpp)$/i;
const MAX_BYTES = 400 * 1024;
const MAX_FILES = 8000;

/** Count identifiers in text -> Map(name -> count). Names shorter than 2 characters are not worth indexing. */
function countIdentifiers(text) {
  const counts = new Map();
  const re = /[A-Za-z_$][\w$]*/g;
  let m;
  while ((m = re.exec(text))) { if (m[0].length > 1) counts.set(m[0], (counts.get(m[0]) || 0) + 1); }
  return counts;
}

class UsageIndex {
  /** listFiles(): Promise<string[]> relative paths of the project files (git's list, honouring .gitignore) */
  constructor(root, listFiles) {
    this.root = root;
    this.listFiles = listFiles;
    this.files = new Map(); // rel -> { sig, counts }
    this.building = null;
    this.stale = true;
  }

  /** Call when files changed on disk: the next query re-checks them. */
  invalidate() { this.stale = true; }

  async refresh() {
    if (this.building) return this.building;
    if (!this.stale && this.files.size) return undefined;
    this.building = (async () => {
      this.stale = false;
      const list = (await this.listFiles()).filter((f) => CODE.test(f)).slice(0, MAX_FILES);
      const keep = new Set(list);
      for (const rel of [...this.files.keys()]) if (!keep.has(rel)) this.files.delete(rel);
      let n = 0;
      for (const rel of list) {
        try {
          const st = fs.statSync(path.join(this.root, rel));
          if (!st.isFile() || st.size > MAX_BYTES) { this.files.delete(rel); continue; }
          const sig = `${st.size}:${st.mtimeMs}`;
          const old = this.files.get(rel);
          if (old && old.sig === sig) continue;
          this.files.set(rel, { sig, counts: countIdentifiers(fs.readFileSync(path.join(this.root, rel), 'utf8')) });
        } catch { this.files.delete(rel); }
        if (++n % 200 === 0) await new Promise((r) => setImmediate(r)); // let the app breathe on big projects
      }
    })().finally(() => { this.building = null; });
    return this.building;
  }

  /**
   * Uses of `name` outside its own declaration. `exact` is false because the count is by name only.
   * @returns {{ count: number, files: number, exact: false }}
   */
  usages(name, { declarations = 1 } = {}) {
    let total = 0; let files = 0;
    for (const { counts } of this.files.values()) {
      const c = counts.get(name);
      if (c) { total += c; files++; }
    }
    return { count: Math.max(0, total - declarations), files, exact: false };
  }
}

module.exports = { UsageIndex, countIdentifiers, CODE, toPosix };
