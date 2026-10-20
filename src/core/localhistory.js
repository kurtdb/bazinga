'use strict';
/**
 * Local history: a snapshot of a file every time its content changes (saved in the IDE, or changed on disk by an agent),
 * kept outside the project, so a file an agent overwrote can be brought back even if it was never committed.
 * Layout:  <dir>/<hash of project root>/<hash of file path>/<time>-<content hash>.snap  (+ meta.json with the readable names)
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { toPosix } = require('./util');

const sha = (s, n = 16) => crypto.createHash('sha1').update(s).digest('hex').slice(0, n);
const ID_RE = /^\d{10,}-[0-9a-f]{8}$/;

class LocalHistory {
  constructor(dir, { maxPerFile = 60, maxAgeDays = 30, maxFileBytes = 1024 * 1024, maxTotalBytes = 200 * 1024 * 1024, now = Date.now } = {}) {
    Object.assign(this, { dir, maxPerFile, maxAgeMs: maxAgeDays * 86400000, maxFileBytes, maxTotalBytes, now });
  }

  folder(root, rel) { return path.join(this.dir, sha(path.resolve(root)), sha(toPosix(rel))); }

  _entries(folder) {
    let names = [];
    try { names = fs.readdirSync(folder); } catch { return []; }
    return names.filter((n) => n.endsWith('.snap') && ID_RE.test(n.slice(0, -5))).sort().map((n) => n.slice(0, -5));
  }

  /** Snapshot `content` unless it equals the newest snapshot. Binary and large files are not kept. @returns {{ saved: boolean, id?: string, reason?: string }} */
  record(root, rel, content, { label = '', time } = {}) {
    const text = String(content);
    const bytes = Buffer.byteLength(text);
    if (bytes > this.maxFileBytes) return { saved: false, reason: 'too large' };
    if (text.slice(0, 8000).includes('\0')) return { saved: false, reason: 'binary' };
    const folder = this.folder(root, rel);
    const hash = sha(text, 8);
    const ids = this._entries(folder);
    if (ids.length && ids[ids.length - 1].endsWith(`-${hash}`)) return { saved: false, reason: 'unchanged' };
    fs.mkdirSync(folder, { recursive: true });
    const metaFile = path.join(folder, 'meta.json');
    let meta = { rel: toPosix(rel), root: path.resolve(root), labels: {} };
    try { meta = { ...meta, ...JSON.parse(fs.readFileSync(metaFile, 'utf8')) }; } catch { /* first snapshot */ }
    let t = time || this.now();
    if (ids.length) t = Math.max(t, Number(ids[ids.length - 1].split('-')[0]) + 1); // ids stay ordered even when the clock stands still
    const id = `${String(t).padStart(13, '0')}-${hash}`;
    fs.writeFileSync(path.join(folder, `${id}.snap`), text);
    meta.labels[id] = String(label).slice(0, 60);
    fs.writeFileSync(metaFile, JSON.stringify(meta));
    this.prune(root, rel);
    return { saved: true, id };
  }

  /** Newest first: [{ id, time, size, label }] */
  list(root, rel) {
    const folder = this.folder(root, rel);
    let labels = {};
    try { labels = JSON.parse(fs.readFileSync(path.join(folder, 'meta.json'), 'utf8')).labels || {}; } catch { /* none */ }
    return this._entries(folder).reverse().map((id) => {
      let size = 0; try { size = fs.statSync(path.join(folder, `${id}.snap`)).size; } catch { /* gone */ }
      return { id, time: Number(id.split('-')[0]), size, label: labels[id] || '' };
    });
  }

  has(root, rel) { return this._entries(this.folder(root, rel)).length > 0; }

  read(root, rel, id) {
    if (!ID_RE.test(String(id))) throw new Error('Invalid history entry.');
    return fs.readFileSync(path.join(this.folder(root, rel), `${id}.snap`), 'utf8');
  }

  /** Drop snapshots older than the age limit (always keeping the newest) and beyond the per-file count. */
  prune(root, rel) {
    const folder = this.folder(root, rel);
    const ids = this._entries(folder);
    const cutoff = this.now() - this.maxAgeMs;
    ids.forEach((id, i) => {
      const isNewest = i === ids.length - 1;
      const tooOld = Number(id.split('-')[0]) < cutoff && !isNewest;
      const tooMany = i < ids.length - this.maxPerFile;
      if (tooOld || tooMany) { try { fs.rmSync(path.join(folder, `${id}.snap`)); } catch { /* gone */ } }
    });
  }

  /** Keep the whole store under maxTotalBytes by deleting the oldest snapshots first. Returns how many were removed. */
  pruneTotal() {
    const files = [];
    let total = 0;
    const walk = (d) => {
      let entries = [];
      try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.name.endsWith('.snap')) { const st = fs.statSync(full); total += st.size; files.push({ full, size: st.size, time: Number(e.name.split('-')[0]) }); }
      }
    };
    walk(this.dir);
    files.sort((a, b) => a.time - b.time);
    let removed = 0;
    for (const f of files) {
      if (total <= this.maxTotalBytes) break;
      try { fs.rmSync(f.full); total -= f.size; removed++; } catch { /* locked */ }
    }
    return removed;
  }
}

module.exports = { LocalHistory, ID_RE };
