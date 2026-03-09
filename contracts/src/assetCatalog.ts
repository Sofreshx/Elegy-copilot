export type ExtensibleString<T extends string> = T | (string & {});

export type AssetKind = ExtensibleString<'agent' | 'skill' | 'prompt'>;

export type AssetCatalogLayer =
  | 'source'
  | 'user-installed'
  | 'vault-only'
  | 'repo-local'
  | 'repo-state-overlay'
  | 'targeted-recommendation';

export type AssetContentLayer = Extract<
  AssetCatalogLayer,
  'source' | 'user-installed' | 'vault-only' | 'repo-local'
>;

export type AssetScopeKind = ExtensibleString<
  'global' | 'user' | 'repo' | 'workspace' | 'framework'
>;

export type AssetLoadMode = ExtensibleString<'always' | 'on-demand' | 'manual'>;

export type AssetInstallMaterialization = ExtensibleString<
  'materialized' | 'pointer' | 'vault-only' | 'overlay-only' | 'recommendation-only'
>;

export type AssetAvailability = ExtensibleString<
  'source-only' | 'installed' | 'vault-only' | 'repo-local'
>;

export type AssetLifecycleState = ExtensibleString<
  'draft' | 'active' | 'deprecated' | 'archived'
>;

export type EffectiveAssetLabel =
  | 'available'
  | 'installed'
  | 'enabled'
  | 'recommended'
  | 'disabled'
  | 'deprecated'
  | 'overridden';

export type RecommendationSource = ExtensibleString<
  'framework' | 'repo-scan' | 'usage' | 'search' | 'manual'
>;

export type AssetAuditEventType = ExtensibleString<
  | 'catalog.rebuilt'
  | 'asset.created'
  | 'asset.updated'
  | 'asset.removed'
  | 'asset.installed'
  | 'asset.enabled'
  | 'asset.disabled'
  | 'asset.recommended'
  | 'asset.search.query'
  | 'asset.search.result'
  | 'asset.search.selected'
  | 'asset.search.miss'
  | 'asset.used'
>;

export type AssetAuditActorKind = ExtensibleString<
  'user' | 'system' | 'ui' | 'runtime' | 'extension'
>;

export type SkillSearchMatchReasonCode = ExtensibleString<
  | 'exact-name'
  | 'name'
  | 'trigger'
  | 'description'
  | 'tags'
  | 'framework'
  | 'stack'
  | 'language'
  | 'repo-local'
  | 'workspace'
  | 'load-mode'
  | 'recommendation'
  | 'recent-use'
>;

export type SkillSearchMissReason = ExtensibleString<
  'empty-catalog' | 'no-match' | 'all-filtered'
>;

export interface AssetScope {
  kind: AssetScopeKind;
  repoId?: string;
  repoPath?: string;
  workspaceId?: string;
  workspacePath?: string;
  frameworkIds?: string[];
  displayName?: string;
}

export interface TargetingMetadata {
  frameworks?: string[];
  stacks?: string[];
  languages?: string[];
  tags?: string[];
  repoIds?: string[];
  workspaceIds?: string[];
  pathGlobs?: string[];
  loadMode?: AssetLoadMode;
  recommendationReasons?: string[];
}

export interface InstallState {
  availability: AssetAvailability;
  materialization?: AssetInstallMaterialization;
  loadMode?: AssetLoadMode;
  isInstalled?: boolean;
  isAutoLoaded?: boolean;
  sourcePath?: string;
  installedPaths?: Partial<Record<AssetContentLayer, string>>;
  contentHash?: string;
  installedAt?: string;
  updatedAt?: string;
}

export interface AssetRepoStateOverlay {
  repoId?: string;
  repoPath?: string;
  enabled?: boolean;
  hidden?: boolean;
  pinned?: boolean;
  blockedReason?: string;
  note?: string;
  updatedAt?: string;
}

export interface AssetRecommendation {
  source: RecommendationSource;
  reasonCode: string;
  reason: string;
  score?: number;
  framework?: string;
  stack?: string;
  repoId?: string;
  emittedAt?: string;
}

export interface AssetCatalogEntry {
  assetId: string;
  assetKey: string;
  kind: AssetKind;
  title: string;
  description?: string;
  layer: AssetCatalogLayer;
  scope: AssetScope;
  targeting?: TargetingMetadata;
  installState?: InstallState;
  lifecycle?: AssetLifecycleState;
  version?: string;
  contentPath?: string;
  metadata?: Record<string, unknown>;
  overlay?: AssetRepoStateOverlay;
  recommendation?: AssetRecommendation;
}

