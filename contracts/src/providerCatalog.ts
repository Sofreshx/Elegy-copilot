import type {
  AssetActivationEligibility,
  AssetKind,
  AssetLoadMode,
  AssetProvenance,
  ExtensibleString,
} from './assetCatalog';

export type ProviderSourceType = ExtensibleString<'github-repo' | 'package' | 'filesystem'>;
export type ProviderInstallStrategy = ExtensibleString<'managed-import' | 'bridge-only'>;
export type ProviderBridgeStrategy = ExtensibleString<'plugin-layout' | 'raw-plugin'>;
export type ProviderDiscoveryMode = ExtensibleString<'managed-import' | 'compatibility-bridge'>;
export type ProviderOriginKind = ExtensibleString<
  'shipped' | 'user-home' | 'repo-local' | 'provider-import' | 'provider-bridge'
>;

export interface ProviderSourceDefinition {
  owner?: string;
  repo?: string;
  packageName?: string;
  defaultRef?: string;
}

export interface ProviderAssetLayout {
  namespace?: string;
  skillsRoot?: string;
  agentsRoot?: string;
  managedSkillsRoot?: string;
  managedVaultSkillsRoot?: string;
  managedAgentsPattern?: string;
}

export interface ProviderTrustPolicy {
  pinBy?: string;
  requireUserApproval?: boolean;
}

export interface ProviderCompatibilityPolicy {
  readOnlyBridge?: boolean;
  supportsNamespacedSkills?: boolean;
  supportsPlainMarkdownAgents?: boolean;
  providerQualifiedIdentity?: boolean;
}

export interface ProviderActivationDefaults {
  scope?: ExtensibleString<'global' | 'repo' | 'global-and-repo'>;
  repoOverrides?: boolean;
  plannerProfile?: string;
  orchestrationPolicy?: string;
  defaultBundles?: string[];
  preferredLoadMode?: AssetLoadMode;
}

export interface ProviderCatalogEntry {
  id: string;
  title: string;
  description?: string;
  sourceType: ProviderSourceType;
  source?: ProviderSourceDefinition;
  installStrategy: ProviderInstallStrategy;
  bridgeStrategy?: ProviderBridgeStrategy;
  assetLayout?: ProviderAssetLayout;
  defaultBundles?: string[];
  trustPolicy?: ProviderTrustPolicy;
  compatibility?: ProviderCompatibilityPolicy;
  activationDefaults?: ProviderActivationDefaults;
  sourcePackageMatchers?: string[];
  namespaceMatchers?: string[];
}

export interface ProviderCatalogDocument {
  schemaVersion: number;
  providers: ProviderCatalogEntry[];
}

export interface ProviderInstallStateEntry {
  status?: string;
  installMode?: ProviderDiscoveryMode;
  resolvedRef?: string;
  sourceVersion?: string;
  integrity?: {
    commitSha?: string;
    sourceHash?: string;
  };
  cacheRoot?: string;
  importedAssetIds?: string[];
  updatedAt?: string;
}

export interface ProviderInstallStateDocument {
  schemaVersion: number;
  providers: Record<string, ProviderInstallStateEntry>;
}

export interface InferAssetProvenanceInput {
  kind: Extract<AssetKind, 'agent' | 'skill' | 'prompt'>;
  resolvedPath: string;
  namespace?: string | null;
  fileKind?: 'agent-md' | 'plain-md';
  providers?: ProviderCatalogDocument | ProviderCatalogEntry[] | null;
}

function toProviderList(
  providers?: ProviderCatalogDocument | ProviderCatalogEntry[] | null,
): ProviderCatalogEntry[] {
  if (Array.isArray(providers)) {
    return providers;
  }
  if (providers && Array.isArray(providers.providers)) {
    return providers.providers;
  }
  return DEFAULT_PROVIDER_CATALOG.providers;
}

function normalizePathLike(value: string | undefined | null): string {
  return String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .toLowerCase();
}

function trimSlashes(value: string | undefined | null): string {
  return normalizePathLike(value).replace(/^\/+|\/+$/g, '');
}

function uniqueNormalized(values: Array<string | undefined | null>): string[] {
  const normalized = new Set<string>();
  for (const value of values) {
    const candidate = normalizeProviderIdentityPart(value);
    if (candidate) {
      normalized.add(candidate);
    }
  }
  return Array.from(normalized);
}

