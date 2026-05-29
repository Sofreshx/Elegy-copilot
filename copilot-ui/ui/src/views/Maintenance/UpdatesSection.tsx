import { useEffect, useState } from 'react';
import { Button, HealthDot, Panel } from '../../components';
import { getDesktopUpdaterPresentation } from '../../lib/desktopUpdaterPresentation';
import { useStoreValue } from '../../lib/store';
import { desktopUpdaterStore } from '../../stores/desktopUpdaterStore';
import { sdkHealthStore } from '../../stores/sdkHealthStore';
import { toolingUpdatesStore } from '../../stores/toolingUpdatesStore';

interface ActiveSessionWarningProps {
  count: number;
}

function ActiveSessionWarning({ count }: ActiveSessionWarningProps) {
  if (count <= 0) return null;

  return (
    <div className="updates-session-warning" data-testid="updates-session-warning">
      ⚠ {count} active session{count !== 1 ? 's' : ''} — updates may require restart
    </div>
  );
}

function AppUpdateCard() {
  const updaterState = useStoreValue(desktopUpdaterStore);
  const presentation = getDesktopUpdaterPresentation(updaterState);

  return (
    <Panel
      title="App Update"
      subtitle="Tauri desktop application"
      testId="updates-app-card"
      actions={
        <>
          {updaterState.canDownload ? (
            <Button
              variant="primary"
              size="sm"
              testId="updates-app-download"
              onClick={() => void desktopUpdaterStore.downloadUpdate()}
            >
              Update
            </Button>
          ) : null}
          {updaterState.canRestartToUpdate ? (
            <Button
              variant="primary"
              size="sm"
              testId="updates-app-restart"
              onClick={() => void desktopUpdaterStore.restartToUpdate()}
            >
              Restart to Update
            </Button>
          ) : null}
        </>
      }
    >
      <div className="updates-card-body">
        <HealthDot tone={presentation.tone} label={presentation.summary} testId="updates-app-health" />
        <dl className="updates-card-details">
          <dt>Current Version</dt>
          <dd data-testid="updates-app-current-version">{updaterState.currentVersion}</dd>
          {updaterState.availableVersion ? (
            <>
              <dt>Available Version</dt>
              <dd data-testid="updates-app-available-version">{updaterState.availableVersion}</dd>
            </>
          ) : null}
          <dt>Channel</dt>
          <dd data-testid="updates-app-channel">{updaterState.channel}</dd>
          <dt>Status</dt>
          <dd data-testid="updates-app-status">{updaterState.status}</dd>
        </dl>
        {updaterState.message ? (
          <p className="updates-card-message" data-testid="updates-app-message">{updaterState.message}</p>
        ) : null}
      </div>
    </Panel>
  );
}

function SdkUpdateCard() {
  const { health, loading, error } = useStoreValue(sdkHealthStore);

  const tone = error ? 'error' : loading ? 'loading' : health?.connected ? 'ok' : 'warn';

  return (
    <Panel
      title="SDK Bridge"
      subtitle="SDK connection health"
      testId="updates-sdk-card"
      actions={
        <Button
          variant="secondary"
          size="sm"
          testId="updates-sdk-refresh"
          onClick={() => void sdkHealthStore.refresh()}
        >
          Refresh
        </Button>
      }
    >
      <div className="updates-card-body">
        <HealthDot
          tone={tone}
          label={error || (health?.connected ? 'Connected' : 'Disconnected')}
          testId="updates-sdk-health"
        />
        <dl className="updates-card-details">
          <dt>Connection</dt>
          <dd data-testid="updates-sdk-connected">{health?.connected ? 'Connected' : 'Disconnected'}</dd>
          <dt>State</dt>
          <dd data-testid="updates-sdk-state">{health?.state ?? 'unknown'}</dd>
          {health?.cliVersion ? (
            <>
              <dt>SDK Version</dt>
              <dd data-testid="updates-sdk-version">{health.cliVersion}</dd>
            </>
          ) : null}
        </dl>
        {error ? (
          <p className="updates-card-message updates-card-error" data-testid="updates-sdk-error">{error}</p>
        ) : null}
      </div>
    </Panel>
  );
}

function CliUpdateCard() {
  const { health, loading, error } = useStoreValue(sdkHealthStore);
  const cli = health?.cliManager ?? null;

  const tone = error
    ? 'error'
    : loading
      ? 'loading'
      : cli?.approved
        ? 'ok'
        : cli?.approved === false
          ? 'warn'
          : 'loading';

  return (
    <Panel
      title="CLI Manager"
      subtitle="Managed Copilot CLI"
      testId="updates-cli-card"
      actions={
        <Button
          variant="secondary"
          size="sm"
          testId="updates-cli-refresh"
          onClick={() => void sdkHealthStore.refresh()}
        >
          Refresh
        </Button>
      }
    >
      <div className="updates-card-body">
        <HealthDot
          tone={tone}
          label={cli?.status ?? (loading ? 'Checking…' : 'Unknown')}
          testId="updates-cli-health"
        />
        <dl className="updates-card-details">
          {cli?.cliVersion ? (
            <>
              <dt>CLI Version</dt>
              <dd data-testid="updates-cli-version">{cli.cliVersion}</dd>
            </>
          ) : null}
          <dt>Approved</dt>
          <dd data-testid="updates-cli-approved">{cli?.approved == null ? '—' : cli.approved ? 'Yes' : 'No'}</dd>
          {cli?.status ? (
            <>
              <dt>Status</dt>
              <dd data-testid="updates-cli-status">{cli.status}</dd>
            </>
          ) : null}
        </dl>
        {cli?.message ? (
          <p className="updates-card-message" data-testid="updates-cli-message">{cli.message}</p>
        ) : null}
        {error ? (
          <p className="updates-card-message updates-card-error" data-testid="updates-cli-error">{error}</p>
        ) : null}
      </div>
    </Panel>
  );
}

