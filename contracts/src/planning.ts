import { createHash } from 'node:crypto';

/** Planning record as persisted by the planning API. */
export interface PlanningRecord {
  id: string;
  sessionId: string;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  content?: string;
  metadata?: Record<string, unknown>;
  /**
   * @deprecated Legacy record-scoped research artifacts retained for backward compatibility with older
   * planning records. Prefer repo-backed backlog and roadmap docs for new planning workflows.
   */
  researchNotes?: ResearchNote[];
  /**
   * @deprecated Legacy record-scoped diagram artifacts retained for backward compatibility with older
   * planning records. Prefer repo-backed backlog and roadmap docs for new planning workflows.
   */
  diagrams?: PlanningDiagram[];
}

/** Structured research note attached to a planning record. */
export interface ResearchNote {
  id: string;
  phase: string;
  title: string;
  content: string;
  sources?: string[];
  createdAt: string;

  /** @deprecated Legacy alias for `id`; retained for backward compatibility. */
  noteId?: string;
  /** @deprecated Legacy compatibility field retained for older planning note payloads. */
  summary?: string;
  /** @deprecated Legacy single-source field; use `sources` instead when writing new data. */
  source?: string;
  /** @deprecated Legacy compatibility timestamp retained for older planning note payloads. */
  updatedAt?: string;
}

/** Structured diagram metadata attached to a planning record. */
export interface PlanningDiagram {
  id: string;
  type: string;
  title: string;
  format: string;
  content: string;
  createdAt: string;

  /** @deprecated Legacy alias for `id`; retained for backward compatibility. */
  diagramId?: string;
  /** @deprecated Legacy compatibility timestamp retained for older planning diagram payloads. */
  updatedAt?: string;
}

/** Planning persistence health check result. */
export interface PlanningPersistenceHealth {
  healthy: boolean;
  migrationVersion: number;
  lastCheckedAt: string;
  error?: string;
}

export const PLANNING_INTAKE_CATEGORIES = [
  'idea',
  'research',
  'refactor-candidate',
  'design-complaint',
  'audit-request',
  'roadmap-request',
  'review-prep',
  'commit-prep',
] as const;

export type PlanningIntakeCategory = typeof PLANNING_INTAKE_CATEGORIES[number];

export const PLANNING_INTAKE_ARTIFACT_KIND = 'planning.intake.artifact';
export const PLANNING_INTAKE_ARTIFACT_SCHEMA_VERSION = 1;

export interface PlanningIntakeArtifact {
  kind: typeof PLANNING_INTAKE_ARTIFACT_KIND;
  schemaVersion: typeof PLANNING_INTAKE_ARTIFACT_SCHEMA_VERSION;
  id: string;
  category: PlanningIntakeCategory;
  title: string;
  summary: string;
  acceptanceCriteria: string[];
  targetRepoIds: string[];
  planningState?: string;
  createdAt: string;
  updatedAt: string;
}

export const SYNCED_NOTE_SOURCE_PROVIDERS = ['github', 'gitea', 'git'] as const;
export type SyncedNoteSourceProvider = typeof SYNCED_NOTE_SOURCE_PROVIDERS[number];

export const SYNCED_NOTE_SOURCE_PRIMARY_PROVIDER = 'github' as const;
export const SYNCED_NOTE_SOURCE_FALLBACK_PROVIDERS = ['gitea', 'git'] as const;

export type SyncedNoteSourceProviderPolicyTier = 'primary' | 'fallback';

export interface SyncedNoteSourceProviderPolicy {
  provider: SyncedNoteSourceProvider;
  tier: SyncedNoteSourceProviderPolicyTier;
  backend: 'github' | 'gitea' | 'git';
  explicit: true;
}

export const SYNCED_NOTE_SOURCE_ID_PREFIX = 'snsrc';
export const SYNCED_NOTE_SOURCE_ID_PATTERN = /^snsrc_[a-f0-9]{32}$/;

const SYNCED_NOTE_SOURCE_PROVIDER_POLICY: Record<SyncedNoteSourceProvider, SyncedNoteSourceProviderPolicy> = {
  github: {
    provider: 'github',
    tier: 'primary',
    backend: 'github',
    explicit: true,
  },
  gitea: {
    provider: 'gitea',
    tier: 'fallback',
    backend: 'gitea',
    explicit: true,
  },
  git: {
    provider: 'git',
    tier: 'fallback',
    backend: 'git',
    explicit: true,
  },
};

