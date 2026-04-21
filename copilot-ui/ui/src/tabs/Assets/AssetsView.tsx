import { useEffect, useMemo, useState } from 'react';
import { Button, FormInput, Panel, StatusBadge, Toolbar } from '../../components';
import { useStoreValue } from '../../lib/store';
import type {
  CatalogActivationState,
  CatalogAssetAuditAnalytics,
  CatalogAuditAssetSummary,
  CatalogAuditRepoSummary,
  CatalogAuditUsageSummary,
  CatalogBundle,
  CatalogBundleMember,
  CatalogEffectiveAsset,
  CatalogEntry,
  InstallSurfaceTarget,
  CatalogProviderProjection,
  CatalogRepoInventoryEntry,
  CatalogRepoInventoryWorkspaceScan,
} from '../../lib/types';
import {
  CATALOG_AUDIT_EVENT_LIMIT,
  CATALOG_SEARCH_RESULT_LIMIT,
  catalogWorkspaceStore,
} from './catalogWorkspaceStore';

type AuthoringScope = 'shared' | 'user-global' | 'repo-local';
type SupportedAuthoringKind = 'skill' | 'agent';

interface CreateTargetOption {
  id: string;
  authoringScope: AuthoringScope;
  label: string;
  description: string;
  repoPath?: string;
  authoringRepoPath?: string;
}

interface WriteTarget {
  id: string;
  label: string;
  description: string;
  authoringScope: AuthoringScope;
  kind: SupportedAuthoringKind;
  assetId: string;
  assetKey: string;
  loadMode: 'always' | 'on-demand';
  expectedHash?: string;
  repoPath?: string;
  authoringRepoPath?: string;
  contentPrefill: string;
  contentPrefillAvailable: boolean;
}

interface AssetDraftState {
  targetId: string;
  kind: SupportedAuthoringKind;
  assetKey: string;
  title: string;
  description: string;
  loadMode: 'always' | 'on-demand';
  triggersInput: string;
  content: string;
}

interface InstallSurfaceCard {
  target: InstallSurfaceTarget;
  title: string;
  description: string;
  windowsCommand: string;
  unixCommand: string;
}

export interface AssetActivationSummary {
  activationLabel: string;
  routingLabel: string;
  bundleLabel: string;
  activeBundleIds: string[];
  membershipBundleIds: string[];
  eligibleByDefault: boolean;
}

const BALANCED_DEFAULT_PROFILE_ID = 'balanced-default';

const INSTALL_SURFACE_CARDS: InstallSurfaceCard[] = [
  {
    target: 'copilot',
    title: 'Copilot',
    description: 'Installs or refreshes the managed Copilot CLI and VS Code asset surfaces.',
    windowsCommand: 'pwsh -File scripts/cli-install.ps1 --all',
    unixCommand: 'bash scripts/cli-install.sh --all',
  },
  {
    target: 'codex',
    title: 'Codex',
    description: 'Installs native Codex instructions, curated agents, generated role wrappers, and shared skills.',
    windowsCommand: 'pwsh -File scripts/codex-install.ps1',
    unixCommand: 'bash scripts/codex-install.sh',
  },
  {
    target: 'antigravity',
    title: 'Antigravity',
    description: 'Installs shared Antigravity skills and updates only the managed instruction-engine block in GEMINI.md.',
    windowsCommand: 'pwsh -File scripts/antigravity-install.ps1',
    unixCommand: 'bash scripts/antigravity-install.sh',
  },
  {
    target: 'all',
    title: 'Everything',
    description: 'Runs the Copilot, Codex, and Antigravity installers in sequence from a single entrypoint.',
    windowsCommand: 'pwsh -File scripts/install-all.ps1',
    unixCommand: 'bash scripts/install-all.sh',
  },
];

type ObservabilityEvidence = 'none' | 'proxy-only' | 'authoritative' | 'mixed';

interface ObservabilitySummary {
  searchedCount: number;
  selectedCount: number;
  invocationCount: number;
  explicitInvocationCount: number;
  proxyInvocationCount: number;
  evidence: ObservabilityEvidence;
}

function formatCount(value: number | undefined): string {
  return Number.isFinite(value) ? String(value) : '0';
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) {
    return '—';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}

function readCount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function resolveObservabilityEvidence(
  usage: CatalogAuditUsageSummary | null | undefined,
  fallback?: string | null
): ObservabilityEvidence {
  const normalizedFallback = String(fallback || usage?.evidence || '').trim().toLowerCase();
  if (
    normalizedFallback === 'none'
    || normalizedFallback === 'proxy-only'
    || normalizedFallback === 'authoritative'
    || normalizedFallback === 'mixed'
  ) {
    return normalizedFallback;
  }

  const explicitInvocationCount = readCount(usage?.explicitInvocationCount);
  const proxyInvocationCount = readCount(usage?.proxyInvocationCount ?? usage?.proxyInferredCount);
  if (explicitInvocationCount > 0 && proxyInvocationCount > 0) {
    return 'mixed';
  }
  if (explicitInvocationCount > 0) {
    return 'authoritative';
  }
  if (proxyInvocationCount > 0) {
    return 'proxy-only';
  }
  return 'none';
}

function describeObservabilityEvidence(summary: ObservabilitySummary): string {
  if (summary.evidence === 'mixed') {
    return `Mixed evidence: ${summary.explicitInvocationCount} explicit + ${summary.proxyInvocationCount} proxy-only fallback invocation(s).`;
  }
  if (summary.evidence === 'authoritative') {
    return `${summary.explicitInvocationCount} authoritative asset.invoked observation(s).`;
  }
  if (summary.evidence === 'proxy-only') {
    return `${summary.proxyInvocationCount} proxy-only invocation(s) inferred from sampled planner/agent usage because no explicit asset.invoked event was recorded.`;
  }
  return 'No invocation evidence has been observed yet.';
}

function buildAssetObservabilitySummary(asset: CatalogAuditAssetSummary | null | undefined): ObservabilitySummary {
  const explicitInvocationCount = readCount(asset?.usage?.explicitInvocationCount);
  const proxyInvocationCount = readCount(asset?.usage?.proxyInvocationCount ?? asset?.usage?.proxyInferredCount);
  return {
    searchedCount: readCount(asset?.search?.sampled?.searchedCount ?? asset?.search?.sampled?.resultCount),
    selectedCount: readCount(asset?.search?.sampled?.selectedCount),
    invocationCount: readCount(asset?.usage?.invocationCount),
    explicitInvocationCount,
    proxyInvocationCount,
    evidence: resolveObservabilityEvidence(asset?.usage),
  };
}

function buildScopeObservabilitySummary(repos: CatalogAuditRepoSummary[]): ObservabilitySummary {
  return repos.reduce<ObservabilitySummary>((summary, repo) => {
    summary.searchedCount += readCount(repo.search?.searchedCount ?? repo.search?.queryCount);
    summary.selectedCount += readCount(repo.search?.selectedCount);
    summary.invocationCount += readCount(repo.usage?.invocationCount);
    summary.explicitInvocationCount += readCount(repo.usage?.explicitInvocationCount);
    summary.proxyInvocationCount += readCount(repo.usage?.proxyInvocationCount ?? repo.usage?.proxyInferredCount);
    return summary;
  }, {
    searchedCount: 0,
    selectedCount: 0,
    invocationCount: 0,
    explicitInvocationCount: 0,
    proxyInvocationCount: 0,
    evidence: 'none',
  });
}

function normalizePath(input: string | null | undefined): string {
  return typeof input === 'string' ? input.trim() : '';
}

