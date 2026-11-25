'use strict';
/**
 * "What's configured for AI coding agents in this project?" across every tool that might be set up
 * here (Claude Code, Codex, GitHub Copilot, Gemini CLI) - MCP servers, skills, custom agents, hooks,
 * instructions files. Each item is tagged `scope: 'project'` (this repo, usually committed) or
 * `scope: 'global'` (the runner's home-directory config, `~/.claude` etc. - applies to every project
 * on this machine). Every read degrades to "not present" on a missing or malformed file rather than
 * throwing - same spirit as checks.js's unmet-requirement skip. Global paths are best-effort: `~/.claude`
 * (skills/agents/hooks) is verified against this project's own `skills.js` ("IDE level ~/.claude/skills");
 * Codex's and Copilot's global file locations are less certain - see NEXT_STEPS.md.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const skillsCore = require('./skills');

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function readText(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
}

function listFiles(dir, re) {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && re.test(e.name)).map((e) => e.name).sort(); } catch { return []; }
}

/** Same crude single-line frontmatter reader as skills.js's parseSkillMd, extended with the extra
 * fields a custom-subagent file carries (tools/model) and a instructions file's scope (applyTo). No
 * multi-line YAML - a folded block is simply not read, same documented limit as parseSkillMd. */
function parseFrontmatter(text) {
  const out = {};
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(text || ''));
  if (!m) return out;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^(name|description|tools|model|applyTo):\s*(.*)$/.exec(line);
    if (kv) out[kv[1]] = kv[2].replace(/^["']|["']$/g, '').trim();
  }
  return out;
}

/** Claude's and Codex's hooks.json/settings.json share one shape: { "<Event>": [{ matcher, hooks: [{type, command}] }] }. */
function summarizeHooksClaudeStyle(json, file) {
  const hooks = json && json.hooks;
  if (!hooks || typeof hooks !== 'object') return [];
  const items = [];
  for (const [event, entries] of Object.entries(hooks)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      const cmds = (entry && Array.isArray(entry.hooks) ? entry.hooks : []).map((h) => h && h.command).filter(Boolean);
      items.push({ category: 'hook', name: event, description: entry && entry.matcher ? `matcher: ${entry.matcher}` : '', file, detail: { commands: cmds } });
    }
  }
  return items;
}

/** Copilot's .github/hooks/*.json shape: { "hooks": { "<event>": [{ matcher, bash, timeoutSec }] } } - lower-camel
 * event names and a "bash" field instead of "command", confirmed against a real file in this repo. */
function summarizeHooksCopilotStyle(json, file) {
  const hooks = json && json.hooks;
  if (!hooks || typeof hooks !== 'object') return [];
  const items = [];
  for (const [event, entries] of Object.entries(hooks)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      items.push({ category: 'hook', name: event, description: entry && entry.matcher ? `matcher: ${entry.matcher}` : '', file, detail: { commands: [entry && entry.bash].filter(Boolean) } });
    }
  }
  return items;
}

/** Minimal TOML subset: table headers (`[a.b]`) and simple `key = "value"` / `key = [...]` lines only -
 * enough to read Codex's `[mcp_servers.<name>]` blocks, not a general TOML parser. Anything it can't
 * confidently read (nested inline tables, multi-line strings, dotted keys) is silently skipped rather
 * than guessed at. */
