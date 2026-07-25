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
  registerClient,
  revokeToken,
  verifyLocalJwt,
} from '../localOAuth.js';
import { isMcpPathAllowed } from '../publicAccess.js';

const config: OAuthConfig = {
  enabled: true,
  provider: 'external',
  issuer: 'https://example.auth0.com/',
  audience: 'https://mcp.example.com',
  requiredScopes: ['repo:read'],
  publicBaseUrl: 'https://mcp.example.com',
  publicAccessToken: '',
  stateDir: path.join(os.tmpdir(), 'local-repo-mcp-auth-test'),
  accessTokenTtlSeconds: 3600,
  refreshTokenTtlSeconds: 2592000,
};

function builtinConfig(): OAuthConfig {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-repo-mcp-oauth-'));
  return {
    enabled: true,
    provider: 'builtin',
    issuer: 'https://sample.trycloudflare.com',
    audience: 'https://sample.trycloudflare.com/mcp',
    requiredScopes: ['repo:read'],
    publicBaseUrl: 'https://sample.trycloudflare.com',
    publicAccessToken: '',
    stateDir,
    accessTokenTtlSeconds: 3600,
    refreshTokenTtlSeconds: 2592000,
  };
}

const CHATGPT_REDIRECT = 'https://chatgpt.com/connector/oauth/cb';

function registerTestClient(localConfig: OAuthConfig) {
  return registerClient(localConfig, {
    client_name: 'ChatGPT',
    redirect_uris: [CHATGPT_REDIRECT],
    token_endpoint_auth_method: 'none',
  });
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
  assert.equal(metadata.resource, config.audience);
  assert.deepEqual(metadata.authorization_servers, [config.issuer]);
  assert.deepEqual(metadata.scopes_supported, ['repo:read']);
});

test('public access token allows local /mcp and matching public token path', () => {
  assert.equal(isMcpPathAllowed('/mcp', { ...config, publicAccessToken: 'secret-token' }), true);
  assert.equal(isMcpPathAllowed('/mcp/secret-token', { ...config, publicAccessToken: 'secret-token' }), true);
});

test('public access token rejects invalid tokenized MCP path', () => {
  assert.equal(isMcpPathAllowed('/mcp/wrong-token', { ...config, publicAccessToken: 'secret-token' }), false);
  assert.equal(isMcpPathAllowed('/mcp/secret-token', { ...config, publicAccessToken: '' }), false);
  assert.equal(isMcpPathAllowed('/other', { ...config, publicAccessToken: 'secret-token' }), false);
});

test('built-in OAuth metadata exposes local issuer endpoints', () => {
  const localConfig = builtinConfig();
  const metadata = buildAuthorizationServerMetadata(localConfig);
  assert.equal(metadata.issuer, localConfig.issuer);
  assert.equal(metadata.authorization_endpoint, `${localConfig.issuer}/oauth/authorize`);
  assert.equal(metadata.token_endpoint, `${localConfig.issuer}/oauth/token`);
  assert.equal(metadata.registration_endpoint, `${localConfig.issuer}/oauth/register`);
  assert.equal(metadata.revocation_endpoint, `${localConfig.issuer}/oauth/revoke`);
  assert.deepEqual(metadata.grant_types_supported, ['authorization_code', 'refresh_token']);
  assert.deepEqual(metadata.scopes_supported, ['repo:read', 'offline_access']);
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
  const client = registerTestClient(localConfig);
  const { verifier, challenge } = pkce();
  const pending = createPendingAuthorization(localConfig, new URL(`${localConfig.issuer}/oauth/authorize?response_type=code&client_id=${client.client_id}&redirect_uri=${encodeURIComponent(CHATGPT_REDIRECT)}&scope=repo%3Aread&code_challenge=${challenge}&code_challenge_method=S256&resource=${encodeURIComponent(localConfig.audience)}`));
  assert.equal(listPendingAuthorizations(localConfig).length, 1);

  await assert.rejects(
    () => exchangeAuthorizationCode(localConfig, new URLSearchParams({
      grant_type: 'authorization_code',
      code: pending.id,
      redirect_uri: pending.redirectUri,
      code_verifier: verifier,
      client_id: client.client_id,
      resource: localConfig.audience,
    })),
    /Authorization code is not approved/,
  );
});

