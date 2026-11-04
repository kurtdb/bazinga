'use strict';
/**
 * Workspace-wide symbol index: every class/method/function name in the project, searchable without a language
 * server. Built from the same parser (tree-sitter, falling back to line patterns) the symbol lenses and semantic
 * diff already use; re-parses a file only when its size or mtime changed, same caching idiom as UsageIndex. Backs
 * "Go to symbol in workspace" (quick open); the renderer fuzzy-filters the flat list client-side, same as the
 * existing file list, rather than a server round-trip per keystroke. No background daemon: built on first use.
 */
const fs = require('node:fs');
const path = require('node:path');
const { toPosix } = require('./util');

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_FILES = 8000;

class SymbolIndex {
  /**
   * @param {string} root
   * @param {() => Promise<string[]>} listFiles  project files, relative, honouring .gitignore (git.projectFiles)
   * @param {(rel:string, content:string) => Promise<Array|null>} symbolsOf  tree-sitter (preferred) or line-pattern parser; null/[] for an unsupported language
   */
  constructor(root, listFiles, symbolsOf) {
    this.root = root;
    this.listFiles = listFiles;
    this.symbolsOf = symbolsOf;
    this.files = new Map(); // rel -> { sig, symbols }
    this.building = null;
    this.stale = true;
  }

  /** Call when files changed on disk: the next refresh() re-checks them. */
  invalidate() { this.stale = true; }

  async refresh() {
    if (this.building) return this.building;
    if (!this.stale && this.files.size) return undefined;
    this.building = (async () => {
      this.stale = false;
      const list = (await this.listFiles()).slice(0, MAX_FILES);
      const keep = new Set(list);
      for (const rel of [...this.files.keys()]) if (!keep.has(rel)) this.files.delete(rel);
      let n = 0;
      for (const rel of list) {
        try {
          const abs = path.join(this.root, rel);
          const st = fs.statSync(abs);
          if (!st.isFile() || st.size > MAX_BYTES) { this.files.delete(rel); continue; }
          const sig = `${st.size}:${st.mtimeMs}`;
          const old = this.files.get(rel);
          if (old && old.sig === sig) continue;
          const content = fs.readFileSync(abs, 'utf8');
          const syms = (await this.symbolsOf(rel, content)) || [];
          if (syms.length) this.files.set(rel, { sig, symbols: syms }); else this.files.delete(rel);
        } catch { this.files.delete(rel); }
        if (++n % 200 === 0) await new Promise((r) => setImmediate(r)); // let the app breathe on big projects
      }
    })().finally(() => { this.building = null; });
    return this.building;
  }

  /** Every symbol in the project, flattened with its file. */
  all() {
    const out = [];
    for (const [rel, { symbols }] of this.files) for (const s of symbols) out.push({ name: s.name, kind: s.kind, line: s.line, rel: toPosix(rel) });
    return out;
  }
}

module.exports = { SymbolIndex };
