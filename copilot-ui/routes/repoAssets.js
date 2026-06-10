'use strict';

const fs = require('fs');
const path = require('path');
const { sendJson, readJsonBody } = require('./_helpers');

/**
 * Repo Assets route module.
 * Discovers agents/skills/config files in a repository and manages
 * installation status per harness via the elegyDB.
 */

const HARNESS_NAMES = ['opencode', 'codex', 'copilot', 'antigravity'];

const DISCOVERY_PATTERNS = [
  // Root config files
  { pattern: 'AGENTS.md', kind: 'config', sourceHarness: null },
  { pattern: 'guidelines.md', kind: 'config', sourceHarness: null },

  // OpenCode
  { glob: '.opencode/agents/*.agent.md', kind: 'agent', sourceHarness: 'opencode' },
  { glob: '.opencode/skills/*/SKILL.md', kind: 'skill', sourceHarness: 'opencode' },

  // Codex
  { glob: '.codex/agents/*.md', kind: 'agent', sourceHarness: 'codex' },
  { glob: '.codex/agents/*.agent.md', kind: 'agent', sourceHarness: 'codex' },
  { glob: '.codex/skills/*/SKILL.md', kind: 'skill', sourceHarness: 'codex' },

  // Copilot
  { glob: '.copilot/agents/*.agent.md', kind: 'agent', sourceHarness: 'copilot' },
  { glob: '.copilot/skills/*/SKILL.md', kind: 'skill', sourceHarness: 'copilot' },

  // Antigravity
  { glob: '.gemini/agents/*.md', kind: 'agent', sourceHarness: 'antigravity' },
  { glob: '.gemini/agents/*.agent.md', kind: 'agent', sourceHarness: 'antigravity' },
  { glob: '.gemini/skills/*/SKILL.md', kind: 'skill', sourceHarness: 'antigravity' },

  // Repo-level (no harness prefix)
  { glob: 'skills/*/SKILL.md', kind: 'skill', sourceHarness: null },
  { glob: 'agents/*.agent.md', kind: 'agent', sourceHarness: null },

  // Generated mirrors (agents) and canonical repo-local (github)
  { glob: '.agents/skills/*/SKILL.md', kind: 'skill', sourceHarness: 'agents' },
  { glob: '.github/skills/*/SKILL.md', kind: 'skill', sourceHarness: 'copilot' },
];

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Filter dbAssets to only those matching a given assetId.
 * Uses the actual column name `asset_id` (not `assetId`).
 */
function getDbAssetsForAsset(dbAssets, assetId) {
  return (dbAssets || []).filter(
    dbAsset => String(dbAsset.asset_id || '') === String(assetId || '')
  );
}

/**
 * Build the set of harness entries with installation status from elegyDb.
 * The repo_assets table uses per-row design: one row per (repo_path, asset_id, harness).
 */
function buildHarnessStatuses(elegyDb, repoPath, assetId) {
  const statuses = HARNESS_NAMES.map((harness) => ({
    harness,
    installed: false,
    installedAt: null,
  }));

  if (!elegyDb || typeof elegyDb.getRepoAssets !== 'function') {
    return statuses;
  }

  try {
    const dbAssets = elegyDb.getRepoAssets(repoPath);
    if (!Array.isArray(dbAssets)) return statuses;

    const matchingAssets = getDbAssetsForAsset(dbAssets, assetId);

    return HARNESS_NAMES.map((harness) => {
      const matching = matchingAssets.find(
        (dbAsset) => String(dbAsset.harness || '').toLowerCase() === harness.toLowerCase()
      );
      return {
        harness,
        installed: !!matching,
        installedAt: matching ? matching.installed_at || null : null,
      };
    });
  } catch {
    // If db query fails, return default (all not installed)
  }

  return statuses;
}

/**
 * Match a file path against discovery patterns.
 */
function matchPattern(filePath) {
  const normalized = filePath.replace(/\\/g, '/');

  for (const dp of DISCOVERY_PATTERNS) {
    if (dp.pattern) {
      // Exact filename match (root files)
      if (normalized === dp.pattern) {
        return dp;
      }
    }
    if (dp.glob) {
      // Convert simple glob to regex
      const regexStr = dp.glob
        .replace(/\./g, '\\.')
        .replace(/\*/g, '[^/]+');
      const regex = new RegExp('^' + regexStr + '$');
      if (regex.test(normalized)) {
        return dp;
      }
    }
  }

  return null;
}

/**
 * Scan a specific dir for matching files.
 */
function scanDir(repoRoot, results, baseDir) {
  if (!fs.existsSync(baseDir)) return;

  let entries;
  try {
    entries = fs.readdirSync(baseDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(baseDir, entry.name);
    const relativePath = path.relative(repoRoot, fullPath).replace(/\\/g, '/');

    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      // Recursively scan subdirs up to reasonable depth
      const depth = relativePath.split('/').length;
      if (depth > 8) continue;
      scanDir(repoRoot, results, fullPath);
    } else if (entry.isFile()) {
      const match = matchPattern(relativePath);
      if (!match) continue;

      try {
        const stat = fs.statSync(fullPath);
        const assetId = relativePath;

        results.push({
          id: assetId,
          name: entry.name,
          kind: match.kind,
          path: relativePath,
          sourceHarness: match.sourceHarness,
          filePath: fullPath,
          size: stat.size,
          modifiedAt: stat.mtime.toISOString(),
        });
      } catch {
        // skip unreadable files
      }
    }
  }
}

