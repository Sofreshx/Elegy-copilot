import { useEffect, useMemo, useState } from 'react';
import { Button, FormInput, Panel, StatusBadge, Toolbar } from '../../components';
import { getCatalogContent, getInstalledAssets } from '../../lib/api';
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
  overallStatus: string | null;
  lastVerifiedAt: string | null;
  warnings: string[];
  errors: string[];
  checks: Array<Record<string, unknown>>;
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

type DetailState = {
  key: string | null;
  loading: boolean;
  error: string | null;
  content: string;
  label: string;
};

type ExternalInventoryEntry = {
  sourceId: string;
  installableId: string;
  title: string;
  target: string;
  managedName: string | null;
  installedPath: string | null;
  overallStatus: string | null;
  lastVerifiedAt: string | null;
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

const INITIAL_DETAIL_STATE: DetailState = {
  key: null,
  loading: false,
  error: null,
  content: '(select Details to inspect source content)',
  label: 'No source detail selected',
};

function resolveContext7ModeInstallableIds(mode: 'cli-skills' | 'mcp'): string[] {
  if (mode === 'mcp') {
    return ['mcp:context7'];
  }
  return ['cli:context7', 'skill:context7-cli', 'skill:context7-mcp', 'skill:find-docs'];
}

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
    description: 'Managed Antigravity 2 skills and GEMINI.md compatibility block.',
  },
  {
    target: 'opencode',
    title: 'OpenCode',
    description: 'Global OpenCode AGENTS and curated skills.',
  },
  {
    target: 'claude',
    title: 'Claude Code',
    description: 'Claude Code instructions and curated skills.',
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
    case 'claude':
      return 'Claude Code';
    case 'antigravity-cli':
    case 'gemini-cli':
      return 'Antigravity CLI';
    case 'host':
      return 'Host CLI';
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

function normalizeExternalTargetKey(target: string): string {
  const normalized = target.trim().toLowerCase();
  return normalized === 'antigravity-cli' ? 'gemini-cli' : normalized;
}

function readExternalInstallableTargetDetails(
  source: CatalogExternalSourceProjection | null | undefined,
  installableId: string,
  target: string,
): ExternalTargetDetails {
  const activation = source?.activation && typeof source.activation === 'object'
    ? source.activation
    : {};
  const targetKey = normalizeExternalTargetKey(target);
  const targetState = activation[targetKey] && typeof activation[targetKey] === 'object'
    ? activation[targetKey]
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
    overallStatus:
      typeof state.overallStatus === 'string' && state.overallStatus.trim() ? state.overallStatus.trim() : null,
    lastVerifiedAt:
      typeof state.lastVerifiedAt === 'string' && state.lastVerifiedAt.trim() ? state.lastVerifiedAt.trim() : null,
    warnings: Array.isArray(state.warnings)
      ? state.warnings.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
      : [],
    errors: Array.isArray(state.errors)
      ? state.errors.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
      : [],
    checks: Array.isArray(state.checks)
      ? state.checks.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object'))
      : [],
  };
}

