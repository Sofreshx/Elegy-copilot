const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });

rl.on('line', (line) => {
  const request = JSON.parse(line);
  if (request.id === 1) {
    console.log(JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      result: { protocolVersion: 1 },
    }));
  }
  if (request.id === 2) {
    console.log(JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      result: { sessionId: request.params.sessionId || 'session-1' },
    }));
  }
  if (request.id === 3) {
    if (!request.params.sessionId) {
      process.exitCode = 2;
      return;
    }
    console.log(JSON.stringify({
      jsonrpc: '2.0',
      method: 'session/update',
      params: { sessionId: request.params.sessionId },
    }));
    console.log(JSON.stringify({
      jsonrpc: '2.0',
      id: 3,
      result: { stopReason: 'end_turn' },
    }));
  }
});
