import { useEffect, useMemo, useState } from 'react';
import { Button, FormInput, Panel, Toolbar } from '../../components';
import { humanizeToken, summarizeSdkHealth } from '../../lib/stateDiagnostics';
import { useStoreValue } from '../../lib/store';
import type { SessionSummary } from '../../lib/types';
import { sdkHealthStore } from '../../stores/sdkHealthStore';
import { gatewayStore } from '../Gateway/gatewayStore';
import { sandboxesStore } from '../Sandboxes/sandboxesStore';
import SessionDetail from './SessionDetail';
import SessionList from './SessionList';
import SdkMessageList from './SdkMessageList';
import { sdkSessionsStore } from './sdkSessionsStore';
import { sessionsStore } from './sessionsStore';

function isSessionActive(session: SessionSummary): boolean {
  if (typeof session.active === 'boolean') {
    return session.active;
  }

  const status = typeof session.resolvedStatus === 'string' ? session.resolvedStatus : session.status;
  return status === 'active';
}

export default function SessionsView({ preferredMode = 'local' }: { preferredMode?: 'local' | 'sdk' }) {
  const [mode, setMode] = useState<'local' | 'sdk'>(preferredMode);
  const [createModel, setCreateModel] = useState('');
  const [sandboxLaunchId, setSandboxLaunchId] = useState('');
  const [sandboxLaunching, setSandboxLaunching] = useState(false);
  const [sandboxLaunchStatus, setSandboxLaunchStatus] = useState<string | null>(null);
  const [sandboxLaunchError, setSandboxLaunchError] = useState<string | null>(null);
  const localSessionState = useStoreValue(sessionsStore);
  const sdkSessionState = useStoreValue(sdkSessionsStore);
  const sdkHealthState = useStoreValue(sdkHealthStore);
  const gatewayState = useStoreValue(gatewayStore);

  useEffect(() => {
    void sessionsStore.loadSessions();
    void gatewayStore.refreshState(false);

    return () => {
      sdkSessionsStore.dispose();
    };
  }, []);

  useEffect(() => {
    if (mode === 'sdk') {
      void sdkSessionsStore.loadSessions();
      return;
    }

    sdkSessionsStore.detachStream();
  }, [mode]);

  useEffect(() => {
    if (preferredMode !== mode) {
      setMode(preferredMode);
    }
  }, [mode, preferredMode]);

  const selectedSession =
    localSessionState.sessions.find((session) => session.id === localSessionState.selectedSessionId) ?? null;
  const activeCount = localSessionState.sessions.filter((session) => isSessionActive(session)).length;

  const selectedSdkSessionId = sdkSessionState.selectedSessionId;
  const selectedSdkMessages = selectedSdkSessionId
    ? (sdkSessionState.messagesBySession[selectedSdkSessionId] ?? [])
    : [];
  const pendingSdkMessage = selectedSdkSessionId
    ? (sdkSessionState.pendingBySession[selectedSdkSessionId] ?? { content: '', reasoning: '' })
    : { content: '', reasoning: '' };

  const selectedSdkSession = useMemo(
    () => sdkSessionState.sessions.find((session) => session.sessionId === selectedSdkSessionId) ?? null,
    [sdkSessionState.sessions, selectedSdkSessionId]
  );

  const modeError = mode === 'local' ? localSessionState.error : sdkSessionState.error;
  const sdkHealthSummary = summarizeSdkHealth(sdkHealthState.health, sdkHealthState.error);

  const trackerSegment =
    gatewayState.stateEnvelope?.tracker && typeof gatewayState.stateEnvelope.tracker === 'object'
      ? (gatewayState.stateEnvelope.tracker as Record<string, unknown>)
      : null;
  const trackerReason =
    trackerSegment?.error && typeof trackerSegment.error === 'object'
      ? (trackerSegment.error as Record<string, unknown>)
      : null;

  const localConnectionStatus = localSessionState.error
    ? 'Blocked'
    : localSessionState.loading
      ? 'Checking'
      : activeCount > 0
        ? 'Active'
        : 'Idle';
  const localConnectionDetail = localSessionState.error
    ? localSessionState.error
    : `${localSessionState.sessions.length} session(s), ${activeCount} active.`;

  const sandboxConnectionStatus = gatewayState.sandboxTokenMissing
    ? 'Blocked'
    : trackerSegment?.ready === true
      ? 'Connected'
      : humanizeToken(typeof trackerSegment?.status === 'string' ? trackerSegment.status : 'unknown');
  const sandboxConnectionDetail = gatewayState.sandboxTokenMissing
    ? (gatewayState.sandboxTokenGuidance || 'Tracker token is missing for sandbox lifecycle actions.')
    : (typeof trackerReason?.message === 'string' && trackerReason.message.trim()
      ? trackerReason.message
      : 'Sandbox lifecycle follows tracker readiness and token policy.');
  const sandboxLifecycleBlocked = gatewayState.sandboxTokenMissing;

  const handleRefresh = async () => {
    if (mode === 'local') {
      await sessionsStore.refresh();
      return;
    }

    await sdkSessionsStore.loadSessions();
  };

  const handleCreateSdkSession = async () => {
    await sdkSessionsStore.createSession(createModel);
    setCreateModel('');
  };

  const handleLaunchSandboxSdkSession = async () => {
    const normalizedSandboxId = sandboxLaunchId.trim();
    if (!normalizedSandboxId) {
      setSandboxLaunchError('Sandbox ID is required to launch an isolated SDK session.');
      setSandboxLaunchStatus(null);
      return;
    }

    setSandboxLaunching(true);
    setSandboxLaunchError(null);
    setSandboxLaunchStatus('Preparing sandbox...');
    sandboxesStore.setSandboxId(normalizedSandboxId);

    try {
      try {
        await sandboxesStore.createSandbox();
      } catch (error) {
        const createMessage = error instanceof Error ? error.message : String(error);
        if (!/already exists/i.test(createMessage)) {
          throw error;
        }
      }

      setSandboxLaunchStatus('Starting sandbox...');
      await sandboxesStore.startSandbox();

      setSandboxLaunchStatus('Creating isolated SDK session...');
      await sdkSessionsStore.createSession({
        model: createModel,
        contextType: 'sandbox',
        sandboxId: normalizedSandboxId,
      });

      setSandboxLaunchStatus(`Sandbox SDK session ready: ${normalizedSandboxId}`);
      setSandboxLaunchError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to launch sandbox SDK session.';
      setSandboxLaunchError(message);
      setSandboxLaunchStatus(null);
    } finally {
      setSandboxLaunching(false);
    }
  };

  const handleOpenSandboxTerminal = async () => {
    const normalizedSandboxId = sandboxLaunchId.trim();
    if (!normalizedSandboxId) {
      setSandboxLaunchError('Sandbox ID is required to open a sandbox terminal.');
      setSandboxLaunchStatus(null);
      return;
    }

    setSandboxLaunching(true);
    setSandboxLaunchError(null);
    setSandboxLaunchStatus('Opening sandbox terminal...');
    sandboxesStore.setSandboxId(normalizedSandboxId);

    try {
      await sandboxesStore.openSandboxTerminal();
      setSandboxLaunchStatus(`Sandbox terminal opened: ${normalizedSandboxId}`);
      setSandboxLaunchError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to open sandbox terminal.';
      setSandboxLaunchError(message);
      setSandboxLaunchStatus(null);
    } finally {
      setSandboxLaunching(false);
    }
  };

  const handleDeleteSdkSession = async () => {
    if (!selectedSdkSessionId) {
      return;
    }

    await sdkSessionsStore.removeSession(selectedSdkSessionId);
  };

  const handleSendSdkMessage = async () => {
    await sdkSessionsStore.sendPrompt();
  };

  return (
    <section className="sessions-view" data-testid="sessions-view">
      <Toolbar testId="sessions-view-toolbar">
        <div className="sessions-summary">
          <p className="sessions-title">{mode === 'local' ? 'Active Sessions' : 'SDK Sessions'}</p>
          <p className="sessions-copy">
            {mode === 'local'
              ? `${localSessionState.sessions.length} total, ${activeCount} active`
              : `${sdkSessionState.sessions.length} total, stream ${sdkSessionState.streamStatus}`}
          </p>
        </div>

        <div className="showcase-toolbar-group">
          <Button
            onClick={() => setMode('local')}
            testId="sessions-mode-local"
            variant={mode === 'local' ? 'primary' : 'ghost'}
          >
            Local
          </Button>
          <Button
            onClick={() => setMode('sdk')}
            testId="sessions-mode-sdk"
            variant={mode === 'sdk' ? 'primary' : 'ghost'}
          >
            SDK
          </Button>
          <Button
            disabled={mode === 'local' ? localSessionState.loading : sdkSessionState.loading}
            onClick={handleRefresh}
            testId="sessions-view-refresh"
            variant="secondary"
          >
            {(mode === 'local' ? localSessionState.loading : sdkSessionState.loading)
              ? 'Refreshing...'
              : 'Refresh'}
          </Button>
        </div>
      </Toolbar>

      <div className="sessions-connection-grid" data-testid="sessions-connection-grid">
        <article className="sessions-connection-card">
          <p className="sessions-connection-title">Local Sessions</p>
          <p className="sessions-connection-status">{localConnectionStatus}</p>
          <p className="sessions-connection-copy">{localConnectionDetail}</p>
        </article>

        <article className="sessions-connection-card">
          <p className="sessions-connection-title">SDK Bridge</p>
          <p className="sessions-connection-status">{sdkHealthSummary.status}</p>
          <p className="sessions-connection-copy">{sdkHealthSummary.detail}</p>
        </article>

        <article className="sessions-connection-card">
          <p className="sessions-connection-title">Sandbox Lifecycle</p>
          <p className="sessions-connection-status">{sandboxConnectionStatus}</p>
          <p className="sessions-connection-copy">{sandboxConnectionDetail}</p>
        </article>
      </div>

      {modeError ? (
        <p className="sessions-error" role="alert">
          {modeError}
        </p>
      ) : null}

      {mode === 'local' ? (
        <div className="sessions-grid">
          <Panel
            subtitle="Select a session to inspect details."
            testId="sessions-list-panel"
            title="Session List"
          >
            <SessionList
              error={localSessionState.error}
              loading={localSessionState.loading}
              onSelect={(id) => sessionsStore.selectSession(id)}
              selectedSessionId={localSessionState.selectedSessionId}
              sessions={localSessionState.sessions}
            />
          </Panel>

          <Panel
            subtitle="Core fields with metadata fallback."
            testId="session-detail-panel"
            title="Session Details"
          >
            <SessionDetail session={selectedSession} />
          </Panel>
        </div>
      ) : (
        <div className="sessions-grid">
          <Panel
            subtitle="Create, select, and stream SDK sessions."
            testId="sdk-sessions-list-panel"
            title="SDK Session List"
          >
            <div className="sessions-controls">
              <FormInput
                id="sdk-session-model"
                label="Model (optional)"
                onValueChange={setCreateModel}
                placeholder="gpt-5.3-codex"
                testId="sdk-session-model-input"
                value={createModel}
              />

              <div className="sessions-actions">
                <Button
                  disabled={sdkSessionState.creating}
                  onClick={handleCreateSdkSession}
                  testId="sdk-session-create"
                  variant="secondary"
                >
                  {sdkSessionState.creating ? 'Creating...' : 'Create Session'}
                </Button>
                <Button
                  disabled={!selectedSdkSessionId || sdkSessionState.deleting}
                  onClick={handleDeleteSdkSession}
                  testId="sdk-session-delete"
                  variant="danger"
                >
                  {sdkSessionState.deleting ? 'Deleting...' : 'Delete Selected'}
                </Button>
              </div>

              <FormInput
                id="sdk-sandbox-id"
                label="Sandbox ID (isolated SDK launch)"
                onValueChange={setSandboxLaunchId}
                placeholder="sb-..."
                testId="sdk-sandbox-id-input"
                value={sandboxLaunchId}
              />

              <div className="sessions-actions">
                <Button
                  disabled={sandboxLaunching || sdkSessionState.creating || sandboxLifecycleBlocked}
                  onClick={handleLaunchSandboxSdkSession}
                  testId="sdk-session-launch-sandbox"
                  variant="secondary"
                >
                  {sandboxLaunching ? 'Launching...' : 'Launch Sandbox Session'}
                </Button>
                <Button
                  disabled={sandboxLaunching || sandboxLifecycleBlocked}
                  onClick={handleOpenSandboxTerminal}
                  testId="sdk-session-open-sandbox-terminal"
                  variant="ghost"
                >
                  Open Sandbox Terminal
                </Button>
              </div>

              {sandboxLifecycleBlocked ? (
                <p className="sessions-error">
                  Sandbox launch blocked: {sandboxConnectionDetail}
                </p>
              ) : null}

              {sandboxLaunchStatus ? <p className="sessions-copy">{sandboxLaunchStatus}</p> : null}
              {sandboxLaunchError ? (
                <p className="sessions-error" role="alert">
                  {sandboxLaunchError}
                </p>
              ) : null}

              {sdkSessionState.sessions.length === 0 ? (
                <p className="state-message">No SDK sessions available.</p>
              ) : (
                <ul className="tracker-session-list">
                  {sdkSessionState.sessions.map((session) => {
                    const isSelected = selectedSdkSessionId === session.sessionId;
                    return (
                      <li className={isSelected ? 'is-selected' : ''} key={session.sessionId}>
                        <div>
                          <p className="tracker-item-title">{session.sessionId}</p>
                          <p className="tracker-item-copy">
                            {session.model || '(default model)'}
                            {' | '}
                            {session.contextType || 'regular'}
                            {session.sandboxId ? `:${session.sandboxId}` : ''}
                            {' | '}
                            sse clients={session.sseClientCount ?? 0}
                          </p>
                        </div>
                        <div className="tracker-item-actions">
                          <Button
                            onClick={() => sdkSessionsStore.selectSession(session.sessionId)}
                            size="sm"
                            testId={`sdk-session-select-${session.sessionId}`}
                            variant={isSelected ? 'primary' : 'ghost'}
                          >
                            {isSelected ? 'Selected' : 'Select'}
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </Panel>

          <Panel
            subtitle="Message stream with delta accumulation and reasoning details."
            testId="sdk-session-messages-panel"
            title="SDK Messages"
          >
            <p className="sessions-stream-status">
              Stream: <strong>{sdkSessionState.streamStatus}</strong>
              {sdkSessionState.streamError ? ` (${sdkSessionState.streamError})` : ''}
            </p>

            <p className="sessions-copy">
              Selected session: {selectedSdkSession?.sessionId || '(none)'}
              {selectedSdkSession?.contextType
                ? ` (${selectedSdkSession.contextType}${selectedSdkSession.sandboxId ? `:${selectedSdkSession.sandboxId}` : ''})`
                : ''}
            </p>

            <SdkMessageList
              messages={selectedSdkMessages}
              pendingContent={pendingSdkMessage.content}
              pendingReasoning={pendingSdkMessage.reasoning}
              streamStatus={sdkSessionState.streamStatus}
            />

            <label className="form-input" htmlFor="sdk-session-prompt">
              <span className="form-label">Prompt</span>
              <textarea
                data-testid="sdk-session-prompt"
                id="sdk-session-prompt"
                onChange={(event) => sdkSessionsStore.setComposerPrompt(event.target.value)}
                placeholder="Ask the SDK session..."
                rows={5}
                value={sdkSessionState.composerPrompt}
              />
            </label>

            <div className="sessions-actions">
              <Button
                disabled={
                  !selectedSdkSessionId
                  || sdkSessionState.sending
                  || sdkSessionState.composerPrompt.trim().length === 0
                }
                onClick={handleSendSdkMessage}
                testId="sdk-session-send"
              >
                {sdkSessionState.sending ? 'Sending...' : 'Send'}
              </Button>
            </div>
          </Panel>
        </div>
      )}
    </section>
  );
}
