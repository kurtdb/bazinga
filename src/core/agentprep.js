'use strict';
// Everything done to an agent's command just before its terminal starts (see main.js 'agent:prepare').
const path = require('node:path');
const ollama = require('./ollama');
const agenthint = require('./agenthint');
const folderroles = require('./folderroles');
const otelCore = require('./otel');
const openaiAdapter = require('./openaiadapter');
const mcpCore = require('./mcpserver');
const hooksCore = require('./hooks');
const agentmemory = require('./agentmemory');

/** Claude Code on a small local model should not get skills, subagents or MCP servers: it loaded the "simplify" skill for a refactor task, started
 *  four subagents of its own and worked for over an hour. Only the file and shell tools stay, whatever an older saved button says. */
const LOCAL_TOOLS = 'Read,Write,Edit,Bash,Glob,Grep';
function restrictClaude(cmd) {
  const c = String(cmd || '');
  if (!/^claude(\s|$)/.test(c)) return c;
  let out = c;
  if (!/(^|\s)--(tools|allowedTools|allowed-tools)(\s|=)/.test(out)) out += ` --tools ${LOCAL_TOOLS}`;
  if (!/(^|\s)--disable-slash-commands(\s|$)/.test(out)) out += ' --disable-slash-commands';
  if (!/(^|\s)--strict-mcp-config(\s|$)/.test(out)) out += ' --strict-mcp-config';
  return out;
}

