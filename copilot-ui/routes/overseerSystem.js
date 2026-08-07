'use strict';

const { OVERSEER_ORIGIN, redactSecrets, createLoopbackClient } = require('./_overseerLoopback');

function register(deps = {}) {
  const client = createLoopbackClient({
    ...deps,
    resolveTarget(pathname) {
      if (pathname === '/api/overseer/system/v1/summary') return '/api/system/v1/summary';
      return null;
    },
  });
  return [{ method: 'GET', path: '/api/overseer/system/v1/summary', handler: client.handler }];
}

module.exports = { register, OVERSEER_ORIGIN, redactSecrets };