function readSourceVerificationSummary(source: CatalogExternalSourceProjection | null | undefined): {
  lastVerifiedAt: string | null;
  warnings: string[];
  errors: string[];
  status: string | null;
} {
  const sync = source?.sync && typeof source.sync === 'object' ? source.sync : {};
  return {
    lastVerifiedAt:
      typeof sync.lastVerifiedAt === 'string' && sync.lastVerifiedAt.trim() ? sync.lastVerifiedAt.trim() : null,
    warnings: Array.isArray(sync.verificationWarnings)
      ? sync.verificationWarnings.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
      : [],
    errors: Array.isArray(sync.verificationErrors)
      ? sync.verificationErrors.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
      : [],
    status:
      typeof sync.verificationStatus === 'string' && sync.verificationStatus.trim() ? sync.verificationStatus.trim() : null,
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

function readInstallableReadablePath(installable: CatalogExternalSourceInstallable): string {
  const metadata = installable.metadata && typeof installable.metadata === 'object'
    ? installable.metadata as Record<string, unknown>
    : {};
  const candidate = [
    metadata.relativeSkillFilePath,
    metadata.readPath,
    installable.sourcePath,
    installable.relativePath,
  ].find((value) => typeof value === 'string' && value.trim().length > 0);
  return typeof candidate === 'string' ? candidate.trim() : '';
}

function getDetailLabel(source: CatalogExternalSourceProjection, installable: CatalogExternalSourceInstallable): string {
  return `${source.title || source.sourceId} · ${installable.title || installable.name || installable.installableId}`;
}

function buildExternalInventoryEntries(sources: CatalogExternalSourceProjection[]): ExternalInventoryEntry[] {
  return sources
    .flatMap((source) => {
      const installables = Array.isArray(source.installables) ? source.installables : [];
      return installables.flatMap((installable) => {
        if (installable.kind !== 'mcp' && installable.kind !== 'cli-tool' && installable.kind !== 'skill') {
          return [];
        }
        const supportedTargets = readExternalInstallableTargets(installable);
        const targets = supportedTargets.length > 0 ? supportedTargets : installable.kind === 'cli-tool' ? ['host'] : [];
        return targets
          .map((target) => {
            const details = readExternalInstallableTargetDetails(source, installable.installableId, target);
            if (!details.enabled && !details.installed && !details.installedPath && !details.managedName && !details.overallStatus) {
              return null;
            }
            return {
              sourceId: source.sourceId,
              installableId: installable.installableId,
              title: installable.title || installable.name || installable.installableId,
              target,
              managedName: details.managedName,
              installedPath: details.installedPath,
              overallStatus: details.overallStatus,
              lastVerifiedAt: details.lastVerifiedAt,
            } satisfies ExternalInventoryEntry;
          })
          .filter((entry): entry is ExternalInventoryEntry => Boolean(entry));
      });
    })
    .sort((left, right) => {
      const titleOrder = String(left.title || '').localeCompare(String(right.title || ''));
      if (titleOrder !== 0) {
        return titleOrder;
      }
      const sourceOrder = String(left.sourceId || '').localeCompare(String(right.sourceId || ''));
      if (sourceOrder !== 0) {
        return sourceOrder;
      }
      return String(left.target || '').localeCompare(String(right.target || ''));
    });
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
  const [detailState, setDetailState] = useState<DetailState>(INITIAL_DETAIL_STATE);
  const [context7Mode, setContext7Mode] = useState<'cli-skills' | 'mcp'>('cli-skills');
  const [selectedTargets, setSelectedTargets] = useState<Set<string>>(new Set());

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
  const selectedRepoPath = typeof catalogState.repoInventory?.selectedRepo?.repoPath === 'string'
    ? catalogState.repoInventory.selectedRepo.repoPath.trim()
    : '';
  const activeRepoPath = typeof catalogState.activeRepoPath === 'string' ? catalogState.activeRepoPath.trim() : '';
  const effectiveRepoPath = selectedRepoPath || activeRepoPath;
  const topSkills = useMemo(() => buildTopSkills(statsState.recentSessionUsage), [statsState.recentSessionUsage]);
  const alwaysLoadedCount = useMemo(
    () => skillsState.skills.filter((skill) => skill.loadMode === 'always').length,
    [skillsState.skills],
  );
  const providerBackedCount = useMemo(
    () => skillsState.skills.filter((skill) => skill.provider && skill.provider !== 'user-home').length,
    [skillsState.skills],
  );
  const externalInventoryEntries = useMemo(
    () => buildExternalInventoryEntries(externalSources),
    [externalSources],
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

  const handleSyncInstallVerifySource = async (source: CatalogExternalSourceProjection) => {
    await catalogWorkspaceStore.syncInstallVerifyExternalSource({
      sourceId: source.sourceId,
      repoPath: effectiveRepoPath || undefined,
    });
  };

  const handleSyncInstallVerifyContext7 = async (source: CatalogExternalSourceProjection, mode: 'cli-skills' | 'mcp') => {
    await catalogWorkspaceStore.syncInstallVerifyExternalSource({
      sourceId: source.sourceId,
      installableIds: resolveContext7ModeInstallableIds(mode),
      repoPath: effectiveRepoPath || undefined,
    });
  };

  const handleBootstrapSpecKit = async () => {
    await catalogWorkspaceStore.bootstrapSpecKitRepo({
      repoPath: effectiveRepoPath || undefined,
      integration: 'copilot',
      script: 'ps',
    });
  };

  const handleOpenDetails = async (
    source: CatalogExternalSourceProjection,
    installable: CatalogExternalSourceInstallable,
  ) => {
    const readPath = readInstallableReadablePath(installable);
    const detailKey = `${source.sourceId}:${installable.installableId}`;
    const label = getDetailLabel(source, installable);
    if (!readPath) {
      setDetailState({
        key: detailKey,
        loading: false,
        error: 'No readable detail path is available for this installable.',
        content: 'No readable detail path is available for this installable.',
        label,
      });
      return;
    }

    setDetailState({
      key: detailKey,
      loading: true,
      error: null,
      content: `(loading ${label}...)`,
      label,
    });

    try {
      const content = await getCatalogContent({
        mode: 'external-source',
        sourceId: source.sourceId,
        path: readPath,
      });
      setDetailState({
        key: detailKey,
        loading: false,
        error: null,
        content: content || '(empty content)',
        label,
      });
    } catch (error) {
      const message = toErrorMessage(error, 'Unable to load source details.');
      setDetailState({
        key: detailKey,
        loading: false,
        error: message,
        content: `Unable to load source details: ${message}`,
        label,
      });
    }
  };

  const handleDeactivateAllForSource = async (source: CatalogExternalSourceProjection) => {
    const activation = source.activation && typeof source.activation === 'object' ? source.activation : {};
    const promises: Array<Promise<void>> = [];

    for (const [targetKey, targetState] of Object.entries(activation)) {
      if (!targetState || typeof targetState !== 'object') {
        continue;
      }

      const installables = (targetState as Record<string, unknown>).installables;
      if (!installables || typeof installables !== 'object') {
        continue;
      }

      for (const [installableId, entry] of Object.entries(installables as Record<string, Record<string, unknown>>)) {
        if (entry?.enabled === true) {
          promises.push(
            catalogWorkspaceStore.deactivateExternalSourceInstallable({
              sourceId: source.sourceId,
              installableId,
              target: targetKey,
            }),
          );
        }
      }
    }

    if (promises.length > 0) {
      await Promise.all(promises);
    }
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

      {/* External Assets — Featured */}
      <Panel
        subtitle="Quick-access cards for Context7 and Caveman. Enable or disable with one click. Full management lives in the Sources panel below."
        testId="catalog-status-external-assets-panel"
        title="External Assets"
      >
        {(() => {
          const featuredIds = ['context7', 'caveman'];
          const featured = externalSources.filter((s) => featuredIds.includes(s.sourceId));
          const otherShipped = externalSources.filter(
            (s) => s.sourceId !== 'context7' && s.sourceId !== 'caveman' && !s.editable,
          );

          if (featured.length === 0 && otherShipped.length === 0) {
            return <p className="state-message">No shipped external assets found. Add a source below to get started.</p>;
          }

          return (
            <div>
              <div className="state-card-grid">
                {featured.map((source) => {
                  const activeCount = countExternalSourceActiveTargets(source);
                  const installableCount = countVisibleExternalInstallables(source);
                  const verification = readSourceVerificationSummary(source);
                  const isActive = activeCount > 0;

                  return (
                    <article key={source.sourceId} className="state-card catalog-external-asset-card">
                      <div className="catalog-external-asset-header">
                        <p className="state-card-title">{source.title || source.sourceId}</p>
                        <StatusBadge
                          status={isActive ? 'active' : 'inactive'}
                          testId={`catalog-external-asset-${source.sourceId}-status`}
                        />
                      </div>
                      <p className="state-card-copy">{source.description || 'No description available.'}</p>
                      <p className="catalog-inline-note">
                        {installableCount} installable(s) · {activeCount} active target(s)
                        {source.sync?.resolvedRef ? ` · ref: ${source.sync.resolvedRef}` : ''}
                      </p>
                      {source.sourceId === 'context7' && !isActive && (
                        <div className="catalog-action-row" style={{ marginBottom: '6px' }}>
                          <label className="planning-checkbox" style={{ marginRight: '12px' }}>
                            <input
                              checked={context7Mode === 'cli-skills'}
                              onChange={() => setContext7Mode('cli-skills')}
                              type="radio"
                              name="context7-mode"
                            />
                            CLI + Skills (recommended)
                          </label>
                          <label className="planning-checkbox">
                            <input
                              checked={context7Mode === 'mcp'}
                              onChange={() => setContext7Mode('mcp')}
                              type="radio"
                              name="context7-mode"
                            />
                            MCP Server
                          </label>
                        </div>
                      )}
                      {verification.errors.length > 0 && (
                        <p className="state-message state-error">{verification.errors[0]}</p>
                      )}
                      <div className="catalog-action-row">
                        {isActive ? (
                          <Button
                            disabled={catalogState.loading || catalogState.mutating}
                            onClick={() => {
                              void handleDeactivateAllForSource(source);
                            }}
                            size="sm"
                            testId={`catalog-external-asset-${source.sourceId}-disable`}
                            variant="secondary"
                          >
                            Disable
                          </Button>
                        ) : (
                          <Button
                            disabled={catalogState.loading || catalogState.mutating || installableCount === 0}
                            onClick={() => {
                              if (source.sourceId === 'context7') {
                                void handleSyncInstallVerifyContext7(source, context7Mode);
                              } else {
                                void handleSyncInstallVerifySource(source);
                              }
                            }}
                            size="sm"
                            testId={`catalog-external-asset-${source.sourceId}-enable`}
                            variant="primary"
                          >
                            Enable & Install
                          </Button>
                        )}
                        <Button
                          disabled={catalogState.loading || catalogState.refreshing || catalogState.mutating}
                          onClick={() => {
                            void catalogWorkspaceStore.refreshExternalSource(source.sourceId);
                          }}
                          size="sm"
                          testId={`catalog-external-asset-${source.sourceId}-refresh`}
                          variant="ghost"
                        >
                          Refresh
                        </Button>
                      </div>
                    </article>
                  );
                })}

                {/* Other shipped sources as compact cards */}
                {otherShipped.map((source) => {
                  const activeCount = countExternalSourceActiveTargets(source);
                  const installableCount = countVisibleExternalInstallables(source);
                  const isActive = activeCount > 0;

                  return (
                    <article key={source.sourceId} className="state-card catalog-external-asset-card">
                      <div className="catalog-external-asset-header">
                        <p className="state-card-title">{source.title || source.sourceId}</p>
                        <StatusBadge
                          status={isActive ? 'active' : 'inactive'}
                          testId={`catalog-external-asset-${source.sourceId}-status`}
                        />
                      </div>
                      <p className="state-card-copy">{installableCount} installable(s) · {activeCount} active</p>
                    </article>
                  );
                })}
              </div>

              {/* User-added sources summary */}
              {externalSources.filter((s) => s.editable).length > 0 && (
                <div style={{ marginTop: '12px' }}>
                  <p className="catalog-inline-note">
                    {externalSources.filter((s) => s.editable).length} user-added source(s) configured. Manage them in
                    the Sources panel below.
                  </p>
                </div>
              )}
            </div>
          );
        })()}
      </Panel>

      <Panel
        subtitle="Use the managed installers for each supported harness. Installed and active states for source installables are shown below."
        testId="catalog-status-targets-panel"
        title="Targets & install surfaces"
      >
        {catalogState.lastInstallResults && catalogState.lastInstallResults.length > 0 ? (
          <div className="catalog-install-results" data-testid="catalog-install-results">
            <p className="catalog-inline-note">Last install results:</p>
            <table className="catalog-mini-table">
              <thead>
                <tr>
                  <th>Target</th>
                  <th>Total</th>
                  <th>Created</th>
                  <th>Updated</th>
                  <th>Skipped</th>
                </tr>
              </thead>
              <tbody>
                {catalogState.lastInstallResults.map((r) => (
                  <tr key={r.target}>
                    <td>{r.target}</td>
                    <td>{r.total}</td>
                    <td>{r.created}</td>
                    <td>{r.updated}</td>
                    <td>{r.skipped + r.skippedConflict}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {/* Multi-select action bar */}
        {selectedTargets.size > 0 ? (
          <div className="catalog-action-bar">
            <Button
              disabled={catalogState.loading || catalogState.installing || catalogState.refreshing}
              onClick={() => {
                for (const target of selectedTargets) {
                  void catalogWorkspaceStore.installSurface(target as InstallSurfaceTarget, false);
                }
                setSelectedTargets(new Set());
              }}
              testId="catalog-install-selected"
              variant="primary"
            >
              Install Selected ({selectedTargets.size})
            </Button>
            <Button
              disabled={catalogState.loading || catalogState.installing || catalogState.refreshing}
              onClick={() => {
                for (const target of selectedTargets) {
                  void catalogWorkspaceStore.installSurface(target as InstallSurfaceTarget, true);
                }
                setSelectedTargets(new Set());
              }}
              testId="catalog-force-selected"
              variant="ghost"
            >
              Force Selected ({selectedTargets.size})
            </Button>
            <Button
              disabled={catalogState.loading || catalogState.installing || catalogState.refreshing}
              onClick={() => setSelectedTargets(new Set())}
              variant="ghost"
            >
              Clear selection
            </Button>
          </div>
        ) : null}

        <div className="catalog-surface-grid">
          {INSTALL_SURFACE_CARDS.map((card) => {
            const harnessInfo = (catalogState.summary?.globalInventory?.harnesses || [])
              .find((h) => h.harnessId === card.target);
            const optedIn = harnessInfo?.optedIn === true;
            return (
              <article className="catalog-surface-card" key={card.target}>
                <div className="catalog-surface-card-header">
                  <p className="catalog-surface-title">{card.title}</p>
                  <p className="catalog-item-copy">{card.description}</p>
                </div>
                {optedIn ? (
                  <p className="catalog-inline-note" data-testid={`catalog-status-optin-${card.target}`}>Active — click to manage assets for this harness.</p>
                ) : (
                  <p className="catalog-inline-note" data-testid={`catalog-status-optin-${card.target}`}>Not in use — turn on to manage assets for {card.title} here.</p>
                )}
                <div className="catalog-action-row">
                  <label className="planning-checkbox">
                    <input
                      type="checkbox"
                      checked={selectedTargets.has(card.target)}
                      disabled={catalogState.loading || catalogState.installing || catalogState.refreshing || !optedIn}
                      onChange={(e) => {
                        const next = new Set(selectedTargets);
                        if (e.target.checked) next.add(card.target);
                        else next.delete(card.target);
                        setSelectedTargets(next);
                      }}
                    />
                    <span>Select</span>
                  </label>
                  <Button
                    disabled={catalogState.loading || catalogState.installing || catalogState.mutating || catalogState.refreshing}
                    onClick={() => {
                      void catalogWorkspaceStore.toggleHarnessOptIn(card.target as 'codex' | 'opencode' | 'antigravity' | 'claude', !optedIn);
                    }}
                    testId={`catalog-status-optin-toggle-${card.target}`}
                    variant={optedIn ? 'primary' : 'secondary'}
                  >
                    {optedIn ? 'Deactivate' : 'Activate'}
                  </Button>
                  {optedIn ? (
                    <>
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
                      {(harnessInfo as Record<string, unknown>)?.state === 'external-managed' ? (
                        <p className="catalog-inline-note" data-testid={`catalog-external-note-${card.target}`}>
                          This harness has externally managed assets. Manage activation in External Inventory.
                        </p>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </article>
            );
          })}
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
              const verification = readSourceVerificationSummary(source);
              const isSpecKit = source.sourceId === 'spec-kit';

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
                  <p className="catalog-inline-note">
                    Verification {verification.status || 'unknown'} · last verified {formatTimestamp(verification.lastVerifiedAt)}
                    {effectiveRepoPath ? ` · repo ${effectiveRepoPath}` : ''}
                  </p>
                  {source.sync?.lastError ? <p className="state-message state-error">{source.sync.lastError}</p> : null}
                  {verification.errors.map((entry) => (
                    <p className="state-message state-error" key={`${source.sourceId}-error-${entry}`}>{entry}</p>
                  ))}
                  {verification.warnings.map((entry) => (
                    <p className="state-message" key={`${source.sourceId}-warning-${entry}`}>{entry}</p>
                  ))}

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
                      disabled={catalogState.loading || catalogState.refreshing || catalogState.mutating}
                      onClick={() => {
                        void handleSyncInstallVerifySource(source);
                      }}
                      size="sm"
                      testId="catalog-status-source-sync-install-verify"
                      variant="primary"
                    >
                      Sync / install / verify
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
                    {isSpecKit ? (
                      <Button
                        disabled={catalogState.loading || catalogState.refreshing || catalogState.mutating || !effectiveRepoPath}
                        onClick={() => {
                          void handleBootstrapSpecKit();
                        }}
                        size="sm"
                        testId="catalog-status-source-bootstrap-spec-kit"
                        variant="ghost"
                      >
                        Bootstrap selected repo
                      </Button>
                    ) : null}
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
                        const resolvedTargets = supportedTargets.length > 0 ? supportedTargets : installable.kind === 'cli-tool' ? ['host'] : [];
                        const targetIssues = resolvedTargets.flatMap((target) => {
                          const details = readExternalInstallableTargetDetails(source, installable.installableId, target);
                          return [...details.errors, ...details.warnings].map((issue) => ({
                            target,
                            issue,
                            isError: details.errors.includes(issue),
                          }));
                        });
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

                            <p className="catalog-inline-note">Supports: {formatHarnessList(resolvedTargets)}</p>
                            <div className="catalog-badge-row">
                              {resolvedTargets.map((target) => {
                                const details = readExternalInstallableTargetDetails(source, installable.installableId, target);
                                return (
                                  <StatusBadge
                                    key={`${source.sourceId}-${installable.installableId}-${target}`}
                                    status={`${getExternalTargetLabel(target)}:${details.overallStatus || (details.enabled ? (details.installed ? 'installed-active' : 'active') : 'inactive')}`}
                                    testId="catalog-status-installable-target"
                                  />
                                );
                              })}
                            </div>

                            {resolvedTargets.map((target) => {
                              const details = readExternalInstallableTargetDetails(source, installable.installableId, target);
                              return (
                                <p
                                  className="catalog-inline-note"
                                  data-testid="catalog-status-installable-target-detail"
                                  key={`${source.sourceId}-${installable.installableId}-${target}-detail`}
                                >
                                  {getExternalTargetLabel(target)}: {details.overallStatus || (details.enabled ? (details.installed ? 'installed and active' : 'active') : 'supported, not active')}
                                  {details.managedName ? ` · ${details.managedName}` : ''}
                                  {details.installedPath ? ` · ${details.installedPath}` : ''}
                                  {details.lastVerifiedAt ? ` · verified ${formatTimestamp(details.lastVerifiedAt)}` : ''}
                                </p>
                              );
                            })}

                            {targetIssues.map(({ target, issue, isError }) => (
                              <p
                                className={`catalog-inline-note ${isError ? 'state-error' : ''}`}
                                data-testid="catalog-status-installable-target-issue"
                                key={`${source.sourceId}-${installable.installableId}-${target}-issue-${issue}`}
                              >
                                {getExternalTargetLabel(target)}: {issue}
                              </p>
                            ))}

                            <div className="catalog-action-row">
                              <Button
                                disabled={catalogState.loading || catalogState.refreshing || catalogState.mutating}
                                onClick={() => {
                                  void handleOpenDetails(source, installable);
                                }}
                                size="sm"
                                testId="catalog-status-installable-details"
                                variant="ghost"
                              >
                                Details
                              </Button>
                              {resolvedTargets.map((target) => {
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
            <article className="catalog-stat-card">
              <p className="catalog-stat-label">External MCP / CLI</p>
              <p className="catalog-stat-value">{externalInventoryEntries.length}</p>
              <p className="catalog-stat-copy">Derived from external source activation state across supported harnesses.</p>
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
              <p className="preview-title">External MCP / CLI inventory</p>
              {externalInventoryEntries.length === 0 ? <p className="preview-empty">No external MCP or CLI installs detected.</p> : null}
              {externalInventoryEntries.length > 0 ? (
                <ul data-testid="catalog-status-external-inventory-list">
                  {externalInventoryEntries.slice(0, 8).map((entry) => (
                    <li key={`${entry.sourceId}:${entry.installableId}:${entry.target}`}>
                      <div>
                        <span>{entry.title}</span>
                        <small>
                          {getExternalTargetLabel(entry.target)}
                          {entry.overallStatus ? ` · ${entry.overallStatus}` : ''}
                          {entry.managedName ? ` · ${entry.managedName}` : ''}
                          {entry.installedPath ? ` · ${entry.installedPath}` : ''}
                          {entry.lastVerifiedAt ? ` · verified ${formatTimestamp(entry.lastVerifiedAt)}` : ''}
                        </small>
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

        <Panel
          subtitle={detailState.label}
          testId="catalog-status-detail-panel"
          title="Source detail"
        >
          {detailState.error ? <p className="catalog-global-error">{detailState.error}</p> : null}
          <pre className="catalog-global-detail-content">{detailState.content}</pre>
        </Panel>
      </div>
    </section>
  );
}
