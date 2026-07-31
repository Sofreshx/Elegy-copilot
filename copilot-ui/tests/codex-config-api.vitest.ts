import { describe, expect, it } from 'vitest';
import { normalizeCodexProviderStatusResponse } from '../ui/src/lib/api/core';

describe('normalizeCodexProviderStatusResponse', () => {
  it('normalizes the native Codex status and legacy migration fields', () => {
    const status = normalizeCodexProviderStatusResponse({
      codexHome: 'C:/Users/example/.codex',
      configPath: 'C:/Users/example/.codex/config.toml',
      backupPath: 'C:/Users/example/.codex/config.toml.bak',
      exists: true,
      activeMode: 'native',
      providerId: 'openai',
      hasLegacyBlock: true,
      hasBackup: true,
      legacyMigration: {
        required: true,
        action: 'backup-and-remove-known-blocks',
      },
    });

    expect(status.activeMode).toBe('native');
    expect(status.providerId).toBe('openai');
    expect(status.codexHome).toContain('.codex');
    expect(status.hasLegacyBlock).toBe(true);
    expect(status.hasBackup).toBe(true);
    expect(status.legacyMigration).toEqual({
      required: true,
      action: 'backup-and-remove-known-blocks',
    });
  });

  it('applies safe defaults to an incomplete native payload', () => {
    const status = normalizeCodexProviderStatusResponse({});

    expect(status.activeMode).toBe('native');
    expect(status.providerId).toBe('openai');
    expect(status.exists).toBe(false);
    expect(status.hasLegacyBlock).toBe(false);
    expect(status.hasBackup).toBe(false);
    expect(status.backupPath).toBeNull();
  });
});
