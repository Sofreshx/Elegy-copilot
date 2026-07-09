import { useEffect, useState } from 'react';
import { Button, HealthDot, Panel } from '../../components';
import { getDesktopUpdaterPresentation } from '../../lib/desktopUpdaterPresentation';
import { useStoreValue } from '../../lib/store';
import { cliToolingStore } from '../../stores/cliToolingStore';
import { desktopUpdaterStore } from '../../stores/desktopUpdaterStore';
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
  const isInstalling = updaterState.status === 'downloading';
  const canCheck = updaterState.canCheckForUpdates
    && !updaterState.canDownload
    && updaterState.status !== 'checking'
    && !isInstalling;

  return (
    <Panel
      title="App Update"
      subtitle="Tauri desktop application"
      testId="updates-app-card"
      actions={
        <>
          {canCheck ? (
            <Button
              variant="secondary"
              size="sm"
              testId="updates-app-check"
              onClick={() => void desktopUpdaterStore.checkForUpdates()}
            >
              Check
            </Button>
          ) : null}
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
          {isInstalling ? (
            <Button
              variant="primary"
              size="sm"
              testId="updates-app-installing"
              disabled
            >
              Installing...
            </Button>
          ) : null}
          {updaterState.canRestartToUpdate ? (
            <Button
              variant="primary"
              size="sm"
              testId="updates-app-restart"
              onClick={() => void desktopUpdaterStore.restartToUpdate()}
            >
              Relaunch
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
        ? planning.features?.complete === false
          ? `Update required (${planning.features.missing.length} missing feature${planning.features.missing.length === 1 ? '' : 's'})`
          : planning.managedSource?.updateAvailable
            ? 'Managed GitHub source is newer'
            : `Update available (${planning.latestVersion ?? 'latest'})`
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
          <dt>Feature Surface</dt>
          <dd data-testid="updates-elegy-planning-features">
            {planning?.features?.complete
              ? 'complete'
              : planning?.features?.missing?.length
                ? `missing ${planning.features.missing.join(', ')}`
                : 'unknown'}
          </dd>
          <dt>Managed Source</dt>
          <dd data-testid="updates-elegy-planning-source">
            {planning?.managedSource?.repoRoot
              ? planning.managedSource.updateAvailable
                ? 'newer GitHub source available'
                : planning.managedSource.kind === 'github-source'
                  ? 'GitHub source tracked'
                  : 'source tracked'
              : 'not detected'}
          </dd>
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
          <dt>Source</dt>
          <dd data-testid="updates-elegy-skills-source">
            {skills?.source === 'github-source'
              ? skills.managedSource?.updateAvailable
                ? 'newer GitHub source available'
                : 'GitHub source tracked'
              : 'not detected'}
          </dd>
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

function CliToolingCard({ tool, installing }: { tool: import('../../lib/types').CliToolingTool; installing: boolean }) {
  const tone = tool.installed ? 'ok' : tool.lastError ? 'error' : 'warn';
  const summary = tool.installed
    ? `Installed${tool.version ? ` (${tool.version})` : ''}`
    : tool.lastError
      ? tool.lastError
      : 'Not installed';

  return (
    <Panel
      title={tool.title || tool.id}
      subtitle={tool.path || 'npm package'}
      testId={`updates-cli-${tool.id}-card`}
      actions={
        <>
          {!tool.installed ? (
            <Button
              variant="primary"
              size="sm"
              testId={`updates-cli-${tool.id}-install`}
              onClick={() => void cliToolingStore.install(tool.id)}
              disabled={installing}
            >
              {installing ? 'Installing…' : 'Install'}
            </Button>
          ) : null}
        </>
      }
    >
      <div className="updates-card-body">
        <HealthDot tone={tone} label={summary} testId={`updates-cli-${tool.id}-health`} />
        <dl className="updates-card-details">
          <dt>Version</dt>
          <dd data-testid={`updates-cli-${tool.id}-version`}>{tool.version || 'not detected'}</dd>
          <dt>Package</dt>
          <dd data-testid={`updates-cli-${tool.id}-path`}>{tool.path || 'unknown'}</dd>
        </dl>
        {tool.lastError && tool.installed ? null : tool.lastError ? (
          <p className="updates-card-message updates-card-error" data-testid={`updates-cli-${tool.id}-error`}>
            {tool.lastError}
          </p>
        ) : null}
      </div>
    </Panel>
  );
}

function CliToolingSection() {
  const { status, loading, installing, error } = useStoreValue(cliToolingStore);

  useEffect(() => {
    void cliToolingStore.refresh();
  }, []);

  if (loading && !status) {
    return (
      <div className="updates-section-loading" data-testid="updates-cli-section-loading">
        Loading CLI tooling status…
      </div>
    );
  }

  const tools = (status?.tools && Array.isArray(status.tools)) ? status.tools : [];

  return (
    <div className="updates-section" data-testid="updates-cli-section">
      {error ? (
        <div className="updates-section-error" data-testid="updates-cli-error">
          {error}
        </div>
      ) : null}
      {tools.map((tool) => (
        <CliToolingCard
          key={tool.id}
          tool={tool}
          installing={installing?.[tool.id] || false}
        />
      ))}
    </div>
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
      <ElegyPlanningUpdateCard />
      <ElegySkillsUpdateCard />
      <CliToolingSection />
    </div>
  );
}
