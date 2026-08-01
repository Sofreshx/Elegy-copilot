import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { SignJWT, exportJWK, importJWK, jwtVerify, type JWK } from 'jose';
import type { OAuthConfig } from './config.js';

const KEY_ID = 'local-repo-mcp-local-key';
const AUTH_TTL_MS = 10 * 60 * 1000;
const CODE_TTL_MS = 2 * 60 * 1000;
type RegisteredClient = {
  clientId: string;
  clientName: string;
  redirectUris: string[];
  createdAt: string;
};

type RefreshTokenGrant = {
  tokenHash: string;
  familyId: string;
  clientId: string;
  scope: string;
  resource: string;
  issuedAt: string;
  expiresAt: string;
  rotatedAt?: string;
  revokedAt?: string;
};

type PendingAuthorization = {
  id: string;
  userCode: string;
  clientId: string;
  redirectUri: string;
  state: string;
  scope: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  resource: string;
  createdAt: string;
  expiresAt: string;
  approvedAt?: string;
  code?: string;
  codeExpiresAt?: string;
  consumedAt?: string;
};

type OAuthStore = {
  pending: PendingAuthorization[];
  clients: RegisteredClient[];
  refreshTokens: RefreshTokenGrant[];
};

export class LocalOAuthError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.name = 'LocalOAuthError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function keyPath(config: OAuthConfig): string {
  return path.join(config.stateDir, 'signing-key.json');
}

function storePath(config: OAuthConfig): string {
  return path.join(config.stateDir, 'pending-authorizations.json');
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tempPath, filePath);
  try { fs.chmodSync(filePath, 0o600); } catch { /* Windows ACLs are managed by the user profile. */ }
}

async function loadPrivateJwk(config: OAuthConfig): Promise<JWK> {
  const filePath = keyPath(config);
  if (fs.existsSync(filePath)) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as JWK;
  }

  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = await exportJWK(privateKey);
  jwk.kid = KEY_ID;
  jwk.alg = 'RS256';
  jwk.use = 'sig';
  writeJsonAtomic(filePath, jwk);
  return jwk;
}

export async function getPublicJwks(config: OAuthConfig): Promise<{ keys: JWK[] }> {
  const privateJwk = await loadPrivateJwk(config);
  const { d, p, q, dp, dq, qi, ...publicJwk } = privateJwk;
  void d; void p; void q; void dp; void dq; void qi;
  return { keys: [{ ...publicJwk, kid: KEY_ID, alg: 'RS256', use: 'sig' }] };
}

function loadStore(config: OAuthConfig): OAuthStore {
  const filePath = storePath(config);
  if (!fs.existsSync(filePath)) return { pending: [], clients: [], refreshTokens: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as OAuthStore;
    return {
      pending: Array.isArray(parsed.pending) ? parsed.pending : [],
      clients: Array.isArray(parsed.clients) ? parsed.clients : [],
      refreshTokens: Array.isArray(parsed.refreshTokens) ? parsed.refreshTokens : [],
    };
  } catch {
    return { pending: [], clients: [], refreshTokens: [] };
  }
}

function saveStore(config: OAuthConfig, store: OAuthStore): void {
  const now = Date.now();
  const pending = store.pending.filter((entry) => {
    if (entry.consumedAt) return false;
    const expiry = entry.codeExpiresAt || entry.expiresAt;
    return Date.parse(expiry) > now;
  });
  const refreshTokens = store.refreshTokens.filter((entry) => Date.parse(entry.expiresAt) > now);
  writeJsonAtomic(storePath(config), { pending, clients: store.clients, refreshTokens });
}

function requestedScopes(scope: string): string[] {
  return scope.split(/\s+/).map((item) => item.trim()).filter(Boolean);
}

function assertAllowedScopes(scope: string, config: OAuthConfig): void {
  const allowed = new Set(config.requiredScopes);
  for (const requested of requestedScopes(scope)) {
    if (!allowed.has(requested) && requested !== 'openid' && requested !== 'offline_access') {
      throw new LocalOAuthError('invalid_scope', `Unsupported scope: ${requested}`);
    }
  }
}

