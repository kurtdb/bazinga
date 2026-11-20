'use strict';
/**
 * Bend (https://bend-lang.com) asks every project using it to add a short block to AGENTS.md so AI coding
 * agents learn its workflow - the exact snippet below is what the project's own homepage suggests pasting in.
 * Mirrors core/skillindex.js's managed-block pattern: only the text between the markers is ever touched, and
 * the block disappears again once the project no longer looks like a Bend project.
 */
const START = '<!-- bazinga:bend:start (generated, do not edit between the markers) -->';
const END = '<!-- bazinga:bend:end -->';

function renderBlock() {
  return [
    START, '## Bend', '',
    'When using Bend:',
    '- run `bend guide` to learn it',
    '- use `LAWS.bend` to keep important rules',
    '- run `bend PROOF.bend` before committing',
    '- parallelize the code whenever possible',
    END,
  ].join('\n');
}

/** present: does this project look like a Bend project (LAWS.bend or PROOF.bend at its root)? Returns the new file text, or null when nothing needs to change. */
function applyBlock(text, present) {
  const current = String(text || '');
  const has = current.includes(START) && current.includes(END) && current.indexOf(START) < current.indexOf(END);
  if (!present) {
    if (!has) return null; // nothing there and nothing to add: leave the file alone
    const out = (current.slice(0, current.indexOf(START)).replace(/\s+$/, '') + current.slice(current.indexOf(END) + END.length)).replace(/^\s+$/, '');
    return out ? `${out.replace(/\s+$/, '')}\n` : '';
  }
  const block = renderBlock();
  if (has) {
    const next = current.slice(0, current.indexOf(START)) + block + current.slice(current.indexOf(END) + END.length);
    return next === current ? null : next;
  }
  const base = current.replace(/\s+$/, '');
  return `${base ? `${base}\n\n` : ''}${block}\n`;
}

module.exports = { START, END, renderBlock, applyBlock };
