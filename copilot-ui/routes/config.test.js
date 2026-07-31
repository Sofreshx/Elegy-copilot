'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { register } = require('./config');

test('Codex config routes expose read-only native status without legacy bridge controls', async () => {
  const sent = [];
  const routes = register({
    sendJson: (_res, status, body) => sent.push({ status, body }),
    codexConfig: {
      getStatus: () => ({
        activeMode: 'native',
        providerId: 'openai',
        hasLegacyBlock: false,
      }),
    },
  });

  const paths = routes.map((route) => route.path).filter((path) => typeof path === 'string');
  assert.deepEqual(paths, [
    '/api/config/remote-sessions',
    '/api/config/remote-sessions',
    '/api/config/collaboration-profile',
    '/api/config/collaboration-profile',
    '/api/config/collaboration-profile/instructions',
    '/api/config/collaboration-profile/instructions/view',
    '/api/config/codex-provider',
  ]);
  assert.equal(paths.some((path) => path.includes('deepseek')), false);
  assert.equal(paths.some((path) => path.includes('reset')), false);

  await routes.find((route) => route.path === '/api/config/codex-provider').handler({
    res: {},
    codexHome: 'C:/codex',
  });
  assert.deepEqual(sent.at(-1), {
    status: 200,
    body: { activeMode: 'native', providerId: 'openai', hasLegacyBlock: false },
  });
});
