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

module.exports = { diffSymbols };
