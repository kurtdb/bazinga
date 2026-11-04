'use strict';
/**
 * Opt-in language intelligence (hover, go to definition, find references, completion, signature help, diagnostics) through any
 * Language Server Protocol server over stdio: jdtls for Java, pyright for Python, typescript-language-server for TS/JS,
 * gopls for Go, rust-analyzer for Rust, csharp-ls for C#...
 * Nothing is bundled or started unless you enable it (settings or .ide/config.json: { "lsp": { "enabled": true } }) and the server is installed.
 * Documents are synchronised with full-text changes (simple and robust; the renderer debounces them).
 */
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const crypto = require('node:crypto');
const path = require('node:path');
const { pathToFileURL, fileURLToPath } = require('node:url');
const { toPosix } = require('./util');

/** command/args may use {workspace}: a private data folder per project for servers that need one (jdtls). */
const DEFAULT_SERVERS = {
  java: { command: 'jdtls', args: ['-data', '{workspace}'], extensions: ['java'] },
  python: { command: 'pyright-langserver', args: ['--stdio'], extensions: ['py'] },
  typescript: { command: 'typescript-language-server', args: ['--stdio'], extensions: ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'] },
  go: { command: 'gopls', args: [], extensions: ['go'] },
  rust: { command: 'rust-analyzer', args: [], extensions: ['rs'] },
  csharp: { command: 'csharp-ls', args: [], extensions: ['cs'] },
};
const LSP_LANGUAGE_ID = { py: 'python', java: 'java', ts: 'typescript', tsx: 'typescriptreact', js: 'javascript', jsx: 'javascriptreact', mjs: 'javascript', cjs: 'javascript', kt: 'kotlin', go: 'go', rs: 'rust', cs: 'csharp', yml: 'yaml', yaml: 'yaml' };
/** The Monaco language id for an extension (what the editor registers its providers for). */
const MONACO_LANGUAGE = { py: 'python', java: 'java', ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript', kt: 'kotlin', go: 'go', rs: 'rust', cs: 'csharp', yml: 'yaml', yaml: 'yaml' };

// ------------------------------------------------------------------ JSON-RPC over stdio

class LspClient extends EventEmitter {
  constructor(child) {
    super();
    this.child = child;
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = Buffer.alloc(0);
    this.closed = false;
    child.stdout.on('data', (d) => this._onData(d));
    child.stderr.on('data', () => { /* servers log a lot there */ });
    child.on('exit', (code) => this._close(`exited with code ${code}`));
    child.on('error', (err) => this._close(err.code === 'ENOENT' ? 'not installed' : err.message, err.code));
  }

  _close(reason, code) {
    if (this.closed) return;
    this.closed = true;
    for (const { reject, timer } of this.pending.values()) { clearTimeout(timer); reject(new Error(`language server ${reason}`)); }
    this.pending.clear();
    this.emit('close', reason, code);
  }

  _send(msg) {
    if (this.closed) return;
    const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...msg }), 'utf8');
    try { this.child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`); this.child.stdin.write(body); } catch { /* closed */ }
  }

  _onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const headEnd = this.buffer.indexOf('\r\n\r\n');
      if (headEnd < 0) return;
      const m = /Content-Length:\s*(\d+)/i.exec(this.buffer.subarray(0, headEnd).toString('ascii'));
      if (!m) { this.buffer = this.buffer.subarray(headEnd + 4); continue; }
      const len = Number(m[1]);
      if (this.buffer.length < headEnd + 4 + len) return;
      const body = this.buffer.subarray(headEnd + 4, headEnd + 4 + len).toString('utf8');
      this.buffer = this.buffer.subarray(headEnd + 4 + len);
      let msg;
      try { msg = JSON.parse(body); } catch { continue; }
      this._dispatch(msg);
    }
  }

  _dispatch(msg) {
    if (msg.id !== undefined && (msg.result !== undefined || msg.error) && !msg.method) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(msg.error.message || 'language server error')); else p.resolve(msg.result);
    } else if (msg.method && msg.id !== undefined) {
      // a request from the server: answer the housekeeping ones so it never waits for us
      const result = msg.method === 'workspace/configuration' ? ((msg.params && msg.params.items) || []).map(() => null) : null;
      this._send({ id: msg.id, result });
    } else if (msg.method) {
      this.emit('notification', msg.method, msg.params);
    }
  }

  request(method, params, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      if (this.closed) { reject(new Error('language server is not running')); return; }
      const id = this.nextId++;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`language server did not answer ${method} in time`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this._send({ id, method, params });
    });
  }

  notify(method, params) { this._send({ method, params }); }

  async shutdown() {
    if (this.closed) return;
    try { await this.request('shutdown', null, 2000); this.notify('exit'); } catch { /* ignore */ }
    setTimeout(() => { try { this.child.kill(); } catch { /* gone */ } }, 300).unref();
  }
}

// ------------------------------------------------------------------ manager: one server per language family, per project

const extOf = (rel) => path.posix.extname(toPosix(rel)).slice(1).toLowerCase();

class LspManager extends EventEmitter {
  /**
   * @param {object} o
   * @param {string} o.root
   * @param {() => {enabled:boolean, servers:object}} o.getConfig
   * @param {string} o.workspaceDir  private folder for server data
   * @param {(cfg:{name:string,command:string,args:string[]}) => Promise<boolean>} [o.approve]  asked before starting a server the project itself defined
   */
  constructor({ root, getConfig, workspaceDir, approve }) {
    super();
    this.root = root;
    this.getConfig = getConfig;
    this.workspaceDir = workspaceDir;
    this.approve = approve;
    this.servers = new Map(); // name -> { client, ready: Promise, state, version map }
    this.docs = new Map();    // rel -> { server, version }
    this.failed = new Map();  // name -> reason (not retried until restart)
  }

  resolved() {
    const cfg = this.getConfig() || {};
    if (!cfg.enabled) return {};
    const out = {};
    const user = cfg.servers || {};
    for (const name of new Set([...Object.keys(DEFAULT_SERVERS), ...Object.keys(user)])) {
      const merged = { ...(DEFAULT_SERVERS[name] || {}), ...(user[name] || {}) };
      if (merged.enabled === false || !merged.command || !Array.isArray(merged.extensions) || !merged.extensions.length) continue;
      out[name] = merged;
    }
    return out;
  }

  /** What the editor needs to know: enabled?, and which extensions / Monaco languages have a server. */
  status() {
    const servers = this.resolved();
    const languages = new Set();
    const list = Object.entries(servers).map(([name, s]) => {
      for (const e of s.extensions) if (MONACO_LANGUAGE[e]) languages.add(MONACO_LANGUAGE[e]);
      const live = this.servers.get(name);
      return { name, command: s.command, extensions: s.extensions, state: this.failed.has(name) ? 'unavailable' : live ? live.state : 'idle', reason: this.failed.get(name) || null };
    });
    return { enabled: !!(this.getConfig() || {}).enabled, servers: list, languages: [...languages] };
  }

  serverFor(rel) {
    const e = extOf(rel);
    for (const [name, s] of Object.entries(this.resolved())) if (s.extensions.includes(e)) return { name, spec: s };
    return null;
  }

  _uri(rel) { return pathToFileURL(path.join(this.root, rel)).href; }
  _rel(uri) {
    try {
      const abs = fileURLToPath(uri);
      const r = path.relative(this.root, abs);
      return r && !r.startsWith('..') && !path.isAbsolute(r) ? toPosix(r) : null;
    } catch { return null; }
  }

  async _start(name, spec) {
    if (this.failed.has(name)) throw new Error(this.failed.get(name));
    const existing = this.servers.get(name);
    if (existing) { await existing.ready; return existing; }
    const fill = (a) => String(a).split('{workspace}').join(path.join(this.workspaceDir, `${name}-${Buffer.from(this.root).toString('hex').slice(-16)}`));
    const args = (spec.args || []).map(fill);
    if (this.approve && spec.fromProject && !(await this.approve({ name, command: spec.command, args }))) {
      this.failed.set(name, 'not approved');
      throw new Error('not approved');
    }
    this.emit('state', { server: name, state: 'starting' });
    let child;
    // on Windows servers are .cmd shims that need a shell; quote anything with spaces ourselves (spawn does not when shell is on)
    const winQuote = (a) => (process.platform === 'win32' && /\s/.test(a) && !/^".*"$/.test(a) ? `"${a}"` : a);
    try { child = spawn(winQuote(spec.command), args.map(winQuote), { cwd: this.root, env: { ...process.env, ...(spec.env || {}) }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: process.platform === 'win32' }); } catch (err) {
      this.failed.set(name, err.message); this.emit('state', { server: name, state: 'unavailable', message: err.message }); throw err;
    }
    const client = new LspClient(child);
    const entry = { client, state: 'starting', ready: null };
    this.servers.set(name, entry);
    client.on('notification', (method, params) => {
      if (method === 'textDocument/publishDiagnostics' && params) {
        const rel = this._rel(params.uri);
        if (rel) this.emit('diagnostics', rel, params.diagnostics || []);
      }
    });
    client.on('close', (reason, code) => {
      const notFound = code === 'ENOENT' || /not installed/.test(reason) || /not recognized|not found|ENOENT/i.test(reason);
      if (entry.state === 'starting' && notFound) this.failed.set(name, `“${spec.command}” is not installed`);
      entry.state = 'exited';
      this.servers.delete(name);
      for (const [rel, d] of this.docs) if (d.server === name) this.docs.delete(rel);
      this.emit('state', { server: name, state: this.failed.has(name) ? 'unavailable' : 'exited', message: this.failed.get(name) || reason });
    });
    entry.ready = (async () => {
      await client.request('initialize', {
        processId: process.pid,
        rootUri: pathToFileURL(this.root).href,
        workspaceFolders: [{ uri: pathToFileURL(this.root).href, name: path.basename(this.root) }],
        capabilities: {
          textDocument: {
            synchronization: { didSave: false },
            hover: { contentFormat: ['markdown', 'plaintext'] },
            completion: { completionItem: { snippetSupport: false, documentationFormat: ['markdown', 'plaintext'] } },
            definition: { linkSupport: true }, references: {}, signatureHelp: { signatureInformation: { documentationFormat: ['markdown', 'plaintext'] } },
            publishDiagnostics: { relatedInformation: false },
          },
          workspace: { workspaceFolders: true, configuration: true },
        },
        initializationOptions: spec.initializationOptions || null,
      }, 120000);
      client.notify('initialized', {});
      entry.state = 'ready';
      this.emit('state', { server: name, state: 'ready' });
    })();
    try { await entry.ready; } catch (err) {
      if (!this.failed.has(name)) this.failed.set(name, err.message);
      this.emit('state', { server: name, state: 'unavailable', message: this.failed.get(name) });
      try { child.kill(); } catch { /* gone */ }
      this.servers.delete(name);
      throw err;
    }
    return entry;
  }

  /** Tell the server about a file. Returns { ok:false, reason } when there is no (working) server for it. */
  async open(rel, text) {
    const target = this.serverFor(rel);
    if (!target) return { ok: false, reason: 'no server' };
    try {
      const entry = await this._start(target.name, target.spec);
      const prev = this.docs.get(rel);
      if (prev) { this.change(rel, text); return { ok: true, server: target.name }; }
      this.docs.set(rel, { server: target.name, version: 1 });
      entry.client.notify('textDocument/didOpen', { textDocument: { uri: this._uri(rel), languageId: LSP_LANGUAGE_ID[extOf(rel)] || 'plaintext', version: 1, text: String(text) } });
      return { ok: true, server: target.name };
    } catch (err) { return { ok: false, reason: err.message }; }
  }

  change(rel, text) {
    const d = this.docs.get(rel);
    const entry = d && this.servers.get(d.server);
    if (!entry) return false;
    d.version += 1;
    entry.client.notify('textDocument/didChange', { textDocument: { uri: this._uri(rel), version: d.version }, contentChanges: [{ text: String(text) }] });
    return true;
  }

  close(rel) {
    const d = this.docs.get(rel);
    const entry = d && this.servers.get(d.server);
    this.docs.delete(rel);
    if (entry) entry.client.notify('textDocument/didClose', { textDocument: { uri: this._uri(rel) } });
  }

  /**
   * kind: hover | definition | references | completion | signatureHelp | rename; pos: { line, character } (0-based).
   * Locations come back as { rel, range } and are dropped when they point outside the project (JDK sources, node_modules typings...).
   */
  async request(rel, kind, pos, opts = {}) {
    const d = this.docs.get(rel);
    const entry = d && this.servers.get(d.server);
    if (!entry || entry.state !== 'ready') return null;
    const base = { textDocument: { uri: this._uri(rel) }, position: { line: Number(pos.line) || 0, character: Number(pos.character) || 0 } };
    const call = (method, extra) => entry.client.request(method, { ...base, ...(extra || {}) });
    const toLocations = (res) => (res ? (Array.isArray(res) ? res : [res]) : [])
      .map((l) => ({ rel: this._rel(l.uri || l.targetUri), range: l.range || l.targetSelectionRange || l.targetRange }))
      .filter((l) => l.rel && l.range);
    switch (kind) {
      case 'hover': return call('textDocument/hover');
      case 'definition': return toLocations(await call('textDocument/definition'));
      case 'references': return toLocations(await call('textDocument/references', { context: { includeDeclaration: opts.includeDeclaration !== false } }));
      case 'completion': return call('textDocument/completion', { context: { triggerKind: 1 } });
      case 'signatureHelp': return call('textDocument/signatureHelp');
      case 'rename': return this._toRelEdits(await call('textDocument/rename', { newName: String(opts.newName || '') }));
      default: throw new Error(`Unsupported language server request: ${kind}`);
    }
  }

  /** LSP WorkspaceEdit (changes and/or documentChanges) -> { rel: TextEdit[] }, project-relative, or null when there is nothing to apply. */
  _toRelEdits(we) {
    const out = new Map();
    const add = (uri, edits) => {
      const rel = this._rel(uri);
      if (!rel || !Array.isArray(edits) || !edits.length) return;
      out.set(rel, [...(out.get(rel) || []), ...edits]);
    };
    if (we && we.changes) for (const [uri, edits] of Object.entries(we.changes)) add(uri, edits);
    if (we && Array.isArray(we.documentChanges)) {
      for (const dc of we.documentChanges) if (dc.textDocument && Array.isArray(dc.edits)) add(dc.textDocument.uri, dc.edits);
    }
    return out.size ? Object.fromEntries(out) : null;
  }

  /** workspace/symbol, asked only of servers already running (a search should never be the reason one starts). Merges and caps results. */
  async workspaceSymbols(query, { max = 200 } = {}) {
    const out = [];
    await Promise.all(Object.keys(this.resolved()).map(async (name) => {
      const entry = this.servers.get(name);
      if (!entry || entry.state !== 'ready') return;
      try {
        const res = await entry.client.request('workspace/symbol', { query: String(query || '') }, 4000);
        for (const s of (res || [])) {
          const loc = s.location || {};
          const rel = this._rel(loc.uri);
          if (!rel || !loc.range) continue;
          out.push({ name: s.name, kind: s.kind, rel, range: loc.range, containerName: s.containerName || null });
        }
      } catch { /* unsupported or timed out: this server contributes nothing */ }
    }));
    return out.slice(0, max);
  }

  /**
   * Exact usage counts from the server. targets: [{ key, line, character }] (0-based, on the declared name).
   * Resolves to Map(key -> count | null); null = the server could not answer in time (not started, still indexing, no support),
   * so the caller can fall back to a count by name. Answers are cached per file content.
   */
  async usageCounts(rel, text, targets, { budgetMs = 4000, max = 60 } = {}) {
    const out = new Map();
    const list = targets.slice(0, max);
    for (const t of targets) out.set(t.key, null);
    if (!list.length || !this.serverFor(rel)) return out;
    const sig = crypto.createHash('sha1').update(String(text)).digest('hex');
    const cache = (this._usageCache = this._usageCache || new Map());
    const hit = cache.get(rel);
    const known = hit && hit.sig === sig ? hit.counts : new Map();
    const todo = list.filter((t) => !known.has(`${t.line}:${t.character}`));
    if (todo.length) {
      if (!this.docs.has(rel)) { const o = await this.open(rel, text); if (!o.ok) return out; }
      let timer;
      const deadline = new Promise((resolve) => { timer = setTimeout(resolve, budgetMs); });
      await Promise.race([deadline, Promise.all(todo.map(async (t) => {
        try {
          const locs = await this.request(rel, 'references', { line: t.line, character: t.character }, { includeDeclaration: false });
          if (Array.isArray(locs)) known.set(`${t.line}:${t.character}`, locs.length);
        } catch { /* unsupported or failed: stays null */ }
      }))]);
      clearTimeout(timer);
      cache.set(rel, { sig, counts: known });
    }
    for (const t of list) { const v = known.get(`${t.line}:${t.character}`); if (v !== undefined) out.set(t.key, v); }
    return out;
  }

  async dispose() {
    const all = [...this.servers.values()];
    this.servers.clear(); this.docs.clear();
    await Promise.all(all.map((e) => e.client.shutdown()));
  }
}

module.exports = { LspClient, LspManager, DEFAULT_SERVERS, MONACO_LANGUAGE, LSP_LANGUAGE_ID };
