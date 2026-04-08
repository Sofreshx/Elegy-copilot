import { useEffect } from 'react';
import { Button, FormInput, Panel, StatusBadge, Toolbar } from '../../components';
import { SANDBOX_TOKEN_REMEDIATION_GUIDANCE } from '../../lib/api';
import { useStoreValue } from '../../lib/store';
import type { ExecutorWorktreeRecord, SessionSummary } from '../../lib/types';
import { gatewayStore } from '../Gateway/gatewayStore';
import { readSandboxId, sandboxesStore } from './sandboxesStore';

interface SandboxesViewProps {
  onFollowSessions?: (sessionId: string) => void;
}

function readSessionStatus(session: SessionSummary): string {
  const record = session as Record<string, unknown>;
  const resolvedStatus =
    typeof record.resolvedStatus === 'string' && record.resolvedStatus.trim()
      ? record.resolvedStatus
      : typeof record.status === 'string' && record.status.trim()
        ? record.status
        : 'unknown';

  return resolvedStatus;
}

function readWorktreeStatus(worktree: ExecutorWorktreeRecord): string {
  if (typeof worktree.status === 'string' && worktree.status.trim()) {
    return worktree.status;
  }
  if (typeof worktree.mode === 'string' && worktree.mode.trim()) {
    return worktree.mode;
  }
  return 'unknown';
}

