import React, { useEffect, useState } from 'react';
import { Badge, Button, LogViewer, Panel, Toolbar } from '../../components';
import { useStoreValue } from '../../lib/store';
import type {
  CustomPromptMap,
  OpenCodeLane,
  OpenCodeLaneNode,
  OpenCodePermissions,
  OpenCodeProfile,
  OpenCodeRequestLogEntry,
  OpenCodeStatusResponse,
  OpenCodeTabSectionId,
  OpenCodeWarning,
} from '../../lib/types';
import { opencodeStore } from '../../stores/opencodeStore';

const TAB_SECTIONS: Array<{ id: OpenCodeTabSectionId; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'lanes', label: 'Lanes' },
  { id: 'profiles', label: 'Profiles' },
  { id: 'logs', label: 'Request Log' },
  { id: 'go-workspaces', label: 'Workspaces' },
  { id: 'permissions', label: 'Permissions' },
  { id: 'experimental', label: 'Experimental' },
  { id: 'prompts', label: 'Prompts' },
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
  const overallStatus = status.overallStatus ?? 'unknown';
  const warnings = status.warnings ?? [];
  const elegyPlanningCli = status.elegyPlanningCli ?? { cliPath: null, currentVersion: null };
  const elegySkillsAssets = status.elegySkillsAssets ?? { trackedCount: 0, outdatedCount: 0 };
  const planningLiveAuthority = status.planningLiveAuthority ?? { ready: false };
  const overallBadge = overallStatus === 'ready' ? 'success'
    : overallStatus === 'degraded' ? 'accent'
    : 'danger';

  return (
    <div className="opencode-section" data-testid="opencode-overview">
      <Panel title="Readiness Dashboard" subtitle="OpenCode installation status and dependency checks" testId="opencode-readiness">
        <div className="opencode-readiness-cards">
          <div className="opencode-readiness-card">
            <span className="opencode-readiness-label">Overall Status</span>
            <Badge tone={overallBadge} testId="opencode-overall-status">
              {overallStatus.toUpperCase()}
            </Badge>
          </div>
          <div className="opencode-readiness-card">
            <span className="opencode-readiness-label">OpenCode Home</span>
            <code className="opencode-readiness-value">{status.opencodeHome ?? 'Not found'}</code>
          </div>
          <div className="opencode-readiness-card">
            <span className="opencode-readiness-label">Config Path</span>
            <code className="opencode-readiness-value">{status.configPath ?? 'Not found'}</code>
          </div>
          <div className="opencode-readiness-card">
            <span className="opencode-readiness-label">Effective Profile</span>
            <Badge tone="brand">{status.effectiveProfileId || status.activeProfileId || 'None'}</Badge>
          </div>
          {status.selectedProfileId && status.selectedProfileId !== status.effectiveProfileId ? (
            <div className="opencode-readiness-card">
              <span className="opencode-readiness-label">Selected Profile</span>
              <Badge tone="accent">{status.selectedProfileId}</Badge>
            </div>
          ) : null}
          <div className="opencode-readiness-card">
            <span className="opencode-readiness-label">Small Model</span>
            <code className="opencode-readiness-value">{status.smallModel ?? '—'}</code>
          </div>
          <div className="opencode-readiness-card">
            <span className="opencode-readiness-label">Big Model</span>
            <code className="opencode-readiness-value">{status.bigModel ?? '—'}</code>
          </div>
          <div className="opencode-readiness-card">
            <span className="opencode-readiness-label">Elegy Planning CLI</span>
            <StatusDot status={elegyPlanningCli.cliPath ? 'ok' : 'warning'} />
            <span className="opencode-readiness-value">
              {elegyPlanningCli.cliPath ? elegyPlanningCli.currentVersion || 'detected' : 'Not detected'}
            </span>
          </div>
          <div className="opencode-readiness-card">
            <span className="opencode-readiness-label">Elegy Skills</span>
            <StatusDot status={elegySkillsAssets.trackedCount > 0 ? 'ok' : 'warning'} />
            <span className="opencode-readiness-value">
              {elegySkillsAssets.trackedCount} tracked
              {elegySkillsAssets.outdatedCount > 0 ? `, ${elegySkillsAssets.outdatedCount} outdated` : ''}
            </span>
          </div>
          <div className="opencode-readiness-card">
            <span className="opencode-readiness-label">Planning Live Authority</span>
            <StatusDot status={planningLiveAuthority.ready ? 'ok' : 'warning'} />
            <span className="opencode-readiness-value">
              {planningLiveAuthority.ready ? 'Ready' : 'Not ready'}
            </span>
          </div>
          <div className="opencode-readiness-card">
            <span className="opencode-readiness-label">Warnings</span>
            <Badge tone={warnings.length > 0 ? 'accent' : 'success'}>
              {warnings.length > 0 ? `${warnings.length} active` : 'None'}
            </Badge>
          </div>
        </div>
      </Panel>

      {warnings.length > 0 ? (
        <Panel title="Active Warnings" subtitle="Configuration issues that need attention" testId="opencode-warnings">
          {warnings.map((w: OpenCodeWarning) => (
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
  const lanes = status.lanes ?? [];
  const selectedLane = selectedLaneId
    ? lanes.find((l: OpenCodeLane) => l.id === selectedLaneId)
    : null;

  return (
    <div className="opencode-section" data-testid="opencode-lanes">
      <div className="opencode-lane-map" data-testid="opencode-lane-map">
        {lanes.map((lane: OpenCodeLane) => (
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
  const profiles = status.profiles ?? [];
  const [smallModel, setSmallModel] = useState<string>(status.smallModel ?? '');
  const [bigModel, setBigModel] = useState<string>(status.bigModel ?? '');
  const profileReviewModel = profiles.find(p => p.id === status.activeProfileId)?.reviewModel || '';
  const [reviewModel, setReviewModel] = useState<string>(profileReviewModel);
  const [modelsDirty, setModelsDirty] = useState<boolean>(false);
  const [roleModels, setRoleModels] = useState<Record<string, string>>(status.roleModels || {});

  useEffect(() => {
    setSmallModel(status.smallModel ?? '');
    setBigModel(status.bigModel ?? '');
    setRoleModels(status.roleModels || {});
    const profile = profiles.find(p => p.id === status.activeProfileId);
    if (profile) {
      setReviewModel(profile.reviewModel);
    }
    setModelsDirty(false);
  }, [status.smallModel, status.bigModel, status.activeProfileId, profiles, status.roleModels]);

  const mismatch = status.profileMismatch;

  const handleRouteChange = (profileId: string) => {
    void opencodeStore.saveConfig({ profileRoute: profileId });
  };

  const handleSaveModels = () => {
    void opencodeStore.saveConfig({ smallModel, bigModel, reviewModel });
  };

  const handleProfileSwitch = (profileId: string) => {
    void opencodeStore.saveConfig({ profileId });
  };

  const handleSaveRoleModels = () => {
    void opencodeStore.saveConfig({ roleModels });
  };

  return (
    <div className="opencode-section" data-testid="opencode-profiles">
      <Panel title="Provider Routing" subtitle="Which AI provider and model OpenCode uses for each role" testId="opencode-provider-routing">
        <div className="opencode-profiles-list">
          {profiles.map((profile: OpenCodeProfile) => (
            <div
              key={profile.id}
              className={`opencode-profile-card${profile.id === (status.effectiveProfileId || status.activeProfileId) ? ' opencode-profile-card-active' : ''}`}
              data-testid={`opencode-profile-${profile.id}`}
            >
              <div className="opencode-profile-header">
                <h3>{profile.label}</h3>
                {profile.id === (status.effectiveProfileId || status.activeProfileId) ? (
                  <Badge tone="brand" testId={`opencode-profile-badge-${profile.id}`}>Active</Badge>
                ) : profile.id === status.selectedProfileId && status.selectedProfileId !== status.effectiveProfileId ? (
                  <Badge tone="accent" testId={`opencode-profile-badge-${profile.id}`}>Selected</Badge>
                ) : null}
              </div>
              <p className="opencode-profile-desc">{profile.description}</p>
              {profile.tags && profile.tags.length > 0 ? (
                <div className="opencode-profile-tags" style={{ marginTop: '4px' }}>
                  {profile.tags.map((tag: string) => (
                    <span key={tag} className="opencode-tag" style={{
                      display: 'inline-block',
                      background: 'var(--color-bg-tertiary)',
                      borderRadius: '4px',
                      padding: '1px 6px',
                      marginRight: '4px',
                      fontSize: '11px',
                    }}>{tag}</span>
                  ))}
                </div>
              ) : null}
              <dl className="opencode-detail-list">
                <dt>Route</dt>
                <dd><code>{profile.route}</code></dd>
                <dt>Small Model</dt>
                <dd>{profile.smallModel}</dd>
                <dt>Big Model</dt>
                <dd>{profile.bigModel}</dd>
                <dt>Review Model</dt>
                <dd>{profile.reviewModel}</dd>
                {profile.roleModels && Object.keys(profile.roleModels).length > 0 ? (
                  Object.entries(profile.roleModels).map(([role, model]) => (
                    <React.Fragment key={role}>
                      <dt>{role.charAt(0).toUpperCase() + role.slice(1)}</dt>
                      <dd>{model}</dd>
                    </React.Fragment>
                  ))
                ) : null}
              </dl>
              {profile.id !== status.activeProfileId ? (
                <Button
                  variant="secondary"
                  size="sm"
                  testId={`opencode-profile-activate-${profile.id}`}
                  disabled={saving}
                  onClick={() => handleProfileSwitch(profile.id)}
                >
                  {saving ? 'Saving…' : 'Activate'}
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Model Selection" subtitle="Choose models for planning, implementation, review, research, and exploration roles" testId="opencode-model-selection">
        <div className="opencode-model-form">
          {(['planning', 'implementation', 'exploration', 'review', 'research'] as const).map((role) => (
            <div className="opencode-model-row" key={role}>
              <label className="opencode-model-label" htmlFor={`opencode-role-${role}`}>
                {role.charAt(0).toUpperCase() + role.slice(1)}
              </label>
              <input
                id={`opencode-role-${role}`}
                className="opencode-model-input"
                type="text"
                value={roleModels[role] || ''}
                data-testid={`opencode-role-${role}-input`}
                onChange={(e) => {
                  setRoleModels((prev: Record<string, string>) => ({ ...prev, [role]: e.target.value }));
                  setModelsDirty(true);
                }}
              />
            </div>
          ))}
          <div className="opencode-model-actions">
            <Button
              variant="primary"
              size="sm"
              testId="opencode-models-save"
              disabled={!modelsDirty || saving}
              onClick={handleSaveRoleModels}
            >
              {saving ? 'Saving…' : 'Save role models'}
            </Button>
          </div>
        </div>
      </Panel>

      {mismatch && mismatch.mismatches && mismatch.mismatches.length > 0 ? (
        <Panel title="Profile Mismatch" subtitle="Warnings when current profile does not match recommended settings" testId="opencode-profile-mismatch">
          <div className="opencode-mismatch-banner" style={{ background: '#fff3cd', border: '1px solid #ffc107', borderRadius: '4px', padding: '12px', marginBottom: '12px' }}>
              <p style={{ margin: 0, color: '#856404' }}>
                <strong>⚠ Profile mismatch detected:</strong> selected profile is <strong>{mismatch.expectedProfile}</strong> but effective profile is <strong>{mismatch.effectiveProfile || 'custom'}</strong>. {mismatch.mismatches.length} agent(s) use unexpected models. Re-apply to align.
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

      {(!mismatch || !mismatch.mismatches || mismatch.mismatches.length === 0) && status.selectedProfileId && status.effectiveProfileId && status.selectedProfileId !== status.effectiveProfileId ? (
        <Panel title="Profile Configuration Notice" subtitle="Current profile and its active settings" testId="opencode-profile-diff-notice">
          <div className="opencode-mismatch-banner" style={{ background: '#e7f3ff', border: '1px solid #2196f3', borderRadius: '4px', padding: '12px', marginBottom: '12px' }}>
            <p style={{ margin: 0, color: '#0d47a1' }}>
              <strong>ℹ Selected profile</strong> (<code>{status.selectedProfileId}</code>) differs from <strong>effective configuration</strong> (<code>{status.effectiveProfileId || 'custom'}</code>). The dashboard uses the effective profile for status display.
            </p>
            <div style={{ marginTop: '8px' }}>
              <Button
                variant="secondary"
                size="sm"
                testId="opencode-profile-reapply-selected"
                disabled={saving}
                onClick={() => handleProfileSwitch(status.selectedProfileId!)}
              >
                {saving ? 'Applying…' : `Re-apply ${status.selectedProfileId}`}
              </Button>
            </div>
          </div>
        </Panel>
      ) : null}

      {status.configPreview ? (
        <Panel title="Config Preview" subtitle="Preview the generated OpenCode configuration" testId="opencode-config-preview">
          <pre className="opencode-config-preview">{JSON.stringify(status.configPreview, null, 2)}</pre>
        </Panel>
      ) : null}
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

      {/* Workspace Pool Section */}
      <div className="go-workspaces-pool" style={{ marginTop: 'var(--space-md)', padding: 'var(--space-sm)', border: '1px solid var(--color-border-100)', borderRadius: 'var(--radius-sm)' }}>
        <h4>Workspace Pool</h4>
        <p className="catalog-inline-note" style={{ marginBottom: 'var(--space-xs)' }}>
          Manage multiple workspaces as a priority-ordered pool. The active workspace is used by default; pool members can be quickly accessed.
        </p>

        <label className="planning-checkbox" style={{ marginBottom: 'var(--space-sm)' }}>
          <input
            type="checkbox"
            checked={state.workspacePool?.enabled || false}
            onChange={(e) => opencodeStore.setWorkspacePool({ enabled: e.target.checked })}
            disabled={loading}
          />
          Enable workspace pool
        </label>

        {(state.workspacePool?.enabled) && allWorkspaces.filter(w => w._type === 'registered').length > 0 && (
          <div style={{ marginTop: 'var(--space-xs)' }}>
            <p className="catalog-inline-note">
              Pool members ({state.workspacePool?.workspaceIds?.length || 0} selected):
            </p>
            {allWorkspaces.filter(w => w._type === 'registered').map((w) => {
              const isInPool = (state.workspacePool?.workspaceIds || []).includes(w.id);
              return (
                <label key={w.id} className="planning-checkbox" style={{ display: 'block', marginBottom: '2px' }}>
                  <input
                    type="checkbox"
                    checked={isInPool}
                    onChange={(e) => {
                      const currentIds = state.workspacePool?.workspaceIds || [];
                      const nextIds = e.target.checked
                        ? [...currentIds, w.id]
                        : currentIds.filter((id) => id !== w.id);
                      opencodeStore.setWorkspacePool({ workspaceIds: nextIds });
                    }}
                    disabled={loading}
                  />
                  {w.label} ({w.workspaceId || 'no id'})
                </label>
              );
            })}
            <button
              className="button button-sm button-ghost"
              style={{ marginTop: 'var(--space-xs)' }}
              onClick={() => opencodeStore.validateWorkspacePool()}
              disabled={loading || state.workspacePoolLoading}
            >
              {state.workspacePoolLoading ? 'Validating...' : 'Validate All Pool Members'}
            </button>
          </div>
        )}
      </div>

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
                  {workspace.lastValidatedAt && (
                    <span className="go-workspace-validated-at" style={{ fontSize: '0.75rem', opacity: 0.7 }}>
                      Last checked: {new Date(workspace.lastValidatedAt).toLocaleDateString()}
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
    .filter(([key]) => key !== 'elegy-copilot-worktree-permission-profile');

  return (
    <div className="opencode-section" data-testid="opencode-permissions">
      {permissionsError && <div className="opencode-error">{permissionsError}</div>}

      <Panel title="Permission Rules" subtitle="Actions OpenCode agents are allowed or denied to perform" testId="opencode-permissions-rules">
        {permissionEntries.length === 0 ? (
          <p className="opencode-hint">No permission rules configured. All actions use default behavior.</p>
        ) : (
          <div className="opencode-permissions-patterns">
            {permissionEntries.map(([key, value]) => (
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

interface ExperimentalFeatureDef {
  key: string;
  label: string;
  badge?: string;
  description: string;
  configKey?: string; // defaults to key
}

const EXPERIMENTAL_FEATURES: ExperimentalFeatureDef[] = [
  {
    key: 'lsp',
    label: 'Language Server Protocol (LSP)',
    badge: 'BETA',
    description: 'Enables real-time code intelligence (diagnostics, completions, hover info) for supported languages directly in OpenCode. Requires the LSP runtime to be installed and configured.',
  },
  {
    key: 'batch_tool',
    label: 'Batch Tool',
    description: 'Enable the batch tool for executing multiple operations in a single step.',
  },
  {
    key: 'openTelemetry',
    label: 'OpenTelemetry Tracing',
    description: 'Enable OpenTelemetry spans for AI SDK calls. Useful for debugging and performance analysis.',
  },
  {
    key: 'continue_loop_on_deny',
    label: 'Continue on Deny',
    description: 'Continue the agent loop when a tool call is denied, instead of stopping the session.',
  },
  {
    key: 'disable_paste_summary',
    label: 'Disable Paste Summary',
    description: 'Disable the automatic summary when pasting large blocks of text.',
  },
];

function ExperimentalSection({ status }: SectionProps) {
  const state = useStoreValue(opencodeStore);

  const expConfig = status.configPreview?.experimental && typeof status.configPreview.experimental === 'object'
    ? status.configPreview.experimental as Record<string, unknown>
    : {};

  const getExpValue = (key: string): boolean => {
    if (key === 'lsp') {
      return typeof status.configPreview?.lsp === 'boolean' ? status.configPreview.lsp : false;
    }
    return typeof expConfig[key] === 'boolean' ? Boolean(expConfig[key]) : false;
  };

  const handleToggle = (key: string, currentValue: boolean) => {
    void opencodeStore.toggleConfigKey(key === 'lsp' ? 'lsp' : `experimental.${key}`, !currentValue);
  };

  return (
    <div className="opencode-section" data-testid="opencode-experimental">
      <Panel title="Experimental Features" subtitle="Enable or disable beta and experimental OpenCode features" testId="opencode-experimental-panel">
        <div className="opencode-experimental-list">
          {EXPERIMENTAL_FEATURES.map((feature) => {
            const enabled = getExpValue(feature.key);
            return (
              <div className="opencode-experimental-item" key={feature.key} data-testid={`opencode-experimental-${feature.key}`}>
                <div className="opencode-experimental-info">
                  <div className="opencode-experimental-header">
                    <h4 className="opencode-experimental-name">{feature.label}</h4>
                    {feature.badge ? <Badge tone="accent" testId={`opencode-experimental-${feature.key}-badge`}>{feature.badge}</Badge> : null}
                  </div>
                  <p className="opencode-experimental-desc">{feature.description}</p>
                </div>
                <div className="opencode-experimental-toggle">
                  <label className="toggle-switch" data-testid={`opencode-experimental-${feature.key}-toggle`}>
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={() => handleToggle(feature.key, enabled)}
                      disabled={state.saving}
                    />
                    <span className="toggle-slider" />
                    <span className="toggle-label">{enabled ? 'Enabled' : 'Disabled'}</span>
                  </label>
                </div>
              </div>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}

const ALL_LANE_AGENT_KEYS = ['explore', 'scout', 'quick', 'impl', 'explorer', 'standard', 'spec', 'project', 'reviewer'];

const ROLE_TO_AGENT: Record<string, string[]> = {
  planning: ['plan', 'standard', 'spec', 'project'],
  implementation: ['build', 'impl', 'quick'],
  exploration: ['explore', 'explorer'],
  review: ['reviewer'],
  research: ['scout'],
};

function PromptsSection(_props: SectionProps): React.ReactElement {
  const state = useStoreValue(opencodeStore);
  const status = state.status || _props.status;

  // Initialize draft prompts from store once on mount
  const [draftPrompts, setDraftPrompts] = useState<CustomPromptMap>(() => {
    const s = opencodeStore.getState();
    return JSON.parse(JSON.stringify(s.customPrompts || {}));
  });
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());
  const [effectiveExpanded, setEffectiveExpanded] = useState<Set<string>>(new Set());
  // Track override models that have been explicitly removed (hidden but kept in draftPrompts)
  const [hiddenOverrides, setHiddenOverrides] = useState<Set<string>>(new Set());

  const customPrompts = state.customPrompts || {};
  const effectivePrompts = state.effectivePrompts || {};
  const promptsSaving = state.promptsSaving;

  // Resolve active model for a given agent
  const activeProfile = status?.profiles?.find(p => p.id === status?.activeProfileId);
  const roleModels = activeProfile?.roleModels || status?.roleModels || {};

  function getActiveModel(agent: string): string | null {
    for (const [role, agents] of Object.entries(ROLE_TO_AGENT)) {
      if (agents.includes(agent)) {
        return roleModels[role] || null;
      }
    }
    return null;
  }

  // Status dot logic
  function getAgentPromptStatus(agent: string, activeModel: string | null): 'active' | 'inactive' | 'default' {
    const agentPrompts = customPrompts[agent];
    if (!agentPrompts || Object.keys(agentPrompts).length === 0) return 'default';
    if (activeModel && agentPrompts[activeModel] && agentPrompts[activeModel].trim().length > 0) return 'active';
    // Check if any non-active model has a non-empty prompt
    const hasNonEmptyOverride = Object.entries(agentPrompts).some(
      ([m, v]) => m !== activeModel && v && v.trim().length > 0
    );
    if (hasNonEmptyOverride) return 'inactive';
    return 'default';
  }

  function getModelDisplayName(modelId: string): string {
    const model = status?.availableModels?.find(m => m.id === modelId);
    return model?.displayName || modelId;
  }

  // Count agents with at least one non-empty custom prompt
  const configuredCount = ALL_LANE_AGENT_KEYS.filter(a => {
    const ap = customPrompts[a];
    return ap && Object.keys(ap).length > 0 && Object.values(ap).some(v => v && v.trim().length > 0);
  }).length;

  const isBlocked = status?.overallStatus === 'blocked';

  // Save all draft prompts
  const handleSaveAll = () => {
    void opencodeStore.savePrompts({ customPrompts: draftPrompts });
  };

  // Toggle agent row expansion
  const toggleAgent = (agent: string) => {
    setExpandedAgents(prev => {
      const next = new Set(prev);
      if (next.has(agent)) next.delete(agent);
      else next.add(agent);
      return next;
    });
  };

  // Toggle effective prompt sub-section
  const toggleEffective = (agent: string) => {
    setEffectiveExpanded(prev => {
      const next = new Set(prev);
      if (next.has(agent)) {
        next.delete(agent);
      } else {
        next.add(agent);
        // Load effective prompt data on expand
        void opencodeStore.loadEffectivePrompt(agent);
      }
      return next;
    });
  };

  // Update a draft prompt value for a specific agent+model
  const updateDraft = (agent: string, modelId: string, value: string) => {
    setDraftPrompts(prev => ({
      ...prev,
      [agent]: {
        ...(prev[agent] || {}),
        [modelId]: value,
      },
    }));
  };

  // Add a new model override (starts empty, visible immediately)
  const addModelOverride = (agent: string, modelId: string) => {
    setDraftPrompts(prev => ({
      ...prev,
      [agent]: {
        ...(prev[agent] || {}),
        [modelId]: '',
      },
    }));
    // Remove from hidden if previously removed
    setHiddenOverrides(prev => {
      const next = new Set(prev);
      next.delete(`${agent}::${modelId}`);
      return next;
    });
  };

  // Remove a model override (keeps entry as empty string in data, hides from UI)
  const removeModelOverride = (agent: string, modelId: string) => {
    setDraftPrompts(prev => ({
      ...prev,
      [agent]: {
        ...(prev[agent] || {}),
        [modelId]: '',
      },
    }));
    setHiddenOverrides(prev => new Set(prev).add(`${agent}::${modelId}`));
  };

  // Get available models for the add-override dropdown
  const getAvailableModels = (agent: string): Array<{ id: string; displayName: string; provider: string }> => {
    const existingOverrides = draftPrompts[agent] || {};
    return (status?.availableModels || []).filter(m => {
      const alreadyExists = m.id in existingOverrides;
      const isHidden = hiddenOverrides.has(`${agent}::${m.id}`);
      // Show models that don't exist OR have been explicitly hidden (removed)
      return !alreadyExists || isHidden;
    });
  };

  return (
    <div className="opencode-section" data-testid="opencode-prompts">
      <Panel title="Custom System Prompts" subtitle="Override the default system prompt for OpenCode agents" testId="opencode-prompts-panel">
        {/* Blocked/warning state */}
        {isBlocked ? (
          <div
            className="opencode-prompts-warning"
            style={{
              background: 'var(--color-bg-warning, #fff3cd)',
              border: '1px solid var(--color-border-warning, #ffc107)',
              borderRadius: '4px',
              padding: '12px',
              marginBottom: '12px',
            }}
            data-testid="opencode-prompts-blocked-warning"
          >
            <p style={{ margin: 0, color: 'var(--color-text-warning, #856404)' }}>
              ⚠ opencode.jsonc not found or unreadable. Custom prompts cannot be applied.
            </p>
          </div>
        ) : null}

        {/* Summary line */}
        <div
          className="opencode-prompts-summary"
          style={{ marginBottom: '8px', fontSize: '13px', color: 'var(--color-text-secondary)' }}
          data-testid="opencode-prompts-summary"
        >
          {configuredCount} of {ALL_LANE_AGENT_KEYS.length} agents have custom prompts.
        </div>

        {/* Save All button */}
        <div className="opencode-prompts-actions" style={{ marginBottom: '16px' }}>
          <Button
            variant="primary"
            size="sm"
            testId="opencode-prompts-save"
            disabled={promptsSaving || isBlocked}
            onClick={handleSaveAll}
          >
            {promptsSaving ? 'Saving…' : 'Save All'}
          </Button>
        </div>

        {/* Agent rows */}
        {ALL_LANE_AGENT_KEYS.map(agent => {
          const activeModel = getActiveModel(agent);
          const dotStatus = getAgentPromptStatus(agent, activeModel);
          const isExpanded = expandedAgents.has(agent);
          const agentDraftPrompts = draftPrompts[agent] || {};

          // Override entries: all models in draftPrompts except the active model
          const overrideModelIds = Object.keys(agentDraftPrompts).filter(
            m => m !== activeModel && !hiddenOverrides.has(`${agent}::${m}`)
          );

          return (
            <div
              key={agent}
              className="opencode-prompts-agent"
              data-testid={`opencode-prompts-agent-${agent}`}
              style={{
                border: '1px solid var(--color-border)',
                borderRadius: '6px',
                marginBottom: '8px',
                overflow: 'hidden',
              }}
            >
              {/* ---- Agent Header ---- */}
              <div
                className="opencode-prompts-agent-header"
                onClick={() => toggleAgent(agent)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '10px 12px',
                  cursor: 'pointer',
                  background: 'var(--color-bg-secondary)',
                  userSelect: 'none',
                }}
                data-testid={`opencode-prompts-agent-header-${agent}`}
              >
                {/* Status dot */}
                <span
                  className={`opencode-status-dot opencode-status-dot--${dotStatus}`}
                  style={{
                    width: '10px',
                    height: '10px',
                    borderRadius: '50%',
                    display: 'inline-block',
                    flexShrink: 0,
                    background:
                      dotStatus === 'active' ? '#22c55e'
                      : dotStatus === 'inactive' ? '#eab308'
                      : '#9ca3af',
                  }}
                  data-testid={`opencode-prompts-dot-${agent}`}
                />

                {/* Agent name */}
                <strong style={{ flex: 1, fontSize: '14px' }}>{agent}</strong>

                {/* Active model badge */}
                {activeModel ? (
                  <Badge tone="brand" testId={`opencode-prompts-model-badge-${agent}`}>
                    {activeModel}
                  </Badge>
                ) : null}

                {/* Expand toggle arrow */}
                <span
                  style={{
                    transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                    transition: 'transform 0.2s',
                    fontSize: '12px',
                    color: 'var(--color-text-tertiary)',
                  }}
                >
                  ▼
                </span>
              </div>

              {/* ---- Expanded Body ---- */}
              {isExpanded ? (
                <div className="opencode-prompts-agent-body" style={{ padding: '12px' }}>

                  {/* Active model textarea */}
                  {activeModel ? (
                    <div className="opencode-prompts-model-group" style={{ marginBottom: '12px' }}>
                      <label
                        style={{
                          display: 'block',
                          fontWeight: 600,
                          marginBottom: '4px',
                          fontSize: '12px',
                          textTransform: 'uppercase',
                          color: 'var(--color-text-secondary)',
                        }}
                      >
                        {activeModel}{' '}
                        <span style={{ fontWeight: 400, textTransform: 'none' }}>(active)</span>
                      </label>
                      <textarea
                        className="opencode-prompts-textarea"
                        value={agentDraftPrompts[activeModel] || ''}
                        onChange={e => updateDraft(agent, activeModel, e.target.value)}
                        rows={4}
                        style={{
                          width: '100%',
                          fontFamily: 'monospace',
                          fontSize: '12px',
                          padding: '6px',
                          borderRadius: '4px',
                          border: '1px solid var(--color-border)',
                          background: 'var(--color-bg-primary)',
                          color: 'var(--color-text-primary)',
                          resize: 'vertical',
                          boxSizing: 'border-box',
                        }}
                        data-testid={`opencode-prompts-textarea-${agent}-${activeModel}`}
                        placeholder="Enter custom system prompt for this model…"
                      />
                    </div>
                  ) : (
                    <p
                      style={{
                        fontSize: '12px',
                        color: 'var(--color-text-tertiary)',
                        fontStyle: 'italic',
                        marginBottom: '12px',
                      }}
                    >
                      No active model found for this agent.
                    </p>
                  )}

                  {/* Model-specific override textareas */}
                  {overrideModelIds.map(modelId => (
                    <div
                      key={modelId}
                      className="opencode-prompts-model-group"
                      style={{
                        marginBottom: '12px',
                        padding: '8px',
                        border: '1px dashed var(--color-border)',
                        borderRadius: '4px',
                        position: 'relative',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          marginBottom: '4px',
                        }}
                      >
                        <label
                          style={{
                            fontWeight: 600,
                            fontSize: '12px',
                            textTransform: 'uppercase',
                            color: 'var(--color-text-secondary)',
                          }}
                        >
                          {getModelDisplayName(modelId)}{' '}
                          <span style={{ fontWeight: 400, textTransform: 'none' }}>(override)</span>
                        </label>
                        <Button
                          variant="ghost"
                          size="sm"
                          testId={`opencode-prompts-remove-${agent}-${modelId}`}
                          onClick={() => removeModelOverride(agent, modelId)}
                        >
                          Remove
                        </Button>
                      </div>
                      <textarea
                        className="opencode-prompts-textarea"
                        value={agentDraftPrompts[modelId] || ''}
                        onChange={e => updateDraft(agent, modelId, e.target.value)}
                        rows={3}
                        style={{
                          width: '100%',
                          fontFamily: 'monospace',
                          fontSize: '12px',
                          padding: '6px',
                          borderRadius: '4px',
                          border: '1px solid var(--color-border)',
                          background: 'var(--color-bg-primary)',
                          color: 'var(--color-text-primary)',
                          resize: 'vertical',
                          boxSizing: 'border-box',
                        }}
                        data-testid={`opencode-prompts-textarea-${agent}-${modelId}`}
                        placeholder="Enter custom system prompt for this model override…"
                      />
                    </div>
                  ))}

                  {/* Add model override dropdown */}
                  {(() => {
                    const availableModels = getAvailableModels(agent);
                    if (availableModels.length === 0) return null;
                    return (
                      <div style={{ marginBottom: '12px' }}>
                        <select
                          className="opencode-prompts-model-select"
                          value=""
                          onChange={e => {
                            if (e.target.value) {
                              addModelOverride(agent, e.target.value);
                              // Reset the select element
                              const select = e.currentTarget;
                              select.value = '';
                            }
                          }}
                          style={{
                            fontSize: '12px',
                            padding: '4px 8px',
                            borderRadius: '4px',
                            border: '1px solid var(--color-border)',
                            background: 'var(--color-bg-primary)',
                            color: 'var(--color-text-secondary)',
                          }}
                          data-testid={`opencode-prompts-add-override-${agent}`}
                        >
                          <option value="">+ Add model override…</option>
                          {availableModels.map(m => (
                            <option key={m.id} value={m.id}>
                              {m.displayName} ({m.provider})
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  })()}

                  {/* Effective Prompt section */}
                  <div
                    className="opencode-prompts-effective"
                    style={{
                      borderTop: '1px solid var(--color-border)',
                      paddingTop: '8px',
                      marginTop: '4px',
                    }}
                  >
                    {/* Effective Prompt toggle header */}
                    <div
                      className="opencode-prompts-effective-header"
                      onClick={() => toggleEffective(agent)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        cursor: 'pointer',
                        fontSize: '12px',
                        fontWeight: 600,
                        color: 'var(--color-text-secondary)',
                        userSelect: 'none',
                      }}
                      data-testid={`opencode-prompts-effective-toggle-${agent}`}
                    >
                      <span
                        style={{
                          transform: effectiveExpanded.has(agent) ? 'rotate(90deg)' : 'rotate(0deg)',
                          transition: 'transform 0.2s',
                          fontSize: '10px',
                        }}
                      >
                        ▶
                      </span>
                      Effective Prompt
                    </div>

                    {/* Effective Prompt body */}
                    {effectiveExpanded.has(agent) ? (
                      <div className="opencode-prompts-effective-body" style={{ marginTop: '8px' }}>
                        {effectivePrompts[agent] ? (
                          effectivePrompts[agent]!.layers.length > 0 ? (
                            effectivePrompts[agent]!.layers.map((layer, idx) => (
                              <div
                                key={idx}
                                className="opencode-prompts-effective-layer"
                                style={{
                                  marginBottom: '8px',
                                  padding: '8px',
                                  background: 'var(--color-bg-tertiary)',
                                  borderRadius: '4px',
                                  border: '1px solid var(--color-border)',
                                }}
                              >
                                {/* Layer header */}
                                <div
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    marginBottom: '4px',
                                    flexWrap: 'wrap',
                                  }}
                                >
                                  <strong style={{ fontSize: '12px' }}>{layer.name}</strong>
                                  {layer.elegyManaged === true ? (
                                    <Badge tone="accent" testId={`opencode-prompts-elegy-managed-${agent}-${idx}`}>
                                      Elegy-managed
                                    </Badge>
                                  ) : null}
                                  {layer.elegyManaged === false ? (
                                    <Badge tone="neutral" testId={`opencode-prompts-manual-override-${agent}-${idx}`}>
                                      Manual override (not Elegy-managed)
                                    </Badge>
                                  ) : null}
                                </div>

                                {/* Layer source */}
                                <div
                                  style={{
                                    fontSize: '11px',
                                    color: 'var(--color-text-tertiary)',
                                    marginBottom: '4px',
                                  }}
                                >
                                  <code>{layer.source}</code>
                                </div>

                                {/* Layer content */}
                                {layer.missing ? (
                                  <p
                                    style={{
                                      fontSize: '12px',
                                      color: 'var(--color-danger)',
                                      fontStyle: 'italic',
                                      margin: 0,
                                    }}
                                  >
                                    (file not found)
                                  </p>
                                ) : layer.content !== null ? (
                                  <pre
                                    style={{
                                      fontSize: '11px',
                                      whiteSpace: 'pre-wrap',
                                      margin: 0,
                                      maxHeight: '120px',
                                      overflowY: 'auto',
                                      background: 'var(--color-bg-primary)',
                                      padding: '6px',
                                      borderRadius: '4px',
                                    }}
                                  >
                                    {layer.content}
                                  </pre>
                                ) : layer.note ? (
                                  <p
                                    style={{
                                      fontSize: '12px',
                                      color: 'var(--color-text-tertiary)',
                                      fontStyle: 'italic',
                                      margin: 0,
                                    }}
                                  >
                                    {layer.note}
                                  </p>
                                ) : null}
                              </div>
                            ))
                          ) : (
                            <p
                              style={{
                                fontSize: '12px',
                                color: 'var(--color-text-tertiary)',
                                fontStyle: 'italic',
                              }}
                            >
                              No effective prompt layers available.
                            </p>
                          )
                        ) : (
                          <p
                            style={{
                              fontSize: '12px',
                              color: 'var(--color-text-tertiary)',
                            }}
                            data-testid={`opencode-prompts-effective-loading-${agent}`}
                          >
                            Loading effective prompt…
                          </p>
                        )}
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}

        {/* Empty state */}
        {configuredCount === 0 ? (
          <p
            className="opencode-hint"
            data-testid="opencode-prompts-empty"
            style={{ marginTop: '16px', fontStyle: 'italic', color: 'var(--color-text-tertiary)' }}
          >
            No custom prompts configured. Agents are using their default system prompts.
          </p>
        ) : null}
      </Panel>
    </div>
  );
}

const SECTION_COMPONENTS: Partial<Record<OpenCodeTabSectionId, React.FC<SectionProps>>> = {
  overview: OverviewSection,
  lanes: LaneSection,
  profiles: ProfilesSection,
  logs: RequestLogSection,
  'go-workspaces': GoWorkspacesSection,
  permissions: PermissionsSection,
  experimental: ExperimentalSection,
  prompts: PromptsSection,
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
    <div className="view-shell opencode-settings-view" data-testid="opencode-settings-view">
      <div className="view-static">
        <Toolbar testId="opencode-settings-toolbar">
          <h2>OpenCode Workspace</h2>
        </Toolbar>
        <div className="workspace-nav" role="tablist" aria-label="OpenCode sections">
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
      </div>
      <div className="view-scroll opencode-settings-content" data-testid="opencode-settings-content">
        {state.loading && !state.status ? (
          <p className="opencode-loading state-message" data-testid="opencode-loading">Loading OpenCode workspace...</p>
        ) : null}

        {state.loading && state.status ? (
          <p className="state-message" data-testid="opencode-refreshing" style={{ opacity: 0.7, fontSize: '0.8rem' }}>Refreshing…</p>
        ) : null}

        {state.error ? (
          <p className="opencode-error" data-testid="opencode-error">{state.error}</p>
        ) : null}

        {state.message ? (
          <p className="opencode-message" data-testid="opencode-message">{state.message}</p>
        ) : null}

        {state.status && state.status.overallStatus && SectionComponent ? (
          <SectionComponent status={state.status} selectedLaneId={state.selectedLaneId} saving={state.saving} />
        ) : null}
      </div>
    </div>
  );
}
