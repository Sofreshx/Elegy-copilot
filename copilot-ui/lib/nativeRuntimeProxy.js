'use strict';

const http = require('http');

function proxyToNativeRuntime(nativeRuntimeUrl, pathname, req, res) {
  const parsed = new URL(pathname, nativeRuntimeUrl);
  const accept = String(req.headers?.accept || 'application/json');
  const options = {
    hostname: parsed.hostname,
    port: parsed.port,
    path: parsed.pathname + parsed.search,
    method: req.method,
    headers: {
      Accept: accept,
      ...(req.headers?.['content-type'] ? { 'Content-Type': req.headers['content-type'] } : {}),
      ...(req.headers?.['idempotency-key'] ? { 'Idempotency-Key': req.headers['idempotency-key'] } : {}),
      ...(req.headers?.['last-event-id'] ? { 'Last-Event-ID': req.headers['last-event-id'] } : {}),
      ...(req.headers?.authorization ? { Authorization: req.headers.authorization } : {}),
    },
    timeout: accept.includes('text/event-stream') ? 0 : 10000,
  };

  const proxyReq = http.request(options, (proxyRes) => {
    const contentType = String(proxyRes.headers['content-type'] || '');
    if (contentType.includes('text/event-stream')) {
      res.writeHead(proxyRes.statusCode || 502, {
        ...proxyRes.headers,
        'cache-control': proxyRes.headers['cache-control'] || 'no-cache',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      proxyRes.pipe(res);
      const close = () => {
        proxyRes.destroy();
        proxyReq.destroy();
      };
      req.once('close', close);
      res.once('close', close);
      return;
    }
    const chunks = [];
    proxyRes.on('data', (chunk) => chunks.push(chunk));
    proxyRes.on('end', () => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      res.end(Buffer.concat(chunks));
    });
  });

  proxyReq.on('error', (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: `Native runtime unreachable: ${err.message}` }));
    }
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    if (!res.headersSent) {
      res.writeHead(504, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Native runtime request timed out' }));
    }
  });

  if (req.method === 'PATCH' || req.method === 'POST' || req.method === 'PUT') {
    req.pipe(proxyReq);
  } else {
    proxyReq.end();
  }
}

module.exports = { proxyToNativeRuntime };