export default function SandboxesView({ onFollowSessions }: SandboxesViewProps) {
  const sandboxState = useStoreValue(sandboxesStore);
  const gatewayState = useStoreValue(gatewayStore);

  useEffect(() => {
    void sandboxesStore.loadSandboxes();
  }, []);

  const handleRefresh = async () => {
    await sandboxesStore.refresh();
  };

  const runAction = async (action: () => Promise<void>) => {
    try {
      await action();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to run sandbox action.';
      sandboxesStore.setStatusMessage(message);
    }
  };

  const handleFollow = async (sandboxId: string) => {
    try {
      const match = await sandboxesStore.followSandboxSession(sandboxId);
      onFollowSessions?.(match.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to follow sandbox session.';
      sandboxesStore.setStatusMessage(message);
    }
  };

  const activeCount = sandboxState.sandboxes.filter((session) => {
    return readSessionStatus(session).toLowerCase() === 'active';
  }).length;

  const lifecycleBlockedByToken = sandboxState.tokenMissingBlocked || gatewayState.sandboxTokenMissing;
  const lifecycleBlockedMessage =
    sandboxState.tokenMissingMessage
    || gatewayState.sandboxTokenGuidance
    || SANDBOX_TOKEN_REMEDIATION_GUIDANCE;

  return (
    <section className="sandboxes-view" data-testid="sandboxes-view">
      <Toolbar testId="sandboxes-view-toolbar">
        <div className="sandboxes-summary">
          <p className="sandboxes-title">Sandbox Lifecycle</p>
          <p className="sandboxes-copy">
            {sandboxState.sandboxes.length} discovered, {activeCount} active
          </p>
        </div>
        <Button
          disabled={sandboxState.loading || sandboxState.actionLoading}
          onClick={handleRefresh}
          testId="sandboxes-view-refresh"
          variant="secondary"
        >
          {sandboxState.loading ? 'Refreshing...' : 'Refresh'}
        </Button>
      </Toolbar>

      {sandboxState.error ? (
        <p className="sandboxes-error" role="alert">
          {sandboxState.error}
        </p>
      ) : null}

      {lifecycleBlockedByToken ? (
        <p className="sandboxes-error" data-testid="sandbox-token-remediation" role="alert">
          Sandbox lifecycle actions are disabled until tracker auth is configured. {lifecycleBlockedMessage}
        </p>
      ) : null}

      {sandboxState.statusMessage ? <p className="sandboxes-status">{sandboxState.statusMessage}</p> : null}

      <div className="sandboxes-grid">
        <Panel
          subtitle="Manual lifecycle controls. No automatic destructive actions."
          testId="sandboxes-controls-panel"
          title="Sandbox Controls"
        >
          <div className="sandboxes-controls">
            <FormInput
              id="sandbox-id"
              label="Sandbox ID"
              onValueChange={(value) => sandboxesStore.setSandboxId(value)}
              placeholder="sb-..."
              testId="sandbox-id-input"
              value={sandboxState.sandboxId}
            />

            <div className="sandboxes-branch-grid">
              <FormInput
                id="sandbox-base-branch"
                label="Base Branch"
                onValueChange={(value) => sandboxesStore.setBaseBranch(value)}
                placeholder="main"
                testId="sandbox-base-branch-input"
                value={sandboxState.baseBranch}
              />
              <FormInput
                id="sandbox-head-branch"
                label="Head Branch"
                onValueChange={(value) => sandboxesStore.setHeadBranch(value)}
                placeholder="feature/my-change"
                testId="sandbox-head-branch-input"
                value={sandboxState.headBranch}
              />
            </div>

            <div className="sandboxes-actions">
              <Button
                disabled={sandboxState.actionLoading || lifecycleBlockedByToken}
                onClick={() => runAction(() => sandboxesStore.createSandbox())}
                testId="sandbox-create-button"
              >
                Create
              </Button>
              <Button
                disabled={sandboxState.actionLoading || lifecycleBlockedByToken}
                onClick={() => runAction(() => sandboxesStore.startSandbox())}
                testId="sandbox-start-button"
                variant="secondary"
              >
                Start
              </Button>
              <Button
                disabled={sandboxState.actionLoading || lifecycleBlockedByToken}
                onClick={() => runAction(() => sandboxesStore.stopSandbox())}
                testId="sandbox-stop-button"
                variant="secondary"
              >
                Stop
              </Button>
              <Button
                disabled={sandboxState.actionLoading || lifecycleBlockedByToken}
                onClick={() => runAction(() => sandboxesStore.openSandboxTerminal())}
                testId="sandbox-open-terminal-button"
                variant="ghost"
              >
                Open Terminal
              </Button>
              <Button
                disabled={sandboxState.actionLoading || lifecycleBlockedByToken}
                onClick={() => runAction(() => sandboxesStore.openSandboxPullRequest())}
                testId="sandbox-open-pr-button"
                variant="ghost"
              >
                Open PR
              </Button>
              <Button
                disabled={sandboxState.actionLoading}
                onClick={() => {
                  void handleFollow(sandboxState.sandboxId);
                }}
                testId="sandbox-follow-button"
                variant="secondary"
              >
                Follow In Runtime
              </Button>
            </div>

            {sandboxState.actionLoading ? (
              <p className="state-message">Running {sandboxState.currentAction ?? 'sandbox action'}...</p>
            ) : null}
          </div>
        </Panel>

        <Panel
          subtitle="App-level sandbox sessions from /api/sessions?source=sandbox. These are not in-session sub-actors."
          testId="sandboxes-list-panel"
          title="Sandbox Sessions"
        >
          {sandboxState.loading && sandboxState.sandboxes.length === 0 ? (
            <p className="state-message">Loading sandbox sessions...</p>
          ) : null}

          {!sandboxState.loading && sandboxState.sandboxes.length === 0 ? (
            <p className="state-message">No sandbox sessions were returned.</p>
          ) : null}

          {sandboxState.sandboxes.length > 0 ? (
            <ul className="sandbox-session-list">
              {sandboxState.sandboxes.map((session) => {
                const sandboxId = readSandboxId(session);
                const selected = sandboxId === sandboxState.sandboxId;

                return (
                  <li className={selected ? 'is-selected' : ''} key={session.id}>
                    <div>
                      <p className="sandbox-item-title">{sandboxId || '(unknown sandbox)'}</p>
                        <p className="sandbox-item-copy">
                          <code>{session.id}</code> | worktree context follows the parent sandbox session
                        </p>
                    </div>
                    <div className="sandbox-item-actions">
                      <StatusBadge status={readSessionStatus(session)} testId="sandbox-session-status" />
                      <Button
                        onClick={() => sandboxesStore.setSandboxId(sandboxId)}
                        size="sm"
                        testId="sandbox-use-id-button"
                        variant="ghost"
                      >
                        Use ID
                      </Button>
                      <Button
                        onClick={() => {
                          void handleFollow(sandboxId);
                        }}
                        size="sm"
                        testId="sandbox-list-follow-button"
                        variant="secondary"
                      >
                        Follow
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </Panel>

        <Panel
          subtitle="Dedicated same-repo worktree reservations and recovery state from /api/executor/worktrees. Worktrees isolate parallel writable app sessions, not sub-actors."
          testId="sandboxes-worktrees-panel"
          title="Worktree Isolation"
        >
          {sandboxState.worktreesError ? (
            <p className="sandboxes-error" role="alert">
              {sandboxState.worktreesError}
            </p>
          ) : null}

          {!sandboxState.loading && sandboxState.worktrees.length === 0 ? (
            <p className="state-message">No dedicated worktree reservations were returned.</p>
          ) : null}

          {sandboxState.worktrees.length > 0 ? (
            <ul className="sandbox-session-list">
              {sandboxState.worktrees.map((worktree) => {
                const pathValue =
                  typeof worktree.path === 'string' && worktree.path.trim()
                    ? worktree.path
                    : typeof worktree.worktreePath === 'string' && worktree.worktreePath.trim()
                      ? worktree.worktreePath
                      : '(path pending)';
                const blocked =
                  worktree.launchBlocked
                  || (worktree.launch && worktree.launch.blocked)
                  || false;
                const blockedReason =
                  worktree.launchBlockedReason
                  || (worktree.launch && worktree.launch.reason)
                  || null;

                return (
                  <li key={worktree.worktreeId || `${worktree.repoId}:${pathValue}`}>
                    <div>
                      <p className="sandbox-item-title">{worktree.worktreeId || '(unassigned worktree)'}</p>
                      <p className="sandbox-item-copy">
                        <code>{pathValue}</code>
                      </p>
                      {blocked && blockedReason ? (
                        <p className="sandbox-item-copy">{blockedReason}</p>
                      ) : null}
                    </div>
                    <div className="sandbox-item-actions">
                      <StatusBadge status={readWorktreeStatus(worktree)} testId="sandbox-worktree-status" />
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </Panel>
      </div>
    </section>
  );
}
