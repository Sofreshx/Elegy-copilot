import { useEffect, useState } from 'react';
import { Badge, Button, Panel } from '../../components';
import { useStoreValue } from '../../lib/store';
import type { ClaudeCodeProviderMode } from '../../lib/types';
import { claudeCodeProviderStore, type ClaudeCodeProviderState } from '../../stores/claudeCodeProviderStore';

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  fontSize: '13px',
  border: '1px solid var(--border-color, #ccc)',
  borderRadius: '4px',
  background: 'var(--input-bg, #fff)',
  color: 'var(--text-color, #000)',
  fontFamily: 'monospace',
  boxSizing: 'border-box',
};

const MODE_META: Record<string, { label: string; description: string; baseUrl: string; models: string }> = {
  vanilla: {
    label: 'Vanilla Claude',
    description: 'Default Anthropic API — requires Anthropic subscription.',
    baseUrl: 'api.anthropic.com (default)',
    models: 'Claude (native)',
  },
  'opencode-go': {
    label: 'OpenCode Go',
    description: 'Claude models via OpenCode Zen gateway. Uses your OpenCode Go credits.',
    baseUrl: 'https://opencode.ai/zen',
    models: 'Claude Opus 4.6 / Sonnet 4.6 / Haiku 4.5',
  },
  'deepseek-direct': {
    label: 'DeepSeek Direct',
    description: 'DeepSeek V4 models via Anthropic-compatible endpoint. Most cost-effective.',
    baseUrl: 'https://api.deepseek.com/anthropic',
    models: 'DeepSeek V4 Pro + Flash',
  },
};

