'use strict';
// Talking to a local Ollama server: what is installed, what is loaded and with which context, and loading a model ahead of time.
const http = require('node:http');
const https = require('node:https');

const DEFAULT_URL = 'http://localhost:11434';
const MIN_CONTEXT = 32768;

/** The model named by --model in an agent command ("ollama_chat/" prefixes dropped). */
function modelOf(command) {
  const m = /--model[ =]["']?([^\s"']+)/.exec(command || '');
  return m ? m[1].replace(/^ollama(_chat)?\//, '') : '';
}

const loopback = (h) => h === 'localhost' || h === '::1' || /^127\./.test(h);

/** An address we treat as an Ollama-style model server: this machine, a machine on the local network, or anything on Ollama's port. Never Anthropic's API. */
function isModelServerUrl(url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (/(^|\.)anthropic\.com$/.test(h)) return false;
  if (u.port === '11434' || loopback(h)) return true;
  return /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^169\.254\./.test(h) || /\.(local|lan|home|internal)$/.test(h) || !h.includes('.');
}

/** Does this agent talk to a model server (here or on the network)? Returns { baseUrl, model, remote } or null. */
function localTarget(agent) {
  const env = (agent && agent.env) || {};
  const url = env.ANTHROPIC_BASE_URL || env.OLLAMA_API_BASE || '';
  if (agent && agent.api === 'openai') { // a server that speaks OpenAI's API (LM Studio, llama.cpp, vLLM, a gateway): any address except Anthropic's own
    let u; try { u = new URL(url); } catch { return null; }
    if (!/^https?:$/.test(u.protocol) || /(^|\.)anthropic\.com$/i.test(u.hostname)) return null;
    return { baseUrl: `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`, model: modelOf(agent.command), remote: !loopback(u.hostname.toLowerCase().replace(/^\[|\]$/g, '')), openai: true };
  }
  if (!url || !isModelServerUrl(url)) return null;
  const u = new URL(url);
  return { baseUrl: `${u.protocol}//${u.host}`, model: modelOf(agent.command), remote: !loopback(u.hostname.toLowerCase().replace(/^\[|\]$/g, '')) };
}

/** What the user typed in the "Ollama server" box -> a base URL, or null. "gpu-box" and "192.168.1.20:11434" are accepted. */
function normalizeBaseUrl(text) {
  let t = String(text || '').trim().replace(/\/+$/, '');
  if (!t) return DEFAULT_URL;
  if (!/^https?:\/\//i.test(t)) t = `http://${t}`;
  try {
    const u = new URL(t);
    if (!u.hostname) return null;
    return `${u.protocol}//${u.host}`.replace(/^(https?:\/\/[^:/]+)$/, (m) => (u.protocol === 'http:' ? `${m}:11434` : m));
  } catch { return null; }
}

function request(baseUrl, method, pathname, body, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(pathname, baseUrl); } catch (e) { reject(e); return; }
    const lib = u.protocol === 'https:' ? https : http;
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = lib.request(u, { method, headers: payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}, timeout: timeoutMs }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode >= 400) { reject(new Error(`HTTP ${res.statusCode}: ${text.slice(0, 200)}`)); return; }
        try { resolve(text ? JSON.parse(text) : {}); } catch { resolve({}); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const sameModel = (a, b) => {
  const norm = (n) => String(n || '').trim().toLowerCase().replace(/:latest$/, '');
  return !!a && !!b && norm(a) === norm(b);
};

/** { running, installed: [{name, size}], loaded: [{name, context, expiresAt}] } ; running=false when nothing answers. */
async function status(baseUrl = DEFAULT_URL, timeoutMs = 2500) {
  let tags;
  try { tags = await request(baseUrl, 'GET', '/api/tags', undefined, timeoutMs); } catch (e) { return { running: false, installed: [], loaded: [], error: e.message }; }
  let ps = {};
  try { ps = await request(baseUrl, 'GET', '/api/ps', undefined, timeoutMs); } catch { /* older servers: no loaded list */ }
  return {
    running: true,
    installed: (tags.models || []).map((m) => ({ name: m.name || m.model, size: m.size || 0 })),
    loaded: (ps.models || []).map((m) => ({ name: m.name || m.model, context: Number(m.context_length) || 0, expiresAt: m.expires_at || null, size: Number(m.size) || 0, sizeVram: Number(m.size_vram) || 0 })),
  };
}

/** Load a model into memory (and keep it for keepAlive, e.g. "15m") without generating anything. */
function warm(baseUrl, model, keepAlive = '15m', timeoutMs = 180000) {
  return request(baseUrl, 'POST', '/api/generate', { model, prompt: '', stream: false, keep_alive: keepAlive }, timeoutMs);
}

/**
 * Fill-in-the-middle inline completion: the text before the cursor (prompt) and after it (suffix, same file),
 * answered with just the continuation - Ollama's native /api/generate `suffix` field (codellama/qwen2.5-coder/
 * starcoder-style models honour it; a model without FIM training just answers as if suffix were not given, which
 * still works for end-of-line/end-of-file completions, only less well mid-function). No chat framing, no markdown
 * fencing: the raw continuation text is returned exactly as the model wrote it, suggestion ghost-text wants nothing else.
 */
async function complete(baseUrl, { model, prompt, suffix, numPredict = 128, timeoutMs = 6000 } = {}) {
  const res = await request(baseUrl, 'POST', '/api/generate', {
    model, prompt: String(prompt || ''), suffix: suffix ? String(suffix) : undefined, stream: false,
    options: { num_predict: numPredict, temperature: 0.2 },
  }, timeoutMs);
  return { text: typeof res.response === 'string' ? res.response : '' };
}

function serveCommand(platform = process.platform) {
  if (platform === 'win32') return '$env:OLLAMA_CONTEXT_LENGTH=32768; $env:OLLAMA_FLASH_ATTENTION=1; $env:OLLAMA_KV_CACHE_TYPE="q8_0"; ollama serve   (stop the Ollama tray app first)';
  return 'OLLAMA_CONTEXT_LENGTH=32768 OLLAMA_FLASH_ATTENTION=1 OLLAMA_KV_CACHE_TYPE=q8_0 ollama serve   (quit the Ollama menu bar app first)';
}

/** Turn a status into the problems worth telling the user about before an agent starts. target = { baseUrl, remote } */
function problems(st, model, platform = process.platform, target = {}) {
  const out = [];
  const where = target.remote ? ` at ${target.baseUrl}` : '';
  if (!st.running) {
    return [{ kind: 'not-running', text: target.remote
      ? `Ollama does not answer${where}. Check that it is running on that machine, that it listens on the network (start it with OLLAMA_HOST=0.0.0.0) and that a firewall allows port 11434.`
      : 'Ollama does not answer on this machine. Start it first (the Ollama app, or “ollama serve”).' }];
  }
  if (model && !st.installed.some((m) => sameModel(m.name, model))) out.push({ kind: 'missing-model', text: target.remote ? `The model “${model}” is not installed on the server${where}. On that machine run:  ollama pull ${model}` : `The model “${model}” is not installed. Run:  ollama pull ${model}` });
  else if (model) {
    const l = st.loaded.find((m) => sameModel(m.name, model));
    if (l && l.context && l.context < MIN_CONTEXT) out.push({ kind: 'small-context', text: `“${model}” is loaded with a ${l.context}-token context${where}. Claude Code needs at least ${MIN_CONTEXT}; with less, the model loses the start of the conversation and answers something else.\nRestart Ollama${target.remote ? ' on that machine' : ''} like this:\n${serveCommand(platform)}` });
  }
  return out;
}

/** Things worth a line in the status bar, but not worth a question (they do not stop the agent). */
function notes(st, model) {
  const out = [];
  const l = st.loaded.find((m) => sameModel(m.name, model));
  if (l && l.size && l.sizeVram && l.sizeVram < l.size * 0.9) out.push(`${model} runs partly on the CPU (${Math.round((l.sizeVram / l.size) * 100)}% in GPU memory): expect it to be slow. A smaller model or a shorter context would help.`);
  const others = st.loaded.filter((m) => !sameModel(m.name, model));
  if (others.length) out.push(`Also loaded in Ollama: ${others.map((m) => m.name).join(', ')} (uses memory).`);
  return out;
}

const isClaudeCommand = (command) => /^\s*(?:[^\s]*[\\/])?claude(?:\.exe|\.cmd)?(?:\s|$)/i.test(String(command || ''));
const SAFE_MODEL = /^[A-Za-z0-9][A-Za-z0-9._\-\/]*(:[A-Za-z0-9._\-]+)?$/;

/**
 * Settings that make Claude Code behave with a model server instead of Anthropic's API. The agent's own env always wins over these.
 * - every model alias (haiku = background work such as titles, sonnet, opus) points at the one local model: otherwise Claude Code asks
 *   for models the server does not have, or makes Ollama swap models for background calls
 * - no calls home (updater, telemetry, surveys), no extra background model calls (prompt suggestions, terminal titles)
 * - no experimental beta headers or thinking parameter, which gateways reject ("Extra inputs are not permitted")
 * - the real context window, so Claude Code compacts the conversation before the server cuts it off silently
 * - a stable prompt start (no changing attribution block) so the server can reuse its cached prompt instead of re-reading it every turn
 * - long timeouts: loading a model and reading a long prompt take minutes on a laptop
 */
/**
 * How many tokens Claude Code may reserve for one reply. For a model name it does not know (every local model) Claude Code
 * reserves 32000, taken out of the context window: on a 32k window that leaves almost nothing, and “Context limit
 * reached” appears right after reading one file. A quarter of the window, at most `wanted` (default 8192), at least 1024.
 */
function maxOutputTokens(context, wanted) {
  const ctx = context && context >= MIN_CONTEXT ? context : MIN_CONTEXT;
  const w = Number.isFinite(Number(wanted)) && Number(wanted) > 0 ? Math.floor(Number(wanted)) : 8192;
  return Math.max(1024, Math.min(w, Math.floor(ctx / 4)));
}

function claudeEnv(model, context, { maxOutput } = {}) {
  const env = {
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: '1',
    CLAUDE_CODE_DISABLE_THINKING: '1',
    CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: 'false',
    CLAUDE_CODE_DISABLE_TERMINAL_TITLE: '1',
    CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY: '1',
    CLAUDE_CODE_ATTRIBUTION_HEADER: '0',
    API_TIMEOUT_MS: '1800000',
    API_FORCE_IDLE_TIMEOUT: '0',
    CLAUDE_CODE_MAX_CONTEXT_TOKENS: String(context && context >= MIN_CONTEXT ? context : MIN_CONTEXT),
    CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(maxOutputTokens(context, maxOutput)),
    // one file read may fill 25000 tokens by default: most of a 32k window. A quarter of the window; the model is told to read the rest in parts.
    CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS: String(Math.floor((context && context >= MIN_CONTEXT ? context : MIN_CONTEXT) / 4)),
  };
  if (model && SAFE_MODEL.test(model)) Object.assign(env, { ANTHROPIC_DEFAULT_HAIKU_MODEL: model, ANTHROPIC_DEFAULT_SONNET_MODEL: model, ANTHROPIC_DEFAULT_OPUS_MODEL: model });
  return env;
}

const contextLabel = (n) => (n ? `${Math.round(n / 1024)}k` : '');

module.exports = { notes, claudeEnv, maxOutputTokens, isClaudeCommand, isModelServerUrl, normalizeBaseUrl, DEFAULT_URL, MIN_CONTEXT, modelOf, localTarget, request, status, warm, complete, problems, serveCommand, sameModel, contextLabel };
