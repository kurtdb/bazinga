#!/usr/bin/env node
// A stand-in for Claude Code that really talks to a model server over the Anthropic Messages API (streaming), runs the tools
// it is asked to, and prints claude's stream-json. It is as strict as Claude Code about tool arguments (required fields,
// absolute paths), so a model server that answers badly makes it fail the same way.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const args = process.argv.slice(2);
const prompt = args[args.indexOf('-p') + 1] || '';
const base = new URL(process.env.ANTHROPIC_BASE_URL || 'http://127.0.0.1:1');
const emit = (o) => console.log(JSON.stringify(o));

const TOOLS = [
  { name: 'Read', description: 'Reads a file.', input_schema: { type: 'object', properties: { file_path: { type: 'string' } }, required: ['file_path'] } },
  { name: 'Write', description: 'Writes a file.', input_schema: { type: 'object', properties: { file_path: { type: 'string' }, content: { type: 'string' } }, required: ['file_path', 'content'] } },
];

function runTool(name, input) {
  const required = (TOOLS.find((t) => t.name === name) || { input_schema: { required: [] } }).input_schema.required;
  const missing = required.filter((k) => typeof input[k] !== 'string');
  if (missing.length) return { error: `InputValidationError: ${name} failed due to missing/invalid parameters: ${missing.join(', ')}` };
  if (!path.isAbsolute(input.file_path)) return { error: 'File path must be absolute' };
  if (name === 'Read') { try { return { text: fs.readFileSync(input.file_path, 'utf8').split('\n').map((l, i) => `${i + 1}\t${l}`).join('\n') }; } catch (e) { return { error: e.message }; } }
  if (name === 'Write') { fs.writeFileSync(input.file_path, input.content); return { text: `File created successfully at: ${input.file_path}` }; }
  return { error: `No such tool: ${name}` };
}

/** One request; resolves with { blocks, stop } built from the SSE events like the SDK does. */
function ask(messages) {
  const body = JSON.stringify({
    model: 'fake', max_tokens: 4096, stream: true, messages, tools: TOOLS,
    system: [{ type: 'text', text: `You are Claude Code.\n# Environment\n - Primary working directory: ${process.cwd()}\n - Platform: linux` }],
  });
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: base.hostname, port: base.port, path: '/v1/messages?beta=true', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, (res) => {
      let buf = ''; const blocks = []; let stop = ''; let status = res.statusCode; let raw = '';
      res.setEncoding('utf8');
      res.on('data', (c) => {
        raw += c;
        if (status !== 200) return;
        buf += c;
        for (let m; (m = /\r?\n\r?\n/.exec(buf));) {
          const chunk = buf.slice(0, m.index); buf = buf.slice(m.index + m[0].length);
          const line = chunk.split('\n').find((l) => l.startsWith('data:'));
          if (!line) continue;
          const e = JSON.parse(line.slice(5));
          if (e.type === 'content_block_start') blocks[e.index] = { ...e.content_block, _json: '' };
          if (e.type === 'content_block_delta') {
            const b = blocks[e.index];
            if (e.delta.type === 'text_delta') b.text += e.delta.text;
            if (e.delta.type === 'input_json_delta') b._json += e.delta.partial_json;
          }
          if (e.type === 'message_delta') stop = e.delta.stop_reason;
          if (e.type === 'content_block_start' || e.type === 'content_block_delta') emit({ type: 'stream_event', event: e });
        }
      });
      res.on('end', () => {
        if (status !== 200) { reject(new Error(`HTTP ${status}: ${raw.slice(0, 300)}`)); return; }
        for (const b of blocks) if (b && b.type === 'tool_use') b.input = b._json ? JSON.parse(b._json) : {};
        resolve({ blocks: blocks.filter(Boolean), stop });
      });
    });
    req.on('error', reject); req.end(body);
  });
}

(async () => {
  let user = prompt;
  const at = /@([\w./-]+)/.exec(prompt);
  if (at) { try { user += `\n\n<file path="${at[1]}">\n${fs.readFileSync(at[1], 'utf8')}</file>`; } catch { /* no such file */ } }
  const messages = [{ role: 'user', content: user }];
  let finalText = '';
  for (let turn = 0; turn < 8; turn++) {
    const { blocks, stop } = await ask(messages);
    messages.push({ role: 'assistant', content: blocks.map((b) => (b.type === 'tool_use' ? { type: 'tool_use', id: b.id, name: b.name, input: b.input } : { type: b.type, text: b.text })) });
    emit({ type: 'assistant', message: { content: blocks.map((b) => (b.type === 'tool_use' ? { type: 'tool_use', id: b.id, name: b.name, input: b.input } : { type: b.type, text: b.text })) } });
    finalText = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('');
    const calls = blocks.filter((b) => b.type === 'tool_use');
    if (stop !== 'tool_use' || !calls.length) break;
    const results = calls.map((c) => { const r = runTool(c.name, c.input); return { type: 'tool_result', tool_use_id: c.id, is_error: !!r.error, content: r.error || r.text }; });
    emit({ type: 'user', message: { content: results } });
    messages.push({ role: 'user', content: results });
  }
  emit({ type: 'result', result: finalText });
})().catch((e) => { console.error(`API Error: ${e.message}`); process.exit(1); });
