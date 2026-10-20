'use strict';
/**
 * "Setup & health": one row per thing Bazinga can do, with a light, a sentence a normal person understands, and (when there is
 * something to do) one button. Pure: the window gathers the facts, this decides what to say. Nothing here starts anything.
 *
 * state: ok (works), off (switched off on purpose, nothing wrong), warn (works, but look), bad (does not work, and the user wants it to)
 * action: { id, label } where id is handled by the window (build-image, jev-key, ...), or { copy, label } for a command to paste.
 */

const row = (id, label, state, text, action = null, group = 'main') => ({ id, label, state, text, action, group });

function claudeRow(f) {
  const t = f.tools.claude;
  if (t && t.ok) return row('claude', 'Claude Code', 'ok', `Found${t.version ? ` (version ${t.version})` : ''}. The Claude button in the top bar starts it.`);
  return row('claude', 'Claude Code', 'bad', 'Not found, so the Claude button cannot start it. Install it once, then press “Check again”.', { copy: 'npm install -g @anthropic-ai/claude-code', label: 'Copy install command' });
}

function localModelRows(f) {
  const agents = (f.localAgents || []);
  if (!agents.length) return [row('local', 'Local models', 'off', 'No agent in your settings uses a local model. Settings → Agents has presets for Ollama and LM Studio.')];
  const o = f.ollama || {};
  const ollamaAgents = agents.filter((a) => !a.openai);
  const out = [];
  if (ollamaAgents.length) {
    if (!o.running) out.push(row('ollama', 'Ollama', 'bad', `Not running, so ${ollamaAgents.map((a) => a.agent).join(', ')} cannot answer. Start Ollama (the app, or “ollama serve”), then press “Check again”.`, { copy: 'ollama serve', label: 'Copy command' }));
    else {
      const have = new Set((o.installed || []).map((m) => m.name));
      const missing = ollamaAgents.filter((a) => a.model && !have.has(a.model) && !have.has(`${a.model}:latest`));
      if (missing.length) out.push(row('ollama', 'Ollama', 'bad', `Running, but the model ${missing[0].model} (used by ${missing[0].agent}) is not downloaded yet.`, { copy: `ollama pull ${missing[0].model}`, label: 'Copy download command' }));
      else out.push(row('ollama', 'Ollama', 'ok', `Running with ${(o.installed || []).length} model${(o.installed || []).length === 1 ? '' : 's'} downloaded; the models your agents use are there.`));
    }
  }
  for (const a of agents.filter((x) => x.openai)) {
    out.push(a.reachable === false
      ? row(`server-${a.agent}`, `Model server for ${a.agent}`, 'bad', `${a.baseUrl} does not answer. Start LM Studio / llama.cpp / vLLM and its local server, then press “Check again”.`)
      : row(`server-${a.agent}`, `Model server for ${a.agent}`, 'ok', `${a.baseUrl} answers.`));
  }
  return out;
}

function dockerRow(f) {
  const d = f.docker || {};
  if (!d.docker) return row('docker', 'Safer runs (Docker)', 'off', 'Agents run directly on this computer. Install Docker if you want them inside a container, with only the run’s folder visible.');
  if (!d.image) return row('docker', 'Safer runs (Docker)', 'off', 'Docker is installed. One click builds the agent image (a few minutes, once); after that agents can run in a container.', { id: 'build-image', label: 'Build the image' });
  if (!d.enabled) return row('docker', 'Safer runs (Docker)', 'off', 'Ready to use. You can tick “Run in a Docker container” per run, or switch it on for all runs.', { id: 'container-on', label: 'Use for all runs' });
  return row('docker', 'Safer runs (Docker)', 'ok', 'On: agent runs start inside a container.', { id: 'container-off', label: 'Switch off' });
}

function hooksRow(f) {
  if (f.hooksOn === false) return row('hooks', 'Claude Code reports itself', 'off', 'Off. Bazinga guesses that Claude is done when its terminal goes quiet, which is less exact.', { id: 'hooks-on', label: 'Switch on' });
  return row('hooks', 'Claude Code reports itself', 'ok', f.hookSeen ? 'Working: Claude Code told Bazinga when it finished.' : 'On. It shows as working after the first Claude Code run that Bazinga starts.', { id: 'hooks-off', label: 'Switch off' });
}