export interface SyncedNoteSourceLocator {
  provider: SyncedNoteSourceProvider;
  host: string;
  owner: string;
  repo: string;
  branch: string;
  notesPath: string;
}

export interface SyncedNoteSourceRecord extends SyncedNoteSourceLocator {
  id: string;
  localCheckoutPath?: string;
  createdAt: string;
  updatedAt: string;
}

export type SyncedNoteSourceContractErrorCode =
  | 'invalid_synced_note_source'
  | 'invalid_synced_note_source_id'
  | 'synced_note_source_locator_mismatch'
  | 'unsupported_synced_note_source_provider';

export class SyncedNoteSourceContractError extends Error {
  readonly code: SyncedNoteSourceContractErrorCode;

  constructor(message: string, code: SyncedNoteSourceContractErrorCode = 'invalid_synced_note_source') {
    super(message);
    this.name = 'SyncedNoteSourceContractError';
    this.code = code;
  }
}

function requireNonEmptyString(value: unknown, fieldName: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    throw new SyncedNoteSourceContractError(`Synced-note source ${fieldName} is required`);
  }
  return normalized;
}

function hasControlCharacters(value: string): boolean {
  return /[\u0000-\u001f\u007f]/.test(value);
}

function normalizeHost(value: unknown): string {
  const normalized = requireNonEmptyString(value, 'host').toLowerCase();
  if (
    normalized.includes('://')
    || normalized.includes('/')
    || normalized.includes('\\')
    || normalized.includes('@')
    || /\s/.test(normalized)
    || hasControlCharacters(normalized)
  ) {
    throw new SyncedNoteSourceContractError('Synced-note source host must be a bare host[:port] value');
  }
  return normalized;
}

function normalizeRepoSegment(value: unknown, fieldName: 'owner' | 'repo'): string {
  const normalized = requireNonEmptyString(value, fieldName);
  if (normalized.includes('/') || normalized.includes('\\') || hasControlCharacters(normalized)) {
    throw new SyncedNoteSourceContractError(`Synced-note source ${fieldName} must be a single path segment`);
  }
  return normalized;
}

function normalizeBranch(value: unknown): string {
  const normalized = requireNonEmptyString(value, 'branch');
  if (
    normalized.includes('\\')
    || normalized.startsWith('/')
    || normalized.endsWith('/')
    || normalized.includes('..')
    || normalized.endsWith('.lock')
    || hasControlCharacters(normalized)
  ) {
    throw new SyncedNoteSourceContractError('Synced-note source branch must be a valid deterministic git ref name');
  }
  return normalized;
}

function normalizeNotesPath(value: unknown): string {
  const raw = requireNonEmptyString(value, 'notesPath').replace(/\\/g, '/');
  const segments = raw
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && segment !== '.');

  if (segments.length === 0) {
    throw new SyncedNoteSourceContractError('Synced-note source notesPath must contain at least one path segment');
  }

  for (const segment of segments) {
    if (segment === '..' || hasControlCharacters(segment)) {
      throw new SyncedNoteSourceContractError('Synced-note source notesPath must not contain parent-directory traversal');
    }
  }

  return segments.join('/');
}

export function normalizeSyncedNoteSourceProvider(value: unknown): SyncedNoteSourceProvider {
  const provider = requireNonEmptyString(value, 'provider').toLowerCase() as SyncedNoteSourceProvider;
  if (!SYNCED_NOTE_SOURCE_PROVIDERS.includes(provider)) {
    throw new SyncedNoteSourceContractError(
      `Unsupported synced-note source provider: ${String(value ?? '')}`,
      'unsupported_synced_note_source_provider',
    );
  }
  return provider;
}

export function getSyncedNoteSourceProviderPolicy(provider: unknown): SyncedNoteSourceProviderPolicy {
  return SYNCED_NOTE_SOURCE_PROVIDER_POLICY[normalizeSyncedNoteSourceProvider(provider)];
}

export function normalizeSyncedNoteSourceId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    throw new SyncedNoteSourceContractError('Synced-note source id is required', 'invalid_synced_note_source_id');
  }
  if (!SYNCED_NOTE_SOURCE_ID_PATTERN.test(normalized)) {
    throw new SyncedNoteSourceContractError(
      'Synced-note source id must match snsrc_<32 lowercase hex characters>',
      'invalid_synced_note_source_id',
    );
  }
  return normalized;
}

