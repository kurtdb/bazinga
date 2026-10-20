'use strict';
// A tiny language server for tests: JSON-RPC over stdio, enough to exercise the client and the editor integration.
// Every identifier "foo" hovers as "fake: foo", "def target" is its definition, and a line containing "BAD" produces a diagnostic.
let buf = Buffer.alloc(0);
const docs = new Map();
const send = (msg) => { const b = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...msg })); process.stdout.write(`Content-Length: ${b.length}\r\n\r\n`); process.stdout.write(b); };
const wordAt = (text, line, ch) => { const l = (text.split('\n')[line] || ''); const m = [...l.matchAll(/[A-Za-z_]\w*/g)].find((x) => ch >= x.index && ch <= x.index + x[0].length); return m ? m[0] : null; };
function diagnose(uri) {
  const text = docs.get(uri) || '';
  const diagnostics = [];
  text.split('\n').forEach((l, i) => { const k = l.indexOf('BAD'); if (k >= 0) diagnostics.push({ range: { start: { line: i, character: k }, end: { line: i, character: k + 3 } }, severity: 1, message: 'fake: BAD found', source: 'fake-lsp' }); });
  send({ method: 'textDocument/publishDiagnostics', params: { uri, diagnostics } });
}
function handle(m) {
  const p = m.params || {};
  switch (m.method) {
    case 'initialize': send({ id: m.id, result: { capabilities: { hoverProvider: true } } }); send({ id: 900, method: 'workspace/configuration', params: { items: [{}] } }); break;
    case 'shutdown': send({ id: m.id, result: null }); break;
    case 'exit': process.exit(0); break;
    case 'textDocument/didOpen': docs.set(p.textDocument.uri, p.textDocument.text); diagnose(p.textDocument.uri); break;
    case 'textDocument/didChange': docs.set(p.textDocument.uri, p.contentChanges[0].text); diagnose(p.textDocument.uri); break;
    case 'textDocument/didClose': docs.delete(p.textDocument.uri); break;
    case 'textDocument/hover': {
      const w = wordAt(docs.get(p.textDocument.uri) || '', p.position.line, p.position.character);
      send({ id: m.id, result: w ? { contents: { kind: 'markdown', value: `**fake**: ${w}` } } : null }); break;
    }
    case 'textDocument/definition': {
      send({ id: m.id, result: [{ uri: p.textDocument.uri, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } } }, { uri: 'file:///outside/project/x.py', range: { start: { line: 1, character: 0 }, end: { line: 1, character: 1 } } }] }); break;
    }
    case 'textDocument/references': {
      // the declaration (line 0) and one use (line 2); the declaration only comes back when asked for. FAKE_LSP_SLOW delays the answer.
      const all = [{ uri: p.textDocument.uri, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } }, { uri: p.textDocument.uri, range: { start: { line: 2, character: 0 }, end: { line: 2, character: 1 } } }];
      const result = p.context && p.context.includeDeclaration === false ? all.slice(1) : all;
      setTimeout(() => send({ id: m.id, result }), Number(process.env.FAKE_LSP_SLOW) || 0);
      break;
    }
    case 'textDocument/completion': send({ id: m.id, result: { isIncomplete: false, items: [{ label: 'fakeCompletion', kind: 3, detail: 'fake()', insertText: 'fakeCompletion()' }, { label: 'other', kind: 6 }] } }); break;
    case 'textDocument/signatureHelp': send({ id: m.id, result: { signatures: [{ label: 'fake(a, b)', parameters: [{ label: 'a' }, { label: 'b' }] }], activeSignature: 0, activeParameter: 0 } }); break;
    default: if (m.id !== undefined) send({ id: m.id, result: null });
  }
}
process.stdin.on('data', (d) => {
  buf = Buffer.concat([buf, d]);
  for (;;) {
    const he = buf.indexOf('\r\n\r\n'); if (he < 0) return;
    const len = Number(/Content-Length:\s*(\d+)/i.exec(buf.subarray(0, he).toString())[1]);
    if (buf.length < he + 4 + len) return;
    const body = buf.subarray(he + 4, he + 4 + len).toString(); buf = buf.subarray(he + 4 + len);
    handle(JSON.parse(body));
  }
});
