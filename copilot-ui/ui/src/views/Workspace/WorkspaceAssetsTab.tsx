import { useState, useEffect } from 'react';
import AppIcon from '../../components/AppIcon';
import { discoverRepoAssets, installRepoAsset } from '../../lib/api/repoAssets';
import type { RepoAssetEntry } from '../../lib/api/repoAssets';

interface Props {
  repoPath: string;
}

export default function WorkspaceAssetsTab({ repoPath }: Props) {
  const [assets, setAssets] = useState<RepoAssetEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data = await discoverRepoAssets(repoPath);
        if (!cancelled) setAssets(data.assets);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [repoPath]);

  async function handleInstall(assetId: string, harness: string) {
    // Set installing state
    setAssets(prev => prev.map(a =>
      a.id === assetId ? { ...a, _installing: harness } : a
    ));
    try {
      await installRepoAsset(repoPath, assetId, harness);
      // Update the harness status
      setAssets(prev => prev.map(a => {
        if (a.id !== assetId) return a;
        return {
          ...a,
          _installing: undefined,
          harnesses: a.harnesses.map(h =>
            h.harness === harness ? { ...h, installed: true, installedAt: new Date().toISOString() } : h
          )
        };
      }));
    } catch (err) {
      // Reset installing state on error
      setAssets(prev => prev.map(a =>
        a.id === assetId ? { ...a, _installing: undefined } : a
      ));
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const harnessLabels: Record<string, string> = {
    opencode: 'OpenCode',
    codex: 'Codex',
    copilot: 'Copilot',
    antigravity: 'Antigravity',
  };

  const harnessIcons: Record<string, string> = {
    opencode: 'opencode',
    codex: 'codex',
    copilot: 'settings',
    antigravity: 'hexagon',
  };

  const kindIcons: Record<string, string> = {
    agent: 'agent',
    skill: 'skill',
    config: 'settings',
  };

  if (loading) return <div className="state-message">Discovering repo assets...</div>;
  if (error) return <div className="state-error">{error}</div>;

  return (
    <div className="workspace-assets-tab">
      <div className="workspace-assets-header">
        <h3>Repository Agents & Skills</h3>
        <span className="workspace-assets-count">{assets.length} assets found</span>
      </div>

      {assets.length === 0 ? (
        <div className="state-message">
          No agents or skills found in this repository.
          <br />
          <small>Add AGENTS.md, skills/SKILL.md, or .opencode/agents/*.agent.md files to your repo.</small>
        </div>
      ) : (
        <div className="workspace-assets-grid">
          {assets.map((asset) => (
            <div key={asset.id} className="workspace-asset-card">
              <div className="workspace-asset-card-header">
                <AppIcon name={(kindIcons[asset.kind] || 'file-text') as any} size={18} className="workspace-asset-kind-icon" />
                <span className="workspace-asset-name">{asset.name}</span>
                <span className="workspace-asset-kind-badge">{asset.kind}</span>
                {asset.sourceHarness && (
                  <span className="workspace-asset-source-badge" title={`From ${harnessLabels[asset.sourceHarness] || asset.sourceHarness} config`}>
                    <AppIcon name={(harnessIcons[asset.sourceHarness] || 'package') as any} size={14} />
                  </span>
                )}
              </div>
              <div className="workspace-asset-path" title={asset.path}>{asset.path}</div>
              <div className="workspace-asset-harnesses">
                {asset.harnesses.map((hs) => (
                  <button
                    key={hs.harness}
                    className={`workspace-asset-harness-btn${hs.installed ? ' installed' : ''}${asset._installing === hs.harness ? ' installing' : ''}`}
                    onClick={() => !hs.installed && handleInstall(asset.id, hs.harness)}
                    disabled={hs.installed || asset._installing === hs.harness}
                    title={hs.installed
                      ? `Installed for ${harnessLabels[hs.harness]}${hs.installedAt ? ` at ${new Date(hs.installedAt).toLocaleDateString()}` : ''}`
                      : `Install for ${harnessLabels[hs.harness]}`
                    }
                  >
                    <AppIcon name={(harnessIcons[hs.harness] || 'package') as any} size={14} className="workspace-asset-harness-icon" />
                    <span className="workspace-asset-harness-label">{harnessLabels[hs.harness] || hs.harness}</span>
                    {hs.installed ? (
                      <AppIcon name="check" size={14} className="workspace-asset-harness-check" />
                    ) : asset._installing === hs.harness ? (
                      <AppIcon name="sync" size={14} className="workspace-asset-harness-spinner" />
                    ) : (
                      <AppIcon name="squared-plus" size={14} className="workspace-asset-harness-add" />
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
