import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { OAuthConfig } from '../config.js';
import { AuthError, buildProtectedResourceMetadata, validateAuthConfig, validateJwtClaims } from '../auth.js';
import {
  approvePendingAuthorization,
  buildAuthorizationServerMetadata,
  createPendingAuthorization,
  exchangeAuthorizationCode,
  getAuthorizationStatus,
  getPublicJwks,
  listPendingAuthorizations,
  verifyLocalJwt,
} from '../localOAuth.js';

const config: OAuthConfig = {
  enabled: true,
  provider: 'external',
  issuer: 'https://example.auth0.com/',
  audience: 'https://mcp.example.com',
  requiredScopes: ['repo:read'],
  publicBaseUrl: 'https://mcp.example.com',
  stateDir: path.join(os.tmpdir(), 'local-repo-mcp-auth-test'),
};

function builtinConfig(): OAuthConfig {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-repo-mcp-oauth-'));
  return {
    enabled: true,
    provider: 'builtin',
    issuer: 'https://sample.trycloudflare.com',
    audience: 'https://sample.trycloudflare.com',
    requiredScopes: ['repo:read'],
    publicBaseUrl: 'https://sample.trycloudflare.com',
    stateDir,
  };
}

function pkce() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

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

test('built-in OAuth metadata exposes local issuer endpoints', () => {
  const localConfig = builtinConfig();
  const metadata = buildAuthorizationServerMetadata(localConfig);
  assert.equal(metadata.issuer, localConfig.issuer);
  assert.equal(metadata.authorization_endpoint, `${localConfig.issuer}/oauth/authorize`);
  assert.equal(metadata.token_endpoint, `${localConfig.issuer}/oauth/token`);
  assert.deepEqual(metadata.scopes_supported, ['repo:read']);
});

test('built-in OAuth publishes public jwks', async () => {
  const localConfig = builtinConfig();
  const jwks = await getPublicJwks(localConfig);
  assert.equal(jwks.keys.length, 1);
  assert.equal(jwks.keys[0].kid, 'local-repo-mcp-local-key');
  assert.equal(jwks.keys[0].d, undefined);
});

test('built-in OAuth token exchange rejects unapproved authorization code', async () => {
  const localConfig = builtinConfig();
  const { verifier, challenge } = pkce();
  const pending = createPendingAuthorization(localConfig, new URL(`${localConfig.issuer}/oauth/authorize?response_type=code&client_id=chatgpt&redirect_uri=https%3A%2F%2Fchatgpt.com%2Fconnector%2Foauth%2Fcb&scope=repo%3Aread&code_challenge=${challenge}&code_challenge_method=S256&resource=${encodeURIComponent(localConfig.audience)}`));
  assert.equal(listPendingAuthorizations(localConfig).length, 1);

  await assert.rejects(
    () => exchangeAuthorizationCode(localConfig, new URLSearchParams({
      grant_type: 'authorization_code',
      code: pending.id,
      redirect_uri: pending.redirectUri,
      code_verifier: verifier,
    })),
    /Authorization code is not approved/,
  );
});

test('built-in OAuth exchanges approved code and verifies local jwt', async () => {
  const localConfig = builtinConfig();
  const { verifier, challenge } = pkce();
  const pending = createPendingAuthorization(localConfig, new URL(`${localConfig.issuer}/oauth/authorize?response_type=code&client_id=chatgpt&redirect_uri=https%3A%2F%2Fchatgpt.com%2Fconnector%2Foauth%2Fcb&state=abc&scope=repo%3Aread&code_challenge=${challenge}&code_challenge_method=S256&resource=${encodeURIComponent(localConfig.audience)}`));
  approvePendingAuthorization(localConfig, pending.id);
  const status = getAuthorizationStatus(localConfig, pending.id);
  assert.equal(status.status, 'approved');
  if (status.status !== 'approved') throw new Error('expected approval');
  assert.ok(status.redirectUrl);
  const code = new URL(status.redirectUrl).searchParams.get('code') || '';

  const token = await exchangeAuthorizationCode(localConfig, new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: pending.redirectUri,
    code_verifier: verifier,
  }));
  const verified = await verifyLocalJwt(token.access_token, localConfig);
  assert.equal(verified.payload.iss, localConfig.issuer);
  assert.equal(verified.payload.aud, localConfig.audience);
  assert.equal(verified.payload.scope, 'repo:read');
});

test('built-in OAuth rejects wrong PKCE verifier', async () => {
  const localConfig = builtinConfig();
  const { challenge } = pkce();
  const pending = createPendingAuthorization(localConfig, new URL(`${localConfig.issuer}/oauth/authorize?response_type=code&client_id=chatgpt&redirect_uri=https%3A%2F%2Fchatgpt.com%2Fconnector%2Foauth%2Fcb&scope=repo%3Aread&code_challenge=${challenge}&code_challenge_method=S256&resource=${encodeURIComponent(localConfig.audience)}`));
  approvePendingAuthorization(localConfig, pending.id);
  const status = getAuthorizationStatus(localConfig, pending.id);
  if (status.status !== 'approved') throw new Error('expected approval');
  assert.ok(status.redirectUrl);
  const code = new URL(status.redirectUrl).searchParams.get('code') || '';

  await assert.rejects(
    () => exchangeAuthorizationCode(localConfig, new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: pending.redirectUri,
      code_verifier: 'wrong',
    })),
    /PKCE verifier/,
  );
});
