'use strict';

const path = require('path');

const repoInventoryLib = require('../lib/repoInventoryService');

const DEFAULT_PLANNING_API_CONTRACT_VERSION = 'planning_api_v1';

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function firstDefined(...values) {
  for (const value of values) {
    if (value != null) {
      return value;
    }
  }
  return undefined;
}

function normalizePathForKey(inputPath) {
  return String(inputPath || '').replace(/\\/g, '/').trim().toLowerCase();
}

function buildRouteError(message, statusCode, code, extra = {}) {
  return Object.assign(new Error(message), {
    statusCode,
    code,
    reason: code,
    ...extra,
  });
}

function buildErrorBody(contractVersion, kind, error) {
  return {
    contractVersion: contractVersion || DEFAULT_PLANNING_API_CONTRACT_VERSION,
    kind,
    deterministic: true,
    error: String(error && error.message ? error.message : error),
    code: normalizeString(error && error.code) || 'planning_repo_route_failed',
    reason:
      normalizeString(error && error.reason)
      || normalizeString(error && error.code)
      || 'planning_repo_route_failed',
  };
}

function sendRouteError(res, deps, kind, error) {
  deps.sendJson(
    res,
    error && error.statusCode ? error.statusCode : 500,
    buildErrorBody(deps.contractVersion, kind, error),
  );
}

function normalizeRepoSelector(searchParams, body = {}) {
  const source = body && typeof body === 'object' ? body : {};
  const repoId = normalizeString(firstDefined(source.repoId, searchParams && searchParams.get('repoId')));
  const repoPath = normalizeString(firstDefined(source.repoPath, searchParams && searchParams.get('repoPath')));
  return {
    ...(repoId ? { repoId } : {}),
    ...(repoPath ? { repoPath } : {}),
  };
}

function summarizeRepo(repo) {
  return repo
    ? {
      repoId: repo.repoId || null,
      repoPath: repo.repoPath || null,
      repoLabel: repo.repoLabel || null,
    }
    : null;
}

function loadInventory(ctx, deps) {
  return deps.repoInventory.listKnownRepos({
    copilotHome: firstDefined(ctx.copilotHomeAbs, ctx.copilotHome),
    engineRoot: ctx.engineRoot,
  });
}

function ensureRepoSelection(repo) {
  if (repo && repo.repoPath) {
    return repo;
  }
  throw buildRouteError(
    'Catalog repo selection is required for repo-backed planning docs',
    409,
    'catalog_repo_not_selected',
  );
}

function resolveReadRepoContext(ctx, deps, selector = {}) {
  const inventory = loadInventory(ctx, deps);
  const repo = ensureRepoSelection(deps.repoInventory.resolveRepoEntry(inventory, selector));
  return { inventory, repo };
}

function resolveMutationRepoContext(ctx, deps, selector = {}) {
  const inventory = loadInventory(ctx, deps);
  const requestedRepoId = normalizeString(selector.repoId);
  const requestedRepoPath = normalizeString(selector.repoPath);

  if (requestedRepoPath && !requestedRepoId) {
    throw buildRouteError(
      'Repo-backed planning mutations require Catalog repoId targeting; raw repoPath targeting is rejected',
      409,
      'catalog_repo_id_required_for_mutation',
    );
  }

  const repo = requestedRepoId
    ? deps.repoInventory.resolveRepoEntry(inventory, { repoId: requestedRepoId })
    : inventory.selectedRepo;

  if (!repo || !repo.repoPath || !repo.repoId) {
    throw buildRouteError(
      requestedRepoId
        ? `Catalog repoId not found in inventory: ${requestedRepoId}`
        : 'Catalog repo selection is required for repo-backed planning mutations',
      409,
      requestedRepoId ? 'catalog_repo_not_found' : 'catalog_repo_not_selected',
    );
  }

  if (
    requestedRepoPath
    && normalizePathForKey(path.resolve(requestedRepoPath)) !== normalizePathForKey(repo.repoPath)
  ) {
    throw buildRouteError(
      'Provided repoPath does not match the Catalog repo selected by repoId',
      409,
      'catalog_repo_path_mismatch',
    );
  }

  return { inventory, repo };
}

module.exports = {
  DEFAULT_PLANNING_API_CONTRACT_VERSION,
  normalizeString,
  buildRouteError,
  sendRouteError,
  normalizeRepoSelector,
  summarizeRepo,
  resolveReadRepoContext,
  resolveMutationRepoContext,
  repoInventoryLib,
};
