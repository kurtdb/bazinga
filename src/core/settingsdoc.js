'use strict';
/**
 * A reference to Bazinga's own user-level settings, written as a managed block into userData/AGENTS.md (see
 * main.js's refreshSettingsDoc(), once per launch) so a user can point their own coding agent at that folder and
 * say "change X" - the same idea herdr (herdr.dev) uses for its own ~/.config/herdr-app/AGENTS.md, minus the
 * mods/plugin half of that story. Types/enums come straight from core/configschema.js's SCHEMA and defaults from
 * core/config.js's DEFAULT_CONFIG, so neither can drift out of sync with what the app actually validates and
 * ships - only the one-line DESCRIPTIONS below are hand-written (comments aren't introspectable at runtime), and
 * they are deliberately their own, shorter, user-facing text rather than a copy of DEFAULT_CONFIG's own (developer-
 * facing) comments. Mirrors core/skillindex.js's/core/bendindex.js's managed-block pattern, simplified: this block
 * is always present (not conditional on project state), so there is no "remove" case to handle.
 */
const { DEFAULT_CONFIG } = require('./config');
const { SCHEMA } = require('./configschema');
const { DEFAULT_KEYBINDINGS } = require('./keybindings');

const START = '<!-- bazinga:settings:start (generated, do not edit between the markers) -->';
const END = '<!-- bazinga:settings:end -->';

// One short, user-facing sentence per settings.json key. Every key in DEFAULT_CONFIG and in SCHEMA.properties
// needs an entry here - test/settingsdoc.test.js fails loudly if one is ever added without a matching line.
const DESCRIPTIONS = {
  shell: 'Which shell new terminals use. null = PowerShell on Windows, $SHELL elsewhere.',
  shellArgs: 'Extra arguments passed to that shell.',
  theme: 'The app-wide color theme.',
  autoCheck: 'Run the fast quality gates automatically whenever files change on disk.',
  autoCheckpoint: 'Snapshot the working tree automatically before every agent terminal starts.',
  agents: 'The agent buttons themselves: name, launch command, and (for ACP/local-model agents) protocol/api/env.',
  customThemes: 'Themes built in Settings -> "Create custom theme...". Usually easier to create there than by hand.',
  fixLoop: 'Auto re-prompt an idle agent with the quality gates\' findings, up to maxRounds times.',
  autoMerge: 'Merge a clean run automatically once an (agent, kind of task) has enough winning history. Off by default.',
  oversight: 'The human-in-the-loop preset: autonomous | supervised | guided | stepwise. null = the individual settings below decide instead.',
  taskPrefix: 'Text prepended to every agent task (normally set by the guided oversight levels, not by hand).',
  notifyKinds: 'Which kinds of event trigger an OS notification. null = all of them.',
  mergeGuard: 'Per-rule override, keyed by rule id: "block" | "warn" | "off".',
  insights: 'Usage & insights window: Claude plan-limit tracking, a SonarQube/SonarCloud project key, a Spring actuator URL.',
  containerWhenUnattended: '"auto" | "off": whether unattended workflow steps run inside the Docker container.',
  externalEditor: '"Open in other editor" target: "auto" | "vscode" | "idea".',
  copilot: 'Shortcut to GitHub Copilot usage tracking. Leave off without a Copilot licence.',
  jev: 'Jev (TypeSafe AI): classifies the kind of a task for the scorecard instead of keyword rules. Sends the task text only.',
  agentContainer: 'Run agent runs inside a Docker container instead of on the host.',
  agentEnv: 'Which environment variables agent terminals inherit. scrub strips anything that looks like a credential.',
  ollama: 'Local-model (Ollama) connection and behavior: server URL, keep-warm, context handling, tool-call repair, prompt slimming.',
  inlineCompletion: 'AI ghost-text suggestions as you type, from a local model\'s fill-in-the-middle endpoint. Off by default.',
  skillsMirrors: 'Extra folders every installed skill is also copied to (e.g. .agents/skills for Copilot).',
  folders: 'Folders marked as source/tests (usually set by right-clicking in the file tree, not by hand).',
  foldersFiles: 'How many file paths of a marked folder are listed to agents. 0 = none.',
  foldersIndex: 'Also list marked folders in a managed AGENTS.md block, for agents that read that file.',
  skillsIndex: 'Also list installed skills in a managed AGENTS.md block, for agents without native skill support.',
  skillsDir: 'Where skills live, under your home folder (IDE level) and under each project (project level).',
  reviewRules: 'IDE-wide AI-review rules; a project\'s REVIEW.md is appended after them.',
  runBudgetMinutes: 'Active-agent-time budget per run before you are told. 0 = no limit.',
  protectedPaths: 'Paths the merge guard always blocks changes to. null = the built-in list.',
  symbolParser: '"auto" (tree-sitter where available) or "regex" (line-pattern fallback only) for the usages/blame lenses.',
  errorLens: 'Show every diagnostic inline at the end of its line, not only as a squiggly underline.',
  minimap: "Monaco's minimap. Off by default.",
  symbolLenses: 'Which lenses render above classes/methods: usages count, last-change blame, Spring awareness.',
  keybindings: 'Overrides of the default chords below (core/keybindings.js), commandId -> chord string, or null to unbind.',
  workItems: 'How #123 / AB#123 / PROJ-12 mentions link out (GitHub issues, Azure Boards, Jira).',
  jira: 'Jira connection. The API token itself lives encrypted in the OS keychain, never in this file.',
  fleet: 'Fleet panel: how long before an agent with no output counts as stale, and per-model $/M-token prices for the cost estimate.',
  agentHooks: 'Let Claude Code report "done"/"needs permission" itself via hooks, instead of Bazinga guessing from a quiet terminal.',
  osc7501: 'Listen for the open OSC 7501 status protocol (any CLI that emits it, not just Claude Code) as another "needs attention" signal, alongside hooks and the quiet-terminal guess.',
  layouts: 'Named panel arrangements (sidebar/bottom-panel size, zen mode, which sidebar tab) saved from the command palette ("Window: save current layout as…") - switch between them, or export/import one as JSON to share. Easiest managed from the command palette, not by hand.',
  notifications: 'OS notification when an agent goes idle or the fix loop finishes, while the window is in the background.',
  updates: 'Update checking: "check" (bool), and optionally "channel"/"github"/"url" to point at a different release feed.',
  monoFont: 'The monospace font for the editor, every terminal, and every other monospace spot in the UI.',
  editorFontSize: 'Editor font size.',
  terminalFontSize: 'Terminal font size.',
  terminalScrollback: 'Lines kept per open terminal. Costs memory per terminal.',
  lsp: 'Language servers (opt-in): { enabled, servers: { <lang>: { command, args } } }.',
  runLinkDirs: 'Folders symlinked from the main checkout into every new agent worktree (e.g. ["node_modules"]).',
  reviewCommand: 'The command the AI-review feature pipes its prompt into on stdin.',
  // SCHEMA-only keys (no entry in DEFAULT_CONFIG - unset until you add one):
  telemetry: 'OpenTelemetry export of agent-run spans. Runs by default; set telemetry.otel: false to turn it off.',
  mcp: 'Expose Bazinga itself as an MCP server other agents/tools can call. Off by default; mcp.server: true turns it on.',
  memory: 'A small per-project memory an agent can read on every run (a capped summary) and query/append to mid-run with the recall/remember MCP tools. Off by default; memory.enabled: true turns it on - and also turns on the MCP connection for that run, like mcp.server, since recall/remember travel over it.',
  acp: 'Per-agent ACP (Agent Client Protocol) connection overrides - advanced; usually set via Settings -> Agents, not by hand.',
};