export function canonicalizeSyncedNoteSourceLocator(locator: SyncedNoteSourceLocator): SyncedNoteSourceLocator {
  const providerPolicy = getSyncedNoteSourceProviderPolicy(locator?.provider);

  return {
    provider: providerPolicy.provider,
    host: normalizeHost(locator?.host),
    owner: normalizeRepoSegment(locator?.owner, 'owner'),
    repo: normalizeRepoSegment(locator?.repo, 'repo'),
    branch: normalizeBranch(locator?.branch),
    notesPath: normalizeNotesPath(locator?.notesPath),
  };
}

export function buildCanonicalSyncedNoteSourceTuple(locator: SyncedNoteSourceLocator): string {
  const canonical = canonicalizeSyncedNoteSourceLocator(locator);
  return [
    `provider=${canonical.provider}`,
    `host=${canonical.host}`,
    `owner=${canonical.owner}`,
    `repo=${canonical.repo}`,
    `branch=${canonical.branch}`,
    `notesPath=${canonical.notesPath}`,
  ].join('\n');
}

export function deriveSyncedNoteSourceId(locator: SyncedNoteSourceLocator): string {
  const digest = createHash('sha256')
    .update(buildCanonicalSyncedNoteSourceTuple(locator), 'utf8')
    .digest('hex')
    .slice(0, 32);
  return `${SYNCED_NOTE_SOURCE_ID_PREFIX}_${digest}`;
}

export function assertSyncedNoteSourceIdMatches(locator: SyncedNoteSourceLocator, expectedId: string): string {
  const normalizedExpectedId = normalizeSyncedNoteSourceId(expectedId);
  const derivedId = deriveSyncedNoteSourceId(locator);

  if (normalizedExpectedId !== derivedId) {
    throw new SyncedNoteSourceContractError(
      `Synced-note source id mismatch: expected ${normalizedExpectedId}, derived ${derivedId}`,
      'synced_note_source_locator_mismatch',
    );
  }

  return derivedId;
}

export const OBSIDIAN_SYNC_STATES = [
  'ready',
  'not-configured',
  'vault-unavailable',
  'notes-unavailable',
] as const;
export type ObsidianSyncState = typeof OBSIDIAN_SYNC_STATES[number];

export const OBSIDIAN_SYNCED_NOTE_ID_PREFIX = 'obsnote';

export interface ObsidianSyncedNoteConfig {
  vaultPath: string;
  notesPathTemplate?: string;
  cliPath?: string;
  syncCommand?: string[];
}

export interface ObsidianSyncedNoteSummary {
  kind: 'synced-note';
  provider: 'obsidian';
  id: string;
  title: string;
  summary: string;
  repoId?: string;
  targetRepoIds: string[];
  vaultName: string;
  notePath: string;
  filePath?: string;
  lastModifiedAt?: string;
  external: true;
  canonicalAuthority: false;
}

export interface ObsidianSyncedNoteDetail extends ObsidianSyncedNoteSummary {
  content: string;
  headings: string[];
}

export type ObsidianPlanningRepresentationKind = 'bullets' | 'roadmap';
export type ObsidianPlanningRepresentationFreshness =
  | 'current'
  | 'stale'
  | 'missing'
  | 'invalid'
  | 'source-missing';

export interface ObsidianPlanningRepresentationSummary {
  kind: 'planning-representation';
  provider: 'obsidian';
  id: string;
  representationKind: ObsidianPlanningRepresentationKind;
  title: string;
  summary: string;
  repoId?: string;
  targetRepoIds: string[];
  roadmapSlug?: string;
  sourceExists: boolean;
  sourceFilePath?: string;
  sourceRepoRelativePath: string;
  sourceUpdatedAt?: string;
  sourceContentHash?: string;
  notePath: string;
  filePath?: string;
  noteExists: boolean;
  noteUpdatedAt?: string;
  generatedAt?: string;
  freshness: ObsidianPlanningRepresentationFreshness;
  metadataValid: boolean;
  external: true;
  canonicalAuthority: false;
  message: string;
  bulletCount?: number;
  itemCount?: number;
}

export interface ObsidianPlanningRepresentationsStatus {
  totalCount: number;
  writeAvailable: boolean;
  currentCount: number;
  staleCount: number;
  missingCount: number;
  invalidCount: number;
  sourceMissingCount: number;
  message: string;
}

