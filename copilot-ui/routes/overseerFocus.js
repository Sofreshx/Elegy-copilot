'use strict';

const { OVERSEER_ORIGIN, redactSecrets, createLoopbackClient } = require('./_overseerLoopback');

function register(deps = {}) {
  const client = createLoopbackClient({
    ...deps,
    resolveTarget(pathname) {
      if (pathname.startsWith('/api/overseer/focus/v1')) return pathname.replace('/api/overseer/focus/v1', '/api/focus/v1');
      return null;
    },
  });
  return [
    { method: 'GET', path: '/api/overseer/focus/v1/summary', handler: client.handler },
    { method: 'GET', path: /^\/api\/overseer\/focus\/v1\/ideas\/([^/]+)$/, handler: client.handler },
  ];
}

module.exports = { register, OVERSEER_ORIGIN, redactSecrets };
