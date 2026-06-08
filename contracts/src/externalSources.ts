import type { ExtensibleString } from './assetCatalog';

declare const __dirname: string;
declare function require(name: string): any;

const fs = require('fs');
const path = require('path');

export type ExternalSourceType = ExtensibleString<'github-repo'>;
export type ExternalInstallableKind = ExtensibleString<'skill' | 'mcp-server' | 'cli-tool'>;
export type ExternalSourceTarget = ExtensibleString<
  'copilot' | 'codex' | 'opencode' | 'antigravity' | 'gemini-cli' | 'antigravity-cli' | 'host'
>;

export interface ExternalInstallableRecord {
  installableId: string;
  kind: ExternalInstallableKind;
  name?: string;
  title?: string;
  description?: string;
  relativePath?: string;
  sourcePath?: string;
  status?: string;
  hiddenByDefault?: boolean;
  deprecated?: boolean;
  setupHints?: string[];
  targetSupport?: ExternalSourceTarget[];
  installCommand?: string;
  verifyCommand?: string;
  bootstrapCommand?: string;
  runtimeChecks?: string[];
  metadata?: Record<string, unknown>;
}

export interface ConflictGroup {
  groupId: string;
  label: string;
  installableIds: string[];
  conflictsWith: string[];
}

export interface ExternalSourceRecord {
  sourceId: string;
  title: string;
  description?: string;
  url: string;
  sourceType: ExternalSourceType;
  owner?: string;
  repo?: string;
  defaultRef?: string;
  includeSkills?: boolean;
  includeMcp?: boolean;
  preferredSkillPathPrefixes?: string[];
  hiddenPathPrefixes?: string[];
  deprecatedPathPrefixes?: string[];
  mcpManifestPath?: string;
  setupHints?: string[];
  installables?: ExternalInstallableRecord[];
  conflictGroups?: ConflictGroup[];
  metadata?: Record<string, unknown>;
  editable?: boolean;
}

export interface ExternalSourcesCatalogDocument {
  schemaVersion: number;
  sources: ExternalSourceRecord[];
}

const CANONICAL_EXTERNAL_SOURCES_PATH = path.resolve(__dirname, '..', '..', 'engine-assets', 'external-sources.json');

const FALLBACK_EXTERNAL_SOURCES: ExternalSourcesCatalogDocument = {
  schemaVersion: 1,
  sources: [],
};

export function normalizeExternalSourceId(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value
      .map((entry) => normalizeString(entry))
      .filter(Boolean)
    : [];
}

function normalizeRecordObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function normalizeExternalInstallableRecord(value: unknown): ExternalInstallableRecord | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const installableId = normalizeString(record.installableId || record.id);
  const kind = normalizeString(record.kind);
  if (!installableId || !kind) {
    return null;
  }

  return {
    installableId,
    kind,
    name: normalizeString(record.name) || undefined,
    title: normalizeString(record.title) || undefined,
    description: normalizeString(record.description) || undefined,
    relativePath: normalizeString(record.relativePath) || undefined,
    sourcePath: normalizeString(record.sourcePath) || undefined,
    status: normalizeString(record.status) || undefined,
    hiddenByDefault: normalizeBoolean(record.hiddenByDefault, false),
    deprecated: normalizeBoolean(record.deprecated, false),
    setupHints: normalizeStringList(record.setupHints),
    targetSupport: normalizeStringList(record.targetSupport) as ExternalSourceTarget[],
    installCommand: normalizeString(record.installCommand) || undefined,
    verifyCommand: normalizeString(record.verifyCommand) || undefined,
    bootstrapCommand: normalizeString(record.bootstrapCommand) || undefined,
    runtimeChecks: normalizeStringList(record.runtimeChecks),
    metadata: normalizeRecordObject(record.metadata),
  };
}

function normalizeConflictGroup(value: unknown): ConflictGroup | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const groupId = normalizeString(record.groupId);
  const label = normalizeString(record.label);
  if (!groupId) {
    return null;
  }

  return {
    groupId,
    label: label || groupId,
    installableIds: normalizeStringList(record.installableIds),
    conflictsWith: normalizeStringList(record.conflictsWith),
  };
}

function normalizeExternalSourceRecord(value: unknown): ExternalSourceRecord | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const sourceId = normalizeExternalSourceId(record.sourceId || record.id || record.repo);
  const title = normalizeString(record.title);
  const url = normalizeString(record.url);
  const sourceType = normalizeString(record.sourceType || 'github-repo') || 'github-repo';

  if (!sourceId || !title || !url || !sourceType) {
    return null;
  }

  return {
    sourceId,
    title,
    description: normalizeString(record.description) || undefined,
    url,
    sourceType,
    owner: normalizeString(record.owner) || undefined,
    repo: normalizeString(record.repo) || undefined,
    defaultRef: normalizeString(record.defaultRef) || undefined,
    includeSkills: normalizeBoolean(record.includeSkills, true),
    includeMcp: normalizeBoolean(record.includeMcp, false),
    preferredSkillPathPrefixes: normalizeStringList(record.preferredSkillPathPrefixes),
    hiddenPathPrefixes: normalizeStringList(record.hiddenPathPrefixes),
    deprecatedPathPrefixes: normalizeStringList(record.deprecatedPathPrefixes),
    mcpManifestPath: normalizeString(record.mcpManifestPath) || undefined,
    setupHints: normalizeStringList(record.setupHints),
    installables: Array.isArray(record.installables)
      ? record.installables
        .map((entry) => normalizeExternalInstallableRecord(entry))
        .filter((entry): entry is ExternalInstallableRecord => Boolean(entry))
      : undefined,
    conflictGroups: Array.isArray(record.conflictGroups)
      ? record.conflictGroups
        .map((entry) => normalizeConflictGroup(entry))
        .filter((entry): entry is ConflictGroup => Boolean(entry))
      : undefined,
    metadata: normalizeRecordObject(record.metadata),
    editable: normalizeBoolean(record.editable, false),
  };
}

export function normalizeExternalSourcesCatalogDocument(value: unknown): ExternalSourcesCatalogDocument {
  if (!value || typeof value !== 'object') {
    return FALLBACK_EXTERNAL_SOURCES;
  }

  const record = value as Record<string, unknown>;
  const normalizedSources = Array.isArray(record.sources)
    ? record.sources
      .map((entry) => normalizeExternalSourceRecord(entry))
      .filter((entry): entry is ExternalSourceRecord => Boolean(entry))
    : [];

  return {
    schemaVersion: Number(record.schemaVersion) || FALLBACK_EXTERNAL_SOURCES.schemaVersion,
    sources: normalizedSources,
  };
}

function loadCanonicalExternalSourcesCatalog(): ExternalSourcesCatalogDocument {
  try {
    const raw = fs.readFileSync(CANONICAL_EXTERNAL_SOURCES_PATH, 'utf8');
    return normalizeExternalSourcesCatalogDocument(JSON.parse(raw));
  } catch {
    return FALLBACK_EXTERNAL_SOURCES;
  }
}

export const DEFAULT_EXTERNAL_SOURCES_CATALOG: ExternalSourcesCatalogDocument = loadCanonicalExternalSourcesCatalog();