function normalizePathForComparison(input: string | null | undefined): string {
  return normalizePath(input).replace(/\//g, '\\').toLowerCase();
}

function samePath(left: string | null | undefined, right: string | null | undefined): boolean {
  const normalizedLeft = normalizePathForComparison(left);
  const normalizedRight = normalizePathForComparison(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

function dedupePaths(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalizedValue = normalizePath(value);
    if (!normalizedValue) {
      continue;
    }
    const comparisonKey = normalizePathForComparison(normalizedValue);
    if (!comparisonKey || seen.has(comparisonKey)) {
      continue;
    }
    seen.add(comparisonKey);
    result.push(normalizedValue);
  }
  return result;
}

function parsePathListInput(input: string): string[] {
  return dedupePaths(
    input
      .split(/\r?\n|,/)
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

function buildPathListKey(values: string[]): string {
  return dedupePaths(values)
    .map((value) => normalizePathForComparison(value))
    .join('|');
}

function formatPathList(values: string[] | null | undefined): string {
  return Array.isArray(values) && values.length > 0 ? values.join(' · ') : '—';
}

function matchesText(asset: CatalogEffectiveAsset, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  const selectedEntry = asset.selectedEntry;
  const searchFields = [
    asset.assetId,
    asset.assetKey,
    asset.kind,
    asset.selectedLayer,
    selectedEntry?.title,
    selectedEntry?.description,
    readMetadataString(selectedEntry, 'provider'),
    readMetadataString(selectedEntry, 'sourcePackage'),
    readMetadataString(selectedEntry, 'namespace'),
    readMetadataString(selectedEntry, 'logicalName'),
    ...(asset.labels ?? []),
  ];

  return searchFields.some((field) => String(field || '').toLowerCase().includes(normalized));
}

function matchesFilters(
  asset: CatalogEffectiveAsset,
  filters: ReturnType<typeof catalogWorkspaceStore.getState>['filters']
): boolean {
  if (filters.kind !== 'all' && asset.kind !== filters.kind) {
    return false;
  }
  if (filters.scopeKind !== 'all' && asset.scope?.kind !== filters.scopeKind) {
    return false;
  }
  if (filters.installedOnly && !asset.installed) {
    return false;
  }
  if (filters.enabledOnly && !asset.enabled) {
    return false;
  }
  if (filters.availableOnly && !asset.available) {
    return false;
  }
  if (filters.overriddenOnly && !asset.overridden) {
    return false;
  }

  return matchesText(asset, filters.text);
}

function summarizeEntryScope(entry: CatalogEntry): string {
  const scope = entry.scope?.kind || 'unknown';
  const repoLabel = typeof entry.scope?.displayName === 'string' ? entry.scope.displayName : '';
  return repoLabel ? `${scope} · ${repoLabel}` : scope;
}

function isSupportedAuthoringKind(kind: unknown): kind is SupportedAuthoringKind {
  return kind === 'skill' || kind === 'agent';
}

function readStringList(input: unknown): string[] {
  return Array.isArray(input)
    ? input
      .map((value) => String(value || '').trim())
      .filter(Boolean)
    : [];
}

function parseListInput(input: string): string[] {
  return input
    .split(/[\r\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function formatListInput(values: string[]): string {
  return values.join(', ');
}

function readLoadMode(entry: CatalogEntry | null | undefined, asset: CatalogEffectiveAsset | null | undefined): 'always' | 'on-demand' {
  const raw = String(
    entry?.installState?.loadMode ||
    entry?.metadata?.manifestLoadMode ||
    asset?.installState?.loadMode ||
    'on-demand'
  ).trim().toLowerCase();

  return raw === 'always' ? 'always' : 'on-demand';
}

function readTriggers(entry: CatalogEntry | null | undefined, asset: CatalogEffectiveAsset | null | undefined): string[] {
  return readStringList(entry?.metadata?.triggersOn ?? asset?.selectedEntry?.metadata?.triggersOn);
}

function readContentHash(entry: CatalogEntry | null | undefined): string {
  return typeof entry?.installState?.contentHash === 'string' ? entry.installState.contentHash : '';
}

function readMetadataString(entry: CatalogEntry | null | undefined, key: string): string {
  const value = entry?.metadata?.[key];
  return typeof value === 'string' ? value.trim() : '';
}

function readProvenanceString(entry: CatalogEntry | null | undefined, key: string): string {
  const provenance = entry?.provenance;
  if (!provenance || typeof provenance !== 'object') {
    return '';
  }

  const value = (provenance as Record<string, unknown>)[key];
  return typeof value === 'string' ? value.trim() : '';
}

function readMetadataBoolean(entry: CatalogEntry | null | undefined, key: string): boolean {
  return entry?.metadata?.[key] === true;
}

function summarizeProvenance(entry: CatalogEntry | null | undefined): string {
  const provider = readMetadataString(entry, 'provider') || readMetadataString(entry, 'source');
  const sourcePackage = readMetadataString(entry, 'sourcePackage');
  const namespace = readMetadataString(entry, 'namespace');
  const segments = [];
  if (sourcePackage) {
    segments.push(sourcePackage);
  } else if (provider) {
    segments.push(provider);
  }
  if (namespace) {
    segments.push(`namespace: ${namespace}`);
  }
  if (readMetadataBoolean(entry, 'readOnly')) {
    segments.push('read-only');
  }
  return segments.join(' · ');
}

function normalizeBundleMembers(bundle: CatalogBundle | null | undefined): CatalogBundleMember[] {
  return Array.isArray(bundle?.members) ? bundle.members.filter((member): member is CatalogBundleMember => Boolean(member?.assetId)) : [];
}

function isBundleActive(bundle: CatalogBundle | null | undefined): boolean {
  const activationStatus = String(bundle?.activationStatus || '').trim().toLowerCase();
  if (activationStatus) {
    return activationStatus === 'active';
  }
  return String(bundle?.status || '').trim().toLowerCase() === 'active';
}

function countEligibleBundleMembers(bundle: CatalogBundle | null | undefined): number {
  if (!isBundleActive(bundle)) {
    return 0;
  }

  return normalizeBundleMembers(bundle).filter((member) => member.available && member.installed && member.enabled && !member.missing).length;
}

export function buildAssetBundleIndex(bundles: CatalogBundle[]): Record<string, CatalogBundle[]> {
  return bundles.reduce<Record<string, CatalogBundle[]>>((index, bundle) => {
    for (const member of normalizeBundleMembers(bundle)) {
      if (!index[member.assetId]) {
        index[member.assetId] = [];
      }
      index[member.assetId].push(bundle);
    }

    return index;
  }, {});
}

export function deriveAssetActivationSummary(
  asset: CatalogEffectiveAsset,
  memberships: CatalogBundle[] | undefined
): AssetActivationSummary {
  const bundleMemberships = Array.isArray(memberships) ? memberships : [];
  const activeMemberships = bundleMemberships.filter((bundle) => isBundleActive(bundle));
  const eligibleByDefault =
    activeMemberships.length > 0 &&
    Boolean(asset.available) &&
    Boolean(asset.installed) &&
    Boolean(asset.enabled) &&
    !Boolean(asset.hiddenFromAutoLoad);

  let activationLabel = 'direct-only';
  if (activeMemberships.length > 0) {
    activationLabel = 'active';
  } else if (bundleMemberships.length > 0) {
    activationLabel = 'inactive-bundle';
  }

  let routingLabel = 'manual-review';
  if (eligibleByDefault) {
    routingLabel = 'auto-routable';
  } else if (activeMemberships.length === 0 && bundleMemberships.length > 0) {
    routingLabel = 'bundle inactive';
  } else if (!asset.installed) {
    routingLabel = 'not installed';
  } else if (!asset.enabled) {
    routingLabel = 'overlay disabled';
  } else if (!asset.available) {
    routingLabel = 'unavailable';
  } else if (asset.hiddenFromAutoLoad) {
    routingLabel = 'manual only';
  }

  return {
    activationLabel,
    routingLabel,
    bundleLabel:
      activeMemberships.length > 0
        ? activeMemberships.map((bundle) => bundle.title || bundle.bundleId).join(', ')
        : bundleMemberships.length > 0
        ? bundleMemberships.map((bundle) => bundle.title || bundle.bundleId).join(', ')
        : 'No surfaced bundle membership',
    activeBundleIds: activeMemberships.map((bundle) => bundle.bundleId),
    membershipBundleIds: bundleMemberships.map((bundle) => bundle.bundleId),
    eligibleByDefault,
  };
}

function buildRepoLabel(repo: CatalogRepoInventoryEntry | null | undefined): string {
  return String(repo?.repoLabel || repo?.repoPath || repo?.repoId || 'Unknown repo');
}

function bundleHasTag(bundle: CatalogBundle, tag: string): boolean {
  return readStringList(bundle.tags).some((value) => value.toLowerCase() === tag.toLowerCase());
}

interface BundleLifecycleSummary {
  memberCount: number;
  availableCount: number;
  installedCount: number;
  enabledCount: number;
  missingCount: number;
  partiallyInstalled: boolean;
  fullyInstalled: boolean;
}

function summarizeBundleLifecycle(bundle: CatalogBundle | null | undefined): BundleLifecycleSummary {
  const members = normalizeBundleMembers(bundle);
  const stats = bundle?.stats ?? {};
  const memberCount = Number(stats.memberCount ?? members.length ?? 0);
  const availableCount = Number(stats.availableCount ?? members.filter((member) => member.available).length ?? 0);
  const installedCount = Number(stats.installedCount ?? members.filter((member) => member.installed).length ?? 0);
  const enabledCount = Number(stats.enabledCount ?? members.filter((member) => member.enabled).length ?? 0);
  const missingCount = Number(stats.missingCount ?? members.filter((member) => member.missing).length ?? 0);
  const fullyInstalled = memberCount > 0 && installedCount >= memberCount && missingCount === 0;
  const partiallyInstalled = !fullyInstalled && (missingCount > 0 || (installedCount > 0 && installedCount < memberCount));
  return {
    memberCount,
    availableCount,
    installedCount,
    enabledCount,
    missingCount,
    partiallyInstalled,
    fullyInstalled,
  };
}

function readBundlePolicy(bundle: CatalogBundle | null | undefined): Record<string, unknown> {
  return bundle?.uninstallPolicy && typeof bundle.uninstallPolicy === 'object'
    ? bundle.uninstallPolicy as Record<string, unknown>
    : {};
}

function isBundleUninstallable(bundle: CatalogBundle | null | undefined): boolean {
  return readBundlePolicy(bundle).removesInstalledMembers !== false;
}

function resolveBundleLifecycleStatus(bundle: CatalogBundle | null | undefined): string {
  const lifecycle = summarizeBundleLifecycle(bundle);
  if (lifecycle.missingCount > 0) {
    return 'missing-members';
  }
  if (lifecycle.partiallyInstalled) {
    return 'partial-members';
  }
  if (lifecycle.fullyInstalled) {
    return 'installed-members';
  }
  return 'not-installed';
}

function describeBundleTargeting(bundle: CatalogBundle | null | undefined): string {
  const targeting = bundle?.targeting && typeof bundle.targeting === 'object'
    ? bundle.targeting as Record<string, unknown>
    : {};
  const segments: string[] = [];
  const scopeKinds = readStringList(targeting.scopeKinds);
  const frameworks = readStringList(targeting.frameworks);
  const languages = readStringList(targeting.languages);
  const stacks = readStringList(targeting.stacks);
  const tags = readStringList(targeting.tags);
  const loadMode = typeof targeting.loadMode === 'string' ? targeting.loadMode.trim() : '';

  if (scopeKinds.length > 0) {
    segments.push(`scope: ${scopeKinds.join(', ')}`);
  }
  if (frameworks.length > 0) {
    segments.push(`frameworks: ${frameworks.join(', ')}`);
  }
  if (languages.length > 0) {
    segments.push(`languages: ${languages.join(', ')}`);
  }
  if (stacks.length > 0) {
    segments.push(`stacks: ${stacks.join(', ')}`);
  }
  if (tags.length > 0) {
    segments.push(`tags: ${tags.join(', ')}`);
  }
  if (loadMode) {
    segments.push(`preferred load: ${loadMode}`);
  }

  return segments.length > 0 ? segments.join(' · ') : 'No targeting metadata surfaced.';
}

function describeBundleUninstallPolicy(bundle: CatalogBundle | null | undefined): string {
  const policy = readBundlePolicy(bundle);
  const segments = [
    policy.removesInstalledMembers !== false ? 'removes managed members' : 'leaves managed members installed',
    policy.clearsActivationState !== false ? 'clears activation state' : 'leaves activation state in place',
    policy.clearsRepoOverlayState !== false ? 'clears repo overlay state' : 'leaves repo overlay state in place',
    policy.preservesExternalPackages !== false ? 'preserves external packages' : 'may remove external packages',
  ];
  return segments.join(' · ');
}

function describeActivationSource(source: string | null | undefined): string {
  const normalized = String(source || '').trim().toLowerCase();
  if (normalized === 'repo-override') {
    return 'repo override';
  }
  if (normalized === 'user-global') {
    return 'user-global defaults';
  }
  return 'provider defaults';
}

function readProviderStateString(provider: CatalogProviderProjection | null | undefined, key: string): string {
  const value = provider?.state?.[key];
  return typeof value === 'string' ? value.trim() : '';
}

function providerLooksInstalled(provider: CatalogProviderProjection | null | undefined): boolean {
  if (!provider) {
    return false;
  }
  if (provider.state?.installed === true) {
    return true;
  }
  return Number(provider.discoveredAssets?.count || 0) > 0;
}

function resolveActiveRepo(
  repos: CatalogRepoInventoryEntry[],
  selectedRepo: CatalogRepoInventoryEntry | null | undefined,
  activeRepoPath: string,
  activeRepoId: string
): CatalogRepoInventoryEntry | null {
  if (selectedRepo && (normalizePath(selectedRepo.repoPath) || String(selectedRepo.repoId || '').trim())) {
    return selectedRepo;
  }

  return repos.find((repo) => (
    (activeRepoId && repo.repoId === activeRepoId) ||
    (activeRepoPath && samePath(repo.repoPath, activeRepoPath))
  )) ?? null;
}

function buildCreateTargets(
  activeRepo: CatalogRepoInventoryEntry | null,
  workspaceRepo: CatalogRepoInventoryEntry | null,
  activeRepoPath: string
): CreateTargetOption[] {
  const targets: CreateTargetOption[] = [];

  const repoPath = normalizePath(activeRepo?.repoPath) || normalizePath(activeRepoPath);
  if (repoPath) {
    targets.push({
      id: `repo-local:${repoPath}`,
      authoringScope: 'repo-local',
      label: `Repo-local (${buildRepoLabel(activeRepo)})`,
      description: `Creates a repo-scoped asset under ${repoPath}\\.github\\agents or ${repoPath}\\.github\\skills.`,
      repoPath,
    });
  }

  targets.push({
    id: 'user-global',
    authoringScope: 'user-global',
    label: 'User-global (~/.copilot)',
    description: 'Creates a personal global asset under ~/.copilot/agents, ~/.copilot/skills, or ~/.copilot/skills-vault.',
  });

  if (repoPath && workspaceRepo?.repoPath && samePath(repoPath, workspaceRepo.repoPath)) {
    targets.unshift({
      id: 'shared',
      authoringScope: 'shared',
      label: 'Shared shipped asset (engine-assets/*)',
      description: 'Creates a shipped asset in engine-assets/* and updates the shared manifest in this Elegy Copilot workspace.',
      authoringRepoPath: normalizePath(workspaceRepo.repoPath),
    });
  }

  return targets;
}

function buildEditableTargets(
  asset: CatalogEffectiveAsset | null,
  entries: CatalogEntry[],
  activeRepo: CatalogRepoInventoryEntry | null,
  workspaceRepo: CatalogRepoInventoryEntry | null,
  previewContent: string,
  previewStatus: string
): WriteTarget[] {
  if (!asset || !isSupportedAuthoringKind(asset.kind)) {
    return [];
  }

  const targets = new Map<string, WriteTarget>();
  const candidateEntries: CatalogEntry[] = [];
  if (asset.selectedEntry) {
    candidateEntries.push(asset.selectedEntry);
  }
  candidateEntries.push(...entries);

  const activeRepoPath = normalizePath(activeRepo?.repoPath);
  const workspaceRepoPath = normalizePath(workspaceRepo?.repoPath);

  for (const entry of candidateEntries) {
    if (!entry || !isSupportedAuthoringKind(entry.kind)) {
      continue;
    }
    if (readMetadataBoolean(entry, 'readOnly')) {
      continue;
    }

    if ((entry.layer === 'user-installed' || entry.layer === 'vault-only') && !targets.has('user-global')) {
      targets.set('user-global', {
        id: 'user-global',
        label: 'User-global asset',
        description: entry.contentPath
          ? `Updates the authoritative file at ${entry.contentPath}.`
          : 'Updates the authoritative user-global asset under ~/.copilot.',
        authoringScope: 'user-global',
        kind: entry.kind,
        assetId: entry.assetId,
        assetKey: entry.assetKey || asset.assetKey,
        loadMode: readLoadMode(entry, asset),
        expectedHash: readContentHash(entry) || undefined,
        contentPrefill: previewStatus === 'ready' ? previewContent : '',
        contentPrefillAvailable: previewStatus === 'ready',
      });
    }

    if (entry.layer === 'repo-local' && entry.scope?.repoPath) {
      const repoPath = normalizePath(entry.scope.repoPath);
      const targetId = `repo-local:${repoPath}`;
      if (!targets.has(targetId)) {
        targets.set(targetId, {
          id: targetId,
          label: `Repo-local override (${entry.scope.displayName || repoPath})`,
          description: entry.contentPath
            ? `Updates the authoritative repo-local asset at ${entry.contentPath}.`
            : `Updates the authoritative repo-local asset in ${repoPath}\\.github\\*.`,
          authoringScope: 'repo-local',
          kind: entry.kind,
          assetId: entry.assetId,
          assetKey: entry.assetKey || asset.assetKey,
          loadMode: readLoadMode(entry, asset),
          expectedHash: readContentHash(entry) || undefined,
          repoPath,
          contentPrefill: '',
          contentPrefillAvailable: false,
        });
      }
    }

    if (entry.layer === 'source' && activeRepoPath && workspaceRepoPath && samePath(activeRepoPath, workspaceRepoPath) && !targets.has('shared')) {
      targets.set('shared', {
        id: 'shared',
        label: 'Shared shipped asset',
        description: entry.contentPath
          ? `Updates the authoritative shipped asset at ${entry.contentPath}.`
          : 'Updates the authoritative shipped asset under engine-assets/*.',
        authoringScope: 'shared',
        kind: entry.kind,
        assetId: entry.assetId,
        assetKey: entry.assetKey || asset.assetKey,
        loadMode: readLoadMode(entry, asset),
        expectedHash: readContentHash(entry) || undefined,
        authoringRepoPath: workspaceRepoPath,
        contentPrefill: '',
        contentPrefillAvailable: false,
      });
    }
  }

  return Array.from(targets.values());
}

function createEmptyDraft(targetId = 'user-global'): AssetDraftState {
  return {
    targetId,
    kind: 'skill',
    assetKey: '',
    title: '',
    description: '',
    loadMode: 'on-demand',
    triggersInput: '',
    content: '',
  };
}

function buildEditDraft(asset: CatalogEffectiveAsset, target: WriteTarget): AssetDraftState {
  return {
    targetId: target.id,
    kind: target.kind,
    assetKey: target.assetKey,
    title: String(target.authoringScope === 'shared'
      ? target.assetKey
      : asset.selectedEntry?.title || target.assetKey
    ),
    description: String(asset.selectedEntry?.description || ''),
    loadMode: target.loadMode,
    triggersInput: formatListInput(readTriggers(asset.selectedEntry, asset)),
    content: target.contentPrefill,
  };
}

function describeRepoAssetSummary(repo: CatalogRepoInventoryEntry): string {
  const skillCount = repo.assets?.skillCount ?? 0;
  const agentCount = repo.assets?.agentCount ?? 0;
  const frameworks = readStringList(repo.hints?.frameworks);
  const targets = readStringList(repo.hints?.targets);
  const hintSummary = [...frameworks.slice(0, 2), ...targets.slice(0, 2)].join(', ');
  return `${skillCount} skill(s), ${agentCount} agent(s)${hintSummary ? ` · ${hintSummary}` : ''}`;
}

export default function AssetsView() {
  const catalogState = useStoreValue(catalogWorkspaceStore);
  const [repoLabelInput, setRepoLabelInput] = useState('');
  const [customScanRootsInput, setCustomScanRootsInput] = useState('');
  const [customScanRootsDirty, setCustomScanRootsDirty] = useState(false);
  const [plannerProfileDraft, setPlannerProfileDraft] = useState(BALANCED_DEFAULT_PROFILE_ID);
  const [createDraft, setCreateDraft] = useState<AssetDraftState>(createEmptyDraft());
  const [editTargetId, setEditTargetId] = useState('');
  const [editDraft, setEditDraft] = useState<AssetDraftState>(createEmptyDraft());
  const [editDraftContextKey, setEditDraftContextKey] = useState('');
  const [editDraftDirty, setEditDraftDirty] = useState(false);
  const [confirmRemoveTargetId, setConfirmRemoveTargetId] = useState<string | null>(null);

  useEffect(() => {
    void catalogWorkspaceStore.loadWorkspace();
  }, []);

  const filteredAssets = useMemo(() => {
    return catalogState.assets.filter((asset) => matchesFilters(asset, catalogState.filters));
  }, [catalogState.assets, catalogState.filters]);

  const selectedAsset = catalogState.selectedAsset;
  const selectedEntry = selectedAsset?.selectedEntry ?? null;
  const selectedReasons = selectedAsset?.reasons ?? [];
  const selectedContributors = selectedAsset?.contributingEntries ?? [];
  const selectedSuppressed = selectedAsset?.suppressedEntries ?? [];
  const selectedProvenance = summarizeProvenance(selectedEntry);
  const selectedIsReadOnly = readMetadataBoolean(selectedEntry, 'readOnly');
  const bundleIndex = useMemo(() => buildAssetBundleIndex(catalogState.bundles), [catalogState.bundles]);
  const selectedAssetActivation = useMemo(
    () => (selectedAsset ? deriveAssetActivationSummary(selectedAsset, bundleIndex[selectedAsset.assetId]) : null),
    [selectedAsset, bundleIndex]
  );
  const recommendedAssets = catalogState.assets.filter((asset) => asset.recommended);
  const workflowBundles = useMemo(
    () => catalogState.bundles.filter((bundle) => bundle.bundleId === 'superpowers-workflow' || bundleHasTag(bundle, 'superpowers')),
    [catalogState.bundles]
  );
  const auditCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const event of catalogState.auditEvents) {
      const key = event.eventType || 'unknown';
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Array.from(counts.entries()).slice(0, 5);
  }, [catalogState.auditEvents]);
  const auditAnalytics: CatalogAssetAuditAnalytics | null = catalogState.auditAnalytics;

  const summaryStats = catalogState.summary?.stats;
  const activationState: CatalogActivationState | null = catalogState.summary?.activation ?? null;
  const providerProjections = Array.isArray(catalogState.summary?.providers)
    ? catalogState.summary.providers as CatalogProviderProjection[]
    : [];
  const runtimeProjection = catalogState.runtimeHealth?.projection;
  const repoInventory = catalogState.repoInventory;
  const repoList = repoInventory?.repos ?? [];
  const workspaceScan: CatalogRepoInventoryWorkspaceScan | null = repoInventory?.workspaceScan ?? null;
  const savedCustomScanRoots = workspaceScan?.customScanRoots ?? [];
  const draftCustomScanRoots = useMemo(() => parsePathListInput(customScanRootsInput), [customScanRootsInput]);
  const customScanRootsChanged = useMemo(
    () => buildPathListKey(savedCustomScanRoots) !== buildPathListKey(draftCustomScanRoots),
    [savedCustomScanRoots, draftCustomScanRoots]
  );
  const bundleStats = useMemo(() => {
    const totalCount = catalogState.bundles.length;
    const activeCount = activationState?.activeBundleIds?.length ?? catalogState.bundles.filter((bundle) => isBundleActive(bundle)).length;
    const defaultRecommendedCount = catalogState.bundles.filter((bundle) => bundle.defaultRecommended).length;
    const eligibleMemberCount = catalogState.bundles.reduce((count, bundle) => count + countEligibleBundleMembers(bundle), 0);
    return {
      totalCount,
      activeCount,
      defaultRecommendedCount,
      eligibleMemberCount,
    };
  }, [activationState?.activeBundleIds, catalogState.bundles]);
  const workspaceRepo = useMemo(
    () => repoList.find((repo) => (repo.sources ?? []).includes('workspace')) ?? null,
    [repoList]
  );
  const activeRepo = useMemo(
    () => resolveActiveRepo(repoList, repoInventory?.selectedRepo ?? null, catalogState.activeRepoPath, catalogState.activeRepoId),
    [repoList, repoInventory?.selectedRepo, catalogState.activeRepoPath, catalogState.activeRepoId]
  );
  const createTargets = useMemo(
    () => buildCreateTargets(activeRepo, workspaceRepo, catalogState.activeRepoPath),
    [activeRepo, workspaceRepo, catalogState.activeRepoPath]
  );
  const editableTargets = useMemo(
    () => buildEditableTargets(
      selectedAsset,
      catalogState.selectedEntries,
      activeRepo,
      workspaceRepo,
      catalogState.selectedAssetContent,
      catalogState.selectedAssetContentStatus
    ),
    [
      selectedAsset,
      catalogState.selectedEntries,
      activeRepo,
      workspaceRepo,
      catalogState.selectedAssetContent,
      catalogState.selectedAssetContentStatus,
    ]
  );
  const selectedCreateTarget = createTargets.find((target) => target.id === createDraft.targetId) ?? createTargets[0] ?? null;
  const selectedEditTarget = editableTargets.find((target) => target.id === editTargetId) ?? editableTargets[0] ?? null;
  const selectedBundle = useMemo(
    () => catalogState.bundles.find((bundle) => bundle.bundleId === catalogState.selectedBundleId) ?? null,
    [catalogState.bundles, catalogState.selectedBundleId]
  );
  const selectedBundleMembers = useMemo(
    () => normalizeBundleMembers(selectedBundle),
    [selectedBundle]
  );
  const editContextKey = `${selectedAsset?.assetId || ''}:${selectedEditTarget?.id || ''}`;
  const sharedEditBlocked = Boolean(
    selectedAsset &&
    catalogState.selectedEntries.some((entry) => entry.layer === 'source') &&
    !editableTargets.some((target) => target.authoringScope === 'shared')
  );
  const hasInstallableSource = Boolean(catalogState.selectedEntries.some((entry) => entry.layer === 'source'));
  const canToggleEnabled = Boolean(
    selectedAsset &&
    isSupportedAuthoringKind(selectedAsset.kind) &&
    normalizePath(activeRepo?.repoPath || catalogState.activeRepoPath)
  );
  const activationRepoPath = normalizePath(activeRepo?.repoPath || catalogState.activeRepoPath) || undefined;
  const repoOverrideActive = Boolean(activationState?.repoOverride?.active);
  const selectedProviderId = String(readProvenanceString(selectedEntry, 'providerId') || readMetadataString(selectedEntry, 'provider') || '').trim();
  const selectedProvider = providerProjections.find((provider) => provider.providerId === selectedProviderId) ?? null;
  const selectedProviderInstallable = Boolean(
    selectedProvider && String(selectedProvider.installStrategy || '').trim().toLowerCase() === 'managed-import'
  );
  const selectedAssetAnalytics = useMemo(
    () => auditAnalytics?.assets.find((asset) => asset.assetId === selectedAsset?.assetId) ?? null,
    [auditAnalytics, selectedAsset?.assetId]
  );
  const selectedAssetObservability = useMemo(
    () => buildAssetObservabilitySummary(selectedAssetAnalytics),
    [selectedAssetAnalytics]
  );
  const scopeObservability = useMemo(() => {
    const repoSummaries = Array.isArray(auditAnalytics?.repos) ? auditAnalytics.repos : [];
    const matchingSummaries = catalogState.activeRepoId
      ? repoSummaries.filter((repo) => repo.repoId === catalogState.activeRepoId)
      : repoSummaries;
    const summary = buildScopeObservabilitySummary(matchingSummaries.length > 0 ? matchingSummaries : repoSummaries);
    return {
      ...summary,
      evidence: resolveObservabilityEvidence({
        explicitInvocationCount: summary.explicitInvocationCount,
        proxyInvocationCount: summary.proxyInvocationCount,
      }),
    };
  }, [auditAnalytics?.repos, catalogState.activeRepoId]);

  useEffect(() => {
    setCreateDraft((current) => {
      const nextTarget = createTargets.find((target) => target.id === current.targetId) ?? createTargets[0] ?? null;
      if (!nextTarget) {
        return current;
      }
      return current.targetId === nextTarget.id ? current : { ...current, targetId: nextTarget.id };
    });
  }, [createTargets]);

  useEffect(() => {
    const nextTarget = editableTargets.find((target) => target.id === editTargetId) ?? editableTargets[0] ?? null;
    const nextTargetId = nextTarget?.id || '';
    if (editTargetId !== nextTargetId) {
      setEditTargetId(nextTargetId);
      setConfirmRemoveTargetId(null);
    }
  }, [editableTargets, editTargetId]);

  useEffect(() => {
    if (!selectedAsset || !selectedEditTarget) {
      setEditDraft(createEmptyDraft());
      setEditDraftContextKey('');
      setEditDraftDirty(false);
      setConfirmRemoveTargetId(null);
      return;
    }

    if (editDraftContextKey !== editContextKey || !editDraftDirty) {
      setEditDraft(buildEditDraft(selectedAsset, selectedEditTarget));
      setEditDraftContextKey(editContextKey);
      setEditDraftDirty(false);
      setConfirmRemoveTargetId(null);
    }
  }, [selectedAsset, selectedEditTarget, editContextKey, editDraftContextKey, editDraftDirty]);

  useEffect(() => {
    const nextPlannerProfile = activationState?.plannerProfile || BALANCED_DEFAULT_PROFILE_ID;
    setPlannerProfileDraft((current) => (current === nextPlannerProfile ? current : nextPlannerProfile));
  }, [activationState?.plannerProfile]);

  useEffect(() => {
    const nextInput = savedCustomScanRoots.join('\n');
    if (!customScanRootsDirty) {
      setCustomScanRootsInput((current) => (current === nextInput ? current : nextInput));
    }
  }, [savedCustomScanRoots, customScanRootsDirty]);

  const handleCreateDraftChange = (updates: Partial<AssetDraftState>) => {
    setCreateDraft((current) => ({ ...current, ...updates }));
  };

  const handleEditDraftChange = (updates: Partial<AssetDraftState>) => {
    setEditDraftDirty(true);
    setEditDraft((current) => ({ ...current, ...updates }));
  };

  const handleCreateAsset = async () => {
    if (!selectedCreateTarget || !createDraft.assetKey.trim() || !createDraft.content.trim()) {
      return;
    }

    await catalogWorkspaceStore.createAsset({
      authoringScope: selectedCreateTarget.authoringScope,
      kind: createDraft.kind,
      assetKey: createDraft.assetKey.trim(),
      title: createDraft.title.trim() || undefined,
      description: createDraft.description.trim() || undefined,
      content: createDraft.content,
      loadMode: createDraft.kind === 'skill' ? createDraft.loadMode : undefined,
      triggersOn: createDraft.kind === 'skill' ? parseListInput(createDraft.triggersInput) : undefined,
      repoPath: selectedCreateTarget.repoPath,
      authoringRepoPath: selectedCreateTarget.authoringRepoPath,
    });

    setCreateDraft((current) => ({
      ...createEmptyDraft(selectedCreateTarget.id),
      targetId: selectedCreateTarget.id,
      kind: current.kind,
      loadMode: current.kind === 'skill' ? current.loadMode : 'on-demand',
    }));
  };

  const handleUpdateAsset = async () => {
    if (!selectedAsset || !selectedEditTarget || !editDraft.content.trim()) {
      return;
    }

    await catalogWorkspaceStore.updateAsset({
      authoringScope: selectedEditTarget.authoringScope,
      kind: selectedEditTarget.kind,
      assetId: selectedEditTarget.assetId,
      assetKey: selectedEditTarget.assetKey,
      title: editDraft.title.trim() || undefined,
      description: editDraft.description.trim() || undefined,
      content: editDraft.content,
      loadMode: selectedEditTarget.kind === 'skill' ? editDraft.loadMode : undefined,
      triggersOn: selectedEditTarget.kind === 'skill' ? parseListInput(editDraft.triggersInput) : undefined,
      expectedHash: selectedEditTarget.expectedHash,
      repoPath: selectedEditTarget.repoPath,
      authoringRepoPath: selectedEditTarget.authoringRepoPath,
    });
  };

  const handleDeleteTarget = async () => {
    if (!selectedEditTarget) {
      return;
    }

    await catalogWorkspaceStore.deleteAsset({
      authoringScope: selectedEditTarget.authoringScope,
      kind: selectedEditTarget.kind,
      assetId: selectedEditTarget.assetId,
      assetKey: selectedEditTarget.assetKey,
      loadMode: selectedEditTarget.kind === 'skill' ? editDraft.loadMode : undefined,
      expectedHash: selectedEditTarget.expectedHash,
      repoPath: selectedEditTarget.repoPath,
      authoringRepoPath: selectedEditTarget.authoringRepoPath,
    });

    setConfirmRemoveTargetId(null);
  };

  const handleInstallAsset = async () => {
    if (!selectedAsset?.assetId) {
      return;
    }

    await catalogWorkspaceStore.installAsset({
      assetId: selectedAsset.assetId,
    });
  };

  const handleInstallBundle = async (bundleId: string) => {
    await catalogWorkspaceStore.installBundle(bundleId);
  };

  const handleUninstallBundle = async (bundleId: string) => {
    await catalogWorkspaceStore.uninstallBundle(bundleId);
  };

  const handleToggleEnabled = async () => {
    if (!selectedAsset || !isSupportedAuthoringKind(selectedAsset.kind)) {
      return;
    }

    const repoPath = normalizePath(activeRepo?.repoPath || catalogState.activeRepoPath);
    if (!repoPath) {
      return;
    }

    if (selectedAsset.enabled) {
      await catalogWorkspaceStore.disableAsset({
        kind: selectedAsset.kind,
        assetId: selectedAsset.assetId,
        assetKey: selectedAsset.assetKey,
        repoPath,
      });
      return;
    }

    await catalogWorkspaceStore.enableAsset({
      kind: selectedAsset.kind,
      assetId: selectedAsset.assetId,
      assetKey: selectedAsset.assetKey,
      repoPath,
    });
  };

  const handleToggleBundleActivation = async (bundle: CatalogBundle) => {
    if (!bundle.bundleId) {
      return;
    }
    if (isBundleActive(bundle)) {
      await catalogWorkspaceStore.deactivateBundle(bundle.bundleId, activationRepoPath);
      return;
    }
    await catalogWorkspaceStore.activateBundle(bundle.bundleId, activationRepoPath);
  };

  const handleSavePlannerProfile = async () => {
    const nextProfile = plannerProfileDraft.trim();
    if (!nextProfile) {
      return;
    }
    await catalogWorkspaceStore.setPlannerProfile(nextProfile, activationRepoPath);
  };

  const handleClearRepoActivationOverride = async () => {
    if (!activationRepoPath) {
      return;
    }
    await catalogWorkspaceStore.clearRepoActivationOverride(activationRepoPath);
  };

  const handleSaveCustomScanRoots = async () => {
    const nextRoots = parsePathListInput(customScanRootsInput);
    await catalogWorkspaceStore.saveCustomScanRoots(nextRoots);
    setCustomScanRootsDirty(false);
    setCustomScanRootsInput(nextRoots.join('\n'));
  };

  return (
    <section className="catalog-workspace" data-testid="catalog-workspace-view">
      <Toolbar testId="catalog-workspace-toolbar">
        <div className="catalog-summary">
          <p className="catalog-title">Catalog workspace</p>
          <p className="catalog-copy">
            {formatCount(summaryStats?.effectiveCount)} effective assets, {formatCount(summaryStats?.installedCount)} installed,{' '}
            {formatCount(bundleStats.activeCount)} active bundles
          </p>
        </div>

        <div className="catalog-toolbar-actions">
          <Button
            disabled={catalogState.loading || catalogState.refreshing}
            onClick={() => {
              void catalogWorkspaceStore.refreshWorkspace();
            }}
            testId="catalog-refresh"
            variant="primary"
          >
            {catalogState.refreshing ? 'Refreshing...' : 'Refresh catalog'}
          </Button>
          <Button
            disabled={catalogState.loading || catalogState.installing || catalogState.refreshing}
            onClick={() => {
              void catalogWorkspaceStore.installSurface('all', false);
            }}
            testId="catalog-install-all"
            variant="secondary"
          >
            Install Everything
          </Button>
          <Button
            disabled={catalogState.loading || catalogState.installing || catalogState.refreshing}
            onClick={() => {
              void catalogWorkspaceStore.installSurface('all', true);
            }}
            testId="catalog-force-reinstall"
            variant="ghost"
          >
            Force Everything
          </Button>
        </div>
      </Toolbar>

      {catalogState.activeRepoPath ? (
        <p className="catalog-status">
          Scoped to repo path: {catalogState.activeRepoPath}
          {activeRepo?.registered ? ' · registered' : ' · ad hoc selection'}
        </p>
      ) : (
        <p className="catalog-status">Showing the global catalog projection. Select a repo to inspect repo-local assets and overlays.</p>
      )}

      {catalogState.error ? (
        <p className="catalog-error" role="alert">
          {catalogState.error}
        </p>
      ) : null}
      {catalogState.installMessage ? <p className="catalog-status">{catalogState.installMessage}</p> : null}

      <Panel>
        <div className="panel-header">
          <div>
            <p className="catalog-title">Install surfaces</p>
            <p className="catalog-copy">
              Use these buttons to run the same surface-specific installers documented below. The legacy managed-asset sync route remains Copilot-only.
            </p>
          </div>
        </div>

        <div className="catalog-surface-grid">
          {INSTALL_SURFACE_CARDS.map((card) => (
            <article key={card.target} className="catalog-surface-card">
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
                  variant="secondary"
                >
                  {card.target === 'all' ? 'Install Everything' : `Install ${card.title}`}
                </Button>
                <Button
                  disabled={catalogState.loading || catalogState.installing || catalogState.refreshing}
                  onClick={() => {
                    void catalogWorkspaceStore.installSurface(card.target, true);
                  }}
                  variant="ghost"
                >
                  {card.target === 'all' ? 'Force Everything' : `Force ${card.title}`}
                </Button>
              </div>

              <div className="catalog-command-stack">
                <div className="catalog-command-block">
                  <p className="catalog-command-label">PowerShell</p>
                  <pre className="catalog-command">{card.windowsCommand}</pre>
                </div>
                <div className="catalog-command-block">
                  <p className="catalog-command-label">macOS / Linux</p>
                  <pre className="catalog-command">{card.unixCommand}</pre>
                </div>
              </div>
            </article>
          ))}
        </div>

        <div className="panel-footer">
          <p>Add `--force` to overwrite managed targets that diverged. Use `--dry-run` from the shell wrappers when you want a preview before writing anything.</p>
        </div>
      </Panel>

      <div className="catalog-summary-grid">
        <article className="catalog-stat-card">
          <p className="catalog-stat-label">Kinds</p>
          <p className="catalog-stat-value">{Object.keys(summaryStats?.byKind ?? {}).length}</p>
          <p className="catalog-stat-copy">
            Skills {formatCount(summaryStats?.byKind?.skill)} · Agents {formatCount(summaryStats?.byKind?.agent)}
          </p>
        </article>
        <article className="catalog-stat-card">
          <p className="catalog-stat-label">Projection freshness</p>
          <p className="catalog-stat-value">{runtimeProjection?.freshness?.status ?? 'unknown'}</p>
          <p className="catalog-stat-copy">Generated {formatTimestamp(runtimeProjection?.generatedAt)}</p>
        </article>
        <article className="catalog-stat-card">
          <p className="catalog-stat-label">Recommendations</p>
          <p className="catalog-stat-value">{recommendedAssets.length}</p>
          <p className="catalog-stat-copy">
            Current backend recommendation flags surfaced without inventing a parallel write path.
          </p>
        </article>
        <article className="catalog-stat-card">
          <p className="catalog-stat-label">Bundles</p>
          <p className="catalog-stat-value">{bundleStats.activeCount}</p>
          <p className="catalog-stat-copy">
            {bundleStats.totalCount} surfaced · {bundleStats.eligibleMemberCount} eligible member(s) under {BALANCED_DEFAULT_PROFILE_ID}
          </p>
        </article>
        <article className="catalog-stat-card">
          <p className="catalog-stat-label">Known repos</p>
          <p className="catalog-stat-value">{repoList.length}</p>
          <p className="catalog-stat-copy">
            {activeRepo ? `Selected: ${buildRepoLabel(activeRepo)}` : 'No repo selected; working in global/user scope.'}
          </p>
        </article>
        <article className="catalog-stat-card" data-testid="catalog-observability-summary">
          <p className="catalog-stat-label">Observed usage</p>
          <p className="catalog-stat-value">{scopeObservability.invocationCount}</p>
          <p className="catalog-stat-copy">
            Searched {scopeObservability.searchedCount} · Selected {scopeObservability.selectedCount} · Invoked {scopeObservability.invocationCount}
          </p>
        </article>
      </div>

      <Panel
        subtitle="Optional workflow packs surfaced from catalog bundle metadata and installed through the existing shipped-asset mutation flow."
        testId="catalog-bundles-panel"
        title="Workflow packs"
      >
        {catalogState.bundlesError ? (
          <p className="state-message state-error" role="alert">
            {catalogState.bundlesError}
          </p>
        ) : null}

        {workflowBundles.length === 0 ? (
          <p className="state-message">No optional workflow packs are currently exposed by the catalog bundle projection.</p>
        ) : (
          <ul className="catalog-repo-list" data-testid="catalog-bundle-list">
            {workflowBundles.map((bundle) => {
              const lifecycle = summarizeBundleLifecycle(bundle);
              const isInstalled = lifecycle.fullyInstalled;
              const canUninstall = isBundleUninstallable(bundle) && lifecycle.installedCount > 0;

              return (
                <li key={bundle.bundleId}>
                  <div className="catalog-search-result-header">
                    <div>
                      <p className="catalog-item-title">{bundle.title || bundle.bundleId}</p>
                      <p className="catalog-item-copy">{bundle.description || 'No bundle description available.'}</p>
                    </div>
                    <div className="catalog-badge-row">
                      <StatusBadge status={bundle.status || 'unknown'} testId="catalog-bundle-status" />
                      <StatusBadge status={bundle.materialization || 'unknown'} testId="catalog-bundle-materialization" />
                      <StatusBadge status={resolveBundleLifecycleStatus(bundle)} testId="catalog-bundle-lifecycle-status" />
                      {bundle.classification ? <StatusBadge status={bundle.classification} testId="catalog-bundle-classification" /> : null}
                      {bundle.defaultRecommended ? <StatusBadge status="recommended" testId="catalog-bundle-recommended" /> : null}
                      {isBundleUninstallable(bundle) ? <StatusBadge status="uninstallable" testId="catalog-bundle-uninstallable" /> : null}
                    </div>
                  </div>

                  <p className="catalog-inline-note" data-testid={`catalog-bundle-lifecycle-${bundle.bundleId}`}>
                    {lifecycle.partiallyInstalled || lifecycle.missingCount > 0 ? 'Partial member state' : isInstalled ? 'Installed member state' : 'Not installed yet'} ·{' '}
                    {formatCount(lifecycle.memberCount)} assets · {formatCount(lifecycle.installedCount)} installed · {formatCount(lifecycle.availableCount)} available ·{' '}
                    {formatCount(lifecycle.missingCount)} missing
                  </p>
                  <p className="catalog-inline-note" data-testid={`catalog-workflow-bundle-taxonomy-${bundle.bundleId}`}>
                    Classification: {bundle.classification || 'unspecified'} · Targets: {describeBundleTargeting(bundle)}
                  </p>
                  <p className="catalog-inline-note" data-testid={`catalog-workflow-bundle-uninstall-policy-${bundle.bundleId}`}>
                    Uninstall behavior: {describeBundleUninstallPolicy(bundle)}
                  </p>

                  <div className="catalog-action-row">
                    <Button
                      disabled={catalogState.loading || catalogState.installing || catalogState.refreshing}
                      onClick={() => {
                        void handleInstallBundle(bundle.bundleId);
                      }}
                      testId={`catalog-install-bundle-${bundle.bundleId}`}
                      variant="secondary"
                    >
                      {isInstalled ? 'Re-check bundle' : 'Install bundle'}
                    </Button>
                    <Button
                      disabled={catalogState.loading || catalogState.installing || catalogState.refreshing || !canUninstall}
                      onClick={() => {
                        void handleUninstallBundle(bundle.bundleId);
                      }}
                      testId={`catalog-uninstall-workflow-bundle-${bundle.bundleId}`}
                      variant="ghost"
                    >
                      Uninstall bundle
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <div className="catalog-grid">
        <Panel
          subtitle="Discovered repos surface automatically from persisted workspace scan roots, while explicit selection remains the activation gate for repo-local catalog and planning context."
          testId="catalog-repo-panel"
          title="Repo scope & registration"
        >
          <div className="catalog-form-grid">
            <FormInput
              label="Repo path"
              onValueChange={(value) => catalogWorkspaceStore.setRepoPathInput(value)}
              placeholder="C:\\path\\to\\repo"
              testId="catalog-repo-path"
              value={catalogState.repoPathInput}
            />
            <FormInput
              label="Repo label (optional)"
              onValueChange={setRepoLabelInput}
              placeholder="Friendly repo label"
              testId="catalog-repo-label"
              value={repoLabelInput}
            />
          </div>

          <div className="catalog-action-row">
            <Button
              disabled={catalogState.loading || catalogState.refreshing || catalogState.mutating || !catalogState.repoPathInput.trim()}
              onClick={() => {
                void catalogWorkspaceStore.applyRepoContext();
              }}
              testId="catalog-apply-repo"
              variant="secondary"
            >
              Select scope
            </Button>
            <Button
              disabled={catalogState.loading || catalogState.refreshing || catalogState.mutating || !catalogState.repoPathInput.trim()}
              onClick={() => {
                void catalogWorkspaceStore.registerRepo(catalogState.repoPathInput, repoLabelInput.trim() || undefined);
              }}
              testId="catalog-register-repo"
              variant="secondary"
            >
              Register repo
            </Button>
            <Button
              disabled={catalogState.loading || catalogState.refreshing || catalogState.mutating || !catalogState.activeRepoPath}
              onClick={() => {
                void catalogWorkspaceStore.refreshRepo({
                  repoId: catalogState.activeRepoId || undefined,
                  repoPath: catalogState.activeRepoPath || undefined,
                });
              }}
              testId="catalog-refresh-repo"
              variant="ghost"
            >
              Refresh selected repo
            </Button>
            <Button
              disabled={catalogState.loading || catalogState.refreshing || catalogState.mutating || !catalogState.activeRepoPath}
              onClick={() => {
                void catalogWorkspaceStore.clearRepoContext();
              }}
              testId="catalog-clear-repo"
              variant="ghost"
            >
              Clear scope
            </Button>
          </div>

          {catalogState.repoInventoryError ? (
            <p className="state-message state-error" role="alert">
              {catalogState.repoInventoryError}
            </p>
          ) : null}

          <p className="catalog-inline-note">
            Active write context:{' '}
            {activeRepo
              ? `${buildRepoLabel(activeRepo)} (${activeRepo.repoPath || activeRepo.repoId || 'unknown path'})`
              : 'Global/user-home only. Select a repo before repo-local or enable/disable actions.'}
          </p>
          <p className="catalog-inline-note">
            Manual registration only persists repo metadata. Discovery and custom scan roots control which repos appear automatically; selecting a repo is still the explicit activation step.
          </p>

          <div className="catalog-form-grid">
            <div>
              <label className="form-label" htmlFor="catalog-custom-scan-roots-input">
                Custom scan roots
              </label>
              <textarea
                className="form-textarea"
                data-testid="catalog-custom-scan-roots-input"
                id="catalog-custom-scan-roots-input"
                onChange={(event) => {
                  setCustomScanRootsDirty(true);
                  setCustomScanRootsInput(event.target.value);
                }}
                placeholder={'C:\\Users\\you\\Documents\\GitHub\nD:\\work\\repos'}
                rows={4}
                value={customScanRootsInput}
              />
              <p className="catalog-inline-note">
                One path per line. Saved to {workspaceScan?.storage?.path || '~/.copilot/catalog/repo-discovery.json'}.
              </p>
            </div>
            <div>
              <p className="catalog-inline-note">
                Default scan roots: {formatPathList(workspaceScan?.defaultRoots)}
              </p>
              <p className="catalog-inline-note">
                Persisted custom roots: {formatPathList(savedCustomScanRoots)}
              </p>
              <p className="catalog-inline-note">
                Effective scan roots: {formatPathList(workspaceScan?.scanRoots)}
              </p>
            </div>
          </div>

          <div className="catalog-action-row">
            <Button
              disabled={catalogState.loading || catalogState.refreshing || catalogState.mutating || !customScanRootsChanged}
              onClick={() => {
                void handleSaveCustomScanRoots();
              }}
              testId="catalog-save-custom-scan-roots"
              variant="secondary"
            >
              Save scan roots
            </Button>
            <Button
              disabled={catalogState.loading || catalogState.refreshing || catalogState.mutating || !customScanRootsDirty}
              onClick={() => {
                setCustomScanRootsDirty(false);
                setCustomScanRootsInput(savedCustomScanRoots.join('\n'));
              }}
              testId="catalog-reset-custom-scan-roots"
              variant="ghost"
            >
              Reset scan roots
            </Button>
          </div>

          <ul className="catalog-repo-list" data-testid="catalog-repo-list">
            {catalogState.repoInventoryLoading && repoList.length === 0 ? (
              <li className="state-message">Loading known repos...</li>
            ) : null}
            {!catalogState.repoInventoryLoading && repoList.length === 0 ? (
              <li className="state-message">No known repos were returned by the repo inventory service.</li>
            ) : null}
            {repoList.map((repo) => (
              <li className={repo.selected ? 'is-selected' : ''} key={`${repo.repoId || repo.repoPath || 'repo'}`}>
                <div className="catalog-search-result-header">
                  <div>
                    <p className="catalog-item-title">{buildRepoLabel(repo)}</p>
                    <p className="catalog-item-copy">{repo.repoPath || repo.repoId || 'No repo path available'}</p>
                  </div>
                  <div className="catalog-badge-row">
                    <StatusBadge status={repo.scanStatus || 'unknown'} testId="catalog-repo-scan-status" />
                    {repo.registered ? <StatusBadge status="registered" testId="catalog-repo-registered" /> : null}
                    {repo.selected ? <StatusBadge status="selected" testId="catalog-repo-selected" /> : null}
                  </div>
                </div>

                <p className="catalog-inline-note">{describeRepoAssetSummary(repo)}</p>
                <div className="catalog-badge-row">
                  {(repo.sources ?? []).slice(0, 4).map((source) => (
                    <StatusBadge key={`${repo.repoId || repo.repoPath}-${source}`} status={source} testId="catalog-repo-source" />
                  ))}
                </div>

                <div className="catalog-action-row">
                  <Button
                    disabled={catalogState.loading || catalogState.refreshing || catalogState.mutating || repo.selected}
                    onClick={() => {
                      void catalogWorkspaceStore.selectRepo({
                        repoId: repo.repoId,
                        repoPath: repo.repoPath,
                      });
                    }}
                    size="sm"
                    testId="catalog-repo-select"
                    variant="secondary"
                  >
                    Select
                  </Button>
                  <Button
                    disabled={catalogState.loading || catalogState.refreshing}
                    onClick={() => {
                      void catalogWorkspaceStore.refreshRepo({
                        repoId: repo.repoId,
                        repoPath: repo.repoPath,
                      });
                    }}
                    size="sm"
                    testId="catalog-repo-item-refresh"
                    variant="ghost"
                  >
                    Refresh
                  </Button>
                  {repo.registered ? (
                    <Button
                      disabled={catalogState.loading || catalogState.refreshing || catalogState.mutating}
                      onClick={() => {
                        void catalogWorkspaceStore.unregisterRepo({
                          repoId: repo.repoId,
                          repoPath: repo.repoPath,
                        });
                      }}
                      size="sm"
                      testId="catalog-repo-unregister"
                      variant="danger"
                    >
                      Unregister
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel
          subtitle="Bundle-first activation view from /api/catalog/bundles, with persisted user-global defaults plus optional repo overrides for bundle/profile control."
          testId="catalog-bundles-panel"
          title="Bundles & activation"
        >
          {catalogState.bundlesError ? (
            <p className="state-message state-error" role="alert">
              {catalogState.bundlesError}
            </p>
          ) : null}

          <div className="catalog-summary-grid">
            <article className="catalog-stat-card">
              <p className="catalog-stat-label">Planner profile</p>
              <p className="catalog-stat-value">{activationState?.plannerProfile || BALANCED_DEFAULT_PROFILE_ID}</p>
              <p className="catalog-stat-copy">
                {activeRepo
                  ? `${buildRepoLabel(activeRepo)} currently inherits or overrides user-global defaults.`
                  : 'User-global defaults currently define the active bundle/profile set.'}
              </p>
            </article>
            <article className="catalog-stat-card">
              <p className="catalog-stat-label">Active bundles</p>
              <p className="catalog-stat-value">{bundleStats.activeCount}</p>
              <p className="catalog-stat-copy">
                {bundleStats.totalCount} visible · source: {describeActivationSource(activationState?.bundleSource)}
              </p>
            </article>
          </div>

          <p className="catalog-inline-note">
            Installed means materialized into a managed surface. Active means the current user/repo context selected the bundle. Default
            routing under {activationState?.plannerProfile || BALANCED_DEFAULT_PROFILE_ID} only considers members that are installed,
            active, enabled, and available.
          </p>
          <p className="catalog-inline-note">
            Editing target: {activationRepoPath && activeRepo ? `${buildRepoLabel(activeRepo)} repo override` : 'user-global defaults'} ·
            planner profile source: {describeActivationSource(activationState?.plannerProfileSource)}
            {activationState?.managedImportProviderIds?.length
              ? ` · managed-import providers: ${activationState.managedImportProviderIds.join(', ')}`
              : ''}
          </p>

          <div className="catalog-form-grid">
            <FormInput
              label="Planner profile"
              onValueChange={setPlannerProfileDraft}
              placeholder={BALANCED_DEFAULT_PROFILE_ID}
              testId="catalog-planner-profile-input"
              value={plannerProfileDraft}
            />
          </div>

          <div className="catalog-action-row">
            <Button
              disabled={catalogState.loading || catalogState.refreshing || catalogState.mutating || !plannerProfileDraft.trim()}
              onClick={() => {
                void handleSavePlannerProfile();
              }}
              testId="catalog-save-planner-profile"
              variant="secondary"
            >
              Save planner profile
            </Button>
            {activationRepoPath ? (
              <Button
                disabled={catalogState.loading || catalogState.refreshing || catalogState.mutating || !repoOverrideActive}
                onClick={() => {
                  void handleClearRepoActivationOverride();
                }}
                testId="catalog-clear-repo-activation-override"
                variant="ghost"
              >
                Use user-global defaults
              </Button>
            ) : null}
          </div>

          {catalogState.bundles.length === 0 ? (
            <p className="state-message">No activation bundles were returned by the current catalog projection.</p>
          ) : (
            <ul className="catalog-repo-list" data-testid="catalog-bundle-list">
              {catalogState.bundles.map((bundle) => {
                const isSelectedBundle = selectedBundle?.bundleId === bundle.bundleId;
                const lifecycle = summarizeBundleLifecycle(bundle);
                const memberCount = lifecycle.memberCount;
                const installedCount = lifecycle.installedCount;
                const enabledCount = lifecycle.enabledCount;
                const eligibleCount = countEligibleBundleMembers(bundle);
                const inspectableMember = normalizeBundleMembers(bundle).find((member) => member.assetId);
                const canUninstall = isBundleUninstallable(bundle) && installedCount > 0;

                return (
                  <li className={isSelectedBundle ? 'is-selected' : ''} key={bundle.bundleId}>
                    <div className="catalog-search-result-header">
                      <div>
                        <p className="catalog-item-title">{bundle.title || bundle.bundleId}</p>
                        <p className="catalog-item-copy">{bundle.description || bundle.bundleId}</p>
                      </div>
                      <div className="catalog-badge-row">
                        <StatusBadge status={bundle.activationStatus || 'inactive'} testId="catalog-bundle-activation-status" />
                        <StatusBadge status={bundle.status || 'unknown'} testId="catalog-bundle-status" />
                        <StatusBadge status={bundle.materialization || 'manual'} testId="catalog-bundle-materialization" />
                        <StatusBadge status={resolveBundleLifecycleStatus(bundle)} testId="catalog-bundle-lifecycle-status" />
                        {bundle.classification ? <StatusBadge status={bundle.classification} testId="catalog-bundle-classification" /> : null}
                        {bundle.defaultRecommended ? <StatusBadge status="default" testId="catalog-bundle-default" /> : null}
                        {isBundleUninstallable(bundle) ? <StatusBadge status="uninstallable" testId="catalog-bundle-uninstallable" /> : null}
                      </div>
                    </div>

                    <p className="catalog-inline-note">
                      {installedCount}/{memberCount} installed · {enabledCount}/{memberCount} overlay-enabled · {eligibleCount}/{memberCount}{' '}
                      auto-routable candidates
                    </p>
                    <div className="catalog-badge-row">
                      <StatusBadge status={bundle.activationScope || 'scope-unknown'} testId="catalog-bundle-scope" />
                      <StatusBadge status={bundle.installTarget || 'install-target-unknown'} testId="catalog-bundle-install-target" />
                      {(bundle.dependsOn ?? []).slice(0, 2).map((dependency) => (
                        <StatusBadge key={`${bundle.bundleId}-${dependency}`} status={`depends:${dependency}`} testId="catalog-bundle-dependency" />
                      ))}
                    </div>
                    <p className="catalog-inline-note" data-testid={`catalog-activation-bundle-taxonomy-${bundle.bundleId}`}>
                      Classification: {bundle.classification || 'unspecified'} · Targets: {describeBundleTargeting(bundle)}
                    </p>
                    <p className="catalog-inline-note" data-testid={`catalog-activation-bundle-uninstall-policy-${bundle.bundleId}`}>
                      Uninstall behavior: {describeBundleUninstallPolicy(bundle)}
                    </p>

                    <div className="catalog-action-row">
                      <Button
                        disabled={catalogState.loading || catalogState.refreshing || catalogState.mutating}
                        onClick={() => {
                          void handleToggleBundleActivation(bundle);
                        }}
                        size="sm"
                        testId="catalog-toggle-bundle-activation"
                        variant={isBundleActive(bundle) ? 'ghost' : 'primary'}
                      >
                        {isBundleActive(bundle) ? 'Deactivate bundle' : 'Activate bundle'}
                      </Button>
                      <Button
                        onClick={() => catalogWorkspaceStore.selectBundle(bundle.bundleId)}
                        size="sm"
                        testId="catalog-select-bundle"
                        variant="secondary"
                      >
                        {isSelectedBundle ? 'Selected' : 'Inspect bundle'}
                      </Button>
                      <Button
                        disabled={catalogState.loading || catalogState.installing || catalogState.refreshing || !canUninstall}
                        onClick={() => {
                          void handleUninstallBundle(bundle.bundleId);
                        }}
                        size="sm"
                        testId={`catalog-uninstall-managed-bundle-${bundle.bundleId}`}
                        variant="ghost"
                      >
                        Uninstall bundle
                      </Button>
                      <Button
                        disabled={!inspectableMember?.assetId}
                        onClick={() => {
                          if (inspectableMember?.assetId) {
                            void catalogWorkspaceStore.selectAsset(inspectableMember.assetId);
                          }
                        }}
                        size="sm"
                        testId="catalog-inspect-bundle-member"
                        variant="ghost"
                      >
                        Inspect first member
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {selectedBundle ? (
            <details className="metadata-block" open>
              <summary>
                Bundle members · {selectedBundle.title || selectedBundle.bundleId} ({selectedBundleMembers.length})
              </summary>
              <p className="catalog-inline-note" data-testid="catalog-selected-bundle-taxonomy">
                Classification: {selectedBundle.classification || 'unspecified'} · Targets: {describeBundleTargeting(selectedBundle)}
              </p>
              <p className="catalog-inline-note" data-testid="catalog-selected-bundle-uninstall-policy">
                Uninstall behavior: {describeBundleUninstallPolicy(selectedBundle)}
              </p>
              <ul className="catalog-entry-list">
                {selectedBundleMembers.map((member) => {
                  const memberAsset = catalogState.assets.find((asset) => asset.assetId === member.assetId) ?? null;
                  const memberLoadMode = readLoadMode(memberAsset?.selectedEntry ?? null, memberAsset);
                  const memberProvenance = summarizeProvenance(memberAsset?.selectedEntry ?? null);

                  return (
                    <li key={`${selectedBundle.bundleId}-${member.assetId}`}>
                      <div className="catalog-search-result-header">
                        <div>
                          <p className="catalog-item-title">{memberAsset?.selectedEntry?.title || member.title || member.assetId}</p>
                          <p className="catalog-item-copy">{memberAsset?.selectedEntry?.description || member.description || member.assetId}</p>
                        </div>
                        <Button
                          onClick={() => {
                            void catalogWorkspaceStore.selectAsset(member.assetId);
                          }}
                          size="sm"
                          testId="catalog-bundle-member-inspect"
                          variant="secondary"
                        >
                          Inspect
                        </Button>
                      </div>

                      <div className="catalog-badge-row">
                        <StatusBadge status={member.kind || memberAsset?.kind || 'unknown'} testId="catalog-bundle-member-kind" />
                        <StatusBadge status={member.installed ? 'installed' : 'not-installed'} testId="catalog-bundle-member-installed" />
                        <StatusBadge status={member.enabled ? 'overlay-enabled' : 'overlay-disabled'} testId="catalog-bundle-member-enabled" />
                        <StatusBadge status={memberLoadMode} testId="catalog-bundle-member-load-mode" />
                        {member.missing ? <StatusBadge status="missing" testId="catalog-bundle-member-missing" /> : null}
                      </div>

                      <p className="catalog-inline-note">
                        {memberProvenance || 'No explicit provenance surfaced for this member.'}
                        {isBundleActive(selectedBundle) && member.available && member.installed && member.enabled && !member.missing
                          ? ' · Eligible for balanced-default auto-routing.'
                          : ' · Not yet eligible for default routing.'}
                      </p>
                    </li>
                  );
                })}
              </ul>
            </details>
          ) : null}
        </Panel>

        <Panel
          subtitle="Install and update provider packs here, while Overview and Agents now own the primary discovery spotlight for provider-backed skills and agents."
          testId="catalog-providers-panel"
          title="Provider installs & state"
        >
          {providerProjections.length === 0 ? (
            <p className="state-message">No provider integrations were exposed by the current catalog projection.</p>
          ) : (
            <div className="catalog-summary-grid">
              {providerProjections.map((provider) => {
                const installed = providerLooksInstalled(provider);
                const providerError = readProviderStateString(provider, 'lastError');
                const providerAction = installed ? 'update' : 'install';

                return (
                  <article className="catalog-stat-card" key={provider.providerId}>
                    <p className="catalog-stat-label">{provider.providerId}</p>
                    <p className="catalog-stat-value">{provider.title || provider.providerId}</p>
                    <p className="catalog-stat-copy">{provider.description || 'External provider package.'}</p>
                    <p className="catalog-inline-note">
                      strategy: {provider.installStrategy || 'unknown'} · discovered assets: {provider.discoveredAssets?.count || 0}
                    </p>
                    {providerError ? <p className="state-message state-error">{providerError}</p> : null}
                    <div className="catalog-action-row">
                      <StatusBadge status={installed ? 'installed' : 'not-installed'} testId="catalog-provider-installed" />
                      <Button
                        disabled={catalogState.loading || catalogState.refreshing || catalogState.mutating || String(provider.installStrategy || '').trim().toLowerCase() !== 'managed-import'}
                        onClick={() => {
                          void catalogWorkspaceStore.installProvider({
                            providerId: provider.providerId,
                            action: providerAction,
                          });
                        }}
                        testId="catalog-provider-install"
                        variant="secondary"
                      >
                        {providerAction === 'update' ? 'Update provider' : 'Install provider'}
                      </Button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </Panel>

        <Panel
          subtitle="Create a new agent or skill in the selected authoritative target. The form makes the write path explicit before saving."
          testId="catalog-create-panel"
          title="Create asset"
        >
          <div className="catalog-form-grid">
            <label className="form-input" htmlFor="catalog-create-target">
              <span className="form-label">Write target</span>
              <select
                data-testid="catalog-create-target"
                id="catalog-create-target"
                onChange={(event) => handleCreateDraftChange({ targetId: event.target.value })}
                value={selectedCreateTarget?.id || ''}
              >
                {createTargets.map((target) => (
                  <option key={target.id} value={target.id}>
                    {target.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="form-input" htmlFor="catalog-create-kind">
              <span className="form-label">Kind</span>
              <select
                data-testid="catalog-create-kind"
                id="catalog-create-kind"
                onChange={(event) => handleCreateDraftChange({ kind: event.target.value as SupportedAuthoringKind })}
                value={createDraft.kind}
              >
                <option value="skill">Skill</option>
                <option value="agent">Agent</option>
              </select>
            </label>
          </div>

          <p className="catalog-inline-note" data-testid="catalog-create-target-copy">
            {selectedCreateTarget?.description || 'Select a write target to create a new asset.'}
          </p>

          <div className="catalog-form-grid">
            <FormInput
              label="Asset key"
              onValueChange={(value) => handleCreateDraftChange({ assetKey: value })}
              placeholder="repo-helper"
              testId="catalog-create-asset-key"
              value={createDraft.assetKey}
            />
            <FormInput
              label="Title"
              onValueChange={(value) => handleCreateDraftChange({ title: value })}
              placeholder="Repo Helper"
              testId="catalog-create-title"
              value={createDraft.title}
            />
          </div>

          <FormInput
            label="Description"
            onValueChange={(value) => handleCreateDraftChange({ description: value })}
            placeholder="Short summary shown in the catalog."
            testId="catalog-create-description"
            value={createDraft.description}
          />

          {createDraft.kind === 'skill' ? (
            <div className="catalog-form-grid">
              <label className="form-input" htmlFor="catalog-create-load-mode">
                <span className="form-label">Load mode</span>
                <select
                  data-testid="catalog-create-load-mode"
                  id="catalog-create-load-mode"
                  onChange={(event) => handleCreateDraftChange({ loadMode: event.target.value as 'always' | 'on-demand' })}
                  value={createDraft.loadMode}
                >
                  <option value="on-demand">On-demand (skills-vault)</option>
                  <option value="always">Always loaded (skills + skills-vault when installed)</option>
                </select>
              </label>

              <FormInput
                label="Triggers"
                onValueChange={(value) => handleCreateDraftChange({ triggersInput: value })}
                placeholder="repo, workspace, helper"
                testId="catalog-create-triggers"
                value={createDraft.triggersInput}
              />
            </div>
          ) : null}

          <label className="form-input" htmlFor="catalog-create-content">
            <span className="form-label">Markdown content</span>
            <textarea
              data-testid="catalog-create-content"
              id="catalog-create-content"
              onChange={(event) => handleCreateDraftChange({ content: event.target.value })}
              placeholder="## Usage&#10;&#10;Add the asset body here."
              value={createDraft.content}
            />
          </label>

          <div className="catalog-action-row">
            <Button
              disabled={catalogState.loading || catalogState.refreshing || catalogState.mutating || !selectedCreateTarget || !createDraft.assetKey.trim() || !createDraft.content.trim()}
              onClick={() => {
                void handleCreateAsset();
              }}
              testId="catalog-create-submit"
              variant="primary"
            >
              Create asset
            </Button>
          </div>
        </Panel>
      </div>

      <div className="catalog-grid">
        <Panel
          subtitle="Unified browsing across the catalog projection with quick perspectives for skills, agents, scopes, and effective state."
          testId="catalog-browser-panel"
          title="Catalog browser"
        >
          <div className="catalog-filter-grid">
            <FormInput
              label="Filter"
              onValueChange={(value) => catalogWorkspaceStore.setFilters({ text: value })}
              placeholder="Search by asset, title, description, label, or selected layer"
              testId="catalog-filter-input"
              type="search"
              value={catalogState.filters.text}
            />
            <div className="catalog-filter-groups">
              <div className="catalog-filter-group">
                <span className="form-label">Perspective</span>
                <div className="catalog-chip-row">
                  {(['all', 'skill', 'agent', 'prompt'] as const).map((kind) => (
                    <button
                      aria-pressed={catalogState.filters.kind === kind}
                      className={`catalog-chip ${catalogState.filters.kind === kind ? 'is-active' : ''}`}
                      key={kind}
                      onClick={() => catalogWorkspaceStore.setFilters({ kind })}
                      type="button"
                    >
                      {kind === 'all' ? 'All assets' : `${kind}s`}
                    </button>
                  ))}
                </div>
              </div>
              <div className="catalog-filter-group">
                <span className="form-label">Scope</span>
                <div className="catalog-chip-row">
                  {(['all', 'global', 'user', 'repo'] as const).map((scopeKind) => (
                    <button
                      aria-pressed={catalogState.filters.scopeKind === scopeKind}
                      className={`catalog-chip ${catalogState.filters.scopeKind === scopeKind ? 'is-active' : ''}`}
                      key={scopeKind}
                      onClick={() => catalogWorkspaceStore.setFilters({ scopeKind })}
                      type="button"
                    >
                      {scopeKind}
                    </button>
                  ))}
                </div>
              </div>
              <div className="catalog-check-grid">
                <label className="planning-checkbox">
                  <input
                    checked={catalogState.filters.installedOnly}
                    onChange={(event) => catalogWorkspaceStore.setFilters({ installedOnly: event.target.checked })}
                    type="checkbox"
                  />
                  Installed only
                </label>
                <label className="planning-checkbox">
                  <input
                    checked={catalogState.filters.enabledOnly}
                    onChange={(event) => catalogWorkspaceStore.setFilters({ enabledOnly: event.target.checked })}
                    type="checkbox"
                  />
                  Enabled only
                </label>
                <label className="planning-checkbox">
                  <input
                    checked={catalogState.filters.availableOnly}
                    onChange={(event) => catalogWorkspaceStore.setFilters({ availableOnly: event.target.checked })}
                    type="checkbox"
                  />
                  Available only
                </label>
                <label className="planning-checkbox">
                  <input
                    checked={catalogState.filters.overriddenOnly}
                    onChange={(event) => catalogWorkspaceStore.setFilters({ overriddenOnly: event.target.checked })}
                    type="checkbox"
                  />
                  Overridden only
                </label>
              </div>
            </div>
          </div>

          {catalogState.loading && catalogState.assets.length === 0 ? (
            <p className="state-message">Loading catalog workspace…</p>
          ) : null}
          {filteredAssets.length === 0 && !catalogState.loading ? (
            <p className="state-message">No catalog assets matched the current filters.</p>
          ) : null}

          {filteredAssets.length > 0 ? (
            <div className="catalog-table-wrap">
              <table className="catalog-table" data-testid="catalog-browser-table">
                <thead>
                  <tr>
                    <th scope="col">Asset</th>
                    <th scope="col">Perspective</th>
                    <th scope="col">Scope</th>
                    <th scope="col">State</th>
                    <th scope="col">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAssets.map((asset) => {
                    const isSelected = asset.assetId === catalogState.selectedAssetId;
                    const provenanceSummary = summarizeProvenance(asset.selectedEntry);
                    const activationSummary = deriveAssetActivationSummary(asset, bundleIndex[asset.assetId]);
                    return (
                      <tr className={isSelected ? 'is-selected' : ''} key={asset.assetId}>
                        <td>
                          <div className="catalog-item-title">{asset.selectedEntry?.title || asset.assetKey}</div>
                          <p className="catalog-item-copy">{asset.selectedEntry?.description || asset.assetId}</p>
                          {provenanceSummary ? <p className="catalog-inline-note">{provenanceSummary}</p> : null}
                        </td>
                        <td>
                          <div className="catalog-badge-row">
                            <StatusBadge status={asset.kind} testId="catalog-kind-badge" />
                            <StatusBadge status={asset.selectedLayer || 'unknown-layer'} testId="catalog-layer-badge" />
                          </div>
                        </td>
                        <td>{asset.scope?.kind || 'unknown'}</td>
                        <td>
                          <div className="catalog-badge-row">
                            <StatusBadge status={asset.installed ? 'installed' : 'not-installed'} testId="catalog-installed-badge" />
                            <StatusBadge status={activationSummary.activationLabel} testId="catalog-activation-badge" />
                            <StatusBadge status={asset.enabled ? 'overlay-enabled' : 'overlay-disabled'} testId="catalog-enabled-badge" />
                            <StatusBadge status={activationSummary.routingLabel} testId="catalog-routing-badge" />
                            <StatusBadge status={readLoadMode(asset.selectedEntry ?? null, asset)} testId="catalog-load-mode-badge" />
                            {asset.overridden ? <StatusBadge status="overridden" testId="catalog-overridden-badge" /> : null}
                          </div>
                          <p className="catalog-inline-note">{activationSummary.bundleLabel}</p>
                        </td>
                        <td>
                          <Button
                            onClick={() => {
                              void catalogWorkspaceStore.selectAsset(asset.assetId);
                            }}
                            size="sm"
                            testId="catalog-select-asset"
                            variant="secondary"
                          >
                            Inspect
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </Panel>

        <Panel
          subtitle="Effective state with explicit installed vs active vs overlay-enabled cues, plus the existing write-target aware edit/remove flows."
          testId="catalog-detail-panel"
          title="Asset state inspector"
        >
          {catalogState.selectedAssetDetailLoading ? <p className="state-message">(loading selected asset...)</p> : null}
          {catalogState.selectedAssetDetailError ? (
            <p className="state-message state-error" role="alert">
              {catalogState.selectedAssetDetailError}
            </p>
          ) : null}

          {selectedAsset ? (
            <>
              <dl className="detail-grid">
                <div>
                  <dt>Asset</dt>
                  <dd>{selectedAsset.selectedEntry?.title || selectedAsset.assetKey}</dd>
                </div>
                <div>
                  <dt>Effective scope</dt>
                  <dd>{selectedAsset.scope?.kind || 'unknown'}</dd>
                </div>
                <div>
                  <dt>Selected layer</dt>
                  <dd>{selectedAsset.selectedLayer || 'unknown'}</dd>
                </div>
                <div>
                  <dt>Availability</dt>
                  <dd>{selectedAsset.installState?.availability || 'unknown'}</dd>
                </div>
                <div>
                  <dt>Load mode</dt>
                  <dd>{readLoadMode(selectedEntry, selectedAsset)}</dd>
                </div>
                <div>
                  <dt>Activation</dt>
                  <dd>{selectedAssetActivation?.activationLabel || 'direct-only'}</dd>
                </div>
                <div>
                  <dt>Default routing</dt>
                  <dd>{selectedAssetActivation?.routingLabel || 'manual-review'}</dd>
                </div>
                <div>
                  <dt>Bundle membership</dt>
                  <dd>{selectedAssetActivation?.bundleLabel || 'No surfaced bundle membership'}</dd>
                </div>
                <div>
                  <dt>Labels</dt>
                  <dd>{(selectedAsset.labels ?? []).join(', ') || '—'}</dd>
                </div>
              </dl>

              <div className="catalog-badge-row">
                <StatusBadge status={selectedAsset.kind} testId="catalog-detail-kind" />
                <StatusBadge status={selectedAsset.installed ? 'installed' : 'not-installed'} testId="catalog-detail-installed" />
                <StatusBadge status={selectedAssetActivation?.activationLabel || 'direct-only'} testId="catalog-detail-activation" />
                <StatusBadge status={selectedAsset.enabled ? 'overlay-enabled' : 'overlay-disabled'} testId="catalog-detail-enabled" />
                <StatusBadge status={selectedAssetActivation?.routingLabel || 'manual-review'} testId="catalog-detail-routing" />
                <StatusBadge status={readLoadMode(selectedEntry, selectedAsset)} testId="catalog-detail-load-mode" />
                {selectedAsset.recommended ? <StatusBadge status="recommended" testId="catalog-detail-recommended" /> : null}
                {selectedAsset.overridden ? <StatusBadge status="overridden" testId="catalog-detail-overridden" /> : null}
                {selectedIsReadOnly ? <StatusBadge status="read-only" testId="catalog-detail-read-only" /> : null}
              </div>

              <p className="catalog-item-copy">
                {selectedAsset.selectedEntry?.description || 'No description available for this asset.'}
              </p>
              <p className="catalog-inline-note">
                Installed = materialized into the managed surface. Active = included by a surfaced bundle/profile. Overlay enabled =
                the current repo has not disabled it. Auto-routing only considers installed + active + overlay-enabled + available
                members under {activationState?.plannerProfile || BALANCED_DEFAULT_PROFILE_ID}.
              </p>

              {selectedProvenance ? (
                <div className="metadata-block">
                  <p className="catalog-section-title">Provenance</p>
                  <p className="catalog-inline-note">{selectedProvenance}</p>
                </div>
              ) : null}

              <div className="catalog-action-row">
                <Button
                  onClick={() => {
                    void catalogWorkspaceStore.selectAsset(selectedAsset.assetId);
                  }}
                  testId="catalog-reinspect-asset"
                  variant="secondary"
                >
                  Refresh inspect state
                </Button>
                <Button
                  disabled={!hasInstallableSource || catalogState.loading || catalogState.refreshing || catalogState.mutating}
                  onClick={() => {
                    void handleInstallAsset();
                  }}
                  testId="catalog-install-selected"
                  variant="secondary"
                >
                  Install shipped copy
                </Button>
                <Button
                  disabled={!canToggleEnabled || catalogState.loading || catalogState.refreshing || catalogState.mutating}
                  onClick={() => {
                    void handleToggleEnabled();
                  }}
                  testId="catalog-toggle-enabled"
                  variant="ghost"
                >
                  {selectedAsset.enabled ? 'Disable overlay for selected repo' : 'Enable overlay for selected repo'}
                </Button>
              </div>

              <div className="metadata-block">
                <p className="catalog-section-title">Selected write target</p>
                {selectedEditTarget ? (
                  <>
                    <label className="form-input" htmlFor="catalog-edit-target">
                      <span className="form-label">Edit / remove target</span>
                      <select
                        data-testid="catalog-edit-target"
                        id="catalog-edit-target"
                        onChange={(event) => setEditTargetId(event.target.value)}
                        value={selectedEditTarget.id}
                      >
                        {editableTargets.map((target) => (
                          <option key={target.id} value={target.id}>
                            {target.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <p className="catalog-inline-note" data-testid="catalog-write-target-copy">
                      {selectedEditTarget.description}
                    </p>
                  </>
                ) : (
                  <p className="catalog-gap-note" data-testid="catalog-write-target-gap">
                    {selectedIsReadOnly
                      ? selectedProviderInstallable
                        ? `External provider assets remain read-only here. Use the provider install controls${selectedProvider ? ` for ${selectedProvider.title || selectedProvider.providerId}` : ''} to install or update the source package.`
                        : 'External plugin-origin assets are read-only in Elegy Copilot. Edit or remove them from their source installation instead.'
                      : sharedEditBlocked
                      ? 'Shared shipped assets are only writable when the Elegy Copilot workspace repo is the selected write scope.'
                      : 'No authoritative write target is available for this effective asset in the current scope.'}
                  </p>
                )}
              </div>

              {selectedEditTarget ? (
                <div className="catalog-editor-grid">
                  <div className="catalog-form-grid">
                    <FormInput
                      label="Title"
                      onValueChange={(value) => handleEditDraftChange({ title: value })}
                      placeholder="Asset title"
                      testId="catalog-edit-title"
                      value={editDraft.title}
                    />
                    <FormInput
                      label="Description"
                      onValueChange={(value) => handleEditDraftChange({ description: value })}
                      placeholder="Short summary"
                      testId="catalog-edit-description"
                      value={editDraft.description}
                    />
                  </div>

                  {selectedEditTarget.kind === 'skill' ? (
                    <div className="catalog-form-grid">
                      <label className="form-input" htmlFor="catalog-edit-load-mode">
                        <span className="form-label">Load mode</span>
                        <select
                          data-testid="catalog-edit-load-mode"
                          id="catalog-edit-load-mode"
                          onChange={(event) => handleEditDraftChange({ loadMode: event.target.value as 'always' | 'on-demand' })}
                          value={editDraft.loadMode}
                        >
                          <option value="on-demand">On-demand</option>
                          <option value="always">Always loaded</option>
                        </select>
                      </label>

                      <FormInput
                        label="Triggers"
                        onValueChange={(value) => handleEditDraftChange({ triggersInput: value })}
                        placeholder="repo, workspace, helper"
                        testId="catalog-edit-triggers"
                        value={editDraft.triggersInput}
                      />
                    </div>
                  ) : null}

                  <label className="form-input" htmlFor="catalog-edit-content">
                    <span className="form-label">Markdown content</span>
                    <textarea
                      data-testid="catalog-edit-content"
                      id="catalog-edit-content"
                      onChange={(event) => handleEditDraftChange({ content: event.target.value })}
                      placeholder="Paste the full replacement content for this asset."
                      value={editDraft.content}
                    />
                  </label>

                  {!selectedEditTarget.contentPrefillAvailable ? (
                    <p className="catalog-gap-note">
                      Current authoritative content is not exposed by the read APIs for this target. Paste the full replacement markdown before saving to avoid accidental truncation.
                    </p>
                  ) : null}

                  <div className="catalog-action-row">
                    <Button
                      disabled={catalogState.loading || catalogState.refreshing || catalogState.mutating || !editDraft.content.trim()}
                      onClick={() => {
                        void handleUpdateAsset();
                      }}
                      testId="catalog-edit-save"
                      variant="primary"
                    >
                      Save changes
                    </Button>
                    <Button
                      disabled={catalogState.loading || catalogState.refreshing || catalogState.mutating}
                      onClick={() => {
                        setConfirmRemoveTargetId((current) => current === selectedEditTarget.id ? null : selectedEditTarget.id);
                      }}
                      testId="catalog-edit-remove"
                      variant="danger"
                    >
                      Remove target
                    </Button>
                    {confirmRemoveTargetId === selectedEditTarget.id ? (
                      <Button
                        disabled={catalogState.loading || catalogState.refreshing || catalogState.mutating}
                        onClick={() => {
                          void handleDeleteTarget();
                        }}
                        testId="catalog-edit-remove-confirm"
                        variant="danger"
                      >
                        Confirm remove
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {selectedReasons.length > 0 ? (
                <div className="metadata-block">
                  <p className="catalog-section-title">Effective-state reasons</p>
                  <ul className="catalog-reason-list">
                    {selectedReasons.map((reason, index) => (
                      <li key={`${reason.code || 'reason'}-${index}`}>
                        <strong>{reason.code || 'reason'}:</strong> {reason.message || 'No explanation provided.'}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <details className="metadata-block" open>
                <summary>{catalogState.selectedAssetContentLabel}</summary>
                <pre className="code-block">{catalogState.selectedAssetContent}</pre>
              </details>

              <details className="metadata-block">
                <summary>View state JSON</summary>
                <pre>{JSON.stringify({ asset: selectedAsset, entries: catalogState.selectedEntries }, null, 2)}</pre>
              </details>
            </>
          ) : (
            <p className="state-message">Select an asset from the catalog browser to inspect effective state.</p>
          )}
        </Panel>
      </div>

      <div className="catalog-grid">
        <Panel
          subtitle="See how source, user-installed, repo-local, and overlay entries resolve into the effective state."
          testId="catalog-overrides-panel"
          title="Scopes & overrides"
        >
          {!selectedAsset ? <p className="state-message">Select an asset to inspect contributing and suppressed entries.</p> : null}

          {selectedAsset ? (
            <div className="catalog-overrides-grid">
              <section>
                <p className="catalog-section-title">Contributing entries ({selectedContributors.length})</p>
                {selectedContributors.length === 0 ? <p className="state-message">No contributing entries recorded.</p> : null}
                {selectedContributors.length > 0 ? (
                  <ul className="catalog-entry-list">
                    {selectedContributors.map((entry, index) => (
                      <li key={`${entry.assetId}-${entry.layer || 'layer'}-${index}`}>
                        <div className="catalog-badge-row">
                          <StatusBadge status={entry.layer || 'unknown-layer'} testId="catalog-entry-layer" />
                          <StatusBadge status={entry.installState?.availability || 'unknown'} testId="catalog-entry-availability" />
                        </div>
                        <p className="catalog-item-title">{entry.title || entry.assetKey || entry.assetId}</p>
                        <p className="catalog-item-copy">{summarizeEntryScope(entry)}</p>
                        <p className="catalog-entry-path">{entry.contentPath || 'No content path available'}</p>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>

              <section>
                <p className="catalog-section-title">Suppressed entries ({selectedSuppressed.length})</p>
                {selectedSuppressed.length === 0 ? <p className="state-message">No suppressed entries recorded.</p> : null}
                {selectedSuppressed.length > 0 ? (
                  <ul className="catalog-entry-list">
                    {selectedSuppressed.map((entry, index) => (
                      <li key={`${entry.assetId}-${entry.layer || 'suppressed'}-${index}`}>
                        <div className="catalog-badge-row">
                          <StatusBadge status={entry.layer || 'unknown-layer'} testId="catalog-suppressed-layer" />
                          <StatusBadge status={entry.installState?.availability || 'unknown'} testId="catalog-suppressed-availability" />
                        </div>
                        <p className="catalog-item-title">{entry.title || entry.assetKey || entry.assetId}</p>
                        <p className="catalog-item-copy">{summarizeEntryScope(entry)}</p>
                        <p className="catalog-entry-path">{entry.contentPath || 'No content path available'}</p>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            </div>
          ) : null}
        </Panel>

        <Panel
          subtitle="Deterministic catalog search against the new backend route family, with explanations and selected recommendations."
          testId="catalog-search-panel"
          title="Search & recommendations"
        >
          <div className="catalog-search-controls">
            <FormInput
              label="Search"
              onValueChange={(value) => catalogWorkspaceStore.setSearchQuery(value)}
              placeholder="Search the catalog by task, skill, agent, tag, or title"
              testId="catalog-search-query"
              type="search"
              value={catalogState.searchQuery}
            />
            <div className="catalog-chip-row">
              {(['all', 'always', 'on-demand'] as const).map((mode) => (
                <button
                  aria-pressed={catalogState.searchPreferLoadMode === mode}
                  className={`catalog-chip ${catalogState.searchPreferLoadMode === mode ? 'is-active' : ''}`}
                  key={mode}
                  onClick={() => catalogWorkspaceStore.setSearchPreferLoadMode(mode)}
                  type="button"
                >
                  {mode === 'all' ? 'Any load mode' : mode}
                </button>
              ))}
            </div>
            <label className="planning-checkbox">
              <input
                checked={catalogState.searchIncludeVaultOnly}
                onChange={(event) => catalogWorkspaceStore.setSearchIncludeVaultOnly(event.target.checked)}
                type="checkbox"
              />
              Include vault-only results
            </label>
            <Button
              disabled={catalogState.searchLoading}
              onClick={() => {
                void catalogWorkspaceStore.runSearch();
              }}
              testId="catalog-run-search"
              variant="secondary"
            >
              {catalogState.searchLoading ? 'Searching...' : 'Search catalog'}
            </Button>
          </div>

          {catalogState.searchError ? (
            <p className="state-message state-error" role="alert">
              {catalogState.searchError}
            </p>
          ) : null}

          {recommendedAssets.length > 0 ? (
            <p className="catalog-inline-note">
              Recommended effective assets currently flagged by the backend: {recommendedAssets.map((asset) => asset.assetKey).join(', ')}
            </p>
          ) : (
            <p className="catalog-inline-note">
              No backend recommendation flags are active in the current projection; search explanations still surface why results matched.
            </p>
          )}

          <p className="catalog-inline-note">
            Privacy-safe selection telemetry is only recorded when you inspect a result. It logs the sanitized query, chosen asset id, rank,
            and explanation codes locally — never the asset content — and the visible list is capped to the top {CATALOG_SEARCH_RESULT_LIMIT} ranked matches.
          </p>

          <ul className="catalog-search-result-list">
            {catalogState.searchResults.length === 0 ? (
              <li className="state-message">Run a search to inspect ranked results and explanations.</li>
            ) : (
              catalogState.searchResults.map((result) => (
                <li key={`${result.assetId}-${result.rank}`}>
                  <div className="catalog-search-result-header">
                    <div>
                      <p className="catalog-item-title">
                        #{result.rank} · {result.entry?.title || result.effectiveState?.assetKey || result.assetId}
                      </p>
                      <p className="catalog-item-copy">Score {result.score}</p>
                    </div>
                    <Button
                      onClick={() => {
                        void catalogWorkspaceStore.inspectSearchResult(result);
                      }}
                      size="sm"
                      testId="catalog-search-inspect"
                      variant="secondary"
                    >
                      Inspect
                    </Button>
                  </div>
                  <div className="catalog-badge-row">
                    <StatusBadge status={result.effectiveState?.kind || 'unknown'} testId="catalog-search-kind" />
                    <StatusBadge status={result.effectiveState?.selectedLayer || 'unknown-layer'} testId="catalog-search-layer" />
                  </div>
                  <ul className="catalog-reason-list">
                    {(result.explanations ?? []).map((explanation, index) => (
                      <li key={`${result.assetId}-explanation-${index}`}>
                        <strong>{explanation.code || 'match'}:</strong> {explanation.message || 'Matched by catalog search.'}
                      </li>
                    ))}
                  </ul>
                </li>
              ))
            )}
          </ul>
        </Panel>
      </div>

      <div className="catalog-grid">
        <Panel
          subtitle="Recent asset-centric usage, search, and rebuild events from the audit log."
          testId="catalog-audit-panel"
          title="Usage & audit"
        >
          <div className="catalog-summary-grid">
            <article className="catalog-stat-card" data-testid="catalog-observability-rollup">
              <p className="catalog-stat-label">Current scope rollup</p>
              <p className="catalog-stat-value">{scopeObservability.invocationCount}</p>
              <p className="catalog-stat-copy">
                Searched {scopeObservability.searchedCount} · Selected {scopeObservability.selectedCount} · Invoked {scopeObservability.invocationCount}
              </p>
              <p className="catalog-inline-note">{describeObservabilityEvidence(scopeObservability)}</p>
            </article>
            <article className="catalog-stat-card" data-testid="catalog-selected-asset-observability">
              <p className="catalog-stat-label">Selected asset</p>
              <p className="catalog-stat-value">{selectedAssetObservability.invocationCount}</p>
              <p className="catalog-stat-copy">
                Searched {selectedAssetObservability.searchedCount} · Selected {selectedAssetObservability.selectedCount} · Invoked {selectedAssetObservability.invocationCount}
              </p>
              <p className="catalog-inline-note">
                {selectedAsset
                  ? describeObservabilityEvidence(selectedAssetObservability)
                  : 'Select an asset to inspect asset-level search and invocation rollups.'}
              </p>
            </article>
          </div>

          <p className="catalog-inline-note">
            Asset-level “searched” counts reflect how often the selected asset surfaced in sampled result sets. Scope-level “searched” counts reflect sampled search queries.
            Invocation totals prefer authoritative asset.invoked evidence and only surface proxy-only fallback counts when explicit evidence is absent.
          </p>
          <p className="catalog-inline-note">
            Showing the newest {CATALOG_AUDIT_EVENT_LIMIT} audit events for the current selection; older activity stays in the audit log.
          </p>
          {catalogState.auditError ? (
            <p className="state-message state-error" role="alert">
              {catalogState.auditError}
            </p>
          ) : null}
          {catalogState.auditAnalyticsError ? (
            <p className="state-message state-error" role="alert">
              {catalogState.auditAnalyticsError}
            </p>
          ) : null}
          {catalogState.auditAnalyticsLoading ? <p className="state-message">Refreshing aggregate observability…</p> : null}

          {auditCounts.length > 0 ? (
            <div className="catalog-badge-row">
              {auditCounts.map(([eventType, count]) => (
                <StatusBadge key={eventType} status={`${eventType} × ${count}`} testId="catalog-audit-type" />
              ))}
            </div>
          ) : null}

          <ul className="catalog-audit-list">
            {catalogState.auditEvents.length === 0 ? (
              <li className="state-message">No audit events were returned for the current selection.</li>
            ) : (
              catalogState.auditEvents.map((event) => (
                <li key={event.eventId}>
                  <p className="catalog-item-title">{event.eventType}</p>
                  <p className="catalog-item-copy">{formatTimestamp(event.occurredAt)}</p>
                  {typeof event.search?.query === 'object' ? (
                    <p className="catalog-inline-note">
                      Query: {String((event.search.query as Record<string, unknown>).query || '—')}
                    </p>
                  ) : null}
                </li>
              ))
            )}
          </ul>
        </Panel>

        <Panel
          subtitle="Projection read mode, freshness, warning state, and audit storage health from /api/runtime/catalog-health."
          testId="catalog-runtime-panel"
          title="Runtime health"
        >
          {catalogState.summaryError ? (
            <p className="state-message state-error" role="alert">
              {catalogState.summaryError}
            </p>
          ) : null}
          {catalogState.healthError ? (
            <p className="state-message state-error" role="alert">
              {catalogState.healthError}
            </p>
          ) : null}

          <dl className="detail-grid">
            <div>
              <dt>Projection status</dt>
              <dd>{catalogState.runtimeHealth?.ok ? 'ok' : 'degraded'}</dd>
            </div>
            <div>
              <dt>Read mode</dt>
              <dd>{runtimeProjection?.readMode || 'unknown'}</dd>
            </div>
            <div>
              <dt>Freshness</dt>
              <dd>{runtimeProjection?.freshness?.status || 'unknown'}</dd>
            </div>
            <div>
              <dt>Warnings</dt>
              <dd>{runtimeProjection?.warnings?.count ?? 0}</dd>
            </div>
            <div>
              <dt>Last rebuild</dt>
              <dd>{formatTimestamp(runtimeProjection?.rebuild?.lastSuccessfulAt)}</dd>
            </div>
            <div>
              <dt>Audit file</dt>
              <dd>{catalogState.runtimeHealth?.audit?.exists ? 'available' : 'missing'}</dd>
            </div>
          </dl>

          <div className="catalog-badge-row">
            <StatusBadge status={runtimeProjection?.freshness?.status || 'unknown'} testId="catalog-runtime-freshness" />
            <StatusBadge status={runtimeProjection?.rebuild?.status || 'idle'} testId="catalog-runtime-rebuild" />
            <StatusBadge status={catalogState.runtimeHealth?.audit?.exists ? 'audit-ready' : 'audit-missing'} testId="catalog-runtime-audit" />
          </div>

          <details className="metadata-block">
            <summary>Projection metadata</summary>
            <pre>{JSON.stringify(catalogState.runtimeHealth, null, 2)}</pre>
          </details>
        </Panel>
      </div>
    </section>
  );
}