export interface EffectiveResolutionReason {
  code:
    | 'selected-source'
    | 'selected-user-installed'
    | 'selected-vault-only'
    | 'selected-repo-local'
    | 'vault-preferred-over-pointer'
    | 'overridden-by-higher-layer'
    | 'repo-overlay-enabled'
    | 'repo-overlay-disabled'
    | 'targeted-recommendation'
    | 'deprecated';
  message: string;
  layer?: AssetCatalogLayer;
}

export interface EffectiveAssetState {
  assetId: string;
  assetKey: string;
  kind: AssetKind;
  scope: AssetScope;
  selectedEntry?: AssetCatalogEntry;
  selectedLayer?: AssetCatalogLayer;
  installState?: InstallState;
  overlay?: AssetRepoStateOverlay;
  recommendations: AssetRecommendation[];
  contributingEntries: AssetCatalogEntry[];
  suppressedEntries: AssetCatalogEntry[];
  available: boolean;
  installed: boolean;
  enabled: boolean;
  recommended: boolean;
  deprecated: boolean;
  overridden: boolean;
  hiddenFromAutoLoad: boolean;
  labels: EffectiveAssetLabel[];
  reasons: EffectiveResolutionReason[];
}

export interface SkillSearchQuery {
  query: string;
  repoId?: string;
  repoPath?: string;
  workspaceId?: string;
  workspacePath?: string;
  frameworks?: string[];
  stacks?: string[];
  languages?: string[];
  tags?: string[];
  limit?: number;
  includeVaultOnly?: boolean;
  includeDisabled?: boolean;
  includeDeprecated?: boolean;
  preferLoadMode?: AssetLoadMode;
  sessionId?: string;
  correlationId?: string;
}

export interface SkillSearchExplanation {
  code: SkillSearchMatchReasonCode;
  weight: number;
  message: string;
  layer?: AssetCatalogLayer;
}

export interface SkillSearchResult {
  assetId: string;
  entry: AssetCatalogEntry;
  effectiveState: EffectiveAssetState;
  score: number;
  rank: number;
  explanations: SkillSearchExplanation[];
}

export interface SkillSearchTelemetrySummary {
  contractVersion: string;
  sample: {
    capacity: number;
    size: number;
    dropped: number;
    deterministic: true;
    maxResultsPerEvent: number;
  };
  countersByEventType: Partial<Record<AssetAuditEventType, number>>;
  countersByMissReason: Partial<Record<SkillSearchMissReason, number>>;
  recent: AssetAuditEvent[];
}

export interface AssetAuditActor {
  kind: AssetAuditActorKind;
  id?: string;
  label?: string;
}

export interface AssetAuditEvent {
  eventId: string;
  eventType: AssetAuditEventType;
  occurredAt: string;
  actor: AssetAuditActor;
  assetId?: string;
  assetKey?: string;
  assetKind?: AssetKind;
  scope?: AssetScope;
  repoId?: string;
  sessionId?: string;
  correlationId?: string;
  search?: {
    query?: SkillSearchQuery;
    resultCount?: number;
    selectedAssetId?: string;
    missReason?: string;
  };
  details?: Record<string, unknown>;
}

export const ASSET_CATALOG_LAYER_PRECEDENCE: readonly AssetCatalogLayer[] = [
  'source',
  'user-installed',
  'vault-only',
  'repo-local',
  'repo-state-overlay',
  'targeted-recommendation',
] as const;

const CONTENT_LAYERS = new Set<AssetCatalogLayer>([
  'source',
  'user-installed',
  'vault-only',
  'repo-local',
]);

const OVERLAY_LAYERS = new Set<AssetCatalogLayer>(['repo-state-overlay']);
const RECOMMENDATION_LAYERS = new Set<AssetCatalogLayer>(['targeted-recommendation']);

export function getAssetLayerPrecedence(layer: AssetCatalogLayer): number {
  return ASSET_CATALOG_LAYER_PRECEDENCE.indexOf(layer);
}

export function isAssetContentLayer(layer: AssetCatalogLayer): layer is AssetContentLayer {
  return CONTENT_LAYERS.has(layer);
}

export function compareAssetCatalogEntries(a: AssetCatalogEntry, b: AssetCatalogEntry): number {
  const precedence = getAssetLayerPrecedence(a.layer) - getAssetLayerPrecedence(b.layer);
  if (precedence !== 0) {
    return precedence;
  }

  const scopeCompare = (a.scope.kind ?? '').localeCompare(b.scope.kind ?? '');
  if (scopeCompare !== 0) {
    return scopeCompare;
  }

  return a.assetId.localeCompare(b.assetId);
}

