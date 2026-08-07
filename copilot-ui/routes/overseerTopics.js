'use strict';

const { OVERSEER_ORIGIN, redactSecrets, createLoopbackClient } = require('./_overseerLoopback');

function register(deps = {}) {
  const client = createLoopbackClient({ ...deps, resolveTarget(pathname) {
    if (pathname === '/api/overseer/briefing/v1/summary') return '/api/briefing/v1/summary';
    if (pathname === '/api/overseer/projects/v1/summary') return '/api/projects/v1/summary';
    const project = pathname.match(/^\/api\/overseer\/projects\/v1\/([^/]+)$/);
    if (project) return `/api/projects/v1/${project[1]}`;
    if (pathname === '/api/overseer/knowledge/v1/summary') return '/api/knowledge/v1/summary';
    if (pathname === '/api/overseer/tasks/v1/summary') return '/api/tasks/v1/summary';
    return null;
  } });
  return [
    { method: 'GET', path: '/api/overseer/briefing/v1/summary', handler: client.handler },
    { method: 'GET', path: '/api/overseer/projects/v1/summary', handler: client.handler },
    { method: 'GET', path: /^\/api\/overseer\/projects\/v1\/([^/]+)$/, handler: client.handler },
    { method: 'GET', path: '/api/overseer/knowledge/v1/summary', handler: client.handler },
    { method: 'GET', path: '/api/overseer/tasks/v1/summary', handler: client.handler },
  ];
}

module.exports = { register, OVERSEER_ORIGIN, redactSecrets };
