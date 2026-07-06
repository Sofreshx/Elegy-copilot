import type http from 'node:http';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { OAuthConfig } from './config.js';

export class AuthError extends Error {
  readonly statusCode = 401;
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
  }
}

export function buildProtectedResourceMetadata(config: OAuthConfig) {
  const resource = config.publicBaseUrl || config.audience;
  return {
    resource,
    authorization_servers: config.issuer ? [config.issuer] : [],
    scopes_supported: config.requiredScopes,
    bearer_methods_supported: ['header'],
    resource_documentation: config.publicBaseUrl ? `${config.publicBaseUrl}/mcp` : undefined,
  };
}

export function buildWwwAuthenticate(config: OAuthConfig): string {
  const parts = ['Bearer'];
  if (config.publicBaseUrl || config.audience) {
    parts.push(`resource="${config.publicBaseUrl || config.audience}"`);
  }
  if (config.requiredScopes.length > 0) {
    parts.push(`scope="${config.requiredScopes.join(' ')}"`);
  }
  return parts.join(' ');
}

export function extractBearerToken(req: http.IncomingMessage): string {
  const header = req.headers.authorization || '';
  const value = Array.isArray(header) ? header[0] : header;
  const match = value.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    throw new AuthError('missing_token', 'Missing bearer token.');
  }
  return match[1].trim();
}

export function validateAuthConfig(config: OAuthConfig): void {
  if (!config.enabled) return;
  if (!config.issuer) throw new AuthError('auth_misconfigured', 'LOCAL_REPO_MCP_AUTH_ISSUER is required.');
  if (!config.audience) throw new AuthError('auth_misconfigured', 'LOCAL_REPO_MCP_AUTH_AUDIENCE is required.');
}

export function validateJwtClaims(payload: JWTPayload, config: OAuthConfig): void {
  if (payload.iss !== config.issuer) {
    throw new AuthError('bad_issuer', 'Token issuer is not allowed.');
  }

  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud].filter(Boolean);
  if (!audiences.includes(config.audience)) {
    throw new AuthError('bad_audience', 'Token audience is not allowed.');
  }

  const tokenScopes = new Set(String(payload.scope || '').split(/\s+/).filter(Boolean));
  for (const scope of config.requiredScopes) {
    if (!tokenScopes.has(scope)) {
      throw new AuthError('missing_scope', `Token is missing required scope: ${scope}`);
    }
  }
}

export async function verifyRequest(req: http.IncomingMessage, config: OAuthConfig): Promise<void> {
  if (!config.enabled) return;
  validateAuthConfig(config);
  const token = extractBearerToken(req);
  const issuerUrl = new URL(config.issuer);
  const jwks = createRemoteJWKSet(new URL('.well-known/jwks.json', issuerUrl));
  const { payload } = await jwtVerify(token, jwks, {
    issuer: config.issuer,
    audience: config.audience,
  });
  validateJwtClaims(payload, config);
}
