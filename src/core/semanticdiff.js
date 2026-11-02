'use strict';
/**
 * Semantic diff: turns two flat symbol lists (classes/methods/functions - the shape treesitter.symbols() and
 * symbols.findSymbols() both return: {name, kind, line, endLine}) plus the two file contents into a short list of
 * what happened to each symbol - added, removed, renamed, moved or changed - instead of raw line deletes and inserts.
 * Pure and synchronous; extracting the symbols (parsing) is the caller's job, so this has no parser dependency.
 *
 * Rename detection is deliberately conservative: a symbol only counts as renamed when its body is identical once
 * every whole-word occurrence of its own name is blanked out on both sides. A rename that also changes behaviour
 * falls through to a plain removed+added pair instead of a wrong "just a rename" claim.
 */

const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
const bodyOf = (lines, sym) => norm(lines.slice(sym.line - 1, sym.endLine).join('\n'));
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const withNamePlaceholder = (body, name) => body.replace(new RegExp(`\\b${escapeRe(name)}\\b`, 'g'), '\u0000');

/**
 * @param {string} oldContent
 * @param {string} newContent
 * @param {Array<{name:string,kind:string,line:number,endLine:number}>} oldSymbols
 * @param {Array<{name:string,kind:string,line:number,endLine:number}>} newSymbols
 * @returns {Array<{type:'added'|'removed'|'modified'|'renamed'|'moved', kind:string, name:string, newName?:string, oldLine?:number, newLine?:number}>}
 *   sorted by where the change sits in the file (old line, else new line for pure additions)
 */
function diffSymbols(oldContent, newContent, oldSymbols, newSymbols) {
  const oldLines = String(oldContent).split('\n');
  const newLines = String(newContent).split('\n');
  const key = (s) => `${s.kind}\u0000${s.name}`;
  const oldByKey = new Map((oldSymbols || []).map((s) => [key(s), s]));
  const newByKey = new Map((newSymbols || []).map((s) => [key(s), s]));
  const usedOld = new Set();
  const usedNew = new Set();
  const changes = [];

  // same kind + name on both sides: unchanged, moved, or modified in place
  for (const [k, os] of oldByKey) {
    const ns = newByKey.get(k);
    if (!ns) continue;
    usedOld.add(os); usedNew.add(ns);
    const sameBody = bodyOf(oldLines, os) === bodyOf(newLines, ns);
    if (sameBody && os.line === ns.line) continue; // nothing worth reporting
    changes.push(sameBody
      ? { type: 'moved', kind: os.kind, name: os.name, oldLine: os.line, newLine: ns.line }
      : { type: 'modified', kind: os.kind, name: os.name, oldLine: os.line, newLine: ns.line });
  }

  // what is left: try to pair a removed symbol with an added one of the same kind and (modulo its own name) the same body
  const leftoverOld = (oldSymbols || []).filter((s) => !usedOld.has(s));
  const leftoverNew = (newSymbols || []).filter((s) => !usedNew.has(s));
  for (const os of leftoverOld) {
    const oldBody = withNamePlaceholder(bodyOf(oldLines, os), os.name);
    const match = leftoverNew.find((ns) => !usedNew.has(ns) && ns.kind === os.kind && ns.name !== os.name
      && oldBody === withNamePlaceholder(bodyOf(newLines, ns), ns.name));
    if (match) {
      usedOld.add(os); usedNew.add(match);
      changes.push({ type: 'renamed', kind: os.kind, name: os.name, newName: match.name, oldLine: os.line, newLine: match.line });
    }
  }

  for (const os of (oldSymbols || [])) if (!usedOld.has(os)) changes.push({ type: 'removed', kind: os.kind, name: os.name, oldLine: os.line });
  for (const ns of (newSymbols || [])) if (!usedNew.has(ns)) changes.push({ type: 'added', kind: ns.kind, name: ns.name, newLine: ns.line });

  return changes.sort((a, b) => (a.oldLine ?? a.newLine ?? 0) - (b.oldLine ?? b.newLine ?? 0));
}

/** Same blanked-own-name body key diffSymbols() uses to pair a rename within one file - exposed so a caller can
 * pair leftover 'removed'/'added' symbols across *different* files (see crossFileMoves). */
function renameKey(content, sym) {
  return withNamePlaceholder(bodyOf(String(content).split('\n'), sym), sym.name);
}

/**
 * Pairs symbols diffSymbols() reported as 'removed' in one file with ones it reported as 'added' in another -
 * a function cut from one file and pasted into another, same name ('moved') or a new one ('renamed'). Same-file
 * pairing is diffSymbols()'s own job (it already saw both sides there); this only looks across files, so it never
 * re-litigates a within-file case diffSymbols left as plain removed+added on purpose (e.g. an ambiguous match).
 * @param {Array<{path:string, sym:object, content:string}>} removals
 * @param {Array<{path:string, sym:object, content:string}>} additions
 */
function crossFileMoves(removals, additions) {
  const usedAdd = new Set();
  const out = [];
  for (const r of removals || []) {
    const rKey = renameKey(r.content, r.sym);
    const match = (additions || []).find((a) => !usedAdd.has(a) && a.path !== r.path && a.sym.kind === r.sym.kind && renameKey(a.content, a.sym) === rKey);
    if (!match) continue;
    usedAdd.add(match);
    out.push({
      type: match.sym.name === r.sym.name ? 'moved' : 'renamed',
      kind: r.sym.kind, name: r.sym.name, ...(match.sym.name !== r.sym.name ? { newName: match.sym.name } : {}),
      fromPath: r.path, toPath: match.path, oldLine: r.sym.line, newLine: match.sym.line,
    });
  }
  return out;
}

/** One line per change, for the AI review prompt - capped so a huge run never blows the prompt budget. */
function summarizeSymbolChanges(changes, max = 50) {
  const describe = (c) => {
    const where = c.fromPath ? `${c.fromPath} → ${c.toPath}` : c.path;
    if (c.type === 'renamed') return `renamed ${c.kind} ${c.name} → ${c.newName} (${where})`;
    if (c.type === 'moved') return `moved ${c.kind} ${c.name} (${where})`;
    if (c.type === 'modified') return `changed ${c.kind} ${c.name} (${where})`;
    if (c.type === 'added') return `added ${c.kind} ${c.name} (${where})`;
    if (c.type === 'removed') return `removed ${c.kind} ${c.name} (${where})`;
    return `${c.type} ${c.kind} ${c.name} (${where})`;
  };
  const list = (changes || []).slice(0, max);
  return list.map(describe).join('\n') + ((changes || []).length > max ? `\n[${changes.length - max} more symbol changes omitted]` : '');
}

module.exports = { diffSymbols, renameKey, crossFileMoves, summarizeSymbolChanges };
