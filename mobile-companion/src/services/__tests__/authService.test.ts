import { describe, expect, it } from 'vitest';
import { getAuthConfigError, resolveRelayHttpUrl } from '../authService';

describe('authService configuration', () => {
  it('requires a configured GitHub client ID', () => {
    expect(getAuthConfigError('')).toMatch(/not configured/i);
    expect(getAuthConfigError('Ov23liF3zWLNuXjUqCRG')).toMatch(/not configured/i);
    expect(getAuthConfigError('test-client-id')).toBeNull();
  });

  it('normalizes relay HTTP URLs', () => {
    expect(resolveRelayHttpUrl('wss://relay.example.com/')).toBe('https://relay.example.com');
    expect(resolveRelayHttpUrl('ws://localhost:3000/')).toBe('http://localhost:3000');
  });
});
