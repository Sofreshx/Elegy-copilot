import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const claudeState = vi.hoisted(() => ({
  status: {
    overallStatus: 'ready',
    claudeHome: 'C:/Users/demo/.claude',
    claudeConfigPath: 'C:/Users/demo/.claude/settings.json',
    cli: { installed: true, version: '1.0.0', lastError: null },
  },
  loading: false,
  installing: false,
  error: null,
  message: null,
}));

vi.mock('../ui/src/stores/claudeCodeStore', () => ({
  claudeCodeStore: {
    getState: () => claudeState,
    subscribe: () => () => {},
    load: vi.fn(),
    installCli: vi.fn(),
    resetState: vi.fn(),
  },
}));

vi.mock('../ui/src/views/Catalog/HarnessAssetsPanel', () => ({
  default: ({ harnessId }: { harnessId: string }) => (
    <div data-testid={`mock-harness-assets-panel-${harnessId}`}>Assets inventory</div>
  ),
}));

vi.mock('../ui/src/views/Settings/ClaudeCodeProviderPanel', () => ({
  default: () => <div data-testid="mock-claude-provider-panel">Provider</div>,
}));

describe('ClaudeCodeView', () => {
  beforeEach(() => {
    claudeState.status = {
      overallStatus: 'ready',
      claudeHome: 'C:/Users/demo/.claude',
      claudeConfigPath: 'C:/Users/demo/.claude/settings.json',
      cli: { installed: true, version: '1.0.0', lastError: null },
    };
    claudeState.loading = false;
    claudeState.error = null;
    claudeState.message = null;
  });

  it('mounts a dedicated Assets tab without replacing Claude readiness controls', async () => {
    const { default: ClaudeCodeView } = await import('../ui/src/tabs/ClaudeCode/ClaudeCodeView');
    render(<ClaudeCodeView />);

    expect(screen.getByTestId('claude-code-tab-overview')).toBeInTheDocument();
    expect(screen.getByTestId('claude-code-tab-assets')).toBeInTheDocument();
    expect(screen.getAllByTestId('claude-code-readiness').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByTestId('claude-code-tab-assets'));
    expect(screen.getByTestId('mock-harness-assets-panel-claude-code')).toBeInTheDocument();
    expect(screen.queryByTestId('claude-code-readiness')).not.toBeInTheDocument();
  });
});
