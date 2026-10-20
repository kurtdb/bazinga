'use strict';
/**
 * `bazinga proxy`: the tool-call helper on its own. Put it between Claude Code and Ollama / LM Studio / llama.cpp / vLLM:
 *
 *   bazinga proxy --upstream http://localhost:11434 --port 8787
 *   ANTHROPIC_BASE_URL=http://127.0.0.1:8787 ANTHROPIC_AUTH_TOKEN=x claude --model qwen3:14b
 */
const { createProxy } = require('./toolproxy');

const HELP = `bazinga proxy: repairs the tool calls of local models so Claude Code works with them

  bazinga proxy --upstream <url> [options]

  --upstream <url>     the model server, e.g. http://localhost:11434 (Ollama) or http://localhost:1234 (LM Studio)
  --format anthropic   the server speaks Anthropic's API (Ollama 0.14+, default)
  --format openai      the server speaks the OpenAI Chat Completions API (LM Studio, llama.cpp, vLLM); translated on the fly
  --port <n>           listen on this port (default 8787, 0 = any free port)
  --no-lean            keep Claude Code's full tool descriptions (default: shortened, small models cope better)
  --no-repair          pass tool calls through untouched
  --hint <text>        a standing instruction added to every request
  --capture <dir>      write the shapes of requests and replies (every text replaced by its length) to this folder, to send as test fixtures
  --quiet              do not print one line per request

Then start Claude Code with:
  ANTHROPIC_BASE_URL=http://127.0.0.1:<port> ANTHROPIC_AUTH_TOKEN=local claude --model <model name>
`;

function parseArgs(argv) {
  const a = { upstream: '', format: 'anthropic', port: 8787, lean: true, repair: true, hint: '', quiet: false, help: false, capture: '' };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--upstream') a.upstream = argv[++i] || '';
    else if (k === '--format') a.format = argv[++i] || '';
    else if (k === '--port') a.port = Number(argv[++i]);
    else if (k === '--capture') { a.capture = argv[++i] || ''; if (!a.capture) a.captureMissing = true; }
    else if (k === '--hint') a.hint = argv[++i] || '';
    else if (k === '--no-lean') a.lean = false;
    else if (k === '--no-repair') a.repair = false;
    else if (k === '--quiet') a.quiet = true;
    else if (k === '-h' || k === '--help') a.help = true;
    else a.unknown = k;
  }
  return a;
}

function validate(a) {
  if (a.unknown) return `Unknown option: ${a.unknown}`;
  if (!a.upstream) return 'Missing --upstream <url> (for example http://localhost:11434).';
  try { const u = new URL(a.upstream); if (!/^https?:$/.test(u.protocol)) throw new Error('x'); } catch { return `Not a web address: ${a.upstream}`; }
  if (a.captureMissing) return '--capture needs a folder.';
  if (!['anthropic', 'openai'].includes(a.format)) return '--format must be anthropic or openai.';
  if (!Number.isInteger(a.port) || a.port < 0 || a.port > 65535) return '--port must be a number between 0 and 65535.';
  return '';
}

/** Starts the proxy; resolves with the handle (`url`, `close`). */
async function start(a, log = console.log) {
  let onCapture = null;
  if (a.capture) { const { Capture, modelRecorder } = require('./capture'); onCapture = modelRecorder(new Capture({ dir: require('node:path').resolve(a.capture), enabled: () => true })); }
  const proxy = await createProxy({ onCapture, upstream: a.upstream, lean: a.lean, repair: a.repair, hint: a.hint, format: a.format, port: a.port, onLog: a.quiet ? null : (l) => log(l) });
  return proxy;
}

async function main(argv, { out = console.log, err = console.error } = {}) {
  const a = parseArgs(argv);
  if (a.help) { out(HELP); return 0; }
  const bad = validate(a);
  if (bad) { err(`${bad}\n\n${HELP}`); return 2; }
  let proxy;
  try { proxy = await start(a, out); } catch (e) { err(e.code === 'EADDRINUSE' ? `Port ${a.port} is in use. Pick another with --port.` : `Could not start: ${e.message}`); return 1; }
  out(`Bazinga proxy listening on ${proxy.url}  ->  ${a.upstream} (${a.format}${a.lean ? ', lean' : ''}${a.repair ? ', repair' : ''})`);
  out(`Start Claude Code with:  ANTHROPIC_BASE_URL=${proxy.url} ANTHROPIC_AUTH_TOKEN=local claude --model <model>`);
  return new Promise((resolve) => { const stop = () => proxy.close().then(() => resolve(0)); process.once('SIGINT', stop); process.once('SIGTERM', stop); });
}

module.exports = { HELP, parseArgs, validate, start, main };
