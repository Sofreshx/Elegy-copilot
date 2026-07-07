import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { SignJWT, exportJWK, importJWK, jwtVerify, type JWK } from 'jose';
import type { OAuthConfig } from './config.js';

const KEY_ID = 'local-repo-mcp-local-key';
const AUTH_TTL_MS = 10 * 60 * 1000;
const CODE_TTL_MS = 2 * 60 * 1000;
const TOKEN_TTL_SECONDS = 60 * 60;

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
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2) + '\n', 'utf8');
  fs.renameSync(tempPath, filePath);
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
  if (!fs.existsSync(filePath)) return { pending: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as OAuthStore;
    return { pending: Array.isArray(parsed.pending) ? parsed.pending : [] };
  } catch {
    return { pending: [] };
  }
}

function saveStore(config: OAuthConfig, store: OAuthStore): void {
  const now = Date.now();
  const pending = store.pending.filter((entry) => {
    if (entry.consumedAt) return false;
    const expiry = entry.codeExpiresAt || entry.expiresAt;
    return Date.parse(expiry) > now;
  });
  writeJsonAtomic(storePath(config), { pending });
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
    grant_types_supported: ['authorization_code'],
    token_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
    client_id_metadata_document_supported: true,
    scopes_supported: config.requiredScopes,
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
  const resource = authorizeUrl.searchParams.get('resource') || config.audience;

  if (responseType !== 'code') throw new LocalOAuthError('unsupported_response_type', 'Only authorization code flow is supported.');
  if (!clientId) throw new LocalOAuthError('invalid_request', 'client_id is required.');
  if (!redirectUri) throw new LocalOAuthError('invalid_request', 'redirect_uri is required.');
  if (!codeChallenge) throw new LocalOAuthError('invalid_request', 'code_challenge is required.');
  if (codeChallengeMethod !== 'S256') throw new LocalOAuthError('invalid_request', 'code_challenge_method must be S256.');
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

export async function exchangeAuthorizationCode(config: OAuthConfig, form: URLSearchParams) {
  const grantType = form.get('grant_type') || '';
  const code = form.get('code') || '';
  const redirectUri = form.get('redirect_uri') || '';
  const codeVerifier = form.get('code_verifier') || '';

  if (grantType !== 'authorization_code') throw new LocalOAuthError('unsupported_grant_type', 'Only authorization_code is supported.');
  if (!code || !redirectUri || !codeVerifier) throw new LocalOAuthError('invalid_request', 'code, redirect_uri, and code_verifier are required.');

  const store = loadStore(config);
  const pending = store.pending.find((entry) => entry.code === code && !entry.consumedAt);
  if (!pending || !pending.approvedAt) throw new LocalOAuthError('invalid_grant', 'Authorization code is not approved.', 401);
  if (pending.redirectUri !== redirectUri) throw new LocalOAuthError('invalid_grant', 'redirect_uri does not match authorization request.', 401);
  if (!pending.codeExpiresAt || Date.parse(pending.codeExpiresAt) <= Date.now()) {
    throw new LocalOAuthError('invalid_grant', 'Authorization code expired.', 401);
  }
  verifyPkce(codeVerifier, pending.codeChallenge);

  pending.consumedAt = new Date().toISOString();
  saveStore(config, store);

  const privateJwk = await loadPrivateJwk(config);
  const key = await importJWK(privateJwk, 'RS256');
  const scope = requestedScopes(pending.scope).filter((item) => config.requiredScopes.includes(item)).join(' ') || config.requiredScopes.join(' ');
  const accessToken = await new SignJWT({ scope, client_id: pending.clientId })
    .setProtectedHeader({ alg: 'RS256', kid: KEY_ID })
    .setIssuer(config.issuer)
    .setAudience(config.audience)
    .setSubject('local-user')
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_TTL_SECONDS}s`)
    .sign(key);

  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: TOKEN_TTL_SECONDS,
    scope,
  };
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
