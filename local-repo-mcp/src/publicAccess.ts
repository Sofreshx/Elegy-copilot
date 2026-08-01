import type { OAuthConfig } from './config.js';

export function isMcpPathAllowed(pathname: string, config: OAuthConfig): boolean {
  if (pathname === '/mcp') return true;
  if (!pathname.startsWith('/mcp/')) return false;
  const token = pathname.slice('/mcp/'.length);
  return Boolean(config.publicAccessToken && token === config.publicAccessToken);
}