function sortByPrecedenceDesc(entries: readonly AssetCatalogEntry[]): AssetCatalogEntry[] {
  return [...entries].sort((a, b) => compareAssetCatalogEntries(b, a));
}

function firstByLayer(
  entries: readonly AssetCatalogEntry[],
  layer: AssetCatalogLayer,
  predicate?: (entry: AssetCatalogEntry) => boolean,
): AssetCatalogEntry | undefined {
  return sortByPrecedenceDesc(entries).find(
    (entry) => entry.layer === layer && (!predicate || predicate(entry)),
  );
}

function deriveAvailability(layer: AssetCatalogLayer): AssetAvailability {
  switch (layer) {
    case 'repo-local':
      return 'repo-local';
    case 'vault-only':
      return 'vault-only';
    case 'user-installed':
      return 'installed';
    default:
      return 'source-only';
  }
}

function mergeInstallState(
  selectedEntry: AssetCatalogEntry | undefined,
  contentEntries: readonly AssetCatalogEntry[],
): InstallState | undefined {
  if (!selectedEntry) {
    return undefined;
  }

  const installedPaths: Partial<Record<AssetContentLayer, string>> = {};
  for (const entry of contentEntries) {
    if (!isAssetContentLayer(entry.layer)) {
      continue;
    }

    const entryPaths = entry.installState?.installedPaths;
    if (entryPaths) {
      for (const [layer, entryPath] of Object.entries(entryPaths) as Array<
        [AssetContentLayer, string | undefined]
      >) {
        if (entryPath) {
          installedPaths[layer] = entryPath;
        }
      }
    }

    if (entry.contentPath) {
      installedPaths[entry.layer] = entry.contentPath;
    }
  }

  const base = selectedEntry.installState ?? { availability: deriveAvailability(selectedEntry.layer) };
  return {
    ...base,
    availability: base.availability ?? deriveAvailability(selectedEntry.layer),
    isInstalled:
      base.isInstalled ?? (selectedEntry.layer === 'source' ? false : true),
    isAutoLoaded:
      base.isAutoLoaded ?? base.loadMode === 'always',
    installedPaths: Object.keys(installedPaths).length ? installedPaths : undefined,
  };
}

function choosePrimaryContentEntry(
  contentEntries: readonly AssetCatalogEntry[],
): { entry?: AssetCatalogEntry; reasons: EffectiveResolutionReason[] } {
  const reasons: EffectiveResolutionReason[] = [];
  const repoLocal = firstByLayer(contentEntries, 'repo-local');
  if (repoLocal) {
    reasons.push({
      code: 'selected-repo-local',
      layer: repoLocal.layer,
      message: 'Repo-local assets override global and shipped variants for the active repo.',
    });
    return { entry: repoLocal, reasons };
  }

  const userInstalled = firstByLayer(
    contentEntries,
    'user-installed',
    (entry) => entry.installState?.materialization !== 'pointer',
  );
  if (userInstalled) {
    reasons.push({
      code: 'selected-user-installed',
      layer: userInstalled.layer,
      message: 'Installed user assets override shipped source assets.',
    });
    return { entry: userInstalled, reasons };
  }

  const vaultOnly = firstByLayer(contentEntries, 'vault-only');
  if (vaultOnly) {
    const pointerStub = firstByLayer(
      contentEntries,
      'user-installed',
      (entry) => entry.installState?.materialization === 'pointer',
    );
    reasons.push({
      code: 'selected-vault-only',
      layer: vaultOnly.layer,
      message: 'Vault-only assets provide the effective skill content for on-demand installs.',
    });
    if (pointerStub) {
      reasons.push({
        code: 'vault-preferred-over-pointer',
        layer: 'vault-only',
        message: 'A vault entry is preferred over a pointer stub in ~/.copilot/skills.',
      });
    }
    return { entry: vaultOnly, reasons };
  }

  const pointerOnly = firstByLayer(contentEntries, 'user-installed');
  if (pointerOnly) {
    reasons.push({
      code: 'selected-user-installed',
      layer: pointerOnly.layer,
      message: 'Installed user metadata is used when no stronger materialized variant is present.',
    });
    return { entry: pointerOnly, reasons };
  }

  const source = firstByLayer(contentEntries, 'source');
  if (source) {
    reasons.push({
      code: 'selected-source',
      layer: source.layer,
      message: 'Shipped source assets provide the fallback catalog baseline.',
    });
    return { entry: source, reasons };
  }

  return { reasons };
}

