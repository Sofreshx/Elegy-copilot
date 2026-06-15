import { useState, useEffect } from 'react';
import { listNoteSettings, setNoteSetting, getNoteSetting, deleteNoteSetting } from '../../lib/api/notes';

export default function NotesSettingsView() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Model options for dropdowns
  const modelOptions = [
    { id: '', label: 'Default (profile)' },
    { id: 'anthropic/claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
    { id: 'deepseek/deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
    { id: 'deepseek/deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
    { id: 'opencode/gpt-5.1-codex', label: 'GPT-5.1 Codex' },
  ];

  // Git sync fields
  const [gitEnabled, setGitEnabled] = useState(false);
  const [gitRepoUrl, setGitRepoUrl] = useState('');
  const [gitBranch, setGitBranch] = useState('main');
  const [gitAuthor, setGitAuthor] = useState('');
  const [syncStatus, setSyncStatus] = useState<string | null>(null);

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    setLoading(true);
    try {
      const res = await listNoteSettings();
      const map: Record<string, string> = {};
      for (const s of res.settings) {
        try { map[s.key] = typeof s.value === 'string' ? s.value : JSON.stringify(s.value); } catch { map[s.key] = String(s.value); }
      }
      setSettings(map);
      
      // Load git config
      try {
        const gc = JSON.parse(map['git_sync_config'] || '{}');
        setGitEnabled(gc.enabled || false);
        setGitRepoUrl(gc.repoUrl || '');
        setGitBranch(gc.branch || 'main');
        setGitAuthor(gc.commitAuthor || '');
      } catch {}
    } catch { /* silent */ }
    finally { setLoading(false); }
  }

  async function saveSetting(key: string, value: string) {
    setSaving(key);
    setError(null);
    setMessage(null);
    try {
      await setNoteSetting(key, value);
      setSettings(s => ({ ...s, [key]: value }));
      setMessage(`Saved ${key}`);
      setTimeout(() => setMessage(null), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally { setSaving(null); }
  }

  async function saveGitConfig() {
    const config = JSON.stringify({
      enabled: gitEnabled,
      repoUrl: gitRepoUrl,
      branch: gitBranch,
      commitAuthor: gitAuthor,
    });
    await saveSetting('git_sync_config', config);
  }

  function handleModelChange(settingKey: string, value: string) {
    saveSetting(settingKey, value);
  }

  if (loading) {
    return <div className="workspace-notes-loading">Loading settings...</div>;
  }

  return (
    <div className="panel">
      <div className="panel-header">
        <h3>Notes Settings</h3>
      </div>

      {error && <div className="workspace-notes-error">{error}</div>}
      {message && <div style={{ color: 'var(--color-brand-400)', fontSize: '0.8rem' }}>{message}</div>}

      <div className="panel-content" style={{ gap: 'var(--space-lg)' }}>
        {/* Default Models */}
        <section>
          <h4 className="workspace-notes-section-title">Default Models</h4>
          <div style={{ display: 'grid', gap: 'var(--space-sm)', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
            {[
              { key: 'default_model_enhance', label: 'Enhance' },
              { key: 'default_model_research', label: 'Research' },
              { key: 'default_model_deduplicate', label: 'Deduplicate' },
              { key: 'default_model_reexamine', label: 'Re-examine' },
            ].map(({ key, label }) => (
              <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '0.75rem', color: 'var(--color-ink-400)' }}>{label}</label>
                <select
                  className="workspace-notes-filter-select"
                  value={settings[key] || ''}
                  onChange={e => handleModelChange(key, e.target.value)}
                  disabled={saving === key}
                  data-testid={`notes-setting-${key}`}
                >
                  {modelOptions.map(m => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </section>

        {/* Research Settings */}
        <section>
          <h4 className="workspace-notes-section-title">Research Agent</h4>
          <div className="workspace-notes-popover-field">
            <label className="workspace-notes-popover-checkbox">
              <input
                type="checkbox"
                checked={settings['research_repo_access_default'] === 'true'}
                onChange={e => saveSetting('research_repo_access_default', e.target.checked ? 'true' : 'false')}
                data-testid="notes-setting-research-repo-access"
              />
              Allow repo access by default
            </label>
            <p style={{ fontSize: '0.7rem', color: 'var(--color-ink-500)', margin: '2px 0 0 24px' }}>
              When enabled, the research agent can read files from the current repository. Disable for "clean" research that is not influenced by existing code.
            </p>
          </div>
        </section>

        {/* Git Backup / Sync */}
        <section>
          <h4 className="workspace-notes-section-title">Git Backup & Sync</h4>
          <div style={{ display: 'grid', gap: 'var(--space-sm)' }}>
            <div className="workspace-notes-popover-field">
              <label className="workspace-notes-popover-checkbox">
                <input
                  type="checkbox"
                  checked={gitEnabled}
                  onChange={e => setGitEnabled(e.target.checked)}
                  data-testid="notes-setting-git-enabled"
                />
                Enable git sync
              </label>
            </div>

            {gitEnabled && (
              <>
                <div className="workspace-notes-editor-field">
                  <label className="workspace-notes-editor-label">Repository URL</label>
                  <input className="workspace-notes-editor-input" type="text" value={gitRepoUrl} onChange={e => setGitRepoUrl(e.target.value)} placeholder="git@github.com:user/notes-vault.git" data-testid="notes-setting-git-url" />
                </div>
                <div className="workspace-notes-editor-field">
                  <label className="workspace-notes-editor-label">Branch</label>
                  <input className="workspace-notes-editor-input" type="text" value={gitBranch} onChange={e => setGitBranch(e.target.value)} placeholder="main" data-testid="notes-setting-git-branch" />
                </div>
                <div className="workspace-notes-editor-field">
                  <label className="workspace-notes-editor-label">Commit Author (name &lt;email&gt;)</label>
                  <input className="workspace-notes-editor-input" type="text" value={gitAuthor} onChange={e => setGitAuthor(e.target.value)} placeholder="Elegy Copilot <noreply@example.com>" data-testid="notes-setting-git-author" />
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
                  <button className="button button-primary button-sm" onClick={() => void saveGitConfig()} data-testid="notes-setting-git-save">Save Git Config</button>
                </div>
                {syncStatus && <p style={{ fontSize: '0.75rem', color: 'var(--color-ink-400)' }}>{syncStatus}</p>}
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
