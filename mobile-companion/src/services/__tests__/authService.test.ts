import { describe, expect, it } from 'vitest';
import { getAuthConfigError, resolveRelayHttpUrl } from '../authService';

describe('authService configuration', () => {
  it('returns error when GitHub client ID is empty', () => {
    expect(getAuthConfigError('')).toMatch(/client id.*not configured/i);
  });

  it('returns error when relay URL is not configured', () => {
    // Valid client ID but no relay URL env var → relay URL error
    expect(getAuthConfigError('test-client-id')).toMatch(/relay.*not configured/i);
  });

  it('normalizes relay HTTP URLs', () => {
    expect(resolveRelayHttpUrl('wss://relay.example.com/')).toBe('https://relay.example.com');
    expect(resolveRelayHttpUrl('ws://localhost:3000/')).toBe('http://localhost:3000');
  });
});