async function prepare(agent, { root, hintDir, config = {}, api = ollama, inUse = [], proxies = null, onLog = null, onUsage = null, onCapture = null, hooks = null, otel = null, mcp = null, memory = null } = {}) {
  const out = { command: String(agent.command || ''), taskCommand: agent.taskCommand ? String(agent.taskCommand) : undefined, local: null };
  const target = api.localTarget(agent);
  // qwen3 "thinks" at length before every answer, which on a laptop can take minutes or never end: its own switch turns that off
  const noThink = !!target && api.isClaudeCommand(agent.command) && /^qwen3/i.test(target.model || '') && (config.ollama || {}).noThink !== false;
  let text = '';
  let memoryIndex = '';
  if (memory && memory.dir && root) {
    try { memoryIndex = agentmemory.buildIndex(agentmemory.readAll(agentmemory.fileFor(memory.dir, root))); } catch { /* no memory is better than no agent */ }
  }
  try {
    text = agenthint.compose({ agentHint: agent.hint, projectHint: root ? agenthint.readProjectHint(root) : '', layout: root ? folderroles.describeAll(root, config.folders, { maxLines: config.foldersFiles === undefined ? 60 : Number(config.foldersFiles) }) : '', memoryIndex, extra: noThink ? '/no_think' : '' });
    const file = agenthint.writeHintFile(hintDir, text);
    if (file) {
      out.command = agenthint.withHintFile(out.command, file);
      if (out.taskCommand) out.taskCommand = agenthint.withHintFile(out.taskCommand, file);
      out.hintFile = file;
    }
  } catch { /* no hint is better than no agent */ }
  if (target && target.openai) {
    // a server that speaks OpenAI's API: nothing to load or unload, but Claude Code needs the translating helper in between
    const oc = config.ollama || {};
    const key = (agent.env || {}).ANTHROPIC_AUTH_TOKEN || (agent.env || {}).ANTHROPIC_API_KEY || '';
    const st = await openaiAdapter.status(target.baseUrl, { apiKey: key });
    const ctx = Number(agent.context) > 0 ? Math.floor(Number(agent.context)) : 0;
    const problems = [];
    if (!st.running) problems.push({ kind: 'not-running', text: `The model server does not answer at ${target.baseUrl}${st.error ? ` (${st.error})` : ''}. Start it first (in LM Studio: the Developer tab, “Start Server”).` });
    else if (st.auth === false) problems.push({ kind: 'auth', text: st.error });
    else if (target.model && st.models.length && !st.models.includes(target.model)) problems.push({ kind: 'missing-model', text: `The server does not list a model called “${target.model}”. It has: ${st.models.slice(0, 8).join(', ')}${st.models.length > 8 ? ', …' : ''}.` });
    out.local = { ...target, noThink: false, running: st.running, context: ctx, contextLabel: api.contextLabel(ctx), problems, keepWarm: false, keepAlive: '', notes: [] };
    if (api.isClaudeCommand(agent.command)) {
      if (oc.restrictTools !== false) {
        out.command = restrictClaude(out.command);
        if (out.taskCommand) out.taskCommand = restrictClaude(out.taskCommand);
        out.local.restricted = true;
      }
      out.env = api.claudeEnv(target.model, ctx, { maxOutput: oc.maxOutputTokens });
      if (proxies && st.running) {
        try {
          const lean = oc.lean !== false; const repair = oc.repair !== false;
          const p = await proxies.ensure({ upstream: target.baseUrl, lean, repair, hint: text, root, onLog, onUsage, onCapture, format: 'openai' });
          const token = hooksCore.newToken().slice(0, 16);
          out.envForce = { ANTHROPIC_BASE_URL: `${p.url}/t/${token}` };
          out.local.proxy = { url: p.url, lean, repair, token, format: 'openai' };
        } catch (err) { out.local.problems.push({ kind: 'proxy', text: `Bazinga's translator for this server could not start (${err.message}), and Claude Code cannot talk to an OpenAI-style server without it.` }); }
      }
    }
  } else if (target) {
    const oc = config.ollama || {};
    let st = await api.status(target.baseUrl);
    const installed = target.model && st.installed.some((m) => api.sameModel(m.name, target.model));
    if (st.running && installed && !st.loaded.some((m) => api.sameModel(m.name, target.model))) {
      // a 16 GB laptop cannot hold two models: unload the others first (never on a server shared with other people)
      if (!target.remote && oc.unloadOthers !== false) {
        const idle = st.loaded.filter((m) => !inUse.some((u) => api.sameModel(u, m.name))); // not the model of a terminal that is still open
        for (const o of idle) { try { await api.warm(target.baseUrl, o.name, '0', 30000); } catch { /* it unloads by itself later */ } }
        out.unloaded = idle.map((m) => m.name);
      }
      try { await api.warm(target.baseUrl, target.model, oc.keepAlive || '15m'); st = await api.status(target.baseUrl); } catch (err) { out.warmError = err.message; }
    }
    const l = st.loaded.find((m) => api.sameModel(m.name, target.model));
    out.local = { ...target, noThink, running: st.running, context: (l && l.context) || 0, contextLabel: api.contextLabel(l && l.context), problems: api.problems(st, target.model, process.platform, target), keepWarm: oc.keepWarm !== false, keepAlive: oc.keepAlive || '15m', notes: api.notes(st, target.model) };
    // Claude Code on a model server: the settings that make it behave (the agent's own env wins)
    if (api.isClaudeCommand(agent.command)) {
      if (oc.restrictTools !== false) {
        out.command = restrictClaude(out.command);
        if (out.taskCommand) out.taskCommand = restrictClaude(out.taskCommand);
        out.local.restricted = true;
      }
      out.env = api.claudeEnv(target.model, out.local.context, { maxOutput: oc.maxOutputTokens });
      // between Claude Code and the model server: records what goes over the wire, repairs tool calls, slims the prompt
      if (proxies && oc.proxy !== false && st.running) {
        try {
          const lean = oc.lean !== false; const repair = oc.repair !== false;
          const p = await proxies.ensure({ upstream: target.baseUrl, lean, repair, hint: text, root, onLog, onUsage, onCapture });
          const token = hooksCore.newToken().slice(0, 16); // this agent's own address prefix: its usage is counted separately
          out.envForce = { ANTHROPIC_BASE_URL: `${p.url}/t/${token}` }; // wins over the agent's own address: that one is where the proxy forwards to
          out.local.proxy = { url: p.url, lean, repair, token };
        } catch (err) { out.local.notes = [...out.local.notes, `Bazinga's tool-call helper could not start (${err.message}); Claude Code talks to the model server directly.`]; }
      }
    }
  }
  // Claude Code reports by itself when it is done or needs permission (see core/hooks.js)
  if (hooks && hooks.server && ollama.isClaudeCommand(agent.command)) {
    try {
      const base = await hooks.server.start();
      const token = hooksCore.newToken();
      const file = hooksCore.writeSettings(hooks.dir, base, token, { statusLine: hooks.statusLine });
      out.command = hooksCore.injectSettings(out.command, file);
      if (out.taskCommand) out.taskCommand = hooksCore.injectSettings(out.taskCommand, file);
      out.hook = { token };
      // a company proxy must not swallow the call to this machine
      const np = [process.env.NO_PROXY || process.env.no_proxy || '', '127.0.0.1', 'localhost'].filter(Boolean).join(',');
      out.envForce = { ...(out.envForce || {}), NO_PROXY: np, no_proxy: np };
    } catch (err) { if (out.local) out.local.notes = [...(out.local.notes || []), `Hooks could not start (${err.message}); Bazinga guesses from the terminal when the agent is done.`]; }
  }
  // Bazinga as an MCP server for this agent (opt-in; cloud agents only: a small local model does better with fewer tools)
  if (mcp && mcp.server && ollama.isClaudeCommand(agent.command) && !out.local) {
    try {
      const base = await mcp.server.start();
      const token = mcpCore.newToken();
      const file = mcpCore.writeConfig(mcp.dir, base, token);
      out.command = mcpCore.injectConfig(out.command, file);
      if (out.taskCommand) out.taskCommand = mcpCore.injectConfig(out.taskCommand, file);
      out.mcp = { token };
    } catch { /* the agent works without it */ }
  }
  // Claude Code's own numbers (tokens, cost, tool use) through OpenTelemetry, for cloud agents only (a local model is counted by the helper)
  if (otel && otel.server && ollama.isClaudeCommand(agent.command) && !out.local && !otelCore.alreadyConfigured(agent.env)) {
    try {
      const base = await otel.server.start();
      const token = otelCore.OtelReceiver.newToken();
      out.otel = { token };
      const np = [process.env.NO_PROXY || process.env.no_proxy || '', '127.0.0.1', 'localhost'].filter(Boolean).join(',');
      out.envForce = { ...(out.envForce || {}), ...otelCore.envFor(base, token), NO_PROXY: np, no_proxy: np };
    } catch { /* the transcript is the fallback */ }
  }
  return out;
}

module.exports = { restrictClaude, LOCAL_TOOLS, prepare, hintDirFor: (userData) => path.join(userData, 'hints') };
