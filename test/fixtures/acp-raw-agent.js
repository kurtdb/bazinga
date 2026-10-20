// An ACP agent written against the bare wire format (newline-delimited JSON-RPC), without the SDK: checks that Bazinga speaks the protocol itself, not just SDK to SDK.
const rl = require('readline').createInterface({ input: process.stdin });
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
let prompt = null;
rl.on('line', (l) => {
  const m = JSON.parse(l);
  if (m.method === 'initialize') out({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: 1, agentCapabilities: {} } });
  else if (m.method === 'session/new') out({ jsonrpc: '2.0', id: m.id, result: { sessionId: 'S' } });
  else if (m.method === 'session/prompt') {
    prompt = m.id;
    out({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'S', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'working on it' } } } });
    out({ jsonrpc: '2.0', id: 900, method: 'session/request_permission', params: { sessionId: 'S', toolCall: { toolCallId: 'c1', title: 'Edit a.txt', kind: 'edit', status: 'pending' }, options: [{ optionId: 'y', name: 'Allow', kind: 'allow_once' }, { optionId: 'n', name: 'Reject', kind: 'reject_once' }] } });
  } else if (m.id === 900) {
    out({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'S', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `chosen ${m.result.outcome.optionId}` } } } });
    out({ jsonrpc: '2.0', id: prompt, result: { stopReason: 'end_turn' } });
  }
});