function buildLabels(state: {
  available: boolean;
  installed: boolean;
  enabled: boolean;
  recommended: boolean;
  deprecated: boolean;
  overridden: boolean;
}): EffectiveAssetLabel[] {
  const labels: EffectiveAssetLabel[] = [];
  if (state.available) {
    labels.push('available');
  }
  if (state.installed) {
    labels.push('installed');
  }
  if (state.enabled) {
    labels.push('enabled');
  } else if (state.available) {
    labels.push('disabled');
  }
  if (state.recommended) {
    labels.push('recommended');
  }
  if (state.deprecated) {
    labels.push('deprecated');
  }
  if (state.overridden) {
    labels.push('overridden');
  }
  return labels;
}

export function resolveEffectiveAssetState(
  entries: readonly AssetCatalogEntry[],
): EffectiveAssetState {
  const sortedEntries = sortByPrecedenceDesc(entries);
  const contentEntries = sortedEntries.filter((entry) => isAssetContentLayer(entry.layer));
  const overlayEntries = sortedEntries.filter((entry) => OVERLAY_LAYERS.has(entry.layer));
  const recommendationEntries = sortedEntries.filter((entry) => RECOMMENDATION_LAYERS.has(entry.layer));

  const { entry: selectedEntry, reasons: selectionReasons } = choosePrimaryContentEntry(contentEntries);
  const suppressedEntries = selectedEntry
    ? contentEntries.filter((entry) => entry !== selectedEntry)
    : [];

  const overlay = overlayEntries.find((entry) => entry.overlay)?.overlay;
  const recommendations = recommendationEntries
    .map((entry) => entry.recommendation)
    .filter((value): value is AssetRecommendation => Boolean(value));

  const available = Boolean(selectedEntry);
  const installState = mergeInstallState(selectedEntry, contentEntries);
  const installed = installState?.isInstalled ?? false;
  const enabled = overlay?.enabled ?? available;
  const recommended = recommendations.length > 0;
  const deprecated =
    selectedEntry?.lifecycle === 'deprecated' || selectedEntry?.metadata?.deprecated === true;
  const overridden = suppressedEntries.length > 0;
  const hiddenFromAutoLoad =
    installState?.loadMode === 'on-demand' || selectedEntry?.layer === 'vault-only';

  const reasons: EffectiveResolutionReason[] = [...selectionReasons];
  for (const entry of suppressedEntries) {
    reasons.push({
      code: 'overridden-by-higher-layer',
      layer: entry.layer,
      message: `${entry.layer} is present but suppressed by a higher-precedence layer.`,
    });
  }
  if (overlay?.enabled === true) {
    reasons.push({
      code: 'repo-overlay-enabled',
      layer: 'repo-state-overlay',
      message: 'Repo-state explicitly enables this asset for the current repo context.',
    });
  }
  if (overlay?.enabled === false) {
    reasons.push({
      code: 'repo-overlay-disabled',
      layer: 'repo-state-overlay',
      message: 'Repo-state explicitly disables this asset for the current repo context.',
    });
  }
  for (const recommendation of recommendations) {
    reasons.push({
      code: 'targeted-recommendation',
      layer: 'targeted-recommendation',
      message: recommendation.reason,
    });
  }
  if (deprecated) {
    reasons.push({
      code: 'deprecated',
      layer: selectedEntry?.layer,
      message: 'The effective asset is deprecated and should be hidden or replaced by default.',
    });
  }

  const fallbackEntry = sortedEntries[0];
  return {
    assetId: selectedEntry?.assetId ?? fallbackEntry?.assetId ?? '',
    assetKey: selectedEntry?.assetKey ?? fallbackEntry?.assetKey ?? '',
    kind: selectedEntry?.kind ?? fallbackEntry?.kind ?? 'skill',
    scope: selectedEntry?.scope ?? fallbackEntry?.scope ?? { kind: 'global' },
    selectedEntry,
    selectedLayer: selectedEntry?.layer,
    installState,
    overlay,
    recommendations,
    contributingEntries: contentEntries,
    suppressedEntries,
    available,
    installed,
    enabled,
    recommended,
    deprecated,
    overridden,
    hiddenFromAutoLoad,
    labels: buildLabels({
      available,
      installed,
      enabled,
      recommended,
      deprecated,
      overridden,
    }),
    reasons,
  };
}
