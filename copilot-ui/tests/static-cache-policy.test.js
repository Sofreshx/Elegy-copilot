'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { cacheControlForStaticPath } = require('../server');

test('hashed Vite assets use immutable long-term caching', () => {
  assert.equal(
    cacheControlForStaticPath('/assets/SettingsView-D3f9ab_X.js'),
    'public, max-age=31536000, immutable',
  );
  assert.equal(
    cacheControlForStaticPath('/assets/index-CN6R1Jsg.css'),
    'public, max-age=31536000, immutable',
  );
});

test('entrypoints and unhashed assets are never cached', () => {
  assert.equal(cacheControlForStaticPath('/index.html'), 'no-store');
  assert.equal(cacheControlForStaticPath('/assets/elegy-copilot-icon.svg'), 'no-store');
  assert.equal(cacheControlForStaticPath('/elegy-copilot-icon.png'), 'no-store');
});
