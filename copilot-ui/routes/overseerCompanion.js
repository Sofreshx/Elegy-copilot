'use strict';

const { OVERSEER_ORIGIN, redactSecrets, createLoopbackClient } = require('./_overseerLoopback');

function register(deps = {}) {
  const client = createLoopbackClient({ ...deps, resolveTarget(pathname) {
    if (pathname === '/api/overseer/context/v1/resolve') return '/api/context/v1/resolve';
    if (pathname === '/api/overseer/chat/v1/conversations') return '/api/chat/v1/conversations';
    const conversation = pathname.match(/^\/api\/overseer\/chat\/v1\/conversations\/([^/]+)$/);
    if (conversation) return `/api/chat/v1/conversations/${conversation[1]}`;
    const turn = pathname.match(/^\/api\/overseer\/chat\/v1\/conversations\/([^/]+)\/turns$/);
    if (turn) return `/api/chat/v1/conversations/${turn[1]}/turns`;
    const events = pathname.match(/^\/api\/overseer\/chat\/v1\/conversations\/([^/]+)\/events$/);
    if (events) return `/api/chat/v1/conversations/${events[1]}/events`;
    const cancel = pathname.match(/^\/api\/overseer\/chat\/v1\/conversations\/([^/]+)\/cancel$/);
    if (cancel) return `/api/chat/v1/conversations/${cancel[1]}/cancel`;
    return null;
  } });
  return [
    { method: 'POST', path: '/api/overseer/context/v1/resolve', handler: client.handler },
    { method: 'POST', path: '/api/overseer/chat/v1/conversations', handler: client.handler },
    { method: 'GET', path: /^\/api\/overseer\/chat\/v1\/conversations\/([^/]+)$/, handler: client.handler },
    { method: 'POST', path: /^\/api\/overseer\/chat\/v1\/conversations\/([^/]+)\/turns$/, handler: client.handler },
    { method: 'GET', path: /^\/api\/overseer\/chat\/v1\/conversations\/([^/]+)\/events$/, handler: client.handler },
    { method: 'POST', path: /^\/api\/overseer\/chat\/v1\/conversations\/([^/]+)\/cancel$/, handler: client.handler },
  ];
}

module.exports = { register, OVERSEER_ORIGIN, redactSecrets };