export function buildAuthorizationServerMetadata(config: OAuthConfig) {
  return {
    issuer: config.issuer,
    authorization_endpoint: `${config.issuer}/oauth/authorize`,
    token_endpoint: `${config.issuer}/oauth/token`,
    jwks_uri: `${config.issuer}/.well-known/jwks.json`,
    response_types_supported: ['code'],
    registration_endpoint: `${config.issuer}/oauth/register`,
    revocation_endpoint: `${config.issuer}/oauth/revoke`,
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: [...new Set([...config.requiredScopes, 'offline_access'])],
  };
}

function assertRedirectUri(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new LocalOAuthError('invalid_redirect_uri', 'redirect_uris must contain absolute URLs.');
  }
  const loopback = (url.hostname === '127.0.0.1' || url.hostname === '[::1]' || url.hostname === 'localhost');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new LocalOAuthError('invalid_redirect_uri', 'Redirect URIs must use HTTPS, except loopback HTTP callbacks.');
  }
  if (url.hash) throw new LocalOAuthError('invalid_redirect_uri', 'Redirect URIs must not contain fragments.');
}

export function registerClient(config: OAuthConfig, metadata: Record<string, unknown>) {
  const redirectUris = Array.isArray(metadata.redirect_uris)
    ? metadata.redirect_uris.map(String)
    : [];
  if (redirectUris.length === 0) throw new LocalOAuthError('invalid_client_metadata', 'redirect_uris is required.');
  redirectUris.forEach(assertRedirectUri);
  if (metadata.token_endpoint_auth_method && metadata.token_endpoint_auth_method !== 'none') {
    throw new LocalOAuthError('invalid_client_metadata', 'Only public clients with token_endpoint_auth_method=none are supported.');
  }
  const store = loadStore(config);
  const client: RegisteredClient = {
    clientId: crypto.randomUUID(),
    clientName: String(metadata.client_name || 'MCP client').slice(0, 200),
    redirectUris: [...new Set(redirectUris)],
    createdAt: new Date().toISOString(),
  };
  store.clients.push(client);
  saveStore(config, store);
  return {
    client_id: client.clientId,
    client_name: client.clientName,
    redirect_uris: client.redirectUris,
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
  };
}

export function createPendingAuthorization(config: OAuthConfig, authorizeUrl: URL): PendingAuthorization {
  const responseType = authorizeUrl.searchParams.get('response_type') || '';
  const clientId = authorizeUrl.searchParams.get('client_id') || '';
  const redirectUri = authorizeUrl.searchParams.get('redirect_uri') || '';
  const state = authorizeUrl.searchParams.get('state') || '';
  const scope = authorizeUrl.searchParams.get('scope') || config.requiredScopes.join(' ');
  const codeChallenge = authorizeUrl.searchParams.get('code_challenge') || '';
  const codeChallengeMethod = authorizeUrl.searchParams.get('code_challenge_method') || '';
  const resource = authorizeUrl.searchParams.get('resource') || '';

  if (responseType !== 'code') throw new LocalOAuthError('unsupported_response_type', 'Only authorization code flow is supported.');
  if (!clientId) throw new LocalOAuthError('invalid_request', 'client_id is required.');
  if (!redirectUri) throw new LocalOAuthError('invalid_request', 'redirect_uri is required.');
  const registeredClient = loadStore(config).clients.find((entry) => entry.clientId === clientId);
  if (!registeredClient) throw new LocalOAuthError('unauthorized_client', 'client_id is not registered.', 401);
  if (!registeredClient.redirectUris.includes(redirectUri)) {
    throw new LocalOAuthError('invalid_request', 'redirect_uri is not registered for this client.');
  }
  if (!codeChallenge) throw new LocalOAuthError('invalid_request', 'code_challenge is required.');
  if (codeChallengeMethod !== 'S256') throw new LocalOAuthError('invalid_request', 'code_challenge_method must be S256.');
  if (!resource) throw new LocalOAuthError('invalid_target', 'resource is required.');
  if (resource !== config.audience) throw new LocalOAuthError('invalid_target', 'resource must match the Local Repo MCP audience.');
  assertAllowedScopes(scope, config);

  const now = new Date();
  const pending: PendingAuthorization = {
    id: crypto.randomUUID(),
    userCode: String(crypto.randomInt(100000, 999999)),
    clientId,
    redirectUri,
    state,
    scope,
    codeChallenge,
    codeChallengeMethod,
    resource,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + AUTH_TTL_MS).toISOString(),
  };
  const store = loadStore(config);
  store.pending.unshift(pending);
  saveStore(config, store);
  return pending;
}

