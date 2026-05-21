import { describe, expect, it } from 'vitest';
import { normalizeCodexProviderStatusResponse } from '../ui/src/lib/api/core';

describe('normalizeCodexProviderStatusResponse', () => {
  it('preserves the backend routed provider id when gateway.providerId is missing', () => {
    const status = normalizeCodexProviderStatusResponse({
      activeMode: 'elegy-routed',
      providerId: 'instruction_engine_elegy',
      gateway: {
        model: 'opencode-go',
        baseUrl: 'http://127.0.0.1:4318/v1',
        envKey: 'OPENCODE_GO_API_KEY',
      },
    });

    expect(status.providerId).toBe('instruction_engine_elegy');
    expect(status.gateway.providerId).toBe('instruction_engine_elegy');
  });

  it('defaults gateway.providerId to openai in native mode when omitted', () => {
    const status = normalizeCodexProviderStatusResponse({
      activeMode: 'native',
      gateway: {
        model: 'opencode-go',
        baseUrl: 'http://127.0.0.1:4318/v1',
        envKey: 'OPENCODE_GO_API_KEY',
      },
    });

    expect(status.providerId).toBe('openai');
    expect(status.gateway.providerId).toBe('openai');
  });
});
