import { useState, useEffect } from 'react';
import { Button, Panel, ToggleField } from '../../components';
import {
  getCollaborationInstructionLayer,
  getCollaborationInstructions,
  getCollaborationProfile,
  saveCollaborationProfile,
  type CollaborationInstructionInspectorResponse,
  type CollaborationProfileResponse,
  type CollaborationProfileSaveResponse,
} from '../../lib/api/config';

const INSTRUCTION_LAYERS = ['baseline', 'preset', 'appendix', 'composed', 'installed'] as const;
type InstructionLayerName = (typeof INSTRUCTION_LAYERS)[number];

export default function CollaborationStyleSettingsView() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<CollaborationProfileResponse['profile'] | null>(null);
  const [presets, setPresets] = useState<CollaborationProfileResponse['presets']>([]);
  const [targets, setTargets] = useState<CollaborationProfileResponse['targets']>([]);
  const [applyResults, setApplyResults] = useState<CollaborationProfileSaveResponse['results'] | null>(null);
  const [allApplied, setAllApplied] = useState(true);
  const [instructionInspector, setInstructionInspector] = useState<CollaborationInstructionInspectorResponse | null>(null);
  const [instructionsLoading, setInstructionsLoading] = useState(true);
  const [instructionsError, setInstructionsError] = useState<string | null>(null);
  const [selectedTargetId, setSelectedTargetId] = useState<string>('');
  const [selectedLayer, setSelectedLayer] = useState<InstructionLayerName>('composed');
  const [layerText, setLayerText] = useState<string>('');
  const [layerLoading, setLayerLoading] = useState(false);
  const [layerError, setLayerError] = useState<string | null>(null);

  // Local form state (may differ from saved profile until Save is clicked)
  const [formEnabled, setFormEnabled] = useState(true);
  const [formPresetId, setFormPresetId] = useState('constructive-coworker');
  const [formCustomInstructions, setFormCustomInstructions] = useState('');

  async function loadInstructionInspector(profileOverride?: CollaborationProfileResponse['profile']) {
    setInstructionsLoading(true);
    setInstructionsError(null);
    try {
      const inspector = await getCollaborationInstructions();
      setInstructionInspector(inspector);
      setSelectedTargetId((current) => {
        if (current && inspector.targets.some((target) => target.id === current)) {
          return current;
        }
        return inspector.targets[0]?.id ?? '';
      });
    } catch (err) {
      setInstructionsError(err instanceof Error ? err.message : 'Failed to load instruction inspector');
      setInstructionInspector(null);
      if (profileOverride) {
        setProfile(profileOverride);
      }
    } finally {
      setInstructionsLoading(false);
    }
  }

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
      await loadInstructionInspector(data.profile);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load profile');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadProfile();
  }, []);

  useEffect(() => {
    if (!selectedTargetId) {
      setLayerText('');
      setLayerError(null);
      return;
    }

    const target = instructionInspector?.targets.find((candidate) => candidate.id === selectedTargetId);
    const summary = target ? target.layers[selectedLayer] : null;
    if (!summary?.available) {
      setLayerLoading(false);
      setLayerError(null);
      setLayerText('Layer unavailable for this target.');
      return;
    }

    let cancelled = false;

    async function loadLayer() {
      setLayerLoading(true);
      setLayerError(null);
      try {
        const text = await getCollaborationInstructionLayer(selectedTargetId, selectedLayer);
        if (!cancelled) {
          setLayerText(text);
        }
      } catch (err) {
        if (!cancelled) {
          setLayerText('');
          setLayerError(err instanceof Error ? err.message : 'Failed to load instruction layer');
        }
      } finally {
        if (!cancelled) {
          setLayerLoading(false);
        }
      }
    }

    void loadLayer();
    return () => {
      cancelled = true;
    };
  }, [instructionInspector, selectedLayer, selectedTargetId]);

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
      await loadInstructionInspector(result.profile);
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
  const selectedTarget = instructionInspector?.targets.find((target) => target.id === selectedTargetId) ?? null;
  const selectedLayerSummary = selectedTarget ? selectedTarget.layers[selectedLayer] : null;

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

          <div className="collab-style-instructions" data-testid="collab-style-instructions">
            <h3 style={{ marginBottom: '0.5rem' }}>Installed instruction surfaces</h3>
            <p className="toggle-field-desc" style={{ marginTop: 0 }}>
              Read-only inspector for the composed home-level instruction files shipped to each harness.
            </p>

            {instructionsLoading ? (
              <p className="settings-about-loading">Loading instruction inspector...</p>
            ) : instructionsError ? (
              <p className="opencode-error">{instructionsError}</p>
            ) : instructionInspector ? (
              <>
                <div
                  style={{
                    display: 'grid',
                    gap: '0.5rem',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                    marginBottom: '1rem',
                  }}
                >
                  {instructionInspector.targets.map((target) => {
                    const hasBudgetIssue = target.layers.baseline.overBudget
                      || target.layers.preset.overBudget
                      || target.layers.appendix.overBudget
                      || target.layers.composed.overBudget;
                    return (
                      <button
                        key={target.id}
                        type="button"
                        onClick={() => setSelectedTargetId(target.id)}
                        style={{
                          textAlign: 'left',
                          padding: '0.75rem',
                          borderRadius: '8px',
                          border: selectedTargetId === target.id ? '2px solid var(--color-accent-500, #0f766e)' : '1px solid var(--color-ink-200)',
                          background: 'var(--color-surface-0)',
                        }}
                      >
                        <strong style={{ display: 'block' }}>{target.id}</strong>
                        <code style={{ display: 'block', margin: '0.25rem 0 0.5rem 0' }}>{target.instructionFile}</code>
                        <span style={{ display: 'block', fontSize: '0.85rem' }}>
                          {target.installed ? 'Installed' : 'Not installed'}
                          {target.managedBlock ? ' · managed block' : ''}
                        </span>
                        <span style={{ display: 'block', fontSize: '0.85rem' }}>
                          {target.drift ? 'Drifted' : 'In sync'}
                          {hasBudgetIssue ? ' · over budget' : ' · within budget'}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {selectedTarget && (
                  <div>
                    <p style={{ marginBottom: '0.5rem' }}>
                      <strong>{selectedTarget.id}</strong>{' '}
                      <code>{selectedTarget.path}</code>
                    </p>
                    {selectedTarget.managedBlock && (
                      <p className="toggle-field-desc" style={{ marginTop: 0 }}>
                        Drift compares the composed output to the managed block inside the installed file.
                      </p>
                    )}

                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                      {INSTRUCTION_LAYERS.map((layer) => {
                        const summary = selectedTarget.layers[layer];
                        return (
                          <button
                            key={layer}
                            type="button"
                            disabled={!summary.available}
                            onClick={() => setSelectedLayer(layer)}
                            style={{
                              padding: '0.4rem 0.65rem',
                              borderRadius: '999px',
                              border: selectedLayer === layer ? '2px solid var(--color-accent-500, #0f766e)' : '1px solid var(--color-ink-200)',
                              background: summary.overBudget ? 'rgba(192, 57, 43, 0.08)' : 'var(--color-surface-0)',
                              opacity: summary.available ? 1 : 0.5,
                              cursor: summary.available ? 'pointer' : 'not-allowed',
                            }}
                          >
                            {layer} · {summary.bytes} B / {summary.lines} L
                          </button>
                        );
                      })}
                    </div>

                    {layerError ? (
                      <p className="opencode-error">{layerError}</p>
                    ) : (
                      <pre
                        data-testid="collab-style-layer-preview"
                        style={{
                          margin: 0,
                          padding: '0.75rem',
                          borderRadius: '8px',
                          border: '1px solid var(--color-ink-200)',
                          background: 'var(--color-surface-0)',
                          maxHeight: '24rem',
                          overflow: 'auto',
                          whiteSpace: 'pre-wrap',
                        }}
                      >
                        {!selectedLayerSummary?.available
                          ? 'Layer unavailable for this target.'
                          : layerLoading ? `Loading ${selectedLayer}...` : layerText || '(empty layer)'}
                      </pre>
                    )}
                  </div>
                )}
              </>
            ) : null}
          </div>
        </>
      )}
    </Panel>
  );
}
