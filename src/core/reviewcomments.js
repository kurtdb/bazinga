'use strict';
/**
 * Review comments left on diff lines, turned into one prompt for the agent.
 * comment: { file, line (1-based, new side), text, code? }
 */
const MAX_COMMENTS = 40;
const MAX_TEXT = 2000;
const MAX_CODE = 200;

const clean = (s, max) => String(s || '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);

/** Normalise and drop unusable comments (no file, no text); order by file then line. */
function normalize(comments) {
  return (Array.isArray(comments) ? comments : [])
    .map((c) => ({ file: String(c && c.file || '').replace(/\\/g, '/'), line: Math.max(1, Math.floor(Number(c && c.line) || 1)), text: clean(c && c.text, MAX_TEXT), code: clean(c && c.code, MAX_CODE).split('\n')[0] }))
    .filter((c) => c.file && c.text)
    .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
    .slice(0, MAX_COMMENTS);
}

function formatComments(comments) {
  const list = normalize(comments);
  if (!list.length) return '';
  const out = [`I reviewed your changes and have ${list.length} comment${list.length === 1 ? '' : 's'}. Address each one. Do not touch files unrelated to these comments, and do not silence a check or weaken a test to make a comment go away.`, ''];
  let file = null;
  for (const c of list) {
    if (c.file !== file) { file = c.file; out.push(`${file}`); }
    out.push(`  line ${c.line}${c.code ? `  \`${c.code}\`` : ''}`);
    out.push(...c.text.split('\n').map((l) => `    ${l}`));
  }
  out.push('', 'When you are done, stop and wait.');
  return out.join('\n');
}

module.exports = { normalize, formatComments, MAX_COMMENTS };
