import { useCallback, useEffect, useState } from 'react';
import { Button, Panel } from '../../components';
import {
  getToolingUpdatesStatus,
  downloadElegyCliSurface,
  downloadAllElegyCliSurfaces,
} from '../../lib/api/toolingUpdates';
import type { ToolingUpdatesStatusResponse, ToolingSurfaceStatus } from '../../lib/types';

const ELEGY_SURFACES = [
  'elegy-cli',
  'elegy-planning',
  'elegy-skills',
  'elegy-mcp',
  'elegy-memory',
  'elegy-configuration',
  'elegy-documentation',
] as const;

const HARNESS_SURFACES = [
  { id: 'copilot', label: 'Copilot', description: 'VS Code + CLI agents, skills, and prompts' },
  { id: 'opencode', label: 'OpenCode', description: 'Global OpenCode agents, skills, and instructions' },
  { id: 'codex', label: 'Codex', description: 'Native Codex instructions, agents, and shared skills' },
  { id: 'antigravity', label: 'Antigravity', description: 'Managed Antigravity skills and GEMINI.md compatibility' },
  { id: 'claude', label: 'Claude Code', description: 'Claude Code skills and instructions' },
] as const;

function formatTimestamp(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return 'never';
  const trimmed = value.trim();
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : trimmed;
}

interface SurfaceCardProps {
  surface: string;
  status: ToolingSurfaceStatus | undefined;
  onInstall: (surface: string) => void;
  installing: string | null;
}

function SurfaceCard({ surface, status, onInstall, installing }: SurfaceCardProps) {
  const installed = status?.installed ?? false;
  const isInstalling = installing === surface;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 'var(--space-sm) var(--space-md)',
        borderBottom: '1px solid var(--border-subtle)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
        <span
          style={{
            display: 'inline-block',
            width: 8,
            height: 8,
            borderRadius: '50%',
            backgroundColor: installed ? 'var(--color-success)' : 'var(--color-muted)',
          }}
        />
        <span style={{ fontWeight: 500 }}>{surface}</span>
        {installed && status?.installSource && (
          <span style={{ fontSize: '0.75em', color: 'var(--color-muted)' }}>
            ({status.installSource})
          </span>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
        {installed && status?.installedAt && (
          <span style={{ fontSize: '0.75em', color: 'var(--color-muted)' }}>
            {formatTimestamp(status.installedAt)}
          </span>
        )}
        <Button
          size="sm"
          disabled={isInstalling}
          onClick={() => onInstall(surface)}
        >
          {isInstalling ? 'Installing...' : installed ? 'Update' : 'Install'}
        </Button>
      </div>
    </div>
  );
}

interface InstallationTabProps {
  onSyncHarnesses?: () => void;
}

export default function InstallationTab({ onSyncHarnesses }: InstallationTabProps) {
  const [status, setStatus] = useState<ToolingUpdatesStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [bulkInstalling, setBulkInstalling] = useState(false);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getToolingUpdatesStatus();
      setStatus(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tooling status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  async function handleInstallSurface(surface: string): Promise<void> {
    setInstalling(surface);
    try {
      const result = await downloadElegyCliSurface(surface);
      if (result.status) {
        setStatus(result.status);
      } else {
        await loadStatus();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to install ${surface}`);
    } finally {
      setInstalling(null);
    }
  }

  async function handleInstallAll(): Promise<void> {
    setBulkInstalling(true);
    try {
      const result = await downloadAllElegyCliSurfaces();
      if (result.status) {
        setStatus(result.status);
      } else {
        await loadStatus();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to install all surfaces');
    } finally {
      setBulkInstalling(false);
    }
  }

  if (loading) {
    return <p className="assets-tools-empty state-message">Loading installation status&hellip;</p>;
  }

  if (error && !status) {
    return <p className="assets-tools-empty state-error">{error}</p>;
  }

  const surfaces = status?.surfaces ?? {};

  return (
    <div
      data-testid="assets-tools-installation"
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)', overflow: 'auto' }}
    >
      {error && (
        <div style={{ padding: 'var(--space-sm)', color: 'var(--color-danger)', fontSize: '0.875em' }}>
          {error}
        </div>
      )}

      {/* Elegy CLI Binaries */}
      <Panel
        title="Elegy CLI Binaries"
        subtitle={`Pulling from main-snapshot (${ELEGY_SURFACES.length} surfaces)`}
        actions={
          <Button size="sm" disabled={bulkInstalling} onClick={() => void handleInstallAll()}>
            {bulkInstalling ? 'Installing...' : 'Install All'}
          </Button>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {ELEGY_SURFACES.map((surface) => (
            <SurfaceCard
              key={surface}
              surface={surface}
              status={surfaces[surface]}
              onInstall={(s) => void handleInstallSurface(s)}
              installing={installing}
            />
          ))}
        </div>
      </Panel>

      {/* Harness Surfaces */}
      <Panel
        title="Harness Installation"
        subtitle="Sync skills and agents to each harness"
        actions={
          onSyncHarnesses ? (
            <Button size="sm" onClick={onSyncHarnesses}>
              Sync All
            </Button>
          ) : undefined
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {HARNESS_SURFACES.map((harness) => (
            <div
              key={harness.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: 'var(--space-sm) var(--space-md)',
                borderBottom: '1px solid var(--border-subtle)',
              }}
            >
              <div>
                <span style={{ fontWeight: 500 }}>{harness.label}</span>
                <span style={{ fontSize: '0.75em', color: 'var(--color-muted)', marginLeft: 'var(--space-sm)' }}>
                  {harness.description}
                </span>
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
