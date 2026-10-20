'use strict';
/**
 * Classes, methods and functions of a source file, found with line patterns (no parser, no language server), plus what
 * the "usages" and "last change" lenses above them need. Good enough for the usual layouts of Java, Kotlin, TS/JS and
 * Python; unusual formatting is simply not recognised (no lens), never mis-reported.
 */
const path = require('node:path');
const { toPosix } = require('./util');

const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'new', 'else', 'throw', 'synchronized', 'function', 'try', 'do', 'await', 'typeof', 'super', 'this', 'when', 'with', 'elif', 'assert', 'in', 'is', 'not', 'and', 'or', 'lambda', 'yield', 'import', 'package']);
const MODS = '(?:(?:public|protected|private|internal|abstract|final|static|sealed|open|override|data|default|synchronized|native|suspend|inline|export|async|readonly|declare)\\s+)';
const LANG = { '.java': 'java', '.kt': 'java', '.kts': 'java', '.js': 'js', '.jsx': 'js', '.mjs': 'js', '.cjs': 'js', '.ts': 'js', '.tsx': 'js', '.py': 'py' };
const lang = (rel) => LANG[path.posix.extname(toPosix(rel)).toLowerCase()] || null;

/** Last line (1-based) of the block that starts at line `start` (1-based). Braces ignore strings and // comments roughly; Python uses indentation. */
function blockEnd(lines, start, kind) {
  if (kind === 'py') {
    const indent = (lines[start - 1].match(/^\s*/) || [''])[0].length;
    let end = start;
    for (let i = start; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      if ((lines[i].match(/^\s*/) || [''])[0].length <= indent) break;
      end = i + 1;
    }
    return end;
  }
  let depth = 0; let seen = false;
  for (let i = start - 1; i < lines.length; i++) {
    const code = lines[i].replace(/\/\/.*$/, '').replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g, '""');
    for (const ch of code) {
      if (ch === '{') { depth++; seen = true; } else if (ch === '}') depth--;
    }
    if (seen && depth <= 0) return i + 1;
    if (!seen && i > start + 8) return start; // no body (abstract / interface method / one-liner without braces)
  }
  return start;
}

/** @returns {Array<{ name: string, kind: 'class'|'method'|'function', line: number, endLine: number }>} */
function findSymbols(rel, content) {
  const kind = lang(rel);
  if (!kind) return [];
  const lines = String(content).split('\n');
  const out = [];
  const classNames = new Set();
  const add = (name, k, i) => { if (!KEYWORDS.has(name)) out.push({ name, kind: k, line: i + 1, endLine: blockEnd(lines, i + 1, kind) }); };

  if (kind === 'py') {
    lines.forEach((l, i) => {
      let m = /^(\s*)class\s+(\w+)/.exec(l);
      if (m) { add(m[2], 'class', i); return; }
      m = /^(\s*)(?:async\s+)?def\s+(\w+)\s*\(/.exec(l);
      if (m) add(m[2], m[1].length ? 'method' : 'function', i);
    });
    return out;
  }

  // classes first: constructors are recognised by the class name
  const classRe = new RegExp(`^\\s*${MODS}*(?:(?:case|annotation)\\s+)?(class|interface|enum|record|object|trait|type)\\s+(\\w+)`);
  lines.forEach((l, i) => { const m = classRe.exec(l); if (m && !/^\s*(\/\/|\*)/.test(l)) { classNames.add(m[2]); add(m[2], 'class', i); } });

  const javaMethod = new RegExp(`^\\s*(?:@\\w+(?:\\([^)]*\\))?\\s+)*${MODS}*(?:<[^>]+>\\s+)?[\\w$<>\\[\\],.?]+(?:\\s*<[^>]*>)?(?:\\[\\])*\\s+(\\w+)\\s*\\([^;]*$`);
  const javaCtor = new RegExp(`^\\s*${MODS}*(\\w+)\\s*\\(`);
  const kotlinFun = new RegExp(`^\\s*(?:@\\w+\\s+)*${MODS}*fun\\s+(?:<[^>]+>\\s+)?(?:[\\w.<>?]+\\.)?(\\w+)\\s*\\(`);
  const jsFunction = new RegExp(`^\\s*${MODS}*function\\*?\\s+(\\w+)\\s*[(<]`);
  const jsArrow = new RegExp(`^\\s*${MODS}*(?:const|let|var)\\s+(\\w+)\\s*(?::[^=]+)?=\\s*(?:async\\s*)?(?:function\\b|\\([^)]*\\)\\s*(?::[^=]+)?=>|\\w+\\s*=>)`);
  const jsMethod = new RegExp(`^\\s+${MODS}*(?:get\\s+|set\\s+)?(\\w+)\\s*\\([^)]*\\)\\s*(?::\\s*[^{]+)?\\{\\s*$`);

  lines.forEach((l, i) => {
    if (/^\s*(\/\/|\*|\/\*|#)/.test(l) || classRe.test(l)) return;
    let m;
    if (/\.(kt|kts)$/i.test(rel) && (m = kotlinFun.exec(l))) { add(m[1], 'method', i); return; }
    if (kind === 'js') {
      if ((m = jsFunction.exec(l))) { add(m[1], 'function', i); return; }
      if ((m = jsArrow.exec(l))) { add(m[1], 'function', i); return; }
      if (/^\s{1,}/.test(l) && (m = jsMethod.exec(l)) && !/^\s*(?:return|new)\b/.test(l)) { add(m[1], 'method', i); return; }
      return;
    }
    // Java: a line that starts a declaration (modifiers / type / name / "(") and does not end the statement
    const head = l.split('{')[0]; // a one-line method body may contain ';'
    if ((m = javaMethod.exec(head)) && !/^\s*(?:return|new|throw|else|case)\b/.test(l) && !/=\s*[^=]/.test(head.split('(')[0])) { add(m[1], 'method', i); return; }
    if ((m = javaCtor.exec(head)) && classNames.has(m[1]) && !/\bnew\b/.test(head) && !/\.\s*\w+\s*\(/.test(head.split('(')[0])) add(m[1], 'method', i);
  });
  return out.sort((a, b) => a.line - b.line);
}

/**
 * Newest change inside the symbol's lines. `blameLines` is history.blame() output.
 * @returns {{ author, time, sha, summary, uncommitted: boolean } | null}
 */
function symbolBlame(blameLines, sym) {
  let best = null; let uncommitted = false;
  for (const b of blameLines || []) {
    if (b.line < sym.line || b.line > sym.endLine) continue;
    if (!b.committed) { uncommitted = true; continue; }
    if (!best || b.time > best.time) best = b;
  }
  if (!best && !uncommitted) return null;
  return best ? { author: best.author, time: best.time, sha: best.sha, summary: best.summary, uncommitted } : { author: '', time: 0, sha: '', summary: '', uncommitted: true };
}

/** 0-based column of the declared name on its line (for asking a language server about it); -1 when not found. */
function nameColumn(lineText, name, kind) {
  const esc = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = kind === 'class' ? new RegExp(`\\b(?:class|interface|enum|record|object|trait|type)\\s+(${esc})\\b`) : new RegExp(`(?:^|[^\\w$.])(${esc})\\s*(?:\\(|=|:|<)`);
  const m = re.exec(lineText);
  if (m) return m.index + m[0].lastIndexOf(m[1]);
  const plain = new RegExp(`\\b${esc}\\b`).exec(lineText);
  return plain ? plain.index : -1;
}

module.exports = { nameColumn, findSymbols, symbolBlame, blockEnd, lang };
