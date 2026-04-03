'use strict';

const repositoryBacklogFileLib = require('../lib/repositoryBacklogFile');
const { sendJson: defaultSendJson, readJsonBody: defaultReadJsonBody } = require('./_helpers');
const {
  DEFAULT_PLANNING_API_CONTRACT_VERSION,
  normalizeString,
  buildRouteError,
  sendRouteError,
  normalizeRepoSelector,
  summarizeRepo,
  resolveReadRepoContext,
  resolveMutationRepoContext,
  repoInventoryLib,
} = require('./_planningRepoContext');

function summarizeBacklog(state) {
  const backlog = state && state.backlog && typeof state.backlog === 'object' ? state.backlog : { items: [] };
  const family = state && state.family && typeof state.family === 'object' ? state.family : {};
  return {
    backlogPath: state && state.backlogPath ? state.backlogPath : null,
    repoRelativePath:
      state && state.repoRelativePath
        ? state.repoRelativePath
        : repositoryBacklogFileLib.REPOSITORY_BACKLOG_PRIMARY_DIRECTORY_REPO_RELATIVE_PATH,
    primaryDirectoryPath: family.primaryDirectoryPath || null,
    primaryRepoRelativePath:
      family.primaryDirectoryRepoRelativePath
      || repositoryBacklogFileLib.REPOSITORY_BACKLOG_PRIMARY_DIRECTORY_REPO_RELATIVE_PATH,
    primaryFamilyRepoRelativePath:
      family.primaryFamilyRepoRelativePath
      || repositoryBacklogFileLib.REPOSITORY_BACKLOG_PRIMARY_FAMILY_REPO_RELATIVE_PATH,
    legacyBacklogPath: family.legacyBacklogPath || null,
    legacyRepoRelativePath:
      family.legacyRepoRelativePath
      || repositoryBacklogFileLib.REPOSITORY_BACKLOG_LEGACY_FILE_RELATIVE_PATH,
    resolvedBacklogPaths: Array.isArray(family.resolvedBacklogPaths) ? family.resolvedBacklogPaths : [],
    resolvedRepoRelativePaths: Array.isArray(family.resolvedRepoRelativePaths) ? family.resolvedRepoRelativePaths : [],
    exists: Boolean(state && state.exists),
    formatVersion: backlog.formatVersion || repositoryBacklogFileLib.REPOSITORY_BACKLOG_FORMAT_VERSION,
    title: backlog.title || repositoryBacklogFileLib.REPOSITORY_BACKLOG_TITLE,
    description: backlog.description || repositoryBacklogFileLib.REPOSITORY_BACKLOG_DESCRIPTION,
    itemCount: Array.isArray(backlog.items) ? backlog.items.length : 0,
    items: Array.isArray(backlog.items) ? backlog.items : [],
  };
}

function readRequestBody(req, deps) {
  return deps.readJsonBody(req).then((body) => (body && typeof body === 'object' ? body : {}));
}

function mapRepositoryBacklogError(error) {
  if (error && error.statusCode) {
    return error;
  }

  const message = normalizeString(error && error.message ? error.message : error);
  if (!message) {
    return buildRouteError('repository backlog route failed', 500, 'repository_backlog_route_failed');
  }

  if (
    message.includes('document must begin with "# Repository Backlog"')
    || message.includes('Duplicate repository backlog item ID:')
    || message.includes('Invalid repository backlog key point line:')
  ) {
    return buildRouteError(message, 409, 'repository_backlog_file_invalid');
  }

  if (message.includes('Repository backlog file not found')) {
    return buildRouteError(message, 404, 'repository_backlog_not_found');
  }

  if (message.includes('Repository backlog item not found:')) {
    return buildRouteError(message, 404, 'repository_backlog_item_not_found');
  }

  return buildRouteError(message, 400, 'repository_backlog_validation_failed');
}

