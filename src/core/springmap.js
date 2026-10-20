'use strict';
/**
 * Spring awareness without a language server: HTTP endpoints, @Bean methods, stereotype classes and
 * "who implements / extends this type" for Java and Kotlin sources. Text patterns, no parser: unusual formatting is
 * missed rather than mis-reported, and everything here says "found by pattern".
 */
const fs = require('node:fs');
const path = require('node:path');

const JVM = /\.(java|kt)$/i;
const MAX_BYTES = 400 * 1024;
const MAPPING = { GetMapping: 'GET', PostMapping: 'POST', PutMapping: 'PUT', DeleteMapping: 'DELETE', PatchMapping: 'PATCH', RequestMapping: null };
const STEREOTYPES = ['RestController', 'Controller', 'Service', 'Repository', 'Component', 'Configuration', 'ControllerAdvice', 'RestControllerAdvice'];

/** The text of an annotation starting at line i (parentheses may span lines). */
function annotationText(lines, i) {
  let text = lines[i]; let depth = 0; let k = i;
  const count = (s) => { for (const ch of s.replace(/"(?:\\.|[^"\\])*"/g, '""')) { if (ch === '(') depth++; else if (ch === ')') depth--; } };
  count(text);
  while (depth > 0 && k < lines.length - 1 && k - i < 12) { k++; text += ` ${lines[k].trim()}`; count(lines[k]); }
  return { text, end: k };
}

function joinPath(base, p) {
  const parts = `${base || ''}/${p || ''}`.split('/').filter(Boolean);
  return `/${parts.join('/')}`;
}

function paths(args) {
  // value = "x" | path = {"a","b"} | "x" (positional); only string literals before `method =` etc. count
  const m = /(?:\b(?:value|path)\s*=\s*)?(\{[^}]*\}|"(?:\\.|[^"\\])*")/.exec(args);
  if (!m) return [''];
  const found = [...m[1].matchAll(/"((?:\\.|[^"\\])*)"/g)].map((x) => x[1]);
  return found.length ? found : [''];
}

function methodsOf(name, args) {
  if (MAPPING[name]) return [MAPPING[name]];
  const m = /\bmethod\s*=\s*(\{[^}]*\}|[\w.]+)/.exec(args);
  if (!m) return ['ANY'];
  return [...m[1].matchAll(/\b(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\b/g)].map((x) => x[1]);
}

