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

  it('normalizes deepseek-bridge mode with deepseek status fields', () => {
    const status = normalizeCodexProviderStatusResponse({
      activeMode: 'deepseek-bridge',
      providerId: 'instruction_engine_deepseek',
      gateway: {
        model: 'deepseek-v4-pro',
        baseUrl: 'http://127.0.0.1:38440/v1',
        envKey: 'MOON_BRIDGE_DEEPSEEK_TOKEN',
      },
      deepseek: {
        bridgePath: '/path/to/bridge.exe',
        bridgeConfigPath: '/path/to/config.yml',
        bridgeUrl: 'http://127.0.0.1:38440/v1',
        keyConfigured: true,
        bridgeReachable: true,
        modelsVisible: true,
        bridgeBinaryAvailable: true,
        bridgeRunning: true,
        modelIds: ['deepseek-v4-pro', 'deepseek-v4-flash'],
        probeError: null,
      },
    });

    expect(status.activeMode).toBe('deepseek-bridge');
    expect(status.providerId).toBe('instruction_engine_deepseek');
    expect(status.deepseek).toBeDefined();
    expect(status.deepseek!.bridgePath).toBe('/path/to/bridge.exe');
    expect(status.deepseek!.keyConfigured).toBe(true);
    expect(status.deepseek!.bridgeReachable).toBe(true);
    expect(status.deepseek!.modelsVisible).toBe(true);
    expect(status.deepseek!.bridgeRunning).toBe(true);
    expect(status.deepseek!.modelIds).toEqual(['deepseek-v4-pro', 'deepseek-v4-flash']);
  });

  it('omits deepseek field when payload has no deepseek data', () => {
    const status = normalizeCodexProviderStatusResponse({
      activeMode: 'native',
      providerId: 'openai',
      gateway: {
        model: 'gpt-5.4',
        baseUrl: '',
        envKey: '',
      },
    });

    expect(status.deepseek).toBeUndefined();
  });

  it('handles deepseek-bridge mode with no key configured', () => {
    const status = normalizeCodexProviderStatusResponse({
      activeMode: 'deepseek-bridge',
      providerId: 'instruction_engine_deepseek',
      deepseek: {
        keyConfigured: false,
        bridgeReachable: false,
        modelsVisible: false,
        bridgeBinaryAvailable: false,
        bridgeRunning: false,
      },
    });

    expect(status.deepseek!.keyConfigured).toBe(false);
    expect(status.deepseek!.bridgeReachable).toBe(false);
    expect(status.deepseek!.modelsVisible).toBe(false);
  });
});
