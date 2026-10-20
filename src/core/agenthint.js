'use strict';
// Standing instructions for an agent: one text (the agent's own hint in Settings plus the project's .ide/agent-hint.md)
// written to a file and handed to Claude Code with --append-system-prompt-file.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PROJECT_FILE = path.join('.ide', 'agent-hint.md');

function compose({ agentHint, projectHint, layout, extra }) {
  return [agentHint, layout, projectHint, extra].map((t) => String(t || '').trim()).filter(Boolean).join('\n\n');
}

/** Insert the flag after the leading `claude` word. Unchanged for other agents, or when the command sets its own system prompt text. */
function withHintFile(command, file) {
  const c = String(command || '');
  if (!file || /--append-system-prompt/.test(c)) return c;
  const m = /^(\s*(?:[^\s]*[\\/])?claude(?:\.exe|\.cmd)?)(?=\s|$)/i.exec(c);
  if (!m) return c;
  return `${m[1]} --append-system-prompt-file "${file}"${c.slice(m[1].length)}`;
}

/** Writes the combined text to dir (content-addressed, so the same text reuses the same file). Returns the path, or null when there is nothing to say. */
function writeHintFile(dir, text) {
  if (!text) return null;
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `hint-${crypto.createHash('sha1').update(text).digest('hex').slice(0, 12)}.md`);
  if (!fs.existsSync(file)) fs.writeFileSync(file, `${text}\n`);
  return file;
}

function readProjectHint(root) {
  try { return fs.readFileSync(path.join(root, PROJECT_FILE), 'utf8'); } catch { return ''; }
}

module.exports = { PROJECT_FILE, compose, withHintFile, writeHintFile, readProjectHint };
