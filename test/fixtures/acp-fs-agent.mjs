// A tiny ACP agent for the tests: on every prompt it writes and reads files through the client and says what happened.
import * as acp from '@agentclientprotocol/sdk';
import { Readable, Writable } from 'node:stream';

const note = (cx, sessionId, text) => cx.notify(acp.methods.client.session.update, { sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } });
const attempt = async (fn) => { try { await fn(); return 'ok'; } catch (e) { return `refused: ${e.message}`; } };

const stream = acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin));
acp.agent({ name: 'fs-agent' })
  .onRequest('initialize', () => ({ protocolVersion: acp.PROTOCOL_VERSION, agentCapabilities: {}, agentInfo: { name: 'fs-agent', version: '0.1' } }))
  .onRequest('session/new', () => ({ sessionId: 'S1' }))
  .onRequest('session/prompt', async (ctx) => {
    const cx = ctx.client; const sid = ctx.params.sessionId;
    const cwd = process.cwd();
    const res = {};
    res.write = await attempt(() => cx.request(acp.methods.client.fs.writeTextFile, { sessionId: sid, path: `${cwd}/sub/out.txt`, content: 'hello' }));
    res.escapeWrite = await attempt(() => cx.request(acp.methods.client.fs.writeTextFile, { sessionId: sid, path: `${cwd}/../escape.txt`, content: 'x' }));
    res.gitWrite = await attempt(() => cx.request(acp.methods.client.fs.writeTextFile, { sessionId: sid, path: `${cwd}/.git/config`, content: 'x' }));
    res.read = await attempt(() => cx.request(acp.methods.client.fs.readTextFile, { sessionId: sid, path: `${cwd}/sub/out.txt` }));
    res.escapeRead = await attempt(() => cx.request(acp.methods.client.fs.readTextFile, { sessionId: sid, path: '/etc/hostname' }));
    await note(cx, sid, JSON.stringify(res));
    return { stopReason: 'end_turn' };
  })
  .onNotification('session/cancel', () => {})
  .connect(stream);
