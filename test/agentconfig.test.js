'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const ac = require('../src/core/agentconfig');
const { tmpdir, write } = require('./helpers');

// Every scan*() call below passes an isolated fixture `home` (never os.homedir()) so these tests stay
// hermetic: a real ~/.claude, ~/.codex etc. on the machine running them must never change the outcome.

test('scanClaude: project skills (reusing findSkills), agents, MCP servers and hooks - all tagged scope: project', () => {
  const root = tmpdir();
  const home = tmpdir();
  write(root, '.claude/skills/pdf/SKILL.md', '---\nname: PDF Tools\ndescription: Work with PDFs\n---\nUse it.');
  write(root, '.claude/agents/reviewer.md', '---\nname: reviewer\ndescription: Reviews code\ntools: Read, Grep\nmodel: sonnet\n---\nBody.');
  write(root, '.mcp.json', JSON.stringify({ mcpServers: { context7: { command: 'npx', args: ['-y', '@upstash/context7-mcp'] } } }));
  write(root, '.claude/settings.json', JSON.stringify({ hooks: { PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'echo hi' }] }] } }));
  write(root, 'CLAUDE.md', '# instructions');
  const r = ac.scanClaude(root, home);
  assert.strictEqual(r.present, true);
  assert.ok(r.items.every((i) => i.scope === 'project'));
  const byCat = Object.fromEntries(r.items.map((i) => [i.category + ':' + i.name, i]));
  assert.strictEqual(byCat['skill:pdf-tools'].description, 'Work with PDFs');
  assert.strictEqual(byCat['agent:reviewer'].detail.tools, 'Read, Grep');
  assert.strictEqual(byCat['mcp:context7'].description, 'npx -y @upstash/context7-mcp');
  assert.strictEqual(byCat['hook:PostToolUse'].detail.commands[0], 'echo hi');
  assert.ok(byCat['instructions:CLAUDE.md']);
});

test('scanClaude: global (home-level) skills, agents, hooks and CLAUDE.md are tagged scope: global, file prefixed with ~/', () => {
  const root = tmpdir();
  const home = tmpdir();
  write(home, '.claude/skills/pdf/SKILL.md', '---\nname: PDF Tools\ndescription: Work with PDFs, everywhere\n---\nUse it.');
  write(home, '.claude/agents/reviewer.md', '---\nname: reviewer\ndescription: Reviews code, everywhere\n---\nBody.');
  write(home, '.claude/settings.json', JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }] } }));
  write(home, '.claude/CLAUDE.md', '# global instructions');
  const r = ac.scanClaude(root, home);
  assert.strictEqual(r.present, true);
  assert.ok(r.items.every((i) => i.scope === 'global'));
  const byCat = Object.fromEntries(r.items.map((i) => [i.category + ':' + i.name, i]));
  assert.strictEqual(byCat['skill:pdf-tools'].description, 'Work with PDFs, everywhere');
  assert.strictEqual(byCat['agent:reviewer'].file, '~/.claude/agents/reviewer.md');
  assert.strictEqual(byCat['hook:Stop'].detail.commands[0], 'say done');
  assert.strictEqual(byCat['instructions:CLAUDE.md'].file, '~/.claude/CLAUDE.md');
});

test('scanCodex: project MCP servers from a minimal TOML subset, and hooks.json (same shape as Claude)', () => {
  const root = tmpdir();
  const home = tmpdir();
  write(root, '.codex/config.toml', [
    '[mcp_servers.serena]',
    'command = "npx"',
    'args = ["-y", "serena-mcp"]',
    'startup_timeout_sec = 10',
    '',
    '[other_table]',
    'ignored = true',
  ].join('\n'));
  write(root, '.codex/hooks.json', JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'notify-send done' }] }] } }));
  const r = ac.scanCodex(root, home);
  assert.strictEqual(r.present, true);
  assert.ok(r.items.every((i) => i.scope === 'project'));
  const mcp = r.items.find((i) => i.category === 'mcp');
  assert.strictEqual(mcp.name, 'serena');
  assert.strictEqual(mcp.description, 'npx -y serena-mcp');
  assert.deepStrictEqual(mcp.detail.args, ['-y', 'serena-mcp']);
  assert.strictEqual(mcp.detail.startup_timeout_sec, 10);
  const hook = r.items.find((i) => i.category === 'hook');
  assert.strictEqual(hook.name, 'Stop');
  assert.strictEqual(hook.detail.commands[0], 'notify-send done');
});

