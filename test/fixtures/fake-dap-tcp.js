'use strict';
// Same fake adapter as fake-dap.js (see its header), but listening on a TCP socket instead of stdio - the
// transport dlv's own `dlv dap --listen=host:port` uses. Port comes from argv[2], the way goAdapter() passes
// dlv its --listen address. Exercises DapSession's TCP code path (_startTcp/tcpTransport/connectWithRetry)
// end-to-end without a real `dlv` binary.
const net = require('node:net');
const port = Number(process.argv[2]);

function makeHandler(write) {
  let seq = 0;
  const send = (msg) => { const b = Buffer.from(JSON.stringify({ seq: ++seq, ...msg })); write(Buffer.from(`Content-Length: ${b.length}\r\n\r\n`)); write(b); };
  let breakpoints = [];
  return function handle(m) {
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
      case 'threads': respond({ threads: [{ id: 1, name: 'MainGoroutine' }] }); break;
      case 'stackTrace': respond({ stackFrames: [{ id: 10, name: 'main.main', line: 2, column: 1, source: { path: '/fake/main.go' } }] }); break;
      case 'scopes': respond({ scopes: [{ name: 'Locals', variablesReference: 20, expensive: false }] }); break;
      case 'variables': respond({ variables: [{ name: 'x', value: '42', type: 'int', variablesReference: 0 }] }); break;
      case 'continue':
        respond({ allThreadsContinued: true });
        send({ type: 'event', event: 'continued', body: { threadId: 1 } });
        send({ type: 'event', event: 'output', body: { category: 'stdout', output: 'done\n' } });
        send({ type: 'event', event: 'terminated', body: {} });
        break;
      case 'disconnect': respond({}); setTimeout(() => process.exit(0), 10); break;
      default: respond({});
    }
  };
}

const server = net.createServer((socket) => {
  let buf = Buffer.alloc(0);
  const handle = makeHandler((b) => { try { socket.write(b); } catch { /* closed */ } });
  socket.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    for (;;) {
      const he = buf.indexOf('\r\n\r\n'); if (he < 0) return;
      const len = Number(/Content-Length:\s*(\d+)/i.exec(buf.subarray(0, he).toString())[1]);
      if (buf.length < he + 4 + len) return;
      const body = buf.subarray(he + 4, he + 4 + len).toString(); buf = buf.subarray(he + 4 + len);
      handle(JSON.parse(body));
    }
  });
});
server.listen(port, '127.0.0.1');