export default function ClaudeCodeProviderPanel() {
  const state: ClaudeCodeProviderState = useStoreValue(claudeCodeProviderStore);

  useEffect(() => {
    void claudeCodeProviderStore.load();
  }, []);

  const status = state.status;
  const activeMode = status?.activeMode || 'vanilla';

  const [deepseekApiKey, setDeepseekApiKey] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    if (!confirmReset) return;
    const timer = setTimeout(() => setConfirmReset(false), 4000);
    return () => clearTimeout(timer);
  }, [confirmReset]);

  const isVanilla = activeMode === 'vanilla';
  const isOpenCodeGo = activeMode === 'opencode-go';
  const isDeepseekDirect = activeMode === 'deepseek-direct';

  const currentMeta = MODE_META[activeMode] || MODE_META.vanilla;

  const handleSetMode = (mode: ClaudeCodeProviderMode) => {
    if (mode === 'deepseek-direct') {
      void claudeCodeProviderStore.setMode(mode, deepseekApiKey || undefined);
    } else {
      void claudeCodeProviderStore.setMode(mode);
    }
  };

  const handleSaveDeepseekKey = () => {
    if (deepseekApiKey.trim()) {
      void claudeCodeProviderStore.saveDeepseekKey(deepseekApiKey.trim());
      setDeepseekApiKey('');
    }
  };

  return (
    <Panel
      title="Claude Code Provider"
      subtitle="Switch Claude Code between native Claude, OpenCode Go, and DeepSeek Direct"
      testId="claude-code-provider"
      actions={
        <>
          <Button
            variant={isVanilla ? 'primary' : 'secondary'}
            size="sm"
            testId="claude-provider-vanilla"
            disabled={state.loading || state.saving}
            onClick={() => handleSetMode('vanilla')}
          >
            {state.saving && !isVanilla ? 'Saving…' : 'Vanilla Claude'}
          </Button>
          <Button
            variant={isOpenCodeGo ? 'primary' : 'secondary'}
            size="sm"
            testId="claude-provider-opencode-go"
            disabled={state.loading || state.saving}
            onClick={() => handleSetMode('opencode-go')}
          >
            {state.saving && !isOpenCodeGo ? 'Saving…' : 'OpenCode Go'}
          </Button>
          <Button
            variant={isDeepseekDirect ? 'primary' : 'secondary'}
            size="sm"
            testId="claude-provider-deepseek-direct"
            disabled={state.loading || state.saving}
            onClick={() => handleSetMode('deepseek-direct')}
          >
            {state.saving && !isDeepseekDirect ? 'Saving…' : 'DeepSeek V4'}
          </Button>
        </>
      }
    >
      <div className="settings-row">
        <div className="settings-row-label">
          <strong>Active provider</strong>
          <span className="settings-row-description">
            {currentMeta.description}
          </span>
          <span className="settings-row-description">
            Models: <code>{currentMeta.models}</code>
          </span>
        </div>
        <div className="settings-row-action">
          <Badge tone={isVanilla ? 'neutral' : 'brand'} testId="claude-provider-mode-badge">
            {currentMeta.label}
          </Badge>
        </div>
      </div>

      {status && (
        <div className="settings-row">
          <div className="settings-row-label">
            <span className="settings-row-description">
              Settings: <code>{status.settingsPath}</code>
            </span>
            {status.baseUrl && (
              <span className="settings-row-description">
                Endpoint: <code>{status.baseUrl}</code>
              </span>
            )}
            {status.model && (
              <span className="settings-row-description">
                Model: <code>{status.model}</code>
              </span>
            )}
          </div>
          <div className="settings-row-action">
            {status.hasBackup && <Badge tone="brand" testId="claude-provider-backup-badge">Backup Ready</Badge>}
          </div>
        </div>
      )}

      {/* ── OpenCode Go details ── */}
      {isOpenCodeGo && (
        <>
          <hr style={{ margin: '12px 0', border: 'none', borderTop: '1px solid var(--border-color, #ddd)' }} />
          <div className="settings-row" data-testid="claude-provider-opencode-go-details">
            <div className="settings-row-label">
              <strong>OpenCode Go Status</strong>
              <span className="settings-row-description">
                {status?.openCodeGoKeyAvailable
                  ? `API key available (source: ${status.openCodeGoKeySource || 'unknown'})`
                  : 'API key not found. Set up an OpenCode Go workspace first.'}
              </span>
              {!status?.openCodeGoKeyAvailable && (
                <span className="settings-row-description" style={{ color: 'var(--color-danger-500, #c00)', fontSize: '0.8rem' }}>
                  OpenCode Go API key is required. Configure it in the OpenCode settings or provide via env.
                </span>
              )}
            </div>
          </div>
        </>
      )}

      {/* ── DeepSeek Direct details ── */}
      {isDeepseekDirect && (
        <>
          <hr style={{ margin: '12px 0', border: 'none', borderTop: '1px solid var(--border-color, #ddd)' }} />
          <div className="settings-row" data-testid="claude-provider-deepseek-details">
            <div className="settings-row-label">
              <strong>DeepSeek API Key</strong>
              <span className="settings-row-description">
                Key is stored locally and never returned by the API after saving.
                Automatically reads from OpenCode auth if available.
              </span>
            </div>
            <div className="settings-row-action" style={{ flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
              <input
                type="password"
                value={deepseekApiKey}
                onChange={(e) => setDeepseekApiKey(e.target.value)}
                placeholder={status?.apiKeyConfigured ? '(key saved — enter new to replace)' : 'Enter DeepSeek API key'}
                style={inputStyle}
                data-testid="claude-deepseek-api-key"
              />
              <Button
                variant="secondary"
                size="sm"
                testId="claude-deepseek-save-key"
                disabled={state.saving || !deepseekApiKey.trim()}
                onClick={handleSaveDeepseekKey}
              >
                Save Key
              </Button>
            </div>
          </div>
        </>
      )}

      <hr style={{ margin: '12px 0', border: 'none', borderTop: '1px solid var(--border-color, #ddd)' }} />

      {/* ── Recovery ── */}
      <div className="settings-row">
        <div className="settings-row-label">
          <strong>Recovery</strong>
          <span className="settings-row-description">
            Restore from backup reverts settings.json to the state before the first provider switch.
            Reset to Vanilla removes all Elegy-managed provider env vars and returns to default Anthropic.
          </span>
        </div>
        <div className="settings-row-action">
          <Button
            variant="secondary"
            size="sm"
            testId="claude-provider-restore-backup"
            disabled={state.loading || state.saving || !status?.hasBackup}
            onClick={() => claudeCodeProviderStore.reset(true)}
          >
            Restore Backup
          </Button>
          <Button
            variant="ghost"
            size="sm"
            testId="claude-provider-reset-vanilla"
            disabled={state.loading || state.saving || isVanilla}
            onClick={() => {
              if (confirmReset) {
                setConfirmReset(false);
                claudeCodeProviderStore.reset(false);
              } else {
                setConfirmReset(true);
              }
            }}
          >
            {state.saving && confirmReset ? 'Resetting…'
              : confirmReset ? 'Confirm Reset?'
              : 'Reset to Vanilla'}
          </Button>
        </div>
      </div>
    </Panel>
  );
}
