'use strict';
// Same fake adapter as fake-dap-tcp.js, but first blasts several MB at its own stdout via a real blocking
// fs.writeSync(1, ...) syscall - exactly what a verbose `dlv dap --listen=...` could do on its own stdout
// (separate from the TCP socket, which carries the actual DAP traffic). With nothing draining the far end's
// pipe buffer (~64KB on Linux/macOS), this write blocks the process until someone reads it - deterministically
// reproducing the hang DapSession._startTcp() risked before it attached a listener to child.stdout.
const fs = require('node:fs');
const net = require('node:net');
const port = Number(process.argv[2]);

const chunk = Buffer.alloc(256 * 1024, 'x');
for (let i = 0; i < 16; i++) { try { fs.writeSync(1, chunk); } catch { break; } } // ~4MB total, well past any OS pipe buffer

function makeHandler(write) {
  let seq = 0;
  const send = (msg) => { const b = Buffer.from(JSON.stringify({ seq: ++seq, ...msg })); write(Buffer.from(`Content-Length: ${b.length}\r\n\r\n`)); write(b); };
  return function handle(m) {
    const respond = (body, success = true, message) => send({ type: 'response', request_seq: m.seq, success, command: m.command, body, message });
    switch (m.command) {
      case 'initialize': respond({ supportsConfigurationDoneRequest: true }); break;
      case 'launch': respond({}); send({ type: 'event', event: 'initialized', body: {} }); break;
      case 'setBreakpoints': respond({ breakpoints: [] }); break;
      case 'configurationDone':
        respond({});
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
