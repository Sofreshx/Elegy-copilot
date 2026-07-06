import assert from 'node:assert/strict';
import test from 'node:test';
import type { OAuthConfig } from '../config.js';
import { AuthError, buildProtectedResourceMetadata, validateAuthConfig, validateJwtClaims } from '../auth.js';

const config: OAuthConfig = {
  enabled: true,
  issuer: 'https://example.auth0.com/',
  audience: 'https://mcp.example.com',
  requiredScopes: ['repo:read'],
  publicBaseUrl: 'https://mcp.example.com',
};

test('validateAuthConfig rejects missing issuer', () => {
  assert.throws(() => validateAuthConfig({ ...config, issuer: '' }), AuthError);
});

test('validateJwtClaims rejects bad issuer', () => {
  assert.throws(() => validateJwtClaims({ iss: 'https://other/', aud: config.audience, scope: 'repo:read' }, config), AuthError);
});

test('validateJwtClaims rejects bad audience', () => {
  assert.throws(() => validateJwtClaims({ iss: config.issuer, aud: 'other', scope: 'repo:read' }, config), AuthError);
});

test('validateJwtClaims rejects missing scope', () => {
  assert.throws(() => validateJwtClaims({ iss: config.issuer, aud: config.audience, scope: 'openid' }, config), AuthError);
});

test('validateJwtClaims accepts valid claims', () => {
  assert.doesNotThrow(() => validateJwtClaims({ iss: config.issuer, aud: config.audience, scope: 'openid repo:read' }, config));
});

test('protected resource metadata exposes auth server and scope', () => {
  const metadata = buildProtectedResourceMetadata(config);
  assert.equal(metadata.resource, config.publicBaseUrl);
  assert.deepEqual(metadata.authorization_servers, [config.issuer]);
  assert.deepEqual(metadata.scopes_supported, ['repo:read']);
});
