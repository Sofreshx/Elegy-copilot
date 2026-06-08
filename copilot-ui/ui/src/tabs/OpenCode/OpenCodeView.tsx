import React, { useEffect, useState } from 'react';
import { Badge, Button, LogViewer, Panel, Toolbar } from '../../components';
import { useStoreValue } from '../../lib/store';
import type {
  OpenCodeLane,
  OpenCodeLaneNode,
  OpenCodePermissions,
  OpenCodeProfile,
  OpenCodeRequestLogEntry,
  OpenCodeSetupCheck,
  OpenCodeStatusResponse,
  OpenCodeTabSectionId,
  OpenCodeWarning,
} from '../../lib/types';
import { opencodeStore } from '../../stores/opencodeStore';

const TAB_SECTIONS: Array<{ id: OpenCodeTabSectionId; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'lanes', label: 'Lanes' },
  { id: 'profiles', label: 'Profiles' },
  { id: 'setup', label: 'Setup' },
  { id: 'logs', label: 'Request Log' },
  { id: 'go-workspaces', label: 'Workspaces' },
  { id: 'permissions', label: 'Permissions' },
  { id: 'experimental', label: 'Experimental' },
];

function StatusDot({ status }: { status: string }) {
  const className = status === 'ok' ? 'health-dot health-dot-ok'
    : status === 'warning' ? 'health-dot health-dot-warn'
    : status === 'blocked' || status === 'critical' ? 'health-dot health-dot-error'
    : 'health-dot health-dot-neutral';
  return (
    <span className={className}>
      <span className="health-dot-pip" aria-hidden="true" />
    </span>
  );
}

function OverviewSection({ status }: SectionProps) {
  const overallBadge = status.overallStatus === 'ready' ? 'success'
    : status.overallStatus === 'degraded' ? 'accent'
    : 'danger';

  return (
    <div className="opencode-section" data-testid="opencode-overview">
      <Panel title="Readiness Dashboard" testId="opencode-readiness">
        <div className="opencode-readiness-cards">
          <div className="opencode-readiness-card">
            <span className="opencode-readiness-label">Overall Status</span>
            <Badge tone={overallBadge} testId="opencode-overall-status">
              {status.overallStatus.toUpperCase()}
            </Badge>
          </div>
          <div className="opencode-readiness-card">
            <span className="opencode-readiness-label">OpenCode Home</span>
            <code className="opencode-readiness-value">{status.opencodeHome}</code>
          </div>
          <div className="opencode-readiness-card">
            <span className="opencode-readiness-label">Config Path</span>
            <code className="opencode-readiness-value">{status.configPath}</code>
          </div>
          <div className="opencode-readiness-card">
            <span className="opencode-readiness-label">Active Profile</span>
            <Badge tone="brand">{status.activeProfileId}</Badge>
          </div>
          <div className="opencode-readiness-card">
            <span className="opencode-readiness-label">Small Model</span>
            <code className="opencode-readiness-value">{status.smallModel}</code>
          </div>
          <div className="opencode-readiness-card">
            <span className="opencode-readiness-label">Big Model</span>
            <code className="opencode-readiness-value">{status.bigModel}</code>
          </div>
          <div className="opencode-readiness-card">
            <span className="opencode-readiness-label">Elegy Planning CLI</span>
            <StatusDot status={status.elegyPlanningCli.cliPath ? 'ok' : 'warning'} />
            <span className="opencode-readiness-value">
              {status.elegyPlanningCli.cliPath ? status.elegyPlanningCli.currentVersion || 'detected' : 'Not detected'}
            </span>
          </div>
          <div className="opencode-readiness-card">
            <span className="opencode-readiness-label">Elegy Skills</span>
            <StatusDot status={status.elegySkillsAssets.trackedCount > 0 ? 'ok' : 'warning'} />
            <span className="opencode-readiness-value">
              {status.elegySkillsAssets.trackedCount} tracked
              {status.elegySkillsAssets.outdatedCount > 0 ? `, ${status.elegySkillsAssets.outdatedCount} outdated` : ''}
            </span>
          </div>
          <div className="opencode-readiness-card">
            <span className="opencode-readiness-label">Planning Live Authority</span>
            <StatusDot status={status.planningLiveAuthority.ready ? 'ok' : 'warning'} />
            <span className="opencode-readiness-value">
              {status.planningLiveAuthority.ready ? 'Ready' : 'Not ready'}
            </span>
          </div>
          <div className="opencode-readiness-card">
            <span className="opencode-readiness-label">Warnings</span>
            <Badge tone={status.warnings.length > 0 ? 'accent' : 'success'}>
              {status.warnings.length > 0 ? `${status.warnings.length} active` : 'None'}
            </Badge>
          </div>
        </div>
      </Panel>

      {status.warnings.length > 0 ? (
        <Panel title="Active Warnings" testId="opencode-warnings">
          {status.warnings.map((w: OpenCodeWarning) => (
            <div key={w.id} className="opencode-warning-row" data-testid={`opencode-warning-${w.id}`}>
              <StatusDot status={w.severity} />
              <div className="opencode-warning-content">
                <strong>{w.title}</strong>
                <p>{w.detail}</p>
              </div>
            </div>
          ))}
        </Panel>
      ) : null}
    </div>
  );
}