function parseTomlTables(text) {
  const tables = new Map(); // "a.b" -> { key: value }
  let current = null;
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const head = /^\[([A-Za-z0-9_.-]+)\]$/.exec(line);
    if (head) { current = {}; tables.set(head[1], current); continue; }
    if (!current) continue;
    const kv = /^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/.exec(line);
    if (!kv) continue;
    const raw = kv[2].trim();
    if (/^".*"$/.test(raw) || /^'.*'$/.test(raw)) current[kv[1]] = raw.slice(1, -1);
    else if (/^\[.*\]$/.test(raw)) {
      try { current[kv[1]] = raw.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean).map((s) => s.replace(/^["']|["']$/g, '')); } catch { /* skip */ }
    } else if (/^(true|false)$/.test(raw)) current[kv[1]] = raw === 'true';
    else if (/^-?\d+(\.\d+)?$/.test(raw)) current[kv[1]] = Number(raw);
  }
  return tables;
}

function mcpServersFromJson(json, key, file) {
  const servers = json && json[key];
  if (!servers || typeof servers !== 'object') return [];
  return Object.entries(servers).map(([name, cfg]) => ({
    category: 'mcp', name, description: cfg && cfg.command ? `${cfg.command} ${(cfg.args || []).join(' ')}`.trim() : '', file, detail: cfg || {},
  }));
}

/** Copilot CLI's project-level MCP files (.mcp.json, .github/mcp.json - confirmed against GitHub's own docs,
 *  see scanCopilot below) accept the same {"mcpServers": {...}} wrapper as ~/.copilot/mcp-config.json, or a
 *  bare {"name": {...}} map with no wrapper at all - tried second, only once the wrapped form comes up empty. */
function mcpServersFromJsonOrBare(json, file) {
  const wrapped = mcpServersFromJson(json, 'mcpServers', file);
  if (wrapped.length || !json || typeof json !== 'object') return wrapped;
  return Object.entries(json)
    .filter(([, cfg]) => cfg && typeof cfg === 'object' && (cfg.command || cfg.url || cfg.type))
    .map(([name, cfg]) => ({ category: 'mcp', name, description: cfg.command ? `${cfg.command} ${(cfg.args || []).join(' ')}`.trim() : '', file, detail: cfg }));
}

const tag = (its, scope) => its.map((it) => ({ ...it, scope }));

/** Claude's skills/agents/hooks live in the same shape at both levels: `.claude/skills`, `.claude/agents`,
 * `.claude/settings*.json` - project-rooted or home-rooted. Confirmed against this project's own `skills.js`
 * ("IDE level ~/.claude/skills"). */
function scanClaudeAt(base, scope) {
  const items = [];
  for (const s of skillsCore.findSkills(base, '.claude/skills')) {
    items.push({ category: 'skill', name: s.name, description: s.description || '', file: `${s.dir}/SKILL.md`, detail: { hasScripts: s.hasScripts }, scope });
  }
  const prefix = scope === 'global' ? '~/' : '';
  for (const f of listFiles(path.join(base, '.claude', 'agents'), /\.md$/i)) {
    const fm = parseFrontmatter(readText(path.join(base, '.claude', 'agents', f)) || '');
    items.push({ category: 'agent', name: fm.name || f.replace(/\.md$/i, ''), description: fm.description || '', file: `${prefix}.claude/agents/${f}`, detail: { tools: fm.tools || '', model: fm.model || '' }, scope });
  }
  for (const name of ['settings.json', 'settings.local.json']) {
    const json = readJson(path.join(base, '.claude', name));
    if (json) items.push(...tag(summarizeHooksClaudeStyle(json, `${prefix}.claude/${name}`), scope));
  }
  return items;
}

function scanClaude(root, home = os.homedir()) {
  const items = scanClaudeAt(root, 'project');
  const mcp = readJson(path.join(root, '.mcp.json'));
  if (mcp) items.push(...tag(mcpServersFromJson(mcp, 'mcpServers', '.mcp.json'), 'project'));
  if (fs.existsSync(path.join(root, 'CLAUDE.md'))) items.push({ category: 'instructions', name: 'CLAUDE.md', description: '', file: 'CLAUDE.md', detail: {}, scope: 'project' });

  items.push(...scanClaudeAt(home, 'global'));
  if (fs.existsSync(path.join(home, '.claude', 'CLAUDE.md'))) items.push({ category: 'instructions', name: 'CLAUDE.md', description: '', file: '~/.claude/CLAUDE.md', detail: {}, scope: 'global' });
  return { runner: 'claude', present: items.length > 0, items };
}

/** Codex's own standard config location is the home-rooted `~/.codex/config.toml`/`hooks.json` - the
 * per-project `.codex/config.toml` is a layer on top of it. Tiering between the two is third-party-sourced,
 * not confirmed against OpenAI's own docs - see NEXT_STEPS.md. */
function scanCodexAt(base, scope) {
  const items = [];
  const prefix = scope === 'global' ? '~/' : '';
  const toml = readText(path.join(base, '.codex', 'config.toml'));
  if (toml) {
    for (const [table, fields] of parseTomlTables(toml)) {
      const m = /^mcp_servers\.(.+)$/.exec(table);
      if (m) items.push({ category: 'mcp', name: m[1], description: fields.command ? `${fields.command} ${(fields.args || []).join(' ')}`.trim() : '', file: `${prefix}.codex/config.toml`, detail: fields, scope });
    }
  }
  const hooks = readJson(path.join(base, '.codex', 'hooks.json'));
  if (hooks) items.push(...tag(summarizeHooksClaudeStyle(hooks, `${prefix}.codex/hooks.json`), scope));
  return items;
}

function scanCodex(root, home = os.homedir()) {
  const items = scanCodexAt(root, 'project');
  items.push(...scanCodexAt(home, 'global'));
  return { runner: 'codex', present: items.length > 0, items };
}

function scanCopilot(root, home = os.homedir()) {
  const items = [];
  if (fs.existsSync(path.join(root, '.github', 'copilot-instructions.md'))) {
    items.push({ category: 'instructions', name: 'copilot-instructions.md', description: '', file: '.github/copilot-instructions.md', detail: {}, scope: 'project' });
  }
  for (const f of listFiles(path.join(root, '.github', 'instructions'), /\.instructions\.md$/i)) {
    const fm = parseFrontmatter(readText(path.join(root, '.github', 'instructions', f)) || '');
    items.push({ category: 'instructions', name: f, description: fm.applyTo ? `applies to: ${fm.applyTo}` : '', file: `.github/instructions/${f}`, detail: { applyTo: fm.applyTo || '' }, scope: 'project' });
  }
  for (const f of listFiles(path.join(root, '.github', 'agents'), /\.md$/i)) {
    const fm = parseFrontmatter(readText(path.join(root, '.github', 'agents', f)) || '');
    items.push({ category: 'agent', name: fm.name || f.replace(/\.md$/i, ''), description: fm.description || '', file: `.github/agents/${f}`, detail: {}, scope: 'project' });
  }
  // .vscode/mcp.json is VS Code's own built-in MCP convention (the Copilot Chat *extension* reads it, among
  // other VS Code AI extensions) - kept for that, but confirmed against GitHub's own docs that the standalone
  // Copilot CLI does NOT read it (its docs call .vscode/mcp.json's "servers" key "unsupported" for the CLI).
  const mcp = readJson(path.join(root, '.vscode', 'mcp.json'));
  if (mcp) items.push(...tag(mcpServersFromJson(mcp, 'servers', '.vscode/mcp.json'), 'project'));
  // The CLI's own project-level MCP files (confirmed): .mcp.json takes precedence when both exist, but both
  // are listed here rather than resolving that - same as every other scope in this file, which lists every
  // real source rather than collapsing to "the one that wins".
  for (const rel of [['.mcp.json'], ['.github', 'mcp.json']]) {
    const json = readJson(path.join(root, ...rel));
    if (json) items.push(...tag(mcpServersFromJsonOrBare(json, rel.join('/')), 'project'));
  }
  for (const f of listFiles(path.join(root, '.github', 'hooks'), /\.json$/i)) {
    const json = readJson(path.join(root, '.github', 'hooks', f));
    if (json) items.push(...tag(summarizeHooksCopilotStyle(json, `.github/hooks/${f}`), 'project'));
  }

  // Global: the Copilot CLI (not the VS Code extension) keeps its own per-user agents at ~/.copilot/agents
  // (confirmed - same .md shape as the project-level ones) and MCP servers in ~/.copilot/mcp-config.json
  // under a "mcpServers" key (confirmed against GitHub's own docs - NOT "servers", which is .vscode/mcp.json's
  // own, CLI-unsupported key; this file is the one place in this whole scanner that was wrong, not just
  // unverified, until this was checked against the real docs).
  for (const f of listFiles(path.join(home, '.copilot', 'agents'), /\.md$/i)) {
    const fm = parseFrontmatter(readText(path.join(home, '.copilot', 'agents', f)) || '');
    items.push({ category: 'agent', name: fm.name || f.replace(/\.agent\.md$|\.md$/i, ''), description: fm.description || '', file: `~/.copilot/agents/${f}`, detail: {}, scope: 'global' });
  }
  const userMcp = readJson(path.join(home, '.copilot', 'mcp-config.json'));
  if (userMcp) items.push(...tag(mcpServersFromJson(userMcp, 'mcpServers', '~/.copilot/mcp-config.json'), 'global'));
  return { runner: 'copilot', present: items.length > 0, items };
}

function scanGemini(root, home = os.homedir()) {
  const items = [];
  const settings = readJson(path.join(root, '.gemini', 'settings.json'));
  if (settings) items.push(...tag(mcpServersFromJson(settings, 'mcpServers', '.gemini/settings.json'), 'project'));
  if (fs.existsSync(path.join(root, 'GEMINI.md'))) items.push({ category: 'instructions', name: 'GEMINI.md', description: '', file: 'GEMINI.md', detail: {}, scope: 'project' });

  // Global: Gemini CLI's own home-level settings.json, same mcpServers key as the project-level file.
  const userSettings = readJson(path.join(home, '.gemini', 'settings.json'));
  if (userSettings) items.push(...tag(mcpServersFromJson(userSettings, 'mcpServers', '~/.gemini/settings.json'), 'global'));
  return { runner: 'gemini', present: items.length > 0, items };
}

/** AGENTS.md declares itself cross-tool in this project's own convention - shown once, not duplicated per runner. */
function scanShared(root) {
  const items = [];
  if (fs.existsSync(path.join(root, 'AGENTS.md'))) items.push({ category: 'instructions', name: 'AGENTS.md', description: '', file: 'AGENTS.md', detail: {} });
  return items;
}

function scanAll(root, home = os.homedir()) {
  if (!root) return { runners: { claude: null, codex: null, copilot: null, gemini: null }, shared: [] };
  return {
    runners: { claude: scanClaude(root, home), codex: scanCodex(root, home), copilot: scanCopilot(root, home), gemini: scanGemini(root, home) },
    shared: scanShared(root),
  };
}

module.exports = { scanAll, scanClaude, scanCodex, scanCopilot, scanGemini, parseTomlTables, parseFrontmatter };