export interface ObsidianSyncedNoteStatus {
  state: ObsidianSyncState;
  configured: boolean;
  readAvailable: boolean;
  syncAvailable: boolean;
  external: true;
  canonicalAuthority: false;
  message: string;
  code?: string;
  configPath?: string;
  vaultName?: string;
  vaultPath?: string;
  notesPathTemplate?: string;
  notesDirectoryPath?: string;
  cliPath?: string;
  syncCommand?: string[];
}

function normalizePathSegments(
  value: unknown,
  fieldName: string,
): string[] {
  const raw = requireNonEmptyString(value, fieldName).replace(/\\/g, '/');
  const segments = raw
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && segment !== '.');

  if (segments.length === 0) {
    throw new SyncedNoteSourceContractError(`Obsidian ${fieldName} must contain at least one path segment`);
  }

  for (const segment of segments) {
    if (segment === '..' || hasControlCharacters(segment)) {
      throw new SyncedNoteSourceContractError(`Obsidian ${fieldName} must not contain parent-directory traversal`);
    }
  }

  return segments;
}

function normalizeOptionalObsidianString(value: unknown, fieldName: string): string | undefined {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    return undefined;
  }
  if (hasControlCharacters(normalized)) {
    throw new SyncedNoteSourceContractError(`Obsidian ${fieldName} must not contain control characters`);
  }
  return normalized;
}

function normalizeOptionalObsidianStringList(value: unknown, fieldName: string): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const normalized = value
    .map((entry) => normalizeOptionalObsidianString(entry, fieldName))
    .filter((entry): entry is string => Boolean(entry));
  return normalized.length > 0 ? normalized : undefined;
}

export function normalizeObsidianNotesPathTemplate(value: unknown): string {
  return normalizePathSegments(value, 'notesPathTemplate').join('/');
}

export function normalizeObsidianSyncedNotePath(value: unknown): string {
  return normalizePathSegments(value, 'notePath').join('/');
}

export function canonicalizeObsidianSyncedNoteConfig(
  config: ObsidianSyncedNoteConfig,
): ObsidianSyncedNoteConfig {
  return {
    vaultPath: requireNonEmptyString(config?.vaultPath, 'vaultPath'),
    notesPathTemplate: config?.notesPathTemplate
      ? normalizeObsidianNotesPathTemplate(config.notesPathTemplate)
      : 'Planning/{repoId}',
    cliPath: normalizeOptionalObsidianString(config?.cliPath, 'cliPath'),
    syncCommand: normalizeOptionalObsidianStringList(config?.syncCommand, 'syncCommand'),
  };
}

export function deriveObsidianSyncedNoteId(input: {
  repoId?: string;
  vaultName: string;
  notePath: string;
}): string {
  const repoId = String(input?.repoId ?? '').trim();
  const vaultName = requireNonEmptyString(input?.vaultName, 'vaultName');
  const notePath = normalizeObsidianSyncedNotePath(input?.notePath);
  const digest = createHash('sha256')
    .update([
      'provider=obsidian',
      `repoId=${repoId || '_'}`,
      `vaultName=${vaultName}`,
      `notePath=${notePath}`,
    ].join('\n'), 'utf8')
    .digest('hex')
    .slice(0, 32);
  return `${OBSIDIAN_SYNCED_NOTE_ID_PREFIX}_${digest}`;
}

/** Supported runtime provider identifiers. */
export type RuntimeProvider = 'non-docker' | 'docker';

export const PLANNING_API_CONTRACT_VERSION = 'planning_api_v1';

export interface PlanningApiEnvelope {
  contractVersion: typeof PLANNING_API_CONTRACT_VERSION;
  kind: string;
  deterministic: true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function buildPlanningApiEnvelope<T extends Record<string, unknown>>(
  kind: string,
  extras?: T,
): PlanningApiEnvelope & T {
  const payload = isRecord(extras) ? extras : ({} as T);
  return {
    ...payload,
    contractVersion: PLANNING_API_CONTRACT_VERSION,
    kind,
    deterministic: true,
  };
}

export function buildPlanningApiErrorEnvelope<
  T extends Record<string, unknown>,
  E extends string | Record<string, unknown>,
>(
  kind: string,
  error: E,
  extras?: T,
): PlanningApiEnvelope & T & { error: E } {
  return buildPlanningApiEnvelope(kind, {
    ...(isRecord(extras) ? extras : {}),
    error,
  } as T & { error: E });
}