const FILE_NOTES = [
  { file: 'settings.json', note: 'The real, user-editable settings. Safe to read and edit - this whole document is about this file.' },
  { file: 'state.json', note: 'Internal session state (last/trusted/recent projects). Not a setting - leave it alone.' },
  { file: 'session.json', note: 'Internal per-project UI session state (open tabs, scroll positions). Not a setting - leave it alone.' },
  { file: 'scorecard.json', note: 'Recorded run outcomes (data the app built, not a setting). Leave it alone.' },
  { file: 'guardoverrides.json', note: 'Counters of how often each merge-guard rule was overridden. Not a setting - leave it alone.' },
  { file: 'secrets.json', note: 'OS-encrypted credentials (Jira tokens, etc). Never read or edit this - the OS key store decrypts it, a text edit cannot.' },
  { file: 'claude-code.json', note: 'Internal Claude Code install/version tracking. Not a setting - leave it alone.' },
  { file: 'claude-limits.json', note: 'Cached Claude plan-usage data. Not a setting - leave it alone.' },
  { file: 'debug.log', note: 'A log file, not a setting.' },
];

/** Every DEFAULT_CONFIG key, plus any SCHEMA-only key (settable even with no declared default), in a stable order. */
function allKeys() {
  const seen = new Set(Object.keys(DEFAULT_CONFIG));
  const extra = Object.keys(SCHEMA.properties || {}).filter((k) => !seen.has(k));
  return [...Object.keys(DEFAULT_CONFIG), ...extra];
}

