'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { register } = require('./kimaki');

test('registers the supported Remote API without legacy destructive routes', () => {
  const routes = register({});
  assert.deepEqual(
    routes.map((route) => `${route.method} ${route.path}`),
    [
      'GET /api/remote/status',
      'POST /api/remote/restart',
      'GET /api/remote/projects',
      'GET /api/remote/sessions',
      'POST /api/remote/send',
      'POST /api/remote/projects/add',
      'GET /api/remote/logs',
    ],
  );
});