function LaneNodeElement({ node, state }: { node: OpenCodeLaneNode; state: 'available' | 'optional' | 'warning' | 'blocked' }) {
  const cls = state === 'blocked' ? 'opencode-lane-node-blocked'
    : state === 'warning' ? 'opencode-lane-node-warning'
    : state === 'optional' ? 'opencode-lane-node-optional'
    : 'opencode-lane-node-available';
  return (
    <div className={`opencode-lane-node ${cls}`} title={`${node.label} (${node.kind})`}>
      <span className="opencode-lane-node-label">{node.label}</span>
      <span className="opencode-lane-node-kind">{node.kind}</span>
    </div>
  );
}

function LaneDetailPanel({ lane }: { lane: OpenCodeLane }) {
  return (
    <div className="opencode-lane-detail" data-testid={`opencode-lane-detail-${lane.id}`}>
      <h4>Model Policy</h4>
      <dl className="opencode-detail-list">
        <dt>Small Model</dt>
        <dd>{lane.modelPolicy.small || '—'}</dd>
        <dt>Big Model</dt>
        <dd>{lane.modelPolicy.big || '—'}</dd>
        <dt>Review Model</dt>
        <dd>{lane.modelPolicy.review || '—'}</dd>
      </dl>
      <h4>Required Setup</h4>
      <ul className="opencode-detail-list">
        {lane.requiredSetup.map((s) => <li key={s}>{s}</li>)}
      </ul>
      {lane.clarificationGates.length > 0 ? (
        <>
          <h4>Clarification Gates</h4>
          <ul className="opencode-detail-list">
            {lane.clarificationGates.map((g) => <li key={g}>{g}</li>)}
          </ul>
        </>
      ) : null}
      {lane.worktreeBehavior ? (
        <>
          <h4>Worktree Behavior</h4>
          <p>{lane.worktreeBehavior}</p>
        </>
      ) : null}
      {lane.escalationTriggers.length > 0 ? (
        <>
          <h4>Escalation Triggers</h4>
          <ul className="opencode-detail-list">
            {lane.escalationTriggers.map((t) => <li key={t}>{t}</li>)}
          </ul>
        </>
      ) : null}
    </div>
  );
}

