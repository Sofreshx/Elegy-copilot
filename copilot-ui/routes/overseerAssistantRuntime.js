'use strict';

const { OVERSEER_ORIGIN, redactSecrets, createLoopbackClient } = require('./_overseerLoopback');

function register(deps = {}) {
  const client = createLoopbackClient({ ...deps, resolveTarget(pathname) {
    if (pathname === '/api/overseer/runs/v1/items') return '/api/runs/v1/items';
    const runItem = pathname.match(/^\/api\/overseer\/runs\/v1\/items\/([^/]+)$/);
    if (runItem) return `/api/runs/v1/items/${runItem[1]}`;
    const runMutation = pathname.match(/^\/api\/overseer\/runs\/v1\/items\/([^/]+)\/(cancel|retry|answer|preview|confirm)$/);
    if (runMutation) return `/api/runs/v1/items/${runMutation[1]}/${runMutation[2]}`;
    if (pathname === '/api/overseer/runs/v1/intake-file') return '/api/runs/v1/intake-file';
    if (pathname === '/api/overseer/assistants/v1/summary') return '/api/assistants/v1/summary';
    if (pathname === '/api/overseer/assistants/v1/operations') return '/api/assistants/v1/operations';
    if (pathname === '/api/overseer/assistants/v1/models') return '/api/assistants/v1/models';
    if (pathname === '/api/overseer/assistants/v1/settings') return '/api/assistants/v1/settings';
    return null;
  }, binaryPaths: new Set(['/api/overseer/runs/v1/intake-file']) });
  return [
    { method: 'GET', path: '/api/overseer/runs/v1/items', handler: client.handler },
    { method: 'GET', path: /^\/api\/overseer\/runs\/v1\/items\/([^/]+)$/, handler: client.handler },
    { method: 'POST', path: '/api/overseer/runs/v1/items', handler: client.handler },
    { method: 'POST', path: /^\/api\/overseer\/runs\/v1\/items\/([^/]+)\/(cancel|retry|answer|preview|confirm)$/, handler: client.handler },
    { method: 'POST', path: '/api/overseer/runs/v1/intake-file', handler: client.handler },
    { method: 'GET', path: '/api/overseer/assistants/v1/summary', handler: client.handler },
    { method: 'GET', path: '/api/overseer/assistants/v1/operations', handler: client.handler },
    { method: 'GET', path: '/api/overseer/assistants/v1/models', handler: client.handler },
    { method: 'GET', path: '/api/overseer/assistants/v1/settings', handler: client.handler },
    { method: 'PUT', path: '/api/overseer/assistants/v1/settings', handler: client.handler },
  ];
}

module.exports = { register, OVERSEER_ORIGIN, redactSecrets };
