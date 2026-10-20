'use strict';
/**
 * Terminals across a restart. What is saved per terminal is only: what it was (plain shell or one of the configured agents),
 * its title and its working folder. Restoring reopens a shell there and, for an agent that can resume, types its resume
 * command (Claude Code and Copilot CLI: "--continue", or the agent's own `resumeCommand`). Conversation content is never stored by the IDE.
 */
const path = require('node:path');

const RESUME_FLAG = { claude: '--continue', copilot: '--continue' };

const inside = (root, p) => {
  const base = path.resolve(root);
  const abs = path.resolve(String(p || ''));
  return abs === base || abs.startsWith(base + path.sep);
};

/** The command that resumes the agent's last conversation in the current folder, or null when we don't know how. */
function resumeCommand(agent) {
  if (!agent) return null;
  if (typeof agent.resumeCommand === 'string' && agent.resumeCommand.trim()) return agent.resumeCommand.trim();
  const command = String(agent.command || '').trim();
  const first = command.split(/\s+/)[0].replace(/\.(exe|cmd|bat)$/i, '').split(/[\\/]/).pop().toLowerCase();
  if (RESUME_FLAG[first] && !/(^|\s)--(continue|resume)\b/.test(command)) return `${command} ${RESUME_FLAG[first]}`;
  return null;
}

/** Records to save: only live terminals whose folder is inside the project, without anything that could hold a secret. */
function toRecords(terms, root) {
  const out = [];
  for (const t of terms) {
    if (!t || t.exited || !t.cwd || !inside(root, t.cwd)) continue;
    out.push({ kind: t.agent ? 'agent' : 'shell', title: String(t.title || 'Terminal').slice(0, 80), cwd: path.resolve(t.cwd), agent: t.agent || null, runId: t.runId || null, container: !!t.container });
  }
  return out.slice(0, 12);
}

/**
 * Turn saved records (or the old format: a number of plain terminals) into terminals to open.
 * @returns {Array<{ title, cwd, initialInput?, env?, watch?, label?, agent?, runId?, note? }>}
 */
function planRestore(saved, { root, agents = [] }) {
  const list = typeof saved === 'number'
    ? Array.from({ length: Math.min(Math.max(0, saved | 0), 12) }, () => ({ kind: 'shell', title: 'Terminal', cwd: root }))
    : (Array.isArray(saved) ? saved : []);
  const plan = [];
  for (const r of list) {
    if (!r || typeof r !== 'object') continue;
    const cwd = r.cwd ? String(r.cwd) : root;
    if (!inside(root, cwd)) continue; // moved or deleted folder, or a record of another project
    const item = { title: String(r.title || 'Terminal'), cwd, agent: null, runId: r.runId || null };
    if (r.container) {
      // an agent that ran in a container is never resumed on the host: that would silently drop the sandbox
      item.agent = null; item.note = 'This agent ran in a container. Start it again from the Agents tab to keep it sandboxed.';
    } else if (r.kind === 'agent' && r.agent) {
      const agent = agents.find((a) => a.name === r.agent);
      const cmd = resumeCommand(agent);
      item.agent = r.agent;
      if (agent && cmd) { item.initialInput = `${cmd}\r`; item.env = agent.env || undefined; item.watch = true; item.label = item.title; }
      else item.note = agent ? `${r.agent} has no resume command: add "resumeCommand" to this agent in the settings to continue its last conversation.` : `${r.agent} is no longer configured.`;
    }
    plan.push(item);
  }
  return plan;
}

module.exports = { resumeCommand, toRecords, planRestore, inside };