function LaneSection({ status, selectedLaneId, saving }: SectionProps) {
  const selectedLane = selectedLaneId
    ? status.lanes.find((l: OpenCodeLane) => l.id === selectedLaneId)
    : null;

  return (
    <div className="opencode-section" data-testid="opencode-lanes">
      <div className="opencode-lane-map" data-testid="opencode-lane-map">
        {status.lanes.map((lane: OpenCodeLane) => (
          <div
            key={lane.id}
            className={`opencode-lane-card${selectedLaneId === lane.id ? ' opencode-lane-card-active' : ''}`}
            data-testid={`opencode-lane-${lane.id}`}
            onClick={() => opencodeStore.setSelectedLaneId(lane.id === selectedLaneId ? null : lane.id)}
          >
            <h3 className="opencode-lane-card-title">{lane.label}</h3>
            <p className="opencode-lane-card-desc">{lane.description}</p>
            <div className="opencode-lane-flow">
              {lane.nodes.map((node, i) => (
                <span key={node.id}>
                  <span className={`opencode-lane-flow-node opencode-lane-node-${node.kind}`}>
                    {node.label}
                  </span>
                  {i < lane.nodes.length - 1 ? (
                    <span className="opencode-lane-flow-arrow">→</span>
                  ) : null}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {selectedLane ? (
        <LaneDetailPanel lane={selectedLane} />
      ) : (
        <p className="opencode-hint">Click a lane above to see details.</p>
      )}
    </div>
  );
}

function ProfilesSection({ status, saving }: SectionProps) {
  const [smallModel, setSmallModel] = useState<string>(status.smallModel);
  const [bigModel, setBigModel] = useState<string>(status.bigModel);
  const profileReviewModel = status.profiles.find(p => p.id === status.activeProfileId)?.reviewModel || '';
  const [reviewModel, setReviewModel] = useState<string>(profileReviewModel);
  const [modelsDirty, setModelsDirty] = useState<boolean>(false);

  useEffect(() => {
    setSmallModel(status.smallModel);
    setBigModel(status.bigModel);
    const profile = status.profiles.find(p => p.id === status.activeProfileId);
    if (profile) {
      setReviewModel(profile.reviewModel);
    }
    setModelsDirty(false);
  }, [status.smallModel, status.bigModel, status.activeProfileId, status.profiles]);

  const mismatch = status.profileMismatch;

  const handleRouteChange = (profileId: string) => {
    void opencodeStore.saveConfig({ profileRoute: profileId });
  };

  const handleSaveModels = () => {
    void opencodeStore.saveConfig({ smallModel, bigModel, reviewModel });
  };

  return (
    <div className="opencode-section" data-testid="opencode-profiles">
      <Panel title="Provider Routing" testId="opencode-provider-routing">
        <div className="opencode-profiles-list">
          {status.profiles.map((profile: OpenCodeProfile) => (
            <div
              key={profile.id}
              className={`opencode-profile-card${profile.id === status.activeProfileId ? ' opencode-profile-card-active' : ''}`}
              data-testid={`opencode-profile-${profile.id}`}
            >
              <div className="opencode-profile-header">
                <h3>{profile.label}</h3>
                {profile.id === status.activeProfileId ? (
                  <Badge tone="brand" testId={`opencode-profile-badge-${profile.id}`}>Active</Badge>
                ) : null}
              </div>
              <p className="opencode-profile-desc">{profile.description}</p>
              <dl className="opencode-detail-list">
                <dt>Route</dt>
                <dd><code>{profile.route}</code></dd>
                <dt>Small Model</dt>
                <dd>{profile.smallModel}</dd>
                <dt>Big Model</dt>
                <dd>{profile.bigModel}</dd>
                <dt>Review Model</dt>
                <dd>{profile.reviewModel}</dd>
              </dl>
              {profile.id !== status.activeProfileId ? (
                <Button
                  variant="secondary"
                  size="sm"
                  testId={`opencode-profile-activate-${profile.id}`}
                  disabled={saving}
                  onClick={() => handleRouteChange(profile.id)}
                >
                  {saving ? 'Saving…' : 'Activate'}
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Model Selection" testId="opencode-model-selection">
        <div className="opencode-model-form">
          <div className="opencode-model-row">
            <label className="opencode-model-label" htmlFor="opencode-small-model">Small Model</label>
            <select
              id="opencode-small-model"
              className="opencode-model-input"
              value={smallModel}
              data-testid="opencode-small-model-input"
              onChange={(e) => { setSmallModel(e.target.value); setModelsDirty(true); }}
            >
              {status.availableModels.map((m) => (
                <option key={m.id} value={m.id}>{m.displayName} ({m.provider})</option>
              ))}
            </select>
          </div>
          <div className="opencode-model-row">
            <label className="opencode-model-label" htmlFor="opencode-big-model">Big Model</label>
            <select
              id="opencode-big-model"
              className="opencode-model-input"
              value={bigModel}
              data-testid="opencode-big-model-input"
              onChange={(e) => { setBigModel(e.target.value); setModelsDirty(true); }}
            >
              {status.availableModels.map((m) => (
                <option key={m.id} value={m.id}>{m.displayName} ({m.provider})</option>
              ))}
            </select>
          </div>
          <div className="opencode-model-row">
            <label className="opencode-model-label" htmlFor="opencode-review-model">Review Model</label>
            <select
              id="opencode-review-model"
              className="opencode-model-input"
              value={reviewModel}
              data-testid="opencode-review-model-input"
              onChange={(e) => { setReviewModel(e.target.value); setModelsDirty(true); }}
            >
              {status.availableModels.map((m) => (
                <option key={m.id} value={m.id}>{m.displayName} ({m.provider})</option>
              ))}
            </select>
          </div>
          <div className="opencode-model-actions">
            <Button
              variant="primary"
              size="sm"
              testId="opencode-models-save"
              disabled={!modelsDirty || saving}
              onClick={handleSaveModels}
            >
              {saving ? 'Saving…' : 'Save models'}
            </Button>
          </div>
        </div>
      </Panel>

      {mismatch && mismatch.mismatches && mismatch.mismatches.length > 0 ? (
        <Panel title="Profile Mismatch" testId="opencode-profile-mismatch">
          <div className="opencode-mismatch-banner" style={{ background: '#fff3cd', border: '1px solid #ffc107', borderRadius: '4px', padding: '12px', marginBottom: '12px' }}>
            <p style={{ margin: 0, color: '#856404' }}>
              <strong>⚠ Profile mismatch detected:</strong> active profile is <strong>{mismatch.expectedProfile}</strong> but {mismatch.mismatches.length} agent(s) use unexpected models. Click Activate to re-apply.
            </p>
            <ul style={{ margin: '8px 0 0', paddingLeft: '20px', color: '#856404' }}>
              {mismatch.mismatches.map((m: { agent: string; role: string; actualModel: string; expectedModel: string }) => (
                <li key={m.agent}>
                  <code>{m.agent}</code> ({m.role}): <code>{m.actualModel}</code> → expected <code>{m.expectedModel}</code>
                </li>
              ))}
            </ul>
            <div style={{ marginTop: '8px' }}>
              <Button
                variant="secondary"
                size="sm"
                testId="opencode-profile-mismatch-activate"
                disabled={saving}
                onClick={() => handleRouteChange(mismatch.expectedProfile)}
              >
                {saving ? 'Applying…' : 'Activate ' + mismatch.expectedProfile}
              </Button>
            </div>
          </div>
        </Panel>
      ) : null}

      {status.configPreview ? (
        <Panel title="Config Preview" testId="opencode-config-preview">
          <pre className="opencode-config-preview">{JSON.stringify(status.configPreview, null, 2)}</pre>
        </Panel>
      ) : null}
    </div>
  );
}

function SetupSection({ status, toolingInstalling, saving }: SectionProps & { toolingInstalling: boolean }) {
  const handleAction = (check: OpenCodeSetupCheck) => {
    if (!check.action) return;
    const actionKind = check.action.kind;
    // R4: Check install-codex-planning BEFORE the narrowed type guard to avoid TS2367
    if (check.id === 'codex-elegy-planning' || actionKind === 'install-codex-planning') {
      void opencodeStore.installCodexPlanning();
      return;
    }
    if (actionKind === 'install-opencode-cli') {
      void opencodeStore.installOpenCodeCli();
      return;
    }
    if (actionKind === 'worktree-permission-profile') {
      void opencodeStore.installWorktreePermissions();
      return;
    }
    if (actionKind === 'install' || actionKind === 'update') {
      if (check.id === 'elegy-planning-cli') {
        void opencodeStore.installTooling({ kind: 'elegy-planning-cli' });
      } else if (check.id === 'elegy-skills') {
        void opencodeStore.installTooling({ kind: 'elegy-skills', force: actionKind === 'update' });
      } else {
        void opencodeStore.installAssets(actionKind === 'update');
      }
    }
  };

  const isRowBusy = (id: string, actionKind: string | undefined) => {
    if (id === 'elegy-planning-cli' || id === 'elegy-skills' || id === 'codex-elegy-planning') return toolingInstalling;
    if (id === 'opencode-cli') return opencodeStore.getState().installingCli;
    if (id === 'worktree-permission-profile') return opencodeStore.getState().permissionsInstalling;
    if (actionKind === 'install' || actionKind === 'update') return saving;
    return false;
  };

  return (
    <div className="opencode-section" data-testid="opencode-setup">
      <Panel title="Setup Checklist" testId="opencode-setup-checklist">
        {status.setupChecks.map((check: OpenCodeSetupCheck) => {
          const busy = isRowBusy(check.id, check.action?.kind);
          return (
            <div key={check.id} className="opencode-setup-row" data-testid={`opencode-setup-${check.id}`}>
              <StatusDot status={check.status} />
              <div className="opencode-setup-content">
                <strong>{check.label}</strong>
                <p>{check.detail}</p>
              </div>
              <div className="opencode-setup-action">
                {check.action && check.status !== 'ok' ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    testId={`opencode-setup-action-${check.id}`}
                    disabled={busy}
                    onClick={() => handleAction(check)}
                  >
                    {busy ? 'Working…' : check.action.label}
                  </Button>
                ) : null}
              </div>
            </div>
          );
        })}
      </Panel>
    </div>
  );
}

function RequestLogSection(_props: SectionProps) {
  const state = useStoreValue(opencodeStore);

  useEffect(() => {
    void opencodeStore.loadRequestLogs({ limit: 100 });
  }, []);

  const lines = (state.requestLogs || []).map((entry: OpenCodeRequestLogEntry) => ({
    timestamp: entry.timestamp,
    level: entry.level === 'ERROR'
      ? 'error' as const
      : entry.mode === 'subagent'
        ? 'info' as const
        : 'success' as const,
    message: `[${entry.agent.padEnd(10)}] ${entry.provider}/${entry.model}  (${entry.mode})`,
  }));

  return (
    <div className="opencode-section" data-testid="opencode-logs">
      <div className="opencode-section-header">
        <h3>Request Log</h3>
        <Button
          variant="secondary"
          size="sm"
          testId="opencode-logs-refresh"
          disabled={state.requestLogsLoading}
          onClick={() => void opencodeStore.loadRequestLogs({ limit: 100 })}
        >
          {state.requestLogsLoading ? 'Loading...' : 'Refresh'}
        </Button>
      </div>
      <div className="opencode-content">
        {state.requestLogsTotal > 0 ? (
          <p className="opencode-meta" data-testid="opencode-logs-count">
            Showing {state.requestLogs?.length || 0} of {state.requestLogsTotal} requests across log files
          </p>
        ) : state.requestLogsLoading ? null : (
          <p className="opencode-hint">No request logs found. OpenCode log files may not be available.</p>
        )}
        <LogViewer lines={lines} />
      </div>
    </div>
  );
}

type SectionProps = { status: OpenCodeStatusResponse; selectedLaneId: string | null; saving: boolean };

function GoWorkspacesSection(_props: SectionProps): React.ReactElement {
  const state = useStoreValue(opencodeStore);
  const goWorkspaces = state.goWorkspaces;
  const loading = state.goWorkspacesLoading;
  const error = state.goWorkspacesError;

  const [label, setLabel] = React.useState('');
  const [wsId, setWsId] = React.useState('');
  const [apiKey, setApiKey] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);

  React.useEffect(() => {
    opencodeStore.loadGoWorkspaces();
  }, []);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!label.trim() || !wsId.trim() || !apiKey.trim()) {
      setFormError('All fields are required.');
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      await opencodeStore.createGoWorkspace({
        label: label.trim(),
        workspaceId: wsId.trim(),
        apiKey: apiKey.trim(),
        activate: true,
      });
      setLabel('');
      setWsId('');
      setApiKey('');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleActivate = (id: string) => opencodeStore.activateGoWorkspaceAction(id);
  const handleValidate = (id: string) => opencodeStore.validateGoWorkspaceAction(id);
  const handleDelete = (id: string, label: string) => {
    if (window.confirm(`Delete workspace "${label}"?`)) {
      opencodeStore.deleteGoWorkspaceAction(id);
    }
  };

  const allWorkspaces = [
    ...(goWorkspaces?.detected || []).map((w) => ({ ...w, _type: 'detected' as const })),
    ...(goWorkspaces?.registered || []).map((w) => ({ ...w, _type: 'registered' as const })),
  ];

  return (
    <div className="opencode-section opencode-go-workspaces">
      {error && <div className="opencode-error">{error}</div>}

      <form className="go-workspaces-register" onSubmit={handleRegister}>
        <h4>Register New Workspace</h4>
        {formError && <div className="opencode-error">{formError}</div>}
        <div className="go-workspaces-form-row">
          <input
            type="text"
            placeholder="Label (e.g. Primary)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            disabled={submitting || loading}
          />
          <input
            type="text"
            placeholder="Workspace ID"
            value={wsId}
            onChange={(e) => setWsId(e.target.value)}
            disabled={submitting || loading}
          />
          <input
            type="password"
            placeholder="API Key"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            disabled={submitting || loading}
          />
          <button type="submit" disabled={submitting || loading}>
            {submitting ? 'Registering…' : 'Register'}
          </button>
        </div>
      </form>

      {loading && !goWorkspaces && <div className="opencode-loading">Loading workspaces…</div>}

      {allWorkspaces.length > 0 && (
        <div className="go-workspaces-list">
          <h4>Workspaces</h4>
          {allWorkspaces.map((workspace) => {
            const isActive = workspace.id === goWorkspaces?.activeId;
            const isDetected = workspace._type === 'detected';
            const isRegistered = workspace._type === 'registered';

            return (
              <div
                key={workspace.id}
                className={`go-workspace-card ${isActive ? 'go-workspace-card-active' : ''}`}
              >
                <div className="go-workspace-card-header">
                  <span className="go-workspace-label">{workspace.label}</span>
                  {isActive && <span className="go-workspace-badge go-workspace-badge-active">Active</span>}
                  {isDetected && <span className="go-workspace-badge go-workspace-badge-detected">Detected</span>}
                </div>
                <div className="go-workspace-card-details">
                  <span className="go-workspace-workspaceId">{workspace.workspaceId}</span>
                  <span className="go-workspace-source">via {workspace.keySource || 'keychain'}</span>
                  {workspace.lastValidatedStatus && (
                    <span className={`go-workspace-validation go-workspace-validation-${workspace.lastValidatedStatus}`}>
                      {workspace.lastValidatedStatus === 'ok' ? '✓ Valid' : workspace.lastValidatedStatus}
                    </span>
                  )}
                </div>
                {isRegistered && (
                  <div className="go-workspace-card-actions">
                    {!isActive && (
                      <button onClick={() => handleActivate(workspace.id)} disabled={loading}>
                        Activate
                      </button>
                    )}
                    <button onClick={() => handleValidate(workspace.id)} disabled={loading}>
                      Validate
                    </button>
                    <button
                      className="go-workspace-delete-btn"
                      onClick={() => handleDelete(workspace.id, workspace.label)}
                      disabled={loading}
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!loading && allWorkspaces.length === 0 && !error && (
        <div className="opencode-empty">No workspaces configured yet. Register one above.</div>
      )}
    </div>
  );
}

function PermissionsSection(_props: SectionProps): React.ReactElement {
  const state = useStoreValue(opencodeStore);
  const [permissions, setPermissions] = React.useState<OpenCodePermissions | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [permissionsError, setPermissionsError] = React.useState<string | null>(null);

  const [newPermKey, setNewPermKey] = React.useState('');
  const [newPermValue, setNewPermValue] = React.useState<'allow' | 'deny' | 'ask'>('allow');

  const loadPermissions = React.useCallback(async () => {
    setLoading(true);
    setPermissionsError(null);
    try {
      const { getOpenCodePermissions } = await import('../../lib/api/opencode');
      const response = await getOpenCodePermissions();
      setPermissions((response.permission as OpenCodePermissions) || null);
    } catch (err) {
      setPermissionsError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadPermissions();
  }, [loadPermissions]);

  const handleSave = async () => {
    setSaving(true);
    setPermissionsError(null);
    try {
      const { saveOpenCodePermissions } = await import('../../lib/api/opencode');
      const response = await saveOpenCodePermissions({ permission: (permissions || {}) as Record<string, unknown> });
      setPermissions((response.permission as OpenCodePermissions) || null);
      opencodeStore.setState((prev) => ({ ...prev, message: 'Permissions saved.' }));
    } catch (err) {
      setPermissionsError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleApplyWorktreeDefaults = async () => {
    setSaving(true);
    setPermissionsError(null);
    try {
      await opencodeStore.installWorktreePermissions();
      // Reload permissions after applying worktree defaults
      await loadPermissions();
    } catch {
      // Error is already set by the store
    } finally {
      setSaving(false);
    }
  };

  const addPermission = () => {
    if (!newPermKey.trim() || !newPermValue) return;
    setPermissions({ ...permissions, [newPermKey.trim()]: newPermValue });
    setNewPermKey('');
  };

  const removePermission = (key: string) => {
    if (!permissions) return;
    const next = { ...permissions };
    delete next[key];
    setPermissions(next);
  };

  const permissionEntries = Object.entries(permissions || {})
    .filter(([key]) => key !== 'instruction-engine-worktree-permission-profile');

  return (
    <div className="opencode-section" data-testid="opencode-permissions">
      {permissionsError && <div className="opencode-error">{permissionsError}</div>}

      <Panel title="Permission Rules" subtitle="Actions OpenCode agents are allowed or denied to perform" testId="opencode-permissions-rules">
        {permissionEntries.length === 0 ? (
          <p className="opencode-hint">No permission rules configured. All actions use default behavior.</p>
        ) : (
          <div className="opencode-permissions-patterns">
            {permissionEntries.map(([key, value]: [string, string]) => (
              <div key={key} className="opencode-permissions-row" data-testid={`opencode-perm-${key}`}>
                <code className="opencode-permissions-value">{key}</code>
                <Badge tone={value === 'allow' ? 'success' : value === 'deny' ? 'danger' : 'accent'}>{value}</Badge>
                <Button variant="ghost" size="sm" testId={`opencode-perm-remove-${key}`} onClick={() => removePermission(key)}>
                  Remove
                </Button>
              </div>
            ))}
          </div>
        )}
        <div className="opencode-permissions-add">
          <input
            type="text"
            className="opencode-model-input"
            placeholder="external_directory"
            value={newPermKey}
            onChange={(e) => setNewPermKey(e.target.value)}
            data-testid="opencode-perm-new-key"
            style={{ width: '200px' }}
          />
          <select
            className="opencode-model-input"
            value={newPermValue}
            onChange={(e) => setNewPermValue(e.target.value as 'allow' | 'deny' | 'ask')}
            data-testid="opencode-perm-new-value"
            style={{ width: '100px' }}
          >
            <option value="allow">allow</option>
            <option value="deny">deny</option>
            <option value="ask">ask</option>
          </select>
          <Button variant="secondary" size="sm" testId="opencode-perm-add" onClick={addPermission} disabled={!newPermKey.trim()}>
            Add Rule
          </Button>
        </div>
      </Panel>

      <Panel title="Worktree Permission Profile" subtitle="Auto-configured worktree permissions" testId="opencode-permissions-worktree-profile">
        <div className="opencode-permissions-row">
          {state.status?.worktreePermissionProfile?.applied ? <StatusDot status="ok" /> : <StatusDot status="warning" />}
          <div>
            <strong>{state.status?.worktreePermissionProfile?.applied ? 'Worktree profile applied' : 'Worktree profile not yet applied'}</strong>
            {state.status?.worktreePermissionProfile?.applied && (
              <>
                <p>Base: {String(state.status.worktreePermissionProfile.worktreeBase || 'unknown')}</p>
                <p>Version: {String(state.status.worktreePermissionProfile.version || 'unknown')}</p>
                <p>Applied at: {String((state.status.worktreePermissionProfile.marker as Record<string, unknown> | null)?.appliedAt || 'unknown')}</p>
              </>
            )}
          </div>
        </div>
        <div className="opencode-model-actions" style={{ marginTop: '12px' }}>
          <Button
            variant="secondary"
            size="sm"
            testId="opencode-perm-apply-worktree"
            disabled={saving}
            onClick={handleApplyWorktreeDefaults}
          >
            {saving ? 'Applying...' : 'Apply Worktree Defaults'}
          </Button>
        </div>
      </Panel>

      <div className="opencode-model-actions" style={{ marginTop: '16px' }}>
        <Button
          variant="primary"
          size="sm"
          testId="opencode-perm-save"
          disabled={saving || loading}
          onClick={handleSave}
        >
          {saving ? 'Saving...' : 'Save Permissions'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          testId="opencode-perm-refresh"
          disabled={loading}
          onClick={loadPermissions}
          style={{ marginLeft: '8px' }}
        >
          {loading ? 'Loading...' : 'Refresh'}
        </Button>
      </div>
    </div>
  );
}

function ExperimentalSection({ status }: SectionProps) {
  const state = useStoreValue(opencodeStore);

  // Read lsp from config preview
  const lspEnabled = typeof status.configPreview?.lsp === 'boolean' ? status.configPreview.lsp : false;

  const handleToggleLsp = () => {
    void opencodeStore.toggleConfigKey('lsp', !lspEnabled);
  };

  return (
    <div className="opencode-section" data-testid="opencode-experimental">
      <Panel title="Experimental Features" subtitle="Enable or disable beta and experimental OpenCode features" testId="opencode-experimental-panel">
        <div className="opencode-experimental-list">
          <div className="opencode-experimental-item" data-testid="opencode-experimental-lsp">
            <div className="opencode-experimental-info">
              <div className="opencode-experimental-header">
                <h4 className="opencode-experimental-name">Language Server Protocol (LSP)</h4>
                <Badge tone="accent" testId="opencode-experimental-lsp-badge">BETA</Badge>
              </div>
              <p className="opencode-experimental-desc">
                Enables real-time code intelligence (diagnostics, completions, hover info) for supported languages
                directly in OpenCode. Requires the LSP runtime to be installed and configured.
              </p>
            </div>
            <div className="opencode-experimental-toggle">
              <label className="toggle-switch" data-testid="opencode-experimental-lsp-toggle">
                <input
                  type="checkbox"
                  checked={lspEnabled}
                  onChange={handleToggleLsp}
                  disabled={state.saving}
                />
                <span className="toggle-slider" />
                <span className="toggle-label">{lspEnabled ? 'Enabled' : 'Disabled'}</span>
              </label>
            </div>
          </div>
        </div>
      </Panel>

    </div>
  );
}

const SECTION_COMPONENTS: Record<OpenCodeTabSectionId, React.FC<SectionProps>> = {
  overview: OverviewSection,
  lanes: LaneSection,
  profiles: ProfilesSection,
  setup: SetupSection as unknown as React.FC<SectionProps>,
  logs: RequestLogSection,
  'go-workspaces': GoWorkspacesSection,
  permissions: PermissionsSection,
  experimental: ExperimentalSection,
};

export default function OpenCodeView() {
  const state = useStoreValue(opencodeStore);

  useEffect(() => {
    void opencodeStore.load();
    return () => {
      opencodeStore.resetState();
    };
  }, []);

  const SectionComponent = SECTION_COMPONENTS[state.activeSection];

  return (
    <div className="opencode-view" data-testid="opencode-view">
      <Toolbar testId="opencode-toolbar">
        <h2>OpenCode Workspace</h2>
      </Toolbar>

      <div className="opencode-tabs" role="tablist" data-testid="opencode-tabs">
        {TAB_SECTIONS.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            className={`opencode-tab${state.activeSection === tab.id ? ' opencode-tab-active' : ''}`}
            data-testid={`opencode-tab-${tab.id}`}
            onClick={() => opencodeStore.setActiveSection(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="opencode-content" role="tabpanel">
        {state.loading && !state.status ? (
          <p className="opencode-loading" data-testid="opencode-loading">Loading OpenCode workspace...</p>
        ) : null}

        {state.error ? (
          <p className="opencode-error" data-testid="opencode-error">{state.error}</p>
        ) : null}

        {state.message ? (
          <p className="opencode-message" data-testid="opencode-message">{state.message}</p>
        ) : null}

        {state.status ? (
          <SectionComponent status={state.status} selectedLaneId={state.selectedLaneId} saving={state.saving} />
        ) : null}
      </div>
    </div>
  );
}