export function listPendingAuthorizations(config: OAuthConfig) {
  const store = loadStore(config);
  saveStore(config, store);
  return loadStore(config).pending
    .filter((entry) => !entry.approvedAt)
    .map(({ id, userCode, clientId, scope, resource, createdAt, expiresAt }) => ({
      id,
      userCode,
      clientId,
      scope,
      resource,
      createdAt,
      expiresAt,
    }));
}

export function approvePendingAuthorization(config: OAuthConfig, id: string) {
  const store = loadStore(config);
  const pending = store.pending.find((entry) => entry.id === id && !entry.consumedAt);
  if (!pending) throw new LocalOAuthError('not_found', 'Pending authorization was not found.', 404);
  if (Date.parse(pending.expiresAt) <= Date.now()) throw new LocalOAuthError('expired_authorization', 'Pending authorization expired.');

  pending.approvedAt = new Date().toISOString();
  pending.code = crypto.randomBytes(32).toString('base64url');
  pending.codeExpiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();
  saveStore(config, store);
  return getAuthorizationStatus(config, id);
}

export function getAuthorizationStatus(config: OAuthConfig, id: string) {
  const store = loadStore(config);
  const pending = store.pending.find((entry) => entry.id === id && !entry.consumedAt);
  if (!pending) return { status: 'missing' };
  if (Date.parse(pending.expiresAt) <= Date.now()) return { status: 'expired' };
  if (!pending.approvedAt || !pending.code) return { status: 'pending', userCode: pending.userCode };

  const redirect = new URL(pending.redirectUri);
  redirect.searchParams.set('code', pending.code);
  if (pending.state) redirect.searchParams.set('state', pending.state);
  return { status: 'approved', redirectUrl: redirect.toString() };
}

function verifyPkce(codeVerifier: string, codeChallenge: string): void {
  const digest = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  if (digest !== codeChallenge) {
    throw new LocalOAuthError('invalid_grant', 'PKCE verifier does not match authorization challenge.', 401);
  }
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('base64url');
}

async function issueAccessToken(config: OAuthConfig, clientId: string, scope: string, resource: string) {
  const privateJwk = await loadPrivateJwk(config);
  const key = await importJWK(privateJwk, 'RS256');
  return new SignJWT({ scope, client_id: clientId, resource })
    .setProtectedHeader({ alg: 'RS256', kid: KEY_ID })
    .setIssuer(config.issuer)
    .setAudience(resource)
    .setSubject('local-user')
    .setJti(crypto.randomUUID())
    .setIssuedAt()
    .setExpirationTime(`${config.accessTokenTtlSeconds}s`)
    .sign(key);
}

function createRefreshToken(store: OAuthStore, config: OAuthConfig, grant: Omit<RefreshTokenGrant, 'tokenHash' | 'issuedAt' | 'expiresAt'>) {
  const token = crypto.randomBytes(48).toString('base64url');
  const now = new Date();
  store.refreshTokens.push({
    ...grant,
    tokenHash: hashToken(token),
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + config.refreshTokenTtlSeconds * 1000).toISOString(),
  });
  return token;
}

