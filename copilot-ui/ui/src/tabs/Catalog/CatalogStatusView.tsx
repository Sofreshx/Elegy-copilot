import { useEffect, useMemo, useState } from 'react';
import { Button, FormInput, Panel, StatusBadge, Toolbar } from '../../components';
import { getInstalledAssets } from '../../lib/api';
import { useStoreValue } from '../../lib/store';
import type {
  CatalogExternalSourceInstallable,
  CatalogExternalSourceProjection,
  InstallSurfaceTarget,
  InstalledAssetsResponse,
  SessionSkillUsageEntry,
  SkillPreviewItem,
} from '../../lib/types';
import { catalogWorkspaceStore } from '../Assets/catalogWorkspaceStore';
import { skillsPreviewStore } from '../SkillsPreview/skillsPreviewStore';
import { statsStore, type StatsSessionUsageSample } from '../Stats/statsStore';

type ExternalTargetDetails = {
  enabled: boolean;
  installed: boolean;
  installedPath: string | null;
  managedName: string | null;
};

type CountEntry = {
  label: string;
  count: number;
  detail?: string;
};

type InstalledInventoryState = {
  loading: boolean;
  error: string | null;
  inventory: InstalledAssetsResponse;
};

const EMPTY_INSTALLED_INVENTORY: InstalledAssetsResponse = {
  agents: [],
  skills: [],
  prompts: [],
  instructions: {
    installed: false,
    absPath: '',
  },
};

const INSTALL_SURFACE_CARDS: Array<{
  target: InstallSurfaceTarget;
  title: string;
  description: string;
}> = [
  {
    target: 'codex',
    title: 'Codex',
    description: 'Native Codex instructions, agents, and shared skills.',
  },
  {
    target: 'antigravity',
    title: 'Antigravity',
    description: 'Managed Antigravity/Gemini skills and GEMINI.md block.',
  },
  {
    target: 'opencode',
    title: 'OpenCode',
    description: 'Global OpenCode AGENTS and curated skills.',
  },
];

