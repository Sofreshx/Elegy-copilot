'use strict';

const fs = require('fs');
const path = require('path');

const HARNESS_ALLOWLIST = Object.freeze(new Set([
  'codex',
  'opencode',
  'copilot',
  'antigravity',
  'human',
]));

const REPO_INVENTORY_FILENAME = 'repo-inventory.json';

/**
 * Read a JSON file if it exists and is parseable.
 * Returns null on any failure.
 */
function readJsonIfExists(absPath) {
  try {
    const stat = fs.statSync(absPath);
    if (!stat.isFile()) {
      return null;
    }
    return JSON.parse(fs.readFileSync(absPath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Read directory entries, returning an empty array on failure.
 */
function safeReadDir(absPath) {
  try {
    return fs.readdirSync(absPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

/**
 * Normalize a string value: trim whitespace, return null if empty.
 */
function normalizeOptionalString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Build a canonical repo record from a candidate source object.
 * Returns null if no identity fields are present.
 */
function buildRepoRecord(input) {
  if (!input || typeof input !== 'object') {
    return null;
  }

  const repoId = normalizeOptionalString(input.repoId);
  const repoPath = normalizeOptionalString(input.repoPath);
  const repoLabel = normalizeOptionalString(input.repoLabel)
    || repoId
    || (repoPath ? path.basename(repoPath) : null);

  if (!repoId && !repoPath) {
    return null;
  }

  const source = normalizeOptionalString(input.source)
    || normalizeOptionalString(input.sourceType)
    || 'unknown';

  return {
    repoId: repoId || '',
    repoPath: repoPath || '',
    repoLabel: repoLabel || '',
    sources: [source],
  };
}

/**
 * Merge a candidate record into the given map keyed by repoId.
 * If the key already exists, merge sources arrays.
 */
function mergeRepoIntoMap(map, record) {
  if (!record || !record.repoId) {
    return;
  }

  const existing = map.get(record.repoId);
  if (existing) {
    const mergedSources = new Set([
      ...existing.sources,
      ...record.sources,
    ]);
    existing.sources = Array.from(mergedSources).sort((a, b) => a.localeCompare(b));
    existing.repoLabel = existing.repoLabel || record.repoLabel;
    existing.repoPath = existing.repoPath || record.repoPath;
    return;
  }

  map.set(record.repoId, {
    repoId: record.repoId,
    repoPath: record.repoPath,
    repoLabel: record.repoLabel,
    sources: Array.from(new Set(record.sources)).sort((a, b) => a.localeCompare(b)),
  });
}

/**
 * Read per-repo projection files from catalog/projections/repo-*.json.
 */
function readProjectionRecords(copilotHome) {
  const projectionsDir = path.join(copilotHome, 'catalog', 'projections');
  const records = [];

  for (const entry of safeReadDir(projectionsDir)) {
    if (!entry.isFile() || !/^repo-.+\.json$/i.test(entry.name)) {
      continue;
    }

    const snapshotPath = path.join(projectionsDir, entry.name);
    const snapshot = readJsonIfExists(snapshotPath);
    if (!snapshot || typeof snapshot !== 'object') {
      continue;
    }

    const repoContext = snapshot.repoContext;
    if (!repoContext || typeof repoContext !== 'object') {
      continue;
    }

    const record = buildRepoRecord({
      repoId: repoContext.repoId,
      repoPath: repoContext.repoPath,
      repoLabel: repoContext.repoLabel || repoContext.displayName,
      source: 'catalog-projection',
    });

    if (record) {
      records.push(record);
    }
  }

  return records;
}

/**
 * Read the repo-inventory.json file from catalog/.
 */
function readInventoryRecords(copilotHome) {
  const inventoryPath = path.join(copilotHome, 'catalog', REPO_INVENTORY_FILENAME);
  const raw = readJsonIfExists(inventoryPath);
  if (!raw || typeof raw !== 'object') {
    return [];
  }

  const repos = Array.isArray(raw.repos) ? raw.repos : [];
  return repos
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }
      return buildRepoRecord({
        repoId: entry.repoId,
        repoPath: entry.repoPath,
        repoLabel: entry.repoLabel || entry.label,
        source: 'repo-inventory',
      });
    })
    .filter(Boolean);
}

/**
 * Load repo inventory from the copilotHome catalog directory.
 *
 * Reads catalog/projections/repo-*.json and catalog/repo-inventory.json.
 * Returns { repos, byId, byLabel, byPath } where the Map values index
 * the canonical records by their respective keys.
 */
function loadRepoInventory(copilotHome) {
  const homePath = normalizeOptionalString(copilotHome) || '';
  if (!homePath) {
    return {
      repos: [],
      byId: new Map(),
      byLabel: new Map(),
      byPath: new Map(),
    };
  }

  const projectionRecords = readProjectionRecords(homePath);
  const inventoryRecords = readInventoryRecords(homePath);

  // Merge all records into a map keyed by repoId
  const byId = new Map();
  for (const record of projectionRecords) {
    mergeRepoIntoMap(byId, record);
  }
  for (const record of inventoryRecords) {
    mergeRepoIntoMap(byId, record);
  }

  const repos = Array.from(byId.values());
  const byLabel = new Map();
  const byPath = new Map();

  for (const repo of repos) {
    if (repo.repoLabel) {
      const labelKey = repo.repoLabel.toLowerCase();
      if (!byLabel.has(labelKey)) {
        byLabel.set(labelKey, repo);
      }
    }
    if (repo.repoPath) {
      const pathKey = repo.repoPath.replace(/\\/g, '/').toLowerCase();
      if (!byPath.has(pathKey)) {
        byPath.set(pathKey, repo);
      }
    }
  }

  return {
    repos,
    byId,
    byLabel,
    byPath,
  };
}

/**
 * Resolve a canonical repo identity triple from flexible input.
 *
 * Accepts:
 *   - A 12-character hex string (matched against repoId)
 *   - A label string (matched against repoLabel, case-insensitive)
 *   - A path string (matched against repoPath, case-insensitive, normalized)
 *   - An object with { repoId, repoPath, repoLabel } fields
 *
 * Returns { repoId, repoLabel, repoPath } or null.
 */
function resolveRepoIdentity(input, inventory) {
  if (!inventory || typeof inventory !== 'object') {
    return null;
  }

  const byId = inventory.byId instanceof Map ? inventory.byId : new Map();
  const byLabel = inventory.byLabel instanceof Map ? inventory.byLabel : new Map();
  const byPath = inventory.byPath instanceof Map ? inventory.byPath : new Map();

  // Object input with explicit identity fields
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const repoId = normalizeOptionalString(input.repoId);
    const repoLabel = normalizeOptionalString(input.repoLabel);
    const repoPath = normalizeOptionalString(input.repoPath);

    if (repoId && byId.has(repoId)) {
      const match = byId.get(repoId);
      return {
        repoId: match.repoId,
        repoLabel: match.repoLabel,
        repoPath: match.repoPath,
      };
    }

    if (repoPath) {
      const pathKey = repoPath.replace(/\\/g, '/').toLowerCase();
      if (byPath.has(pathKey)) {
        const match = byPath.get(pathKey);
        return {
          repoId: match.repoId,
          repoLabel: match.repoLabel,
          repoPath: match.repoPath,
        };
      }
    }

    if (repoLabel) {
      const labelKey = repoLabel.toLowerCase();
      if (byLabel.has(labelKey)) {
        const match = byLabel.get(labelKey);
        return {
          repoId: match.repoId,
          repoLabel: match.repoLabel,
          repoPath: match.repoPath,
        };
      }
    }

    return null;
  }

  // String input
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) {
      return null;
    }

    // 12-character hex string - match against repoId
    if (/^[0-9a-f]{12}$/i.test(trimmed)) {
      const repoId = trimmed.toLowerCase();
      if (byId.has(repoId)) {
        const match = byId.get(repoId);
        return {
          repoId: match.repoId,
          repoLabel: match.repoLabel,
          repoPath: match.repoPath,
        };
      }
      return null;
    }

    // Path string (contains a path separator or looks like a path)
    if (trimmed.includes('/') || trimmed.includes('\\') || path.isAbsolute(trimmed)) {
      const pathKey = path.resolve(trimmed).replace(/\\/g, '/').toLowerCase();
      if (byPath.has(pathKey)) {
        const match = byPath.get(pathKey);
        return {
          repoId: match.repoId,
          repoLabel: match.repoLabel,
          repoPath: match.repoPath,
        };
      }
      // Try partial suffix match: last N segments
      for (const [storedPath, match] of byPath) {
        if (storedPath.endsWith(pathKey) || pathKey.endsWith(storedPath)) {
          return {
            repoId: match.repoId,
            repoLabel: match.repoLabel,
            repoPath: match.repoPath,
          };
        }
      }
      return null;
    }

    // Label string - case-insensitive match
    const labelKey = trimmed.toLowerCase();
    if (byLabel.has(labelKey)) {
      const match = byLabel.get(labelKey);
      return {
        repoId: match.repoId,
        repoLabel: match.repoLabel,
        repoPath: match.repoPath,
      };
    }

    // Fallback: try as repoId (for non-hex IDs like slugs)
    if (byId.has(trimmed)) {
      const match = byId.get(trimmed);
      return {
        repoId: match.repoId,
        repoLabel: match.repoLabel,
        repoPath: match.repoPath,
      };
    }

    return null;
  }

  return null;
}

/**
 * Build canonical repo tag strings for filtering.
 * Returns ['repo:<repoId>', 'repo:<repoLabel>'].
 */
function buildCanonicalRepoTags(identity) {
  if (!identity || typeof identity !== 'object') {
    return [];
  }

  const tags = [];
  const repoId = normalizeOptionalString(identity.repoId);
  const repoLabel = normalizeOptionalString(identity.repoLabel);

  if (repoId) {
    tags.push('repo:' + repoId);
  }
  if (repoLabel) {
    tags.push('repo:' + repoLabel);
  }

  return tags;
}

/**
 * Build a normalized source tag string from a harness name.
 * Returns null if the harness is not in the allowlist.
 *
 * The returned tag has the form 'source:<harness>' where harness
 * is lowercased and trimmed.
 */
function buildHarnessTag(harness) {
  const normalized = normalizeOptionalString(harness);
  if (!normalized) {
    return null;
  }

  const lower = normalized.toLowerCase();
  if (!HARNESS_ALLOWLIST.has(lower)) {
    return null;
  }

  return 'source:' + lower;
}

module.exports = {
  loadRepoInventory,
  resolveRepoIdentity,
  buildCanonicalRepoTags,
  buildHarnessTag,
};
