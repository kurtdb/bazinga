'use strict';
// A tiny debug adapter for tests: DAP over stdio, same Content-Length framing a real adapter uses (verified
// against debugpy.adapter during development - see dap.js's header comment). Simulates one breakpoint in a
// fake 3-line program: setBreakpoints + configurationDone stops there once; continue runs it to the end.
let buf = Buffer.alloc(0);
let seq = 0;
const send = (msg) => { const b = Buffer.from(JSON.stringify({ seq: ++seq, ...msg })); process.stdout.write(`Content-Length: ${b.length}\r\n\r\n`); process.stdout.write(b); };
let breakpoints = [];
function handle(m) {
  const a = m.arguments || {};
  const respond = (body, success = true, message) => send({ type: 'response', request_seq: m.seq, success, command: m.command, body, message });
  switch (m.command) {
    case 'initialize': respond({ supportsConfigurationDoneRequest: true }); break;
    case 'launch':
      if (a.program === 'BAD') { respond({}, false, 'fake: program not found'); break; }
      respond({});
      send({ type: 'event', event: 'initialized', body: {} });
      break;
    case 'setBreakpoints':
      breakpoints = a.breakpoints || [];
      respond({ breakpoints: breakpoints.map((b, i) => ({ line: b.line, verified: b.line !== 999, id: i })) });
      break;
    case 'configurationDone':
      respond({});
      if (breakpoints.length) send({ type: 'event', event: 'stopped', body: { reason: 'breakpoint', threadId: 1, hitBreakpointIds: [0] } });
      else { send({ type: 'event', event: 'output', body: { category: 'stdout', output: 'done\n' } }); send({ type: 'event', event: 'terminated', body: {} }); }
      break;
    case 'threads': respond({ threads: [{ id: 1, name: 'MainThread' }] }); break;
    case 'stackTrace': respond({ stackFrames: [{ id: 10, name: 'main', line: 2, column: 1, source: { path: '/fake/a.py' } }] }); break;
    case 'scopes': respond({ scopes: [{ name: 'Locals', variablesReference: 20, expensive: false }] }); break;
    case 'variables': respond({ variables: [{ name: 'x', value: '42', type: 'int', variablesReference: 0 }] }); break;
    case 'continue':
      respond({ allThreadsContinued: true });
      send({ type: 'event', event: 'continued', body: { threadId: 1 } });
      send({ type: 'event', event: 'output', body: { category: 'stdout', output: 'done\n' } });
      send({ type: 'event', event: 'terminated', body: {} });
      break;
    case 'next': case 'stepIn': case 'stepOut':
      respond({});
      send({ type: 'event', event: 'stopped', body: { reason: m.command, threadId: 1 } });
      break;
    case 'disconnect': respond({}); setTimeout(() => process.exit(0), 10); break;
    default: respond({});
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