function ElegyPlanningUpdateCard() {
  const { status, checking, updatingPlanning, error } = useStoreValue(toolingUpdatesStore);
  const planning = status?.elegyPlanningCli ?? null;
  const tone = error
    ? 'error'
    : checking || updatingPlanning
      ? 'loading'
      : planning?.updateAvailable
        ? 'warn'
        : 'ok';
  const summary = error
    ? error
    : checking || updatingPlanning
      ? 'Checking for updates…'
      : planning?.updateAvailable
        ? `Update available (${planning.latestVersion ?? 'latest'})`
        : 'Up to date';

  return (
    <Panel
      title="Elegy Planning"
      subtitle="elegy-planning CLI"
      testId="updates-elegy-planning-card"
      actions={
        <>
          <Button
            variant="secondary"
            size="sm"
            testId="updates-elegy-planning-check"
            onClick={() => void toolingUpdatesStore.checkNow()}
          >
            Check
          </Button>
          {planning?.canUpdate && planning.updateAvailable ? (
            <Button
              variant="primary"
              size="sm"
              testId="updates-elegy-planning-update"
              onClick={() => void toolingUpdatesStore.updatePlanning()}
              disabled={updatingPlanning}
            >
              {updatingPlanning ? 'Updating…' : 'Update'}
            </Button>
          ) : null}
        </>
      }
    >
      <div className="updates-card-body">
        <HealthDot tone={tone} label={summary} testId="updates-elegy-planning-health" />
        <dl className="updates-card-details">
          <dt>Current Version</dt>
          <dd data-testid="updates-elegy-planning-current">{planning?.currentVersion ?? 'unknown'}</dd>
          <dt>Latest Version</dt>
          <dd data-testid="updates-elegy-planning-latest">{planning?.latestVersion ?? 'unknown'}</dd>
          <dt>CLI Path</dt>
          <dd data-testid="updates-elegy-planning-path">{planning?.cliPath ?? 'not detected'}</dd>
        </dl>
        {planning?.lastError ? (
          <p className="updates-card-message updates-card-error" data-testid="updates-elegy-planning-error">
            {planning.lastError}
          </p>
        ) : null}
      </div>
    </Panel>
  );
}

function ElegySkillsUpdateCard() {
  const { status, checking, updatingSkills, error } = useStoreValue(toolingUpdatesStore);
  const skills = status?.elegySkillsAssets ?? null;
  const tone = error
    ? 'error'
    : checking || updatingSkills
      ? 'loading'
      : skills?.updateAvailable
        ? 'warn'
        : 'ok';
  const summary = error
    ? error
    : checking || updatingSkills
      ? 'Checking skill assets…'
      : skills?.updateAvailable
        ? `${skills.outdatedCount} asset${skills.outdatedCount === 1 ? '' : 's'} outdated`
        : 'All tracked assets are up to date';

  return (
    <Panel
      title="Elegy Skills"
      subtitle="Managed shared skills"
      testId="updates-elegy-skills-card"
      actions={
        <>
          <Button
            variant="secondary"
            size="sm"
            testId="updates-elegy-skills-check"
            onClick={() => void toolingUpdatesStore.checkNow()}
          >
            Check
          </Button>
          {skills?.canUpdate && skills.updateAvailable ? (
            <Button
              variant="primary"
              size="sm"
              testId="updates-elegy-skills-update"
              onClick={() => void toolingUpdatesStore.updateSkills()}
              disabled={updatingSkills}
            >
              {updatingSkills ? 'Updating…' : 'Update'}
            </Button>
          ) : null}
        </>
      }
    >
      <div className="updates-card-body">
        <HealthDot tone={tone} label={summary} testId="updates-elegy-skills-health" />
        <dl className="updates-card-details">
          <dt>Tracked Assets</dt>
          <dd data-testid="updates-elegy-skills-tracked">{skills?.trackedCount ?? 0}</dd>
          <dt>Outdated Assets</dt>
          <dd data-testid="updates-elegy-skills-outdated">{skills?.outdatedCount ?? 0}</dd>
          <dt>Checked</dt>
          <dd data-testid="updates-elegy-skills-checked">
            {status?.checkedAtMs ? new Date(status.checkedAtMs).toLocaleString() : 'never'}
          </dd>
        </dl>
        {skills?.lastError ? (
          <p className="updates-card-message updates-card-error" data-testid="updates-elegy-skills-error">
            {skills.lastError}
          </p>
        ) : null}
      </div>
    </Panel>
  );
}

export default function UpdatesSection() {
  const [activeSessionCount, setActiveSessionCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function fetchSessions() {
      try {
        const res = await fetch('/api/dashboard/summary');
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && typeof data.activeSessionCount === 'number') {
          setActiveSessionCount(data.activeSessionCount);
        }
      } catch {
        // API not available — ignore
      }
    }

    void fetchSessions();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="updates-section" data-testid="updates-section">
      <ActiveSessionWarning count={activeSessionCount} />
      <AppUpdateCard />
      <SdkUpdateCard />
      <CliUpdateCard />
      <ElegyPlanningUpdateCard />
      <ElegySkillsUpdateCard />
    </div>
  );
}
