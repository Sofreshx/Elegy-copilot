/**
 * Deterministic provenance normalization.
 * Maps source roots and source IDs to display group names.
 */

export type ProvenanceGroup =
  | 'Copilot core'
  | 'Shared skills'
  | 'Codex-specific'
  | 'OpenCode-specific'
  | 'Antigravity-specific'
  | 'Claude-specific'
  | 'User / repo / external';

export interface ProvenanceGroupInfo {
  group: ProvenanceGroup;
  groupKey: string;
  order: number;
}

const PROVENANCE_ORDER: Record<string, number> = {
  'Copilot core': 0,
  'Shared skills': 1,
  'Codex-specific': 2,
  'OpenCode-specific': 3,
  'Antigravity-specific': 4,
  'Claude-specific': 5,
  'User / repo / external': 6,
};

/**
 * Normalize a source root or source ID into a provenance group.
 * Handles various path formats and prefixes.
 */
export function normalizeProvenance(
  sourceRoot: string | null | undefined,
  sourceId?: string | null,
  sourceType?: string | null,
): ProvenanceGroupInfo {
  const root = (sourceRoot ?? '').toLowerCase().trim();
  const id = (sourceId ?? '').toLowerCase().trim();
  const type = (sourceType ?? '').toLowerCase().trim();

  if (root.includes('engine-assets') || id.includes('engine-assets') || root.includes('copilot core')) {
    return { group: 'Copilot core', groupKey: 'copilot-core', order: PROVENANCE_ORDER['Copilot core'] };
  }
  if (
    root.includes('catalog-assets') ||
    root.includes('shared-skills') ||
    id.includes('shared-skills') ||
    id.includes('catalog-assets')
  ) {
    return { group: 'Shared skills', groupKey: 'shared-skills', order: PROVENANCE_ORDER['Shared skills'] };
  }
  if (root.includes('codex-assets') || id.includes('codex-assets') || root.includes('codex')) {
    return { group: 'Codex-specific', groupKey: 'codex-specific', order: PROVENANCE_ORDER['Codex-specific'] };
  }
  if (root.includes('opencode-assets') || id.includes('opencode-assets') || root.includes('opencode')) {
    return { group: 'OpenCode-specific', groupKey: 'opencode-specific', order: PROVENANCE_ORDER['OpenCode-specific'] };
  }
  if (root.includes('antigravity-assets') || id.includes('antigravity-assets') || root.includes('antigravity')) {
    return { group: 'Antigravity-specific', groupKey: 'antigravity-specific', order: PROVENANCE_ORDER['Antigravity-specific'] };
  }
  if (root.includes('claude-assets') || id.includes('claude-assets') || root.includes('claude')) {
    return { group: 'Claude-specific', groupKey: 'claude-specific', order: PROVENANCE_ORDER['Claude-specific'] };
  }

  // External, user, or repo-local
  if (type === 'external-source' || type === 'user' || type === 'repo-local' || type === 'repository') {
    return { group: 'User / repo / external', groupKey: 'user-repo-external', order: PROVENANCE_ORDER['User / repo / external'] };
  }

  // Default fallback
  return { group: 'User / repo / external', groupKey: 'user-repo-external', order: PROVENANCE_ORDER['User / repo / external'] };
}

/**
 * Sort function for provenance groups (deterministic order).
 */
export function compareProvenanceGroups(a: ProvenanceGroupInfo, b: ProvenanceGroupInfo): number {
  return a.order - b.order;
}