/** A short "a string" / "true or false" / "one of: a, b" description of a key's shape, or '' when it has no schema entry. */
function typeLine(key) {
  const schema = (SCHEMA.properties || {})[key];
  if (!schema) return '';
  const nullable = !!schema.anyOf && schema.anyOf.some((s) => s.type === 'null');
  const core = schema.anyOf ? (schema.anyOf.find((s) => s.type !== 'null') || {}) : schema;
  let base = '';
  if (core.enum) base = `one of: ${core.enum.join(', ')}`;
  else if (core.type === 'array') base = core.items && core.items.type === 'object' ? 'a list of objects' : 'a list of strings';
  else if (core.type === 'object') base = 'an object';
  else if (core.type === 'integer' || core.type === 'number') {
    const range = [core.minimum !== undefined ? `>= ${core.minimum}` : null, core.maximum !== undefined ? `<= ${core.maximum}` : null].filter(Boolean).join(', ');
    base = `a number${range ? ` (${range})` : ''}`;
  } else if (core.type === 'boolean') base = 'true or false';
  else if (core.type === 'string') base = 'a string';
  if (!base && schema.enum) base = `one of: ${schema.enum.join(', ')}`;
  return base ? `${base}${nullable ? ', or null' : ''}` : '';
}

function renderBlock({ settingsPath, userDataDir, sourceDir } = {}) {
  const lines = [
    START,
    '## Bazinga settings',
    '',
    `This folder (\`${userDataDir || '(this folder)'}\`) is where Bazinga keeps everything of its own: your personal settings and some internal bookkeeping. If you are an AI coding agent reading this because your user asked you to change how Bazinga behaves, this tells you which file to touch and what each key means.`,
    '',
    '### Which file to edit',
    '',
    ...FILE_NOTES.map((f) => `- \`${f.file}\`: ${f.note}`),
    '',
    `Edit only \`${settingsPath || 'settings.json'}\` - a plain JSON object. Keys you don't set keep their default below. Most changes take effect the next time Bazinga reads the file; a few (the shell, language servers) need the app restarted, and the Settings dialog itself only shows new values once reopened. When in doubt, ask the user to restart Bazinga after you save.`,
    '',
    '### Keys',
    '',
  ];
  for (const key of allKeys()) {
    const desc = DESCRIPTIONS[key] || '(undocumented - see src/core/config.js in the Bazinga source for what this does)';
    const type = typeLine(key);
    const hasDefault = Object.prototype.hasOwnProperty.call(DEFAULT_CONFIG, key);
    const def = hasDefault ? ` (default \`${JSON.stringify(DEFAULT_CONFIG[key])}\`${type ? `, ${type}` : ''})` : type ? ` (${type})` : '';
    lines.push(`- **${key}**${def}: ${desc}`);
  }
  lines.push(
    '',
    '### Keybindings',
    '',
    'Rebind any of these by setting `keybindings.<id>` to a chord string (e.g. `"Mod+Shift+P"` - "Mod" is Cmd on macOS, Ctrl elsewhere) or `null` to unbind:',
    '',
    ...DEFAULT_KEYBINDINGS.map((kb) => `- **${kb.id}** (${kb.title}): default \`${kb.chord}\``),
    '',
    '### Custom themes',
    '',
    'Easiest made in Settings -> "Create custom theme..." (three seed colors, then fine-tuned). By hand, each entry of `customThemes` is `{ id, label, dark, seed: { bg, fg, accent }, vars: { <css-variable-name>: <value> } }`.',
  );
  if (sourceDir) {
    lines.push(
      '',
      '### Beyond settings: customizing Bazinga itself',
      '',
      `This copy of Bazinga is running from its own source checkout at \`${sourceDir}\`, not a packaged build - so if a setting above isn't enough, you can change Bazinga's actual behavior by editing that source: \`src/main/*.js\` (the Electron main process), \`src/renderer/*.js\`/\`*.html\` (the UI), \`src/core/*.js\` (logic shared by both). There is no plugin API and no stable boundary here - this is the real application, so a future \`git pull\` or app update can silently conflict with or overwrite whatever you change. Commit your edits (their own branch or commits) as you go, so you can see and reapply them after an update rather than lose them to one. Riskier to get wrong: \`src/main/main.js\`'s IPC handlers, and anything touching file paths, credentials, or the merge guard. Safer to experiment with: \`src/renderer/*\` (UI and behavior), a new setting (add it to both \`src/core/config.js\` and \`src/core/configschema.js\`, plus a line in this file's own generator, \`src/core/settingsdoc.js\`), a new quality-gate check.`,
    );
  }
  lines.push(END);
  return lines.join('\n');
}

/** Upserts the block (always present - unlike skillindex.js/bendindex.js, there is no "remove" case here). Returns the new text, or null when nothing changed. */
function applyBlock(text, opts) {
  const current = String(text || '');
  const has = current.includes(START) && current.includes(END) && current.indexOf(START) < current.indexOf(END);
  const block = renderBlock(opts);
  if (has) {
    const next = current.slice(0, current.indexOf(START)) + block + current.slice(current.indexOf(END) + END.length);
    return next === current ? null : next;
  }
  const base = current.replace(/\s+$/, '');
  return `${base ? `${base}\n\n` : ''}${block}\n`;
}

module.exports = { START, END, DESCRIPTIONS, FILE_NOTES, allKeys, typeLine, renderBlock, applyBlock };
