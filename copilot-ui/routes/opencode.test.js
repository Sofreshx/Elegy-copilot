'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { register } = require('./opencode');

test('Codex planning skill status is not exposed by the OpenCode route set', () => {
  const routes = register();
  assert.equal(
    routes.some((route) => route.path === '/api/codex-planning-status'),
    false,
  );
});