/** Scan one file. Line numbers are 1-based. */
function scanFile(rel, content) {
  const lines = String(content).split('\n');
  const kotlin = /\.kt$/i.test(rel);
  const out = { endpoints: [], beans: [], components: [], types: [] };
  let pending = []; // annotations seen since the last declaration: [{name, args, line}]
  let classBase = ''; let classAnns = []; let classSeen = false;
  const typeRe = kotlin
    ? /^\s*(?:(?:public|internal|private|protected|abstract|open|data|sealed|final|enum|annotation|inner)\s+)*(class|interface|object)\s+(\w+)(.*)$/
    : /^\s*(?:(?:public|protected|private|abstract|final|static|sealed|non-sealed|strictfp)\s+)*(class|interface|enum|record)\s+(\w+)(.*)$/;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*(\/\/|\*|\/\*)/.test(l)) continue;
    let decl = l; let isAnn = false;
    for (let a; (a = /^\s*@(\w+)/.exec(decl)) && a[1] !== 'interface';) {
      isAnn = true;
      const { text, end } = annotationText(lines, i);
      // split `@Name(args) rest` with balanced parentheses (the text may be a joined multi-line annotation)
      const after = text.slice(text.indexOf(`@${a[1]}`) + a[1].length + 1);
      let args = ''; let rest = after;
      if (/^\s*\(/.test(after)) {
        let depth = 0; let k = after.indexOf('('); const st = k; let inStr = false;
        for (; k < after.length; k++) {
          const ch = after[k];
          if (ch === '"' && after[k - 1] !== '\\') inStr = !inStr;
          if (inStr) continue;
          if (ch === '(') depth++; else if (ch === ')' && --depth === 0) break;
        }
        args = after.slice(st + 1, k); rest = after.slice(k + 1);
      }
      pending.push({ name: a[1], args, line: i + 1 });
      if (end > i) { lines[end] = rest; i = end; }
      decl = rest.trim() ? rest : '';
      if (!decl) break;
    }
    if (isAnn && !decl.trim()) continue;
    const t = typeRe.exec(decl);
    if (t) {
      const [, kind, name, tail] = t;
      let ext = null; const impl = [];
      const next = lines[i + 1] || '';
      const more = !decl.includes('{') && (/,\s*$/.test(tail) || /^\s*(extends|implements|permits|:)/.test(next));
      const head = `${tail}${more ? ` ${next}` : ''}`.split('{')[0];
      if (kotlin) {
        const colon = /:\s*([^{]*)$/.exec(head.replace(/\([^)]*\)/g, ''));
        if (colon) for (const part of colon[1].split(',')) { const n = /([A-Za-z_][\w.]*)/.exec(part.trim()); if (n) impl.push(n[1].split('.').pop()); }
      } else {
        const e = /\bextends\s+([\w.,<>\s?]+?)(?=\s+implements\b|\s+permits\b|\s*$)/.exec(head);
        if (e) { const names = e[1].split(',').map((x) => x.trim().replace(/<.*$/, '').split('.').pop()).filter(Boolean); if (kind === 'interface') impl.push(...names); else ext = names[0] || null; }
        const im = /\bimplements\s+([\w.,<>\s?]+?)(?=\s+permits\b|\s*$)/.exec(head);
        if (im) impl.push(...im[1].split(',').map((x) => x.trim().replace(/<.*$/, '').split('.').pop()).filter(Boolean));
      }
      if (ext) impl.push(ext);
      out.types.push({ name, kind, line: i + 1, supers: [...new Set(impl)] });
      const st = pending.find((p) => STEREOTYPES.includes(p.name));
      if (st) out.components.push({ name, stereotype: st.name, line: i + 1 });
      if (!classSeen) {
        classSeen = true; classAnns = pending;
        const rm = pending.find((p) => p.name === 'RequestMapping');
        classBase = rm ? paths(rm.args)[0] : '';
      }
      pending = [];
      continue;
    }
    // a method: annotations pending + a line with name(
    const mm = kotlin ? /\bfun\s+(?:<[^>]+>\s+)?(?:[\w.<>?]+\.)?(\w+)\s*\(/.exec(decl) : /^\s*(?:(?:public|protected|private|static|final|abstract|synchronized|default)\s+)*(?:<[^>]+>\s+)?([\w$<>\[\],.?\s]+?)\s+(\w+)\s*\(/.exec(decl);
    if (mm && pending.length) {
      const name = kotlin ? mm[1] : mm[2];
      const retType = kotlin ? ((/\)\s*:\s*([\w.<>?]+)/.exec(decl) || [])[1] || '') : mm[1].trim().split(/\s+/).pop().replace(/<.*$/, '');
      for (const p of pending) {
        if (p.name in MAPPING) {
          for (const mth of methodsOf(p.name, p.args)) for (const sub of paths(p.args)) out.endpoints.push({ method: mth, path: joinPath(classBase, sub), line: i + 1, handler: name, annotationLine: p.line });
        } else if (p.name === 'Bean') {
          const nm = /\b(?:name|value)\s*=\s*"([^"]+)"|^\s*"([^"]+)"/.exec(p.args);
          out.beans.push({ name: (nm && (nm[1] || nm[2])) || name, method: name, type: retType, line: i + 1 });
        }
      }
      pending = [];
      continue;
    }
    if (l.trim() && !/^\s*(@|\)|\{|\})/.test(l) && !/^\s*(package|import)\b/.test(l)) pending = [];
  }
  void classAnns;
  return out;
}

class SpringIndex {
  constructor(root, listFiles) { this.root = root; this.listFiles = listFiles; this.files = new Map(); this.stale = true; this.building = null; }
  invalidate() { this.stale = true; }
  async refresh() {
    if (this.building) return this.building;
    if (!this.stale && this.files.size) return undefined;
    this.building = (async () => {
      this.stale = false;
      const list = (await this.listFiles()).filter((f) => JVM.test(f)).slice(0, 8000);
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
          this.files.set(rel, { sig, scan: scanFile(rel, fs.readFileSync(path.join(this.root, rel), 'utf8')) });
        } catch { this.files.delete(rel); }
        if (++n % 200 === 0) await new Promise((r) => setImmediate(r));
      }
    })().finally(() => { this.building = null; });
    return this.building;
  }

  overview() {
    const endpoints = []; const beans = []; const components = [];
    for (const [file, { scan }] of this.files) {
      for (const e of scan.endpoints) endpoints.push({ ...e, file });
      for (const b of scan.beans) beans.push({ ...b, file });
      for (const c of scan.components) components.push({ ...c, file });
    }
    const by = (a, b) => (a.file + String(a.line).padStart(6, '0')).localeCompare(b.file + String(b.line).padStart(6, '0'));
    endpoints.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
    return { endpoints, beans: beans.sort(by), components: components.sort(by) };
  }

  /** Types that implement or extend `name` (by simple name; same-named types elsewhere are included). */
  implementations(name) {
    const out = [];
    for (const [file, { scan }] of this.files) for (const t of scan.types) if (t.name !== name && t.supers.includes(name)) out.push({ name: t.name, kind: t.kind, file, line: t.line });
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** What a file has for the lenses: endpoints by handler line, and for each type its implementations. */
  lensInfo(rel) {
    const f = this.files.get(rel);
    if (!f) return { endpoints: [], impls: {} };
    const impls = {};
    for (const t of f.scan.types) { const list = this.implementations(t.name); if (list.length) impls[t.line] = { name: t.name, kind: t.kind, list: list.slice(0, 30), total: list.length }; }
    return { endpoints: f.scan.endpoints, impls };
  }
}

module.exports = { scanFile, SpringIndex, joinPath };
