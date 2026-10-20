#!/usr/bin/env node
// A stand-in for `claude -p --output-format stream-json --verbose` with scripted behaviours, for the model self-test.
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const mode = (args.find((a) => a.startsWith('--mode=')) || '--mode=ok').slice(7);
const prompt = args[args.indexOf('-p') + 1] || '';
const word = (() => { try { return /secret word is (\w+)/.exec(fs.readFileSync('input.txt', 'utf8'))[1]; } catch { return null; } })();
const emit = (o) => console.log(JSON.stringify(o));
const call = (id, name, input) => emit({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } });
const result = (id, text, isError = false) => emit({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: isError, content: text }] } });
const final = (text) => emit({ type: 'result', result: text });
if (mode === 'hang') { setTimeout(() => {}, 60000); return; }
console.error('⚠ claude.ai connectors are disabled because ANTHROPIC_API_KEY is set'); // a warning that is not JSON
if (prompt.includes('@input.txt')) { final(mode === 'no-attach' ? 'I cannot see any file.' : word); return; }
const out = path.join(process.cwd(), 'output.txt');
if (mode === 'text-call') { final(JSON.stringify({ name: 'Write', arguments: { file_path: out, content: word } })); return; }
if (mode === 'claims') { final(`The secret word "${word}" was extracted from input.txt and written to output.txt. No further tool calls were needed.`); return; }
call('r1', 'Read', { file_path: path.join(process.cwd(), 'input.txt') }); result('r1', `1\tThe secret word is ${word}.`);
if (mode === 'think-forever') { emit({ type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'thinking' } } }); emit({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'Hmm, let me think about this for a very long time.' } } }); setTimeout(() => {}, 60000); return; }
if (mode === 'invalid') { call('w1', 'Write', {}); result('w1', 'InputValidationError: file_path is required', true); final('Failed.'); return; }
if (mode === 'denied') { call('w1', 'Write', { file_path: out, content: word }); result('w1', 'Permission to use Write has been denied.', true); final('I was not allowed to write.'); return; }
if (mode === 'elsewhere') { const other = path.join(path.dirname(process.cwd()), `elsewhere-${path.basename(process.cwd())}.txt`); call('w1', 'Write', { file_path: other, content: word }); result('w1', 'File created'); final('Done.'); return; }
if (mode === 'wrong') { fs.writeFileSync(out, 'hello\n'); call('w1', 'Write', { file_path: out, content: 'hello' }); result('w1', 'File created'); final('done'); return; }
if (mode === 'blind') { call('w1', 'Write', { file_path: out, content: word }); fs.writeFileSync(out, `${word}\n`); result('w1', 'File created'); final('done'); return; }
fs.writeFileSync(out, `${word}\n`); call('w1', 'Write', { file_path: out, content: word }); result('w1', 'File created'); final('done');