function uniqueAssetKeys(
  kind: Extract<AssetKind, 'agent' | 'skill' | 'prompt'>,
  values: Array<string | undefined | null>,
): string[] {
  const normalized = new Set<string>();
  for (const value of values) {
    const candidate = normalizeProviderAssetKey(kind, value);
    if (candidate) {
      normalized.add(candidate);
    }
  }
  return Array.from(normalized);
}

function extractImportedNamespaceFromPath(normalizedPath: string): string {
  const providersSkillMatch = normalizedPath.match(/\/skills(?:-vault)?\/providers\/([^/]+)\//i);
  if (providersSkillMatch?.[1]) {
    return normalizeProviderAssetKey('skill', providersSkillMatch[1]);
  }

  const providersAgentMatch = normalizedPath.match(/\/agents\/providers--(.+?)--.+(?:\.agent)?\.md$/i);
  if (providersAgentMatch?.[1]) {
    return normalizeProviderAssetKey('agent', providersAgentMatch[1]);
  }

  return '';
}

function deriveLegacyProviderId(
  sourcePackage: string,
  namespace: string,
  kind: Extract<AssetKind, 'agent' | 'skill' | 'prompt'>,
  fileKind?: 'agent-md' | 'plain-md',
): string {
  if (sourcePackage) {
    return 'copilot-marketplace-plugin';
  }
  if (namespace) {
    return 'copilot-home-plugin';
  }
  if (kind === 'agent' && fileKind === 'plain-md') {
    return 'copilot-home-plain-agent';
  }
  return '';
}

function providerMatchesDiscovery(
  provider: ProviderCatalogEntry,
  details: {
    normalizedPath: string;
    sourcePackage: string;
    namespace: string;
  },
): boolean {
  const sourcePackageMatchers = uniqueNormalized([
    ...(provider.sourcePackageMatchers ?? []),
    provider.source?.packageName,
    provider.source?.repo,
  ]);
  const namespaceMatchers = uniqueAssetKeys('skill', [
    ...(provider.namespaceMatchers ?? []),
    provider.assetLayout?.namespace,
  ]);
  const candidatePaths = [
    provider.assetLayout?.skillsRoot,
    provider.assetLayout?.agentsRoot,
    provider.assetLayout?.managedSkillsRoot,
    provider.assetLayout?.managedVaultSkillsRoot,
  ]
    .map((value) => trimSlashes(value))
    .filter(Boolean);

  if (details.sourcePackage && sourcePackageMatchers.includes(details.sourcePackage)) {
    return true;
  }

  if (details.namespace && namespaceMatchers.includes(details.namespace)) {
    return true;
  }

  return candidatePaths.some((candidatePath) =>
    details.normalizedPath.includes(`/${candidatePath}/`) || details.normalizedPath.endsWith(`/${candidatePath}`),
  );
}

export const DEFAULT_PROVIDER_CATALOG: ProviderCatalogDocument = {
  schemaVersion: 1,
  providers: [
    {
      id: 'superpowers-copilot',
      title: 'Superpowers for GitHub Copilot',
      description:
        'External capability pack discovered via managed imports or compatible raw plugin layouts.',
      sourceType: 'github-repo',
      source: {
        owner: 'DwainTR',
        repo: 'superpowers-copilot',
        defaultRef: 'main',
      },
      installStrategy: 'managed-import',
      bridgeStrategy: 'plugin-layout',
      assetLayout: {
        namespace: 'superpowers',
        skillsRoot: 'plugins/superpowers/skills',
        agentsRoot: 'plugins/superpowers/agents',
        managedSkillsRoot: 'skills/providers/superpowers',
        managedVaultSkillsRoot: 'skills-vault/providers/superpowers',
        managedAgentsPattern: 'agents/providers--superpowers--*.md',
      },
      defaultBundles: [],
      trustPolicy: {
        pinBy: 'commit',
        requireUserApproval: true,
      },
      compatibility: {
        readOnlyBridge: true,
        supportsNamespacedSkills: true,
        supportsPlainMarkdownAgents: true,
        providerQualifiedIdentity: true,
      },
      activationDefaults: {
        scope: 'global-and-repo',
        repoOverrides: true,
        plannerProfile: 'balanced-default',
        orchestrationPolicy: 'balanced-default',
      },
      sourcePackageMatchers: ['dwaintr-superpowers-copilot', 'superpowers-copilot'],
      namespaceMatchers: ['superpowers'],
    },
  ],
};

export function normalizeProviderIdentityPart(value: string | undefined | null): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function normalizeProviderAssetKey(
  kind: Extract<AssetKind, 'agent' | 'skill' | 'prompt'>,
  rawValue: string | undefined | null,
): string {
  const raw = String(rawValue || '').trim();
  if (!raw) {
    return '';
  }
  if (kind === 'agent') {
    return raw
      .replace(/\.agent\.md$/i, '')
      .replace(/\.md$/i, '')
      .trim()
      .toLowerCase();
  }
  if (kind === 'prompt') {
    return raw.replace(/\.prompt\.md$/i, '').trim().toLowerCase();
  }
  return raw.replace(/[\\/]+$/g, '').trim().toLowerCase();
}

export function inferAssetProvenance(input: InferAssetProvenanceInput): AssetProvenance {
  const normalizedPath = normalizePathLike(input.resolvedPath);
  const sourcePackageMatch = normalizedPath.match(/\/marketplace-cache\/([^/]+)\//i);
  const pluginNamespaceMatch = normalizedPath.match(/\/plugins\/([^/]+)\//i);
  const importedNamespace = extractImportedNamespaceFromPath(normalizedPath);
  const sourcePackage = normalizeProviderIdentityPart(sourcePackageMatch?.[1] || '');
  const namespace = normalizeProviderAssetKey(input.kind, input.namespace)
    || normalizeProviderAssetKey(input.kind, importedNamespace)
    || normalizeProviderAssetKey(input.kind, pluginNamespaceMatch?.[1] || '');

  const providerList = toProviderList(input.providers);
  const matchedProvider = providerList.find((provider) =>
    providerMatchesDiscovery(provider, {
      normalizedPath,
      sourcePackage,
      namespace,
    }),
  );
  const legacyProviderId = deriveLegacyProviderId(
    sourcePackage,
    namespace,
    input.kind,
    input.fileKind,
  );
  const providerId = matchedProvider?.id || legacyProviderId || undefined;
  const importLike =
    /\/skills(?:-vault)?\/providers\//i.test(normalizedPath)
    || /\/agents\/providers--/i.test(normalizedPath);
  const providerBacked = Boolean(providerId);

  return {
    providerId,
    legacyProviderId:
      providerId && legacyProviderId && providerId !== legacyProviderId ? legacyProviderId : undefined,
    sourcePackage: sourcePackage || undefined,
    namespace: namespace || undefined,
    readOnly: providerBacked ? true : undefined,
    discoveryMode: providerBacked
      ? (importLike ? 'managed-import' : 'compatibility-bridge')
      : undefined,
    originKind: providerBacked
      ? (importLike ? 'provider-import' : 'provider-bridge')
      : undefined,
    sourceType: matchedProvider?.sourceType,
    matchedProviderId: matchedProvider?.id,
  };
}

export function buildProviderQualifiedAssetKey(
  kind: Extract<AssetKind, 'agent' | 'skill' | 'prompt'>,
  logicalName: string,
  provenance?: AssetProvenance | null,
): string {
  const baseKey = normalizeProviderAssetKey(kind, logicalName);
  if (!baseKey || !provenance?.providerId) {
    return baseKey;
  }

  const parts = [
    normalizeProviderIdentityPart(provenance.providerId),
    normalizeProviderIdentityPart(provenance.sourcePackage),
    normalizeProviderAssetKey(kind, provenance.namespace),
    normalizeProviderIdentityPart(baseKey),
  ].filter(Boolean);

  return parts.join('-');
}

export function deriveProviderQualifiedAssetId(
  kind: Extract<AssetKind, 'agent' | 'skill' | 'prompt'>,
  logicalName: string,
  provenance?: AssetProvenance | null,
): string {
  const assetKey = buildProviderQualifiedAssetKey(kind, logicalName, provenance);
  if (!assetKey) {
    return '';
  }
  return assetKey.startsWith(`${kind}-`) ? assetKey : `${kind}-${assetKey}`;
}

export function buildLegacyProviderQualifiedAssetKey(
  kind: Extract<AssetKind, 'agent' | 'skill' | 'prompt'>,
  logicalName: string,
  provenance?: AssetProvenance | null,
): string {
  if (!provenance?.legacyProviderId) {
    return '';
  }
  return buildProviderQualifiedAssetKey(kind, logicalName, {
    ...provenance,
    providerId: provenance.legacyProviderId,
  });
}