function formatTimestamp(value: string | null | undefined): string {
  if (!value) {
    return 'never';
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : value;
}

function formatHarnessList(targets: string[]): string {
  return targets.length > 0 ? targets.map((target) => getExternalTargetLabel(target)).join(', ') : 'none';
}

function getExternalTargetLabel(target: string): string {
  switch (target) {
    case 'codex':
      return 'Codex';
    case 'opencode':
      return 'OpenCode';
    case 'antigravity':
      return 'Antigravity';
    case 'gemini-cli':
      return 'Gemini CLI';
    default:
      return target;
  }
}

function readExternalInstallableTargets(installable: CatalogExternalSourceInstallable | null | undefined): string[] {
  return Array.isArray(installable?.targetSupport)
    ? installable.targetSupport
      .filter((target): target is string => typeof target === 'string' && target.trim().length > 0)
      .map((target) => target.trim())
      .filter((target) => target !== 'copilot')
    : [];
}

function readExternalInstallableTargetDetails(
  source: CatalogExternalSourceProjection | null | undefined,
  installableId: string,
  target: string,
): ExternalTargetDetails {
  const activation = source?.activation && typeof source.activation === 'object'
    ? source.activation
    : {};
  const targetState = activation[target] && typeof activation[target] === 'object'
    ? activation[target]
    : {};
  const installables = targetState.installables && typeof targetState.installables === 'object'
    ? targetState.installables as Record<string, Record<string, unknown>>
    : {};
  const state = installables[installableId] && typeof installables[installableId] === 'object'
    ? installables[installableId]
    : {};

  return {
    enabled: state.enabled === true,
    installed: state.installed === true,
    installedPath:
      typeof state.installedPath === 'string' && state.installedPath.trim() ? state.installedPath.trim() : null,
    managedName:
      typeof state.managedName === 'string' && state.managedName.trim() ? state.managedName.trim() : null,
  };
}

function countExternalSourceActiveTargets(source: CatalogExternalSourceProjection | null | undefined): number {
  if (!source?.activation || typeof source.activation !== 'object') {
    return 0;
  }

  let count = 0;
  for (const targetState of Object.values(source.activation)) {
    if (!targetState || typeof targetState !== 'object') {
      continue;
    }
    const installables = targetState.installables && typeof targetState.installables === 'object'
      ? Object.values(targetState.installables as Record<string, Record<string, unknown>>)
      : [];
    if (installables.some((entry) => entry?.enabled === true)) {
      count += 1;
    }
  }
  return count;
}

function countVisibleExternalInstallables(source: CatalogExternalSourceProjection | null | undefined): number {
  return Array.isArray(source?.installables)
    ? source.installables.filter((installable) => installable.hiddenByDefault !== true).length
    : 0;
}

function providerLabel(skill: SkillPreviewItem): string {
  const segments: string[] = [];
  if (skill.sourcePackage) {
    segments.push(skill.sourcePackage);
  } else if (skill.provider && skill.provider !== 'user-home') {
    segments.push(skill.provider);
  }
  if (skill.namespace) {
    segments.push(`namespace: ${skill.namespace}`);
  }
  return segments.join(' · ');
}

function asFiniteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function buildTopSkills(samples: StatsSessionUsageSample[]): CountEntry[] {
  const totals = new Map<string, { count: number; kind: string | null }>();

  for (const sample of samples) {
    const skills = Array.isArray(sample.usage?.skillUsage?.skills)
      ? sample.usage?.skillUsage?.skills as SessionSkillUsageEntry[]
      : [];

    for (const skill of skills) {
      const skillId = typeof skill.assetId === 'string' ? skill.assetId.trim() : '';
      const count = asFiniteNumber(skill.invocationCount);
      if (!skillId || count <= 0) {
        continue;
      }

      const current = totals.get(skillId);
      totals.set(skillId, {
        count: (current?.count ?? 0) + count,
        kind: typeof skill.assetKind === 'string' ? skill.assetKind : current?.kind ?? null,
      });
    }
  }

  return Array.from(totals.entries())
    .map(([label, value]) => ({
      label,
      count: value.count,
      detail: value.kind ? value.kind : undefined,
    }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
    .slice(0, 8);
}

function ensureInventory(input: Partial<InstalledAssetsResponse> | null | undefined): InstalledAssetsResponse {
  return {
    agents: Array.isArray(input?.agents) ? input.agents : [],
    skills: Array.isArray(input?.skills) ? input.skills : [],
    prompts: Array.isArray(input?.prompts) ? input.prompts : [],
    instructions:
      input?.instructions && typeof input.instructions === 'object'
        ? {
            installed: Boolean(input.instructions.installed),
            absPath: typeof input.instructions.absPath === 'string' ? input.instructions.absPath : '',
          }
        : {
            installed: false,
            absPath: '',
          },
  };
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
}

export default function CatalogStatusView() {
  const catalogState = useStoreValue(catalogWorkspaceStore);
  const skillsState = useStoreValue(skillsPreviewStore);
  const statsState = useStoreValue(statsStore);
  const [externalSourceDraft, setExternalSourceDraft] = useState({
    url: '',
    title: '',
    sourceId: '',
    description: '',
    ref: '',
    includeMcp: false,
  });
  const [installedState, setInstalledState] = useState<InstalledInventoryState>({
    loading: false,
    error: null,
    inventory: EMPTY_INSTALLED_INVENTORY,
  });

  useEffect(() => {
    void catalogWorkspaceStore.loadWorkspace();
    void skillsPreviewStore.loadSkills();
    statsStore.startPolling();

    let cancelled = false;

    async function loadInstalledInventory() {
      setInstalledState((state) => ({
        ...state,
        loading: true,
        error: null,
      }));

      try {
        const response = await getInstalledAssets();
        if (cancelled) {
          return;
        }
        setInstalledState({
          loading: false,
          error: null,
          inventory: ensureInventory(response),
        });
      } catch (error) {
        if (cancelled) {
          return;
        }
        setInstalledState((state) => ({
          ...state,
          loading: false,
          error: toErrorMessage(error, 'Unable to load installed inventory.'),
        }));
      }
    }

    void loadInstalledInventory();

    return () => {
      cancelled = true;
      statsStore.stopPolling();
    };
  }, []);

  const externalSources = Array.isArray(catalogState.summary?.externalSources)
    ? catalogState.summary.externalSources as CatalogExternalSourceProjection[]
    : [];
  const providerProjections = Array.isArray(catalogState.summary?.providers)
    ? catalogState.summary.providers
    : [];
  const topSkills = useMemo(() => buildTopSkills(statsState.recentSessionUsage), [statsState.recentSessionUsage]);
  const alwaysLoadedCount = useMemo(
    () => skillsState.skills.filter((skill) => skill.loadMode === 'always').length,
    [skillsState.skills],
  );
  const providerBackedCount = useMemo(
    () => skillsState.skills.filter((skill) => skill.provider && skill.provider !== 'user-home').length,
    [skillsState.skills],
  );

  const handleExternalSourceDraftChange = (patch: Partial<typeof externalSourceDraft>) => {
    setExternalSourceDraft((state) => ({ ...state, ...patch }));
  };

  const handleAddExternalSource = async () => {
    await catalogWorkspaceStore.addExternalSource({
      url: externalSourceDraft.url.trim(),
      title: externalSourceDraft.title.trim() || undefined,
      sourceId: externalSourceDraft.sourceId.trim() || undefined,
      description: externalSourceDraft.description.trim() || undefined,
      ref: externalSourceDraft.ref.trim() || undefined,
      includeMcp: externalSourceDraft.includeMcp,
    });

    setExternalSourceDraft({
      url: '',
      title: '',
      sourceId: '',
      description: '',
      ref: '',
      includeMcp: false,
    });
  };

  const handleToggleExternalInstallable = async (
    source: CatalogExternalSourceProjection,
    installable: CatalogExternalSourceInstallable,
    target: string,
  ) => {
    const details = readExternalInstallableTargetDetails(source, installable.installableId, target);
    if (details.enabled) {
      await catalogWorkspaceStore.deactivateExternalSourceInstallable({
        sourceId: source.sourceId,
        installableId: installable.installableId,
        target,
      });
      return;
    }

    await catalogWorkspaceStore.activateExternalSourceInstallable({
      sourceId: source.sourceId,
      installableId: installable.installableId,
      target,
    });
  };

  const handleRefreshStatus = async () => {
    await Promise.all([
      catalogWorkspaceStore.refreshWorkspace(),
      skillsPreviewStore.refresh(),
      statsStore.refresh(),
      (async () => {
        try {
          const response = await getInstalledAssets();
          setInstalledState({
            loading: false,
            error: null,
            inventory: ensureInventory(response),
          });
        } catch (error) {
          setInstalledState((state) => ({
            ...state,
            error: toErrorMessage(error, 'Unable to refresh installed inventory.'),
          }));
        }
      })(),
    ]);
  };

  return (
    <section className="workspace-stack catalog-status-view" data-testid="catalog-status-view">
      <Toolbar testId="catalog-status-toolbar">
        <div className="workspace-nav-summary">
          <p className="workspace-nav-title">Catalog Status</p>
          <p className="workspace-nav-copy">
            Supported targets, external sources, installed inventory, and recent runtime-used skills in one operator surface.
          </p>
        </div>

        <div className="planning-toolbar-actions">
          <Button
            disabled={catalogState.loading || catalogState.refreshing || installedState.loading || skillsState.loading || statsState.loading}
            onClick={() => {
              void handleRefreshStatus();
            }}
            testId="catalog-status-refresh"
            variant="secondary"
          >
            Refresh status
          </Button>
        </div>
      </Toolbar>

      {catalogState.installMessage ? <p className="catalog-status">{catalogState.installMessage}</p> : null}
      {catalogState.error ? <p className="state-message state-error" role="alert">{catalogState.error}</p> : null}

      <div className="catalog-summary-grid">
        <article className="catalog-stat-card">
          <p className="catalog-stat-label">Sources</p>
          <p className="catalog-stat-value">{externalSources.length}</p>
          <p className="catalog-stat-copy">Configured external sources across shipped and user-added catalogs.</p>
        </article>
        <article className="catalog-stat-card">
          <p className="catalog-stat-label">Installed skills</p>
          <p className="catalog-stat-value">{installedState.inventory.skills.length}</p>
          <p className="catalog-stat-copy">Detected from `/api/assets/installed` across managed install surfaces.</p>
        </article>
        <article className="catalog-stat-card">
          <p className="catalog-stat-label">Always-loaded skills</p>
          <p className="catalog-stat-value">{alwaysLoadedCount}</p>
          <p className="catalog-stat-copy">Preview inventory currently marked `always` by the skills catalog endpoint.</p>
        </article>
        <article className="catalog-stat-card">
          <p className="catalog-stat-label">Recent used skills</p>
          <p className="catalog-stat-value">{topSkills.length}</p>
          <p className="catalog-stat-copy">Bounded rollup from recent session usage, not a live in-memory load tracker.</p>
        </article>
      </div>

      <Panel
        subtitle="Use the managed installers for each supported harness. Installed and active states for source installables are shown below."
        testId="catalog-status-targets-panel"
        title="Targets & install surfaces"
      >
        <div className="catalog-surface-grid">
          {INSTALL_SURFACE_CARDS.map((card) => (
            <article className="catalog-surface-card" key={card.target}>
              <div className="catalog-surface-card-header">
                <p className="catalog-surface-title">{card.title}</p>
                <p className="catalog-item-copy">{card.description}</p>
              </div>
              <div className="catalog-action-row">
                <Button
                  disabled={catalogState.loading || catalogState.installing || catalogState.refreshing}
                  onClick={() => {
                    void catalogWorkspaceStore.installSurface(card.target, false);
                  }}
                  testId={`catalog-status-install-${card.target}`}
                  variant="secondary"
                >
                  Install {card.title}
                </Button>
                <Button
                  disabled={catalogState.loading || catalogState.installing || catalogState.refreshing}
                  onClick={() => {
                    void catalogWorkspaceStore.installSurface(card.target, true);
                  }}
                  testId={`catalog-status-force-${card.target}`}
                  variant="ghost"
                >
                  Force {card.title}
                </Button>
              </div>
            </article>
          ))}
        </div>
      </Panel>

      <Panel
        subtitle="Add GitHub-backed external sources, inspect installables, and verify which targets are supported, active, or installed."
        testId="catalog-status-sources-panel"
        title="Sources & target state"
      >
        <div className="catalog-form-grid">
          <FormInput
            label="GitHub repo"
            onValueChange={(value) => handleExternalSourceDraftChange({ url: value })}
            placeholder="https://github.com/owner/repo"
            testId="catalog-status-source-url"
            value={externalSourceDraft.url}
          />
          <FormInput
            label="Title (optional)"
            onValueChange={(value) => handleExternalSourceDraftChange({ title: value })}
            placeholder="Friendly source name"
            testId="catalog-status-source-title"
            value={externalSourceDraft.title}
          />
          <FormInput
            label="Source ID (optional)"
            onValueChange={(value) => handleExternalSourceDraftChange({ sourceId: value })}
            placeholder="owner-repo"
            testId="catalog-status-source-id"
            value={externalSourceDraft.sourceId}
          />
          <FormInput
            label="Ref (optional)"
            onValueChange={(value) => handleExternalSourceDraftChange({ ref: value })}
            placeholder="main"
            testId="catalog-status-source-ref"
            value={externalSourceDraft.ref}
          />
        </div>

        <FormInput
          label="Description (optional)"
          onValueChange={(value) => handleExternalSourceDraftChange({ description: value })}
          placeholder="Short note for this source"
          testId="catalog-status-source-description"
          value={externalSourceDraft.description}
        />

        <label className="planning-checkbox">
          <input
            checked={externalSourceDraft.includeMcp}
            onChange={(event) => handleExternalSourceDraftChange({ includeMcp: event.target.checked })}
            type="checkbox"
          />
          Probe for MCP manifests in addition to skills
        </label>

        <div className="catalog-action-row">
          <Button
            disabled={catalogState.loading || catalogState.refreshing || catalogState.mutating || !externalSourceDraft.url.trim()}
            onClick={() => {
              void handleAddExternalSource();
            }}
            testId="catalog-status-source-add"
            variant="secondary"
          >
            Add source
          </Button>
        </div>

        {externalSources.length === 0 ? (
          <p className="state-message">No external sources are currently configured.</p>
        ) : (
          <ul className="catalog-repo-list" data-testid="catalog-status-source-list">
            {externalSources.map((source) => {
              const installables = Array.isArray(source.installables)
                ? source.installables.filter((installable) => installable.hiddenByDefault !== true)
                : [];
              const activeTargetCount = countExternalSourceActiveTargets(source);
              const visibleInstallableCount = countVisibleExternalInstallables(source);

              return (
                <li key={source.sourceId}>
                  <div className="catalog-search-result-header">
                    <div>
                      <p className="catalog-item-title">{source.title || source.sourceId}</p>
                      <p className="catalog-item-copy">{source.description || source.url || source.sourceId}</p>
                    </div>
                    <div className="catalog-badge-row">
                      <StatusBadge status={source.sync?.status || 'not-synced'} testId="catalog-status-source-sync" />
                      <StatusBadge status={source.editable ? 'editable' : 'shipped'} testId="catalog-status-source-origin" />
                      {source.sync?.resolvedRef ? <StatusBadge status={source.sync.resolvedRef} testId="catalog-status-source-ref" /> : null}
                    </div>
                  </div>

                  <p className="catalog-inline-note">
                    {visibleInstallableCount} visible installable(s) · {activeTargetCount} active target(s) · last synced {formatTimestamp(source.sync?.lastSyncedAt)}
                  </p>
                  {source.sync?.lastError ? <p className="state-message state-error">{source.sync.lastError}</p> : null}

                  <div className="catalog-action-row">
                    <Button
                      disabled={catalogState.loading || catalogState.refreshing || catalogState.mutating}
                      onClick={() => {
                        void catalogWorkspaceStore.refreshExternalSource(source.sourceId);
                      }}
                      size="sm"
                      testId="catalog-status-source-refresh"
                      variant="secondary"
                    >
                      Refresh source
                    </Button>
                    <Button
                      disabled={catalogState.loading || catalogState.refreshing || catalogState.mutating || activeTargetCount === 0}
                      onClick={() => {
                        void catalogWorkspaceStore.reinstallExternalSourceAllTargets(source.sourceId);
                      }}
                      size="sm"
                      testId="catalog-status-source-reinstall-all"
                      variant="ghost"
                    >
                      Reinstall active targets
                    </Button>
                    {source.editable ? (
                      <Button
                        disabled={catalogState.loading || catalogState.refreshing || catalogState.mutating}
                        onClick={() => {
                          void catalogWorkspaceStore.removeExternalSource(source.sourceId);
                        }}
                        size="sm"
                        testId="catalog-status-source-remove"
                        variant="danger"
                      >
                        Remove source
                      </Button>
                    ) : null}
                  </div>

                  {installables.length === 0 ? (
                    <p className="state-message">Refresh this source to inspect installables.</p>
                  ) : (
                    <ul className="catalog-entry-list">
                      {installables.map((installable) => {
                        const supportedTargets = readExternalInstallableTargets(installable);
                        return (
                          <li key={`${source.sourceId}-${installable.installableId}`}>
                            <div className="catalog-search-result-header">
                              <div>
                                <p className="catalog-item-title">{installable.title || installable.name || installable.installableId}</p>
                                <p className="catalog-item-copy">{installable.description || installable.relativePath || installable.installableId}</p>
                              </div>
                              <div className="catalog-badge-row">
                                <StatusBadge status={installable.kind || 'unknown'} testId="catalog-status-installable-kind" />
                                {installable.deprecated ? <StatusBadge status="deprecated" testId="catalog-status-installable-deprecated" /> : null}
                              </div>
                            </div>

                            <p className="catalog-inline-note">Supports: {formatHarnessList(supportedTargets)}</p>
                            <div className="catalog-badge-row">
                              {supportedTargets.map((target) => {
                                const details = readExternalInstallableTargetDetails(source, installable.installableId, target);
                                return (
                                  <StatusBadge
                                    key={`${source.sourceId}-${installable.installableId}-${target}`}
                                    status={`${getExternalTargetLabel(target)}:${details.enabled ? (details.installed ? 'installed-active' : 'active') : 'inactive'}`}
                                    testId="catalog-status-installable-target"
                                  />
                                );
                              })}
                            </div>

                            {supportedTargets.map((target) => {
                              const details = readExternalInstallableTargetDetails(source, installable.installableId, target);
                              return (
                                <p
                                  className="catalog-inline-note"
                                  data-testid="catalog-status-installable-target-detail"
                                  key={`${source.sourceId}-${installable.installableId}-${target}-detail`}
                                >
                                  {getExternalTargetLabel(target)}: {details.enabled ? (details.installed ? 'installed and active' : 'active') : 'supported, not active'}
                                  {details.managedName ? ` · ${details.managedName}` : ''}
                                  {details.installedPath ? ` · ${details.installedPath}` : ''}
                                </p>
                              );
                            })}

                            <div className="catalog-action-row">
                              {supportedTargets.map((target) => {
                                const details = readExternalInstallableTargetDetails(source, installable.installableId, target);
                                return (
                                  <Button
                                    disabled={catalogState.loading || catalogState.refreshing || catalogState.mutating}
                                    key={`${installable.installableId}-${target}`}
                                    onClick={() => {
                                      void handleToggleExternalInstallable(source, installable, target);
                                    }}
                                    size="sm"
                                    testId="catalog-status-installable-toggle"
                                    variant={details.enabled ? 'ghost' : 'secondary'}
                                  >
                                    {details.enabled ? `Deactivate ${getExternalTargetLabel(target)}` : `Activate ${getExternalTargetLabel(target)}`}
                                  </Button>
                                );
                              })}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <div className="catalog-grid">
        <Panel
          subtitle="Current inventory from the installed-assets endpoint, so this reflects actual discovered files rather than only catalog intent."
          testId="catalog-status-installed-panel"
          title="Installed inventory"
        >
          {installedState.error ? <p className="state-message state-error" role="alert">{installedState.error}</p> : null}
          <div className="catalog-summary-grid">
            <article className="catalog-stat-card">
              <p className="catalog-stat-label">Agents</p>
              <p className="catalog-stat-value">{installedState.inventory.agents.length}</p>
              <p className="catalog-stat-copy">Installed agent files discovered on disk.</p>
            </article>
            <article className="catalog-stat-card">
              <p className="catalog-stat-label">Skills</p>
              <p className="catalog-stat-value">{installedState.inventory.skills.length}</p>
              <p className="catalog-stat-copy">Installed skill folders detected across managed surfaces.</p>
            </article>
            <article className="catalog-stat-card">
              <p className="catalog-stat-label">Prompts</p>
              <p className="catalog-stat-value">{installedState.inventory.prompts.length}</p>
              <p className="catalog-stat-copy">Installed prompt files currently surfaced by inventory.</p>
            </article>
            <article className="catalog-stat-card">
              <p className="catalog-stat-label">Instructions</p>
              <p className="catalog-stat-value">{installedState.inventory.instructions.installed ? 'yes' : 'no'}</p>
              <p className="catalog-stat-copy">{installedState.inventory.instructions.absPath || 'Instructions not installed.'}</p>
            </article>
          </div>

          <div className="preview-grid">
            <section>
              <p className="preview-title">Installed skills</p>
              {installedState.loading && installedState.inventory.skills.length === 0 ? <p className="preview-empty">Loading installed skills...</p> : null}
              {!installedState.loading && installedState.inventory.skills.length === 0 ? <p className="preview-empty">No installed skills.</p> : null}
              {installedState.inventory.skills.length > 0 ? (
                <ul data-testid="catalog-status-installed-skills-list">
                  {installedState.inventory.skills.slice(0, 8).map((skill) => (
                    <li key={skill.absPath}>
                      <div>
                        <span>{skill.name || 'Unknown skill'}</span>
                        <small>{skill.kind}{providerLabel(skill as SkillPreviewItem) ? ` · ${providerLabel(skill as SkillPreviewItem)}` : ''}</small>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>

            <section>
              <p className="preview-title">Skill catalog preview</p>
              {skillsState.error ? <p className="preview-empty">{skillsState.error}</p> : null}
              {!skillsState.error && skillsState.skills.length === 0 ? <p className="preview-empty">No previewable skills returned.</p> : null}
              {skillsState.skills.length > 0 ? (
                <ul data-testid="catalog-status-preview-skills-list">
                  {skillsState.skills.slice(0, 8).map((skill) => (
                    <li key={skill.assetId || `${skill.name}:${skill.viewPath || skill.absPath || ''}`}>
                      <div>
                        <span>{skill.name}</span>
                        <small>
                          {(skill.loadMode || 'unknown')} · {(skill.availability || skill.kind)}
                          {providerLabel(skill) ? ` · ${providerLabel(skill)}` : ''}
                        </small>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          </div>
        </Panel>

        <Panel
          subtitle="Recent runtime-observed skills come from session usage sampling. This is not a live memory-load inspector, but it shows what is actually being used."
          testId="catalog-status-runtime-panel"
          title="Runtime-used skills"
        >
          <div className="catalog-summary-grid">
            <article className="catalog-stat-card">
              <p className="catalog-stat-label">Sampled sessions</p>
              <p className="catalog-stat-value">{statsState.recentSessionUsage.length}</p>
              <p className="catalog-stat-copy">Recent sessions with bounded usage sampling from the Stats store.</p>
            </article>
            <article className="catalog-stat-card">
              <p className="catalog-stat-label">Provider-backed preview skills</p>
              <p className="catalog-stat-value">{providerBackedCount}</p>
              <p className="catalog-stat-copy">Preview skills currently tagged with a non-user provider.</p>
            </article>
            <article className="catalog-stat-card">
              <p className="catalog-stat-label">Provider integrations</p>
              <p className="catalog-stat-value">{providerProjections.length}</p>
              <p className="catalog-stat-copy">Catalog projection provider state still surfaced here for migration visibility.</p>
            </article>
          </div>

          {statsState.usageError ? <p className="state-message state-error">{statsState.usageError}</p> : null}
          {topSkills.length === 0 ? (
            <p className="state-message">No recent skill usage sample is available yet.</p>
          ) : (
            <ul className="tracker-session-list" data-testid="catalog-status-top-skills-list">
              {topSkills.map((entry) => (
                <li key={entry.label}>
                  <div>
                    <p className="tracker-item-title">{entry.label}</p>
                    <p className="tracker-item-copy">
                      {entry.count} sampled invocations{entry.detail ? ` | ${entry.detail}` : ''}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </section>
  );
}
