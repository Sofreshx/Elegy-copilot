import { useState, useEffect } from 'react';
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
    opencode: '\u229E',  // ⊞
    codex: '\u25C8',     // ◈
    copilot: '\u2699',   // ⚙
    antigravity: '\u2B21', // ⬡
  };

  const kindIcons: Record<string, string> = {
    agent: '\uD83E\uDD16',   // 🤖
    skill: '\u26A1',         // ⚡
    config: '\u2699',        // ⚙
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
                <span className="workspace-asset-kind-icon">{kindIcons[asset.kind] || '\uD83D\uDCC4'}</span>
                <span className="workspace-asset-name">{asset.name}</span>
                <span className="workspace-asset-kind-badge">{asset.kind}</span>
                {asset.sourceHarness && (
                  <span className="workspace-asset-source-badge" title={`From ${harnessLabels[asset.sourceHarness] || asset.sourceHarness} config`}>
                    {harnessIcons[asset.sourceHarness] || asset.sourceHarness}
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
                    <span className="workspace-asset-harness-icon">{harnessIcons[hs.harness] || hs.harness}</span>
                    <span className="workspace-asset-harness-label">{harnessLabels[hs.harness] || hs.harness}</span>
                    {hs.installed ? (
                      <span className="workspace-asset-harness-check">{'\u2713'}</span>
                    ) : asset._installing === hs.harness ? (
                      <span className="workspace-asset-harness-spinner">{'\u23F3'}</span>
                    ) : (
                      <span className="workspace-asset-harness-add">+</span>
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