function jevRow(f) {
  const j = f.jev || {};
  if (!j.enabled) return row('jev', 'Smarter task recognition (Jev)', 'off', 'Off. Task kinds (bug fix, tests, …) are recognised by keywords on this computer. Jev is an optional online model; only the task text would be sent.', { id: 'jev-setup', label: 'Set up…' });
  if (!j.hasKey) return row('jev', 'Smarter task recognition (Jev)', 'warn', 'Switched on, but there is no key yet, so the keyword rules are used. Paste your TypeSafe key to finish.', { id: 'jev-setup', label: 'Add key…' });
  return row('jev', 'Smarter task recognition (Jev)', 'ok', 'On. Only the task text is sent to TypeSafe; if Jev does not answer, keywords take over.', { id: 'jev-setup', label: 'Change…' });
}

function copilotRow(f) {
  if (!(f.copilot && f.copilot.enabled)) return row('copilot', 'GitHub Copilot usage', 'off', 'Off. Only for people with a Copilot licence: adds a shortcut to see how much of your monthly allowance is used.', { id: 'copilot-on', label: 'I use Copilot' }, 'advanced');
  return row('copilot', 'GitHub Copilot usage', 'ok', 'Bazinga cannot read the numbers itself, but the button opens the page that shows them (used so far and reset date). In your editor, the Copilot icon in the status bar shows the same.', { id: 'copilot-usage', label: 'Open my usage' });
}

function captureRow(f) {
  return f.captureOn
    ? row('capture', 'Record traffic shapes (for bug reports)', 'warn', 'ON. Bazinga is saving the shape of what agents send (never the text). Turn it off when you have what you need.', { id: 'capture-off', label: 'Turn off' }, 'advanced')
    : row('capture', 'Record traffic shapes (for bug reports)', 'off', 'Off. Turn it on only if you were asked for a capture file; text is never saved, only shapes.', { id: 'capture-on', label: 'Turn on' }, 'advanced');
}

function versionRow(f) {
  const d = f.drift || {};
  if (!d.version) return row('version', 'Claude Code version', 'off', 'No version seen yet. It is recorded the first time Claude Code starts.', null, 'advanced');
  if (d.newer) return row('version', 'Claude Code version', 'warn', `Claude Code ${d.version} is newer than ${d.tested}, the version you confirmed. If everything works, confirm this one so this stops showing.`, { id: 'confirm-version', label: 'It works: confirm' }, 'advanced');
  if (!d.tested) return row('version', 'Claude Code version', 'off', `Claude Code ${d.version}. If it works well for you, confirm it: Bazinga then tells you when a newer version appears.`, { id: 'confirm-version', label: 'It works: confirm' }, 'advanced');
  return row('version', 'Claude Code version', 'ok', `Claude Code ${d.version}, confirmed.`, null, 'advanced');
}

function hookRow(f) {
  const h = f.gitHook;
  if (!h) return null;
  if (h.installed) return row('githook', 'Check before you push (git hook)', 'ok', 'Installed: a push that breaks the guard rules is stopped on this computer.', { id: 'hook-remove', label: 'Remove' }, 'advanced');
  if (!h.possible) return row('githook', 'Check before you push (git hook)', 'off', 'Available from the command line: “bazinga hook install” inside the project (needs Bazinga’s source folder, not the installed app).', null, 'advanced');
  return row('githook', 'Check before you push (git hook)', 'off', 'Not installed. It runs the guard rules before every push, so a bad branch is stopped before the pull request.', { id: 'hook-install', label: 'Install' }, 'advanced');
}

function configRow(f) {
  const n = (f.configProblems || []).length;
  return n ? row('config', 'Settings file', 'warn', `${n} thing${n === 1 ? '' : 's'} in your settings look wrong: ${f.configProblems[0]}`, null, 'advanced') : null;
}

/** @param {object} f facts gathered by the window; see main.js `health:get` */
function evaluate(f) {
  const rows = [claudeRow(f), ...localModelRows(f), dockerRow(f), hooksRow(f), jevRow(f), copilotRow(f), hookRow(f), versionRow(f), captureRow(f), configRow(f)].filter(Boolean);
  const bad = rows.filter((r) => r.state === 'bad').length; const warn = rows.filter((r) => r.state === 'warn').length;
  return { rows, bad, warn, summary: bad ? `${bad} thing${bad === 1 ? ' needs' : 's need'} your attention.` : warn ? 'Everything you use works; a few things are worth a look.' : 'Everything you use works.' };
}

module.exports = { evaluate };
