#!/usr/bin/env node
import net from 'node:net';

function parseArgs(argv) {
  const out = { host: '127.0.0.1', port: 3000, prompt: 'Hello', timeoutMs: 120000 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--host') out.host = argv[++i];
    else if (a === '--port') out.port = Number(argv[++i]);
    else if (a === '--prompt') out.prompt = argv[++i];
    else if (a === '--timeout-ms') out.timeoutMs = Number(argv[++i]);
    else throw new Error(`Unknown arg: ${a}`);
  }
  if (!out.host) throw new Error('Missing --host');
  if (!Number.isFinite(out.port) || out.port <= 0) throw new Error('Invalid --port');
  if (!out.prompt) throw new Error('Missing --prompt');
  return out;
}

function isRecord(v) {
  return typeof v === 'object' && v !== null;
}

async function main() {
  const args = parseArgs(process.argv);

  const socket = net.createConnection({ host: args.host, port: args.port });
  socket.setNoDelay(true);

  let buffer = '';
  const pending = new Map();
  let nextId = 1;

  const hardTimeout = setTimeout(() => {
    socket.destroy(new Error('Spike timed out'));
  }, args.timeoutMs);

  function sendJson(obj) {
    socket.write(`${JSON.stringify(obj)}\n`);
  }

  function request(method, params) {
    const id = nextId++;
    const req = { jsonrpc: '2.0', id, method };
    if (params !== undefined) req.params = params;

    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`ACP request timeout: ${method}`));
      }, args.timeoutMs);
      pending.set(id, { resolve, reject, t, method });
      sendJson(req);
    });
  }

  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    while (true) {
      const idx = buffer.indexOf('\n');
      if (idx < 0) break;
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;

      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }

      if (!isRecord(parsed)) continue;

      // Notification
      if (parsed.jsonrpc === '2.0' && typeof parsed.method === 'string' && parsed.id === undefined) {
        continue;
      }

      // Response
      if (parsed.jsonrpc === '2.0' && (typeof parsed.id === 'number' || typeof parsed.id === 'string')) {
        const id = typeof parsed.id === 'number' ? parsed.id : Number.NaN;
        if (!Number.isFinite(id)) continue;
        const p = pending.get(id);
        if (!p) continue;
        clearTimeout(p.t);
        pending.delete(id);

        if (parsed.error) {
          p.reject(new Error(`ACP error: ${JSON.stringify(parsed.error)}`));
        } else {
          p.resolve(parsed.result);
        }
      }
    }
  });

  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });

  console.log(`[spike] connected to ACP ${args.host}:${args.port}`);

  await request('initialize', {
    protocolVersion: 1,
    clientCapabilities: {},
    clientInfo: { name: 'wu-101-spike', title: 'WU-101 Spike', version: '0.0.1' },
  });
  console.log('[spike] initialize: ok');

  const newRes = await request('session/new', { cwd: '/', mcpServers: [] });
  const sessionId = isRecord(newRes) && typeof newRes.sessionId === 'string' ? newRes.sessionId : undefined;
  if (!sessionId) throw new Error(`session/new did not return sessionId: ${JSON.stringify(newRes)}`);
  console.log(`[spike] session/new: ${sessionId}`);

  const promptRes = await request('session/prompt', {
    sessionId,
    prompt: [{ type: 'text', text: args.prompt }],
  });

  const stopReason = isRecord(promptRes) && typeof promptRes.stopReason === 'string' ? promptRes.stopReason : 'end_turn';
  console.log(`[spike] session/prompt done (stopReason=${stopReason})`);

  clearTimeout(hardTimeout);
  socket.end();
}

main().catch((err) => {
  console.error(`[spike] ERROR: ${err?.message ?? String(err)}`);
  process.exitCode = 1;
});