async function exchangeRefreshToken(config: OAuthConfig, form: URLSearchParams) {
  const refreshToken = form.get('refresh_token') || '';
  const clientId = form.get('client_id') || '';
  const resource = form.get('resource') || '';
  if (!refreshToken || !clientId || !resource) {
    throw new LocalOAuthError('invalid_request', 'refresh_token, client_id, and resource are required.');
  }
  if (resource !== config.audience) throw new LocalOAuthError('invalid_target', 'resource must match the Local Repo MCP audience.');
  const store = loadStore(config);
  const grant = store.refreshTokens.find((entry) => entry.tokenHash === hashToken(refreshToken));
  if (!grant || grant.clientId !== clientId || grant.resource !== resource) {
    throw new LocalOAuthError('invalid_grant', 'Refresh token is invalid.', 401);
  }
  if (grant.rotatedAt || grant.revokedAt) {
    const now = new Date().toISOString();
    for (const member of store.refreshTokens) {
      if (member.familyId === grant.familyId) member.revokedAt = member.revokedAt || now;
    }
    saveStore(config, store);
    throw new LocalOAuthError('invalid_grant', 'Refresh token replay detected; token family revoked.', 401);
  }
  if (Date.parse(grant.expiresAt) <= Date.now()) throw new LocalOAuthError('invalid_grant', 'Refresh token expired.', 401);
  grant.rotatedAt = new Date().toISOString();
  const nextRefreshToken = createRefreshToken(store, config, {
    familyId: grant.familyId,
    clientId,
    scope: grant.scope,
    resource,
  });
  saveStore(config, store);
  return {
    access_token: await issueAccessToken(config, clientId, grant.scope, resource),
    token_type: 'Bearer',
    expires_in: config.accessTokenTtlSeconds,
    refresh_token: nextRefreshToken,
    scope: grant.scope,
  };
}

export async function exchangeAuthorizationCode(config: OAuthConfig, form: URLSearchParams) {
  const grantType = form.get('grant_type') || '';
  if (grantType === 'refresh_token') return exchangeRefreshToken(config, form);
  const code = form.get('code') || '';
  const redirectUri = form.get('redirect_uri') || '';
  const codeVerifier = form.get('code_verifier') || '';
  const clientId = form.get('client_id') || '';
  const resource = form.get('resource') || '';

  if (grantType !== 'authorization_code') throw new LocalOAuthError('unsupported_grant_type', 'Grant type is not supported.');
  if (!code || !redirectUri || !codeVerifier || !clientId || !resource) {
    throw new LocalOAuthError('invalid_request', 'code, redirect_uri, code_verifier, client_id, and resource are required.');
  }
  if (resource !== config.audience) throw new LocalOAuthError('invalid_target', 'resource must match the Local Repo MCP audience.');

  const store = loadStore(config);
  const pending = store.pending.find((entry) => entry.code === code && !entry.consumedAt);
  if (!pending || !pending.approvedAt) throw new LocalOAuthError('invalid_grant', 'Authorization code is not approved.', 401);
  if (pending.clientId !== clientId) throw new LocalOAuthError('invalid_grant', 'client_id does not match authorization request.', 401);
  if (pending.resource !== resource) throw new LocalOAuthError('invalid_target', 'resource does not match authorization request.', 401);
  if (pending.redirectUri !== redirectUri) throw new LocalOAuthError('invalid_grant', 'redirect_uri does not match authorization request.', 401);
  if (!pending.codeExpiresAt || Date.parse(pending.codeExpiresAt) <= Date.now()) {
    throw new LocalOAuthError('invalid_grant', 'Authorization code expired.', 401);
  }
  verifyPkce(codeVerifier, pending.codeChallenge);

  pending.consumedAt = new Date().toISOString();
  const scope = requestedScopes(pending.scope).filter((item) => config.requiredScopes.includes(item)).join(' ') || config.requiredScopes.join(' ');
  const refreshToken = createRefreshToken(store, config, {
    familyId: crypto.randomUUID(),
    clientId: pending.clientId,
    scope,
    resource: pending.resource,
  });
  saveStore(config, store);

  return {
    access_token: await issueAccessToken(config, pending.clientId, scope, pending.resource),
    token_type: 'Bearer',
    expires_in: config.accessTokenTtlSeconds,
    refresh_token: refreshToken,
    scope,
  };
}

export function revokeToken(config: OAuthConfig, token: string): void {
  if (!token) return;
  const store = loadStore(config);
  const grant = store.refreshTokens.find((entry) => entry.tokenHash === hashToken(token));
  if (!grant) return;
  const now = new Date().toISOString();
  for (const member of store.refreshTokens) {
    if (member.familyId === grant.familyId) member.revokedAt = member.revokedAt || now;
  }
  saveStore(config, store);
}

export async function verifyLocalJwt(token: string, config: OAuthConfig) {
  const jwks = await getPublicJwks(config);
  const publicJwk = jwks.keys[0];
  const key = await importJWK(publicJwk, 'RS256');
  return jwtVerify(token, key, {
    issuer: config.issuer,
    audience: config.audience,
  });
}
