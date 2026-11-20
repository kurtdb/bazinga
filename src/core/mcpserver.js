'use strict';
/**
 * Bazinga as an MCP server, so an agent can ask about the other runs ("is the backend run done?", "what is blocking?") and, after you
 * confirm in a dialog, start a run of its own. Streamable HTTP on 127.0.0.1, one random address per agent (/mcp/<token>), the Host header
 * must be this machine (no DNS rebinding from a web page). Opt-in (setting mcp.server). Everything real happens in the window; this
 * file only speaks the protocol and hands calls to `handlers`.
 */
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { z } = require('zod');

const newToken = () => crypto.randomBytes(12).toString('hex');
const MAX_STARTS = 5; // runs one agent may ask for (each one needs your OK anyway)

const text = (value) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] });
const fail = (message) => ({ isError: true, content: [{ type: 'text', text: String(message) }] });

class BazingaMcp {
  /** handlers: { listRuns(caller), runStatus(caller, id), startRun(caller, { task, name, agent }),
   *   recall(caller, { query, path, limit }), remember(caller, { text, files }) } -> value | { error } */
  constructor({ handlers, log = () => {} } = {}) {
    this.handlers = handlers;
    this.log = log;
    this.server = null; this.port = 0;
    this.tokens = new Map(); // token -> { id: terminal id, starts }
  }

  get base() { return `http://127.0.0.1:${this.port}`; }

  async start() {
    if (this.server) return this.base;
    this.server = http.createServer((req, res) => this._handle(req, res).catch((err) => { this.log(`error: ${err.message}`); if (!res.headersSent) { res.writeHead(500); res.end(); } }));
    await new Promise((resolve, reject) => { this.server.once('error', reject); this.server.listen(0, '127.0.0.1', resolve); });
    this.port = this.server.address().port;
    if (this.server.unref) this.server.unref();
    return this.base;
  }

  bind(token, id) { if (/^[0-9a-f]{24}$/.test(String(token))) this.tokens.set(String(token), { id, starts: 0 }); }
  unbind(id) { for (const [t, v] of this.tokens) if (v.id === id) this.tokens.delete(t); }

  _tools(caller) {
    const h = this.handlers;
    const server = new McpServer({ name: 'bazinga', version: '1.0.0' });
    const run = async (fn) => { try { const r = await fn(); return r && r.error ? fail(r.error) : text(r); } catch (err) { return fail(err.message); } };
    server.registerTool('list_runs', { description: 'List the agent runs in this Bazinga project: id, name, agent, branch, how many files changed and whether the run is working, waiting for the user, or finished.' }, () => run(() => h.listRuns(caller.id)));
    server.registerTool('run_status', { description: 'Details of one agent run: state, changed files, commits, tokens used, subagents, last error.', inputSchema: { id: z.string().max(100).describe('Run id from list_runs') } }, ({ id }) => run(() => h.runStatus(caller.id, id)));
    server.registerTool('start_run', {
      description: 'Ask Bazinga to start another agent run in its own git worktree. The user is shown a confirmation dialog with your task text and must accept. Use it for work that is independent of what you are doing.',
      inputSchema: { task: z.string().min(5).max(8000).describe('The complete task for the new agent'), name: z.string().max(60).optional(), agent: z.string().max(60).optional().describe('Name of a configured agent; default: the same kind as yours') },
    }, ({ task, name, agent }) => run(async () => {
      if (caller.starts >= MAX_STARTS) return { error: `This agent has already asked for ${MAX_STARTS} runs; ask the user.` };
      caller.starts++;
      return h.startRun(caller.id, { task, name, agent });
    }));
    server.registerTool('recall', {
      description: 'Look up things earlier agent runs learned about this codebase (gotchas, prior breakage, notes about a file). Simple keyword/path filtering, not semantic search.',
      inputSchema: { query: z.string().max(200).optional().describe('Words to look for in remembered notes'), path: z.string().max(300).optional().describe('A file path (or folder prefix) the note should mention'), limit: z.number().int().min(1).max(50).optional() },
    }, (args) => run(() => h.recall(caller.id, args || {})));
    server.registerTool('remember', {
      description: 'Save one short, concrete fact about this codebase for future agent runs to see (e.g. "the retry logic in X swallows ECONNRESET"). Not for task status or opinions - durable, specific facts only. Appears in a capped summary at the start of later runs, so keep it short.',
      inputSchema: { text: z.string().min(3).max(500).describe('The fact to remember, as one or two sentences'), files: z.array(z.string().max(300)).max(20).optional().describe('Relevant file paths') },
    }, ({ text, files }) => run(() => h.remember(caller.id, { text, files })));
    return server;
  }

  async _handle(req, res) {
    const m = /^\/mcp\/([0-9a-f]{24})$/.exec(String(req.url || '').split('?')[0]);
    const deny = (code, msg) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: msg }, id: null })); };
    if (!m) { req.resume(); return deny(404, 'not found'); }
    if (req.headers.origin) { req.resume(); return deny(403, 'browsers are not allowed here'); }
    if (!['127.0.0.1:' + this.port, 'localhost:' + this.port].includes(String(req.headers.host || ''))) { req.resume(); return deny(403, 'wrong host'); }
    const caller = this.tokens.get(m[1]);
    if (!caller) { req.resume(); return deny(401, 'unknown agent'); }
    if (req.method !== 'POST') { req.resume(); return deny(405, 'POST only (stateless server)'); }
    let data = '';
    for await (const c of req) { data += c; if (data.length > 2e6) return deny(413, 'too large'); }
    let body; try { body = JSON.parse(data || '{}'); } catch { return deny(400, 'invalid JSON'); }
    const server = this._tools(caller);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { transport.close().catch(() => {}); server.close().catch(() => {}); });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  }

  close() { if (this.server) { try { this.server.close(); } catch { /* closed */ } this.server = null; } }
}

/** The file Claude Code reads with --mcp-config. */
function writeConfig(dir, base, token) {
  fs.mkdirSync(dir, { recursive: true });
  try { for (const f of fs.readdirSync(dir)) { const p = path.join(dir, f); if (Date.now() - fs.statSync(p).mtimeMs > 24 * 3600e3) fs.unlinkSync(p); } } catch { /* tidy up only */ }
  const file = path.join(dir, `${token}.json`);
  fs.writeFileSync(file, JSON.stringify({ mcpServers: { bazinga: { type: 'http', url: `${base}/mcp/${token}` } } }, null, 2));
  return file;
}

/** `claude ...` -> `claude ... --mcp-config "file"`; other commands, or one that already has --mcp-config, are left alone. */
function injectConfig(cmd, file) {
  const c = String(cmd || '');
  if (!/^\s*(?:[^\s]*[\\/])?claude(?:\.exe|\.cmd)?(?:\s|$)/i.test(c) || /(^|\s)--mcp-config(\s|=)/.test(c)) return c;
  return `${c} --mcp-config "${file}"`;
}

module.exports = { BazingaMcp, newToken, writeConfig, injectConfig, MAX_STARTS };