function handleReadBacklog(ctx, deps) {
  try {
    const selector = normalizeRepoSelector(ctx.u.searchParams);
    const { repo } = resolveReadRepoContext(ctx, deps, selector);
    const backlogState = deps.repositoryBacklogFile.readRepositoryBacklogFile(repo.repoPath);

    deps.sendJson(ctx.res, 200, {
      contractVersion: deps.contractVersion,
      kind: 'planning.backlog.read',
      deterministic: true,
      repo: summarizeRepo(repo),
      backlog: summarizeBacklog(backlogState),
    });
  } catch (error) {
    sendRouteError(ctx.res, deps, 'planning.backlog.read', mapRepositoryBacklogError(error));
  }
}

function handleCreateBacklogItem(ctx, deps) {
  readRequestBody(ctx.req, deps)
    .then((body) => {
      const selector = normalizeRepoSelector(ctx.u.searchParams, body);
      const { repo } = resolveMutationRepoContext(ctx, deps, selector);
      const payload = body.item && typeof body.item === 'object' ? body.item : body;
      const saved = deps.repositoryBacklogFile.updateRepositoryBacklogFile(
        repo.repoPath,
        (backlog) => deps.repositoryBacklogFile.createRepositoryBacklogItem(backlog, payload),
      );
      const item = saved.backlog.items[saved.backlog.items.length - 1] || null;

      deps.sendJson(ctx.res, 201, {
        contractVersion: deps.contractVersion,
        kind: 'planning.backlog.create',
        deterministic: true,
        repo: summarizeRepo(repo),
        backlog: summarizeBacklog(saved),
        item,
      });
    })
    .catch((error) => sendRouteError(
      ctx.res,
      deps,
      'planning.backlog.create',
      mapRepositoryBacklogError(error),
    ));
}

function handleUpdateBacklogItem(ctx, deps) {
  readRequestBody(ctx.req, deps)
    .then((body) => {
      const selector = normalizeRepoSelector(ctx.u.searchParams, body);
      const { repo } = resolveMutationRepoContext(ctx, deps, selector);
      const itemId = decodeURIComponent((ctx.match && ctx.match[1]) || '').trim();
      const current = deps.repositoryBacklogFile.readRepositoryBacklogFile(repo.repoPath);
      if (!current.exists) {
        throw buildRouteError('Repository backlog file not found', 404, 'repository_backlog_not_found');
      }

      const payload = body.item && typeof body.item === 'object'
        ? body.item
        : (body.patch && typeof body.patch === 'object' ? body.patch : body);

      const saved = deps.repositoryBacklogFile.updateRepositoryBacklogFile(
        repo.repoPath,
        (backlog) => deps.repositoryBacklogFile.updateRepositoryBacklogItem(backlog, itemId, payload),
      );
      const item = saved.backlog.items.find((entry) => entry.id === String(itemId || '').trim().toUpperCase()) || null;

      deps.sendJson(ctx.res, 200, {
        contractVersion: deps.contractVersion,
        kind: 'planning.backlog.update',
        deterministic: true,
        repo: summarizeRepo(repo),
        backlog: summarizeBacklog(saved),
        item,
      });
    })
    .catch((error) => sendRouteError(
      ctx.res,
      deps,
      'planning.backlog.update',
      mapRepositoryBacklogError(error),
    ));
}

function register(deps = {}) {
  const resolvedDeps = {
    contractVersion: deps.PLANNING_API_CONTRACT_VERSION || DEFAULT_PLANNING_API_CONTRACT_VERSION,
    sendJson: deps.sendJson || defaultSendJson,
    readJsonBody: deps.readJsonBody || defaultReadJsonBody,
    repoInventory: deps.repoInventory || repoInventoryLib,
    repositoryBacklogFile: deps.repositoryBacklogFile || repositoryBacklogFileLib,
  };

  return [
    {
      method: 'GET',
      path: '/api/planning/backlog',
      handler: (ctx) => handleReadBacklog(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: '/api/planning/backlog',
      handler: (ctx) => handleCreateBacklogItem(ctx, resolvedDeps),
    },
    {
      method: 'PATCH',
      path: /^\/api\/planning\/backlog\/([^/]+)$/,
      handler: (ctx) => handleUpdateBacklogItem(ctx, resolvedDeps),
    },
  ];
}

module.exports = { register };
