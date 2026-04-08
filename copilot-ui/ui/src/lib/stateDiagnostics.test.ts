import { describe, expect, it } from 'vitest';
import { resolveSessionActiveLabel, resolveSessionStatus } from './stateDiagnostics';

describe('stateDiagnostics session live-status labeling', () => {
  it('keeps artifact-only active status neutral when no live runtime evidence exists', () => {
    const session = {
      id: 'session-1',
      status: 'active',
      reconciliation: {
        hasRuntimeState: false,
      },
    };

    expect(resolveSessionStatus(session)).toBe('unknown');
    expect(resolveSessionActiveLabel(session)).toBe('unknown');
  });

  it('preserves active labeling when runtime evidence is present', () => {
    const session = {
      id: 'session-2',
      resolvedStatus: 'active',
      reconciliation: {
        hasRuntimeState: true,
      },
    };

    expect(resolveSessionStatus(session)).toBe('active');
    expect(resolveSessionActiveLabel(session)).toBe('true');
  });
});