/**
 * GET /api/repo-assets/discover?repoPath=...
 */
async function handleRepoAssetsDiscover(ctx, deps) {
  const { res, u, elegyDb } = ctx;
  const { sendJson: json } = deps;
  const repoPath = u.searchParams.get('repoPath');

  if (!isNonEmptyString(repoPath)) {
    json(res, 400, { error: 'repoPath query parameter is required' });
    return;
  }

  const root = repoPath.trim();
  if (!fs.existsSync(root)) {
    json(res, 404, { error: 'Repository path not found' });
    return;
  }

  try {
    const discovered = [];

    // Scan root files
    for (const dp of DISCOVERY_PATTERNS) {
      if (dp.pattern) {
        const fullPath = path.join(root, dp.pattern);
        if (fs.existsSync(fullPath)) {
          try {
            const stat = fs.statSync(fullPath);
            discovered.push({
              id: dp.pattern,
              name: path.basename(dp.pattern),
              kind: dp.kind,
              path: dp.pattern,
              sourceHarness: dp.sourceHarness,
              filePath: fullPath,
              size: stat.size,
              modifiedAt: stat.mtime.toISOString(),
            });
          } catch { /* skip */ }
        }
      }
    }

    // Scan recursive dirs
    scanDir(root, discovered, root);

    // Deduplicate by id (path)
    const seen = new Set();
    const assets = [];
    for (const asset of discovered) {
      if (seen.has(asset.id)) continue;
      seen.add(asset.id);

      assets.push({
        ...asset,
        harnesses: buildHarnessStatuses(elegyDb, root, asset.id),
      });
    }

    // Sort by path
    assets.sort((a, b) => String(a.path || '').localeCompare(String(b.path || '')));

    // Also include worktree info
    let worktrees = [];
    if (elegyDb && typeof elegyDb.listWorktreesByRepo === 'function') {
      try {
        worktrees = elegyDb.listWorktreesByRepo(root) || [];
      } catch (e) { /* ignore */ }
    }

    json(res, 200, {
      repoPath: root,
      assets,
      availableHarnesses: [...HARNESS_NAMES],
      worktrees: worktrees.map(w => ({
        path: w.path,
        branch: w.branch,
        source: w.source,
        status: w.status,
        sessionCount: w.session_count || 0,
        lastActivityAt: w.last_activity_at,
      })),
      count: assets.length,
    });
  } catch (error) {
    json(res, 500, { error: String(error.message || error) });
  }
}

/**
 * POST /api/repo-assets/install
 * Body: { repoPath, assetId, harness }
 */
async function handleRepoAssetsInstall(ctx, deps) {
  const { res, req, elegyDb } = ctx;
  const { sendJson: json } = deps;

  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    const statusCode = err.statusCode || 400;
    json(res, statusCode, { error: String(err.message || 'Invalid request body') });
    return;
  }

  const { repoPath, assetId, harness } = body || {};

  if (!isNonEmptyString(repoPath)) {
    json(res, 400, { error: 'repoPath is required' });
    return;
  }
  if (!isNonEmptyString(assetId)) {
    json(res, 400, { error: 'assetId is required' });
    return;
  }
  if (!isNonEmptyString(harness)) {
    json(res, 400, { error: 'harness is required' });
    return;
  }

  if (!HARNESS_NAMES.includes(harness)) {
    json(res, 400, { error: `Invalid harness. Must be one of: ${HARNESS_NAMES.join(', ')}` });
    return;
  }

  // Verify asset exists in repo
  const root = repoPath.trim();
  const assetPath = path.join(root, assetId);
  if (!fs.existsSync(assetPath)) {
    json(res, 404, { error: 'Asset file not found in repository' });
    return;
  }

  if (!elegyDb || typeof elegyDb.upsertRepoAsset !== 'function') {
    json(res, 503, { error: 'Database not available for recording installation', code: 'elegy_db_not_ready' });
    return;
  }

  try {
    const installedAt = new Date().toISOString();
    const result = elegyDb.upsertRepoAsset({
      repo_path: root,
      asset_id: assetId,
      harness,
      asset_kind: body.assetKind || 'unknown',
      repo_id: body.repoId || null,
      installed_at: installedAt,
      updated_at: installedAt,
      source_path: body.sourcePath || null,
    });

    json(res, 200, {
      ok: true,
      assetId,
      harness,
      installedAt: result ? (result.installed_at || installedAt) : installedAt,
    });
  } catch (error) {
    json(res, 500, { error: String(error.message || error), code: 'elegy_db_write_error' });
  }
}

function register(context = {}) {
  const deps = { sendJson };

  return [
    {
      method: 'GET',
      path: '/api/repo-assets/discover',
      handler: (ctx) => handleRepoAssetsDiscover(ctx, deps),
    },
    {
      method: 'POST',
      path: '/api/repo-assets/install',
      handler: (ctx) => handleRepoAssetsInstall(ctx, deps),
    },
  ];
}

module.exports = { register };