test('built-in OAuth exchanges approved code and verifies local jwt', async () => {
  const localConfig = builtinConfig();
  const client = registerTestClient(localConfig);
  const { verifier, challenge } = pkce();
  const pending = createPendingAuthorization(localConfig, new URL(`${localConfig.issuer}/oauth/authorize?response_type=code&client_id=${client.client_id}&redirect_uri=${encodeURIComponent(CHATGPT_REDIRECT)}&state=abc&scope=repo%3Aread&code_challenge=${challenge}&code_challenge_method=S256&resource=${encodeURIComponent(localConfig.audience)}`));
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
    client_id: client.client_id,
    resource: localConfig.audience,
  }));
  const verified = await verifyLocalJwt(token.access_token, localConfig);
  assert.equal(verified.payload.iss, localConfig.issuer);
  assert.equal(verified.payload.aud, localConfig.audience);
  assert.equal(verified.payload.scope, 'repo:read');
  assert.ok(token.refresh_token);
});

test('built-in OAuth rejects wrong PKCE verifier', async () => {
  const localConfig = builtinConfig();
  const client = registerTestClient(localConfig);
  const { challenge } = pkce();
  const pending = createPendingAuthorization(localConfig, new URL(`${localConfig.issuer}/oauth/authorize?response_type=code&client_id=${client.client_id}&redirect_uri=${encodeURIComponent(CHATGPT_REDIRECT)}&scope=repo%3Aread&code_challenge=${challenge}&code_challenge_method=S256&resource=${encodeURIComponent(localConfig.audience)}`));
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
      client_id: client.client_id,
      resource: localConfig.audience,
    })),
    /PKCE verifier/,
  );
});

test('built-in OAuth rejects unregistered redirect URIs and missing resource indicators', () => {
  const localConfig = builtinConfig();
  const client = registerTestClient(localConfig);
  const { challenge } = pkce();
  assert.throws(
    () => createPendingAuthorization(localConfig, new URL(`${localConfig.issuer}/oauth/authorize?response_type=code&client_id=${client.client_id}&redirect_uri=${encodeURIComponent('https://evil.example/callback')}&scope=repo%3Aread&code_challenge=${challenge}&code_challenge_method=S256&resource=${encodeURIComponent(localConfig.audience)}`)),
    /redirect_uri is not registered/,
  );
  assert.throws(
    () => createPendingAuthorization(localConfig, new URL(`${localConfig.issuer}/oauth/authorize?response_type=code&client_id=${client.client_id}&redirect_uri=${encodeURIComponent(CHATGPT_REDIRECT)}&scope=repo%3Aread&code_challenge=${challenge}&code_challenge_method=S256`)),
    /resource is required/,
  );
});

test('refresh tokens rotate, reject replay, and revoke the token family', async () => {
  const localConfig = builtinConfig();
  const client = registerTestClient(localConfig);
  const { verifier, challenge } = pkce();
  const pending = createPendingAuthorization(localConfig, new URL(`${localConfig.issuer}/oauth/authorize?response_type=code&client_id=${client.client_id}&redirect_uri=${encodeURIComponent(CHATGPT_REDIRECT)}&scope=repo%3Aread%20offline_access&code_challenge=${challenge}&code_challenge_method=S256&resource=${encodeURIComponent(localConfig.audience)}`));
  approvePendingAuthorization(localConfig, pending.id);
  const status = getAuthorizationStatus(localConfig, pending.id);
  if (status.status !== 'approved' || !status.redirectUrl) throw new Error('expected approval');
  const code = new URL(status.redirectUrl).searchParams.get('code') || '';
  const initial = await exchangeAuthorizationCode(localConfig, new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: CHATGPT_REDIRECT,
    code_verifier: verifier,
    client_id: client.client_id,
    resource: localConfig.audience,
  }));
  const rotated = await exchangeAuthorizationCode(localConfig, new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: initial.refresh_token,
    client_id: client.client_id,
    resource: localConfig.audience,
  }));
  assert.notEqual(rotated.refresh_token, initial.refresh_token);
  await assert.rejects(
    () => exchangeAuthorizationCode(localConfig, new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: initial.refresh_token,
      client_id: client.client_id,
      resource: localConfig.audience,
    })),
    /replay detected/,
  );
  await assert.rejects(
    () => exchangeAuthorizationCode(localConfig, new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: rotated.refresh_token,
      client_id: client.client_id,
      resource: localConfig.audience,
    })),
    /replay detected/,
  );

  const secondConfig = builtinConfig();
  const secondClient = registerTestClient(secondConfig);
  const second = registerClient(secondConfig, { redirect_uris: ['https://example.com/callback'] });
  assert.ok(second.client_id);
  revokeToken(secondConfig, 'unknown-token');
  assert.equal(secondClient.token_endpoint_auth_method, 'none');
});
