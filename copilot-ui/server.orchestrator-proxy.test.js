'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const { proxyToNativeRuntime } = require('./lib/nativeRuntimeProxy');

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address())));
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

test('native orchestrator proxy forwards mutation headers and streams SSE disconnects', async () => {
  let upstreamClosed = false;
  const upstream = http.createServer((req, res) => {
    if (req.url.endsWith('/events')) {
      assert.equal(req.headers.accept, 'text/event-stream');
      assert.equal(req.headers['last-event-id'], '7');
      req.on('close', () => { upstreamClosed = true; });
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('id: 8\nevent: running\ndata: {}\n\n');
      return;
    }
    assert.equal(req.headers['idempotency-key'], 'mutation-1');
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(Buffer.concat(chunks));
    });
  });
  const upstreamAddress = await listen(upstream);
  const proxy = http.createServer((req, res) => {
    proxyToNativeRuntime(
      `http://127.0.0.1:${upstreamAddress.port}`,
      req.url,
      req,
      res,
    );
  });
  const proxyAddress = await listen(proxy);

  try {
    const mutation = await new Promise((resolve, reject) => {
      const request = http.request({
        hostname: '127.0.0.1',
        port: proxyAddress.port,
        path: '/api/orchestrator/sessions',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': 'mutation-1',
        },
      }, (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve({
          status: response.statusCode,
          body: Buffer.concat(chunks).toString('utf8'),
        }));
      });
      request.on('error', reject);
      request.end('{"repoId":"repo-1"}');
    });
    assert.equal(mutation.status, 201);
    assert.equal(mutation.body, '{"repoId":"repo-1"}');

    await new Promise((resolve, reject) => {
      const request = http.request({
        hostname: '127.0.0.1',
        port: proxyAddress.port,
        path: '/api/orchestrator/sessions/session-1/events',
        headers: {
          accept: 'text/event-stream',
          'last-event-id': '7',
        },
      }, (response) => {
        assert.equal(response.headers['x-accel-buffering'], 'no');
        response.once('data', (chunk) => {
          assert.match(chunk.toString('utf8'), /id: 8/);
          response.destroy();
          resolve();
        });
      });
      request.on('error', reject);
      request.end();
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(upstreamClosed, true);
  } finally {
    await close(proxy);
    await close(upstream);
  }
});