test('scanCodex: global (~/.codex) config.toml/hooks.json are tagged scope: global, file prefixed with ~/', () => {
  const root = tmpdir();
  const home = tmpdir();
  write(home, '.codex/config.toml', '[mcp_servers.global_one]\ncommand = "npx"\n');
  write(home, '.codex/hooks.json', JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo global' }] }] } }));
  const r = ac.scanCodex(root, home);
  assert.ok(r.items.every((i) => i.scope === 'global'));
  const mcp = r.items.find((i) => i.category === 'mcp');
  assert.strictEqual(mcp.name, 'global_one');
  assert.strictEqual(mcp.file, '~/.codex/config.toml');
});

test('scanCodex: an absent or malformed config.toml/hooks.json degrades to "not present", never throws', () => {
  const root = tmpdir();
  const home = tmpdir();
  assert.deepStrictEqual(ac.scanCodex(root, home), { runner: 'codex', present: false, items: [] });
  write(root, '.codex/config.toml', 'not = valid [[[ toml {{{');
  write(root, '.codex/hooks.json', '{not json');
  assert.doesNotThrow(() => ac.scanCodex(root, home));
});

test('scanCopilot: project instructions (repo-wide + scoped), agents, .vscode/mcp.json\'s "servers" key, and its own hook shape', () => {
  const root = tmpdir();
  const home = tmpdir();
  write(root, '.github/copilot-instructions.md', 'see AGENTS.md');
  write(root, '.github/instructions/frontend.instructions.md', '---\napplyTo: "src/renderer/**"\n---\nBody.');
  write(root, '.github/agents/triager.md', '---\nname: triager\ndescription: Triages issues\n---\nBody.');
  write(root, '.vscode/mcp.json', JSON.stringify({ servers: { local: { command: 'node', args: ['server.js'] } } }));
  write(root, '.github/hooks/impeccable.json', JSON.stringify({ hooks: { postToolUse: [{ matcher: 'edit', bash: 'impeccable hook' }] } }));
  const r = ac.scanCopilot(root, home);
  assert.strictEqual(r.present, true);
  assert.ok(r.items.every((i) => i.scope === 'project'));
  const byCat = Object.fromEntries(r.items.map((i) => [i.category + ':' + i.name, i]));
  assert.ok(byCat['instructions:copilot-instructions.md']);
  assert.strictEqual(byCat['instructions:frontend.instructions.md'].detail.applyTo, 'src/renderer/**');
  assert.strictEqual(byCat['agent:triager'].description, 'Triages issues');
  assert.strictEqual(byCat['mcp:local'].description, 'node server.js');
  assert.strictEqual(byCat['hook:postToolUse'].detail.commands[0], 'impeccable hook');
});

test('scanCopilot: global (~/.copilot) agents and mcp-config.json are tagged scope: global', () => {
  const root = tmpdir();
  const home = tmpdir();
  write(home, '.copilot/agents/triager.agent.md', '---\nname: triager\ndescription: Triages issues, everywhere\n---\nBody.');
  write(home, '.copilot/mcp-config.json', JSON.stringify({ servers: { remote: { command: 'npx', args: ['remote-mcp'] } } }));
  const r = ac.scanCopilot(root, home);
  assert.ok(r.items.every((i) => i.scope === 'global'));
  const byCat = Object.fromEntries(r.items.map((i) => [i.category + ':' + i.name, i]));
  assert.strictEqual(byCat['agent:triager'].file, '~/.copilot/agents/triager.agent.md');
  assert.strictEqual(byCat['mcp:remote'].description, 'npx remote-mcp');
});

test('scanGemini: project MCP servers and GEMINI.md; absent entirely is "not present"', () => {
  const root = tmpdir();
  const home = tmpdir();
  assert.deepStrictEqual(ac.scanGemini(root, home), { runner: 'gemini', present: false, items: [] });
  write(root, '.gemini/settings.json', JSON.stringify({ mcpServers: { files: { command: 'mcp-server-filesystem' } } }));
  write(root, 'GEMINI.md', '# context');
  const r = ac.scanGemini(root, home);
  assert.strictEqual(r.present, true);
  assert.ok(r.items.every((i) => i.scope === 'project'));
  assert.deepStrictEqual(r.items.map((i) => i.category).sort(), ['instructions', 'mcp']);
});

test('scanGemini: global (~/.gemini/settings.json) MCP servers are tagged scope: global', () => {
  const root = tmpdir();
  const home = tmpdir();
  write(home, '.gemini/settings.json', JSON.stringify({ mcpServers: { files: { command: 'mcp-server-filesystem' } } }));
  const r = ac.scanGemini(root, home);
  assert.strictEqual(r.items[0].scope, 'global');
  assert.strictEqual(r.items[0].file, '~/.gemini/settings.json');
});

test('scanAll: AGENTS.md is shown once as shared, not duplicated per runner; no root means every runner is null', () => {
  const root = tmpdir();
  const home = tmpdir();
  write(root, 'AGENTS.md', 'shared instructions');
  const r = ac.scanAll(root, home);
  assert.deepStrictEqual(r.shared.map((i) => i.name), ['AGENTS.md']);
  for (const key of ['claude', 'codex', 'copilot', 'gemini']) assert.strictEqual(r.runners[key].items.some((i) => i.name === 'AGENTS.md'), false);
  const empty = ac.scanAll(null, home);
  assert.deepStrictEqual(empty.runners, { claude: null, codex: null, copilot: null, gemini: null });
});

test('regression: scanning this real repo (with an isolated fixture home) finds the real, already-known project items without throwing', () => {
  const root = path.join(__dirname, '..');
  const home = tmpdir();
  const r = ac.scanAll(root, home);
  assert.ok(r.runners.claude.items.some((i) => i.category === 'skill' && i.name === 'clean-code' && i.scope === 'project'));
  assert.ok(r.runners.codex.items.some((i) => i.category === 'hook' && i.name === 'PostToolUse' && i.scope === 'project'));
  assert.ok(r.runners.copilot.items.some((i) => i.category === 'instructions' && i.name === 'copilot-instructions.md' && i.scope === 'project'));
  assert.ok(r.shared.some((i) => i.name === 'AGENTS.md'));
  // the fixture home is empty, so nothing here should leak in as scope: global
  for (const key of ['claude', 'codex', 'copilot', 'gemini']) assert.strictEqual(r.runners[key].items.some((i) => i.scope === 'global'), false);
});
