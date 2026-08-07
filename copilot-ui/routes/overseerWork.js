'use strict';

const { OVERSEER_ORIGIN, redactSecrets, createLoopbackClient } = require('./_overseerLoopback');

function register(deps = {}) {
  const client = createLoopbackClient({
    ...deps,
    binaryPaths: new Set(['/api/overseer/work/v1/intake-file']),
    resolveTarget(pathname) {
      if (pathname.startsWith('/api/overseer/work/v1')) return pathname.replace('/api/overseer/work/v1', '/api/work/v1');
      return null;
    },
  });
  return [
    { method: 'GET', path: '/api/overseer/work/v1/items', handler: client.handler },
    { method: 'GET', path: /^\/api\/overseer\/work\/v1\/items\/([^/]+)$/, handler: client.handler },
    { method: 'POST', path: '/api/overseer/work/v1/items', handler: client.handler },
    { method: 'POST', path: /^\/api\/overseer\/work\/v1\/items\/([^/]+)\/(cancel|retry|answer|review|preview|confirm)$/, handler: client.handler },
    { method: 'POST', path: '/api/overseer/work/v1/intake-file', handler: client.handler },
  ];
}

module.exports = { register, OVERSEER_ORIGIN, redactSecrets };
