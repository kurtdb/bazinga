'use strict';
/**
 * Not every agent understands skills (local models, simple CLIs). AGENTS.md is read by most of the ones that do not:
 * a managed block there lists the project's skills, so any agent is told where they are and when to read them.
 * Only the text between the markers is ever touched.
 */
const START = '<!-- bazinga:skills:start (generated, do not edit between the markers) -->';
const END = '<!-- bazinga:skills:end -->';

const oneLine = (s) => String(s || '').replace(/\s+/g, ' ').trim();

function renderBlock(skills, relDir) {
  const lines = [START, '## Skills', '',
    `This project has skills (folders with a SKILL.md) in \`${relDir}\`. When a task matches a description below, read that SKILL.md first and follow it.`, ''];
  for (const s of skills) lines.push(`- **${s.name}**: ${oneLine(s.description) || 'no description'} (\`${relDir}/${s.name}/SKILL.md\`)`);
  lines.push(END);
  return lines.join('\n');
}

/** Returns the new file text, or null when nothing needs to be written. */
function applyBlock(text, skills, relDir) {
  const current = String(text || '');
  const has = current.includes(START) && current.includes(END) && current.indexOf(START) < current.indexOf(END);
  if (!skills.length) {
    if (!has) return null; // nothing listed and nothing there: leave the file alone
    const out = (current.slice(0, current.indexOf(START)).replace(/\s+$/, '') + current.slice(current.indexOf(END) + END.length)).replace(/^\s+$/, '');
    return out ? `${out.replace(/\s+$/, '')}\n` : '';
  }
  const block = renderBlock(skills, relDir);
  if (has) {
    const next = current.slice(0, current.indexOf(START)) + block + current.slice(current.indexOf(END) + END.length);
    return next === current ? null : next;
  }
  const base = current.replace(/\s+$/, '');
  return `${base ? `${base}\n\n` : ''}${block}\n`;
}

module.exports = { START, END, renderBlock, applyBlock };
