import { useState, useEffect } from 'react';
import { Button, Panel, ToggleField } from '../../components';
import { getCollaborationProfile, saveCollaborationProfile, type CollaborationProfileResponse, type CollaborationProfileSaveResponse } from '../../lib/api/config';

export default function CollaborationStyleSettingsView() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<CollaborationProfileResponse['profile'] | null>(null);
  const [presets, setPresets] = useState<CollaborationProfileResponse['presets']>([]);
  const [targets, setTargets] = useState<CollaborationProfileResponse['targets']>([]);
  const [applyResults, setApplyResults] = useState<CollaborationProfileSaveResponse['results'] | null>(null);
  const [allApplied, setAllApplied] = useState(true);

  // Local form state (may differ from saved profile until Save is clicked)
  const [formEnabled, setFormEnabled] = useState(true);
  const [formPresetId, setFormPresetId] = useState('constructive-coworker');
  const [formCustomInstructions, setFormCustomInstructions] = useState('');

  async function loadProfile() {
    setLoading(true);
    setError(null);
    try {
      const data = await getCollaborationProfile();
      setProfile(data.profile);
      setPresets(data.presets);
      setTargets(data.targets);
      // Sync form state
      setFormEnabled(data.profile.enabled);
      setFormPresetId(data.profile.presetId);
      setFormCustomInstructions(data.profile.customInstructions);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load profile');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadProfile();
  }, []);

  function handleReset() {
    setFormEnabled(true);
    setFormPresetId('constructive-coworker');
    setFormCustomInstructions('');
    setApplyResults(null);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setApplyResults(null);
    try {
      const result = await saveCollaborationProfile({
        enabled: formEnabled,
        presetId: formPresetId,
        customInstructions: formCustomInstructions,
      });
      // Update saved profile
      setProfile(result.profile);
      setAllApplied(result.allApplied);
      setApplyResults(result.results);
      // Sync form with saved state
      setFormEnabled(result.profile.enabled);
      setFormPresetId(result.profile.presetId);
      setFormCustomInstructions(result.profile.customInstructions);
    } catch (err) {
      // Preserve unsaved text on failure
      setError(err instanceof Error ? err.message : 'Failed to save profile');
    } finally {
      setSaving(false);
    }
  }

  const isDirty =
    formEnabled !== (profile?.enabled ?? true) ||
    formPresetId !== (profile?.presetId ?? 'constructive-coworker') ||
    formCustomInstructions !== (profile?.customInstructions ?? '');

  const charCount = formCustomInstructions.length;
  const charLimit = 8000;
  const charWarning = charCount > charLimit * 0.9;
  const selectedPreset = presets.find((preset) => preset.id === formPresetId);
  const presetGuidance = selectedPreset?.content.trim() ?? '';
  const effectiveGuidance = formEnabled
    ? [presetGuidance, formCustomInstructions.trim()].filter(Boolean).join('\n\n')
    : '';

  return (
    <Panel
      title="Collaboration Style"
      subtitle="Shape how AI agents communicate with you. These preferences are applied between the shared baseline and harness-specific rules."
      testId="collaboration-style-panel"
    >
      {loading && (
        <p className="settings-about-loading" data-testid="collab-style-loading">Loading collaboration profile...</p>
      )}

      {error && (
        <p className="opencode-error" data-testid="collab-style-error">{error}</p>
      )}

      {!loading && (
        <>
          <ToggleField
            label="Enable custom collaboration style"
            description="When disabled, agents use the default communication style."
            checked={formEnabled}
            onChange={() => setFormEnabled(!formEnabled)}
            disabled={saving}
            testId="collab-style-enabled"
          />

          <div className="form-input" data-testid="collab-style-preset">
            <span className="form-label">Preset</span>
            <select
              data-testid="collab-style-preset-control"
              value={formPresetId}
              onChange={(e) => setFormPresetId(e.target.value)}
              disabled={!formEnabled || saving}
            >
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            {selectedPreset && (
              <p className="toggle-field-desc collab-style-preset-description">
                {selectedPreset.description}
              </p>
            )}
          </div>

          <div className="collab-style-guidance-grid">
            <section className="collab-style-guidance-block" data-testid="collab-style-preset-guidance">
              <div className="collab-style-guidance-heading">
                <span className="form-label">Current preset guidance</span>
                <span className="collab-style-guidance-source">Inherited</span>
              </div>
              <pre>{presetGuidance || 'No preset guidance.'}</pre>
            </section>

            <section className="collab-style-guidance-block" data-testid="collab-style-effective-guidance">
              <div className="collab-style-guidance-heading">
                <span className="form-label">Effective guidance preview</span>
                <span className="collab-style-guidance-source">
                  {formEnabled ? 'Preset + override' : 'Disabled'}
                </span>
              </div>
              <pre>{effectiveGuidance || 'Custom collaboration style is disabled.'}</pre>
            </section>
          </div>

          <div className="form-input" data-testid="collab-style-custom">
            <span className="form-label">
              Your override
              <span className={`collab-style-char-count${charWarning ? ' collab-style-char-warning' : ''}`}>
                {' '}({charCount}/{charLimit})
              </span>
            </span>
            <textarea
              data-testid="collab-style-custom-control"
              value={formCustomInstructions}
              onChange={(e) => setFormCustomInstructions(e.target.value)}
              disabled={!formEnabled || saving}
              placeholder="Add guidance that extends or refines the preset shown above."
              rows={6}
              maxLength={charLimit + 100}
              style={{
                width: '100%',
                padding: 'var(--space-sm)',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--color-ink-200)',
                backgroundColor: 'var(--color-surface-0)',
                color: 'var(--color-ink-950)',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.8rem',
                resize: 'vertical',
              }}
            />
            {charWarning && (
              <p className="collab-style-char-warning-text">Approaching character limit. Instructions are truncated at {charLimit} characters.</p>
            )}
          </div>

          <p className="collab-style-warning">
            Custom instructions are stored locally in your Elegy config and sent as part of instruction prompts.
            Do not include secrets, passwords, or API keys.
          </p>

          <div className="opencode-model-actions" data-testid="collab-style-actions">
            <Button
              variant="primary"
              size="sm"
              testId="collab-style-save"
              disabled={!isDirty || saving}
              loading={saving}
              loadingLabel="Saving..."
              onClick={handleSave}
            >
              Save and apply
            </Button>
            <Button
              variant="secondary"
              size="sm"
              testId="collab-style-reset"
              disabled={saving}
              onClick={handleReset}
            >
              Reset to defaults
            </Button>
          </div>

          {applyResults && applyResults.length > 0 && (
            <div className="collab-style-results" data-testid="collab-style-results">
              <p className={`collab-style-results-summary ${allApplied ? 'collab-style-results-ok' : 'collab-style-results-partial'}`}>
                {allApplied ? 'Applied to all installed harnesses.' : 'Applied with some issues.'}
              </p>
              <ul className="collab-style-results-list">
                {applyResults.map((r) => (
                  <li
                    key={r.id}
                    className={`collab-style-result collab-style-result-${r.status}`}
                    data-testid={`collab-style-result-${r.id}`}
                  >
                    <strong>{r.id}</strong>
                    {': '}
                    {r.status === 'applied' && 'Updated'}
                    {r.status === 'unchanged' && 'Already up to date'}
                    {r.status === 'not-installed' && 'Not installed'}
                    {r.status === 'error' && (r.error || 'Error')}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}
