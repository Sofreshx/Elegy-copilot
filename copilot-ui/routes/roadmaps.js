'use strict';

const repoInventoryLib = require('../lib/repoInventoryService');
const roadmapArtifactsLib = require('../lib/roadmapArtifacts');
const { sendJson: defaultSendJson, readJsonBody: defaultReadJsonBody } = require('./_helpers');

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

function buildErrorBody(contractVersion, kind, error) {
  return {
    contractVersion,
    kind,
    deterministic: true,
    error: String(error && error.message ? error.message : error),
    code: normalizeString(error && error.code) || 'roadmap_route_failed',
    reason: normalizeString(error && error.reason) || normalizeString(error && error.code) || 'roadmap_route_failed',
  };
}

function sendRouteError(res, deps, kind, error) {
  deps.sendJson(res, error && error.statusCode ? error.statusCode : 500, buildErrorBody(
    deps.contractVersion,
    kind,
    error,
  ));
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

function summarizeRoadmap(roadmap) {
  const items = Array.isArray(roadmap && roadmap.items) ? roadmap.items : [];
  const statusCounts = {};
  for (const item of items) {
    const status = normalizeString(item && item.status) || 'planned';
    statusCounts[status] = (statusCounts[status] || 0) + 1;
  }

  return {
    slug: roadmap.slug,
    title: roadmap.title,
    overview: roadmap.overview,
    filePath: roadmap.filePath,
    repoRelativePath: roadmap.repoRelativePath,
    itemCount: items.length,
    statusCounts,
    items,
  };
}

function resolveRepoContext(ctx, deps, selector) {
  const inventory = deps.repoInventory.listKnownRepos({
    copilotHome: ctx.copilotHomeAbs,
    engineRoot: ctx.engineRoot,
    explicitRepoPaths: selector.repoPath ? [selector.repoPath] : [],
  });
  const repo = deps.repoInventory.resolveRepoEntry(inventory, selector);
  if (!repo || !repo.repoPath) {
    throw Object.assign(new Error('Catalog repo selection is required for roadmap artifacts'), {
      statusCode: 409,
      code: 'catalog_repo_not_selected',
      reason: 'catalog_repo_not_selected',
    });
  }
  return { inventory, repo };
}

function resolveRoadmapSlug(match, index = 1) {
  return decodeURIComponent((match && match[index]) || '').trim();
}

function readRequestBody(req, deps) {
  return deps.readJsonBody(req).then((body) => (body && typeof body === 'object' ? body : {}));
}

function handleListRoadmaps(ctx, deps) {
  try {
    const selector = normalizeRepoSelector(ctx.u.searchParams);
    const { repo } = resolveRepoContext(ctx, deps, selector);
    const roadmaps = deps.roadmapArtifacts.listRoadmapDocuments(repo.repoPath).map(summarizeRoadmap);
    deps.sendJson(ctx.res, 200, {
      contractVersion: deps.contractVersion,
      kind: 'planning.roadmaps.list',
      deterministic: true,
      repo: summarizeRepo(repo),
      count: roadmaps.length,
      roadmaps,
    });
  } catch (error) {
    sendRouteError(ctx.res, deps, 'planning.roadmaps.list', error);
  }
}

function handleReadRoadmap(ctx, deps) {
  try {
    const slug = deps.roadmapArtifacts.assertRoadmapSlug(resolveRoadmapSlug(ctx.match, 1));
    const selector = normalizeRepoSelector(ctx.u.searchParams);
    const { repo } = resolveRepoContext(ctx, deps, selector);
    const roadmap = deps.roadmapArtifacts.readRoadmapDocument(repo.repoPath, slug);
    deps.sendJson(ctx.res, 200, {
      contractVersion: deps.contractVersion,
      kind: 'planning.roadmaps.read',
      deterministic: true,
      repo: summarizeRepo(repo),
      roadmap: summarizeRoadmap(roadmap),
    });
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      sendRouteError(ctx.res, deps, 'planning.roadmaps.read', Object.assign(
        new Error('roadmap artifact not found'),
        { statusCode: 404, code: 'roadmap_not_found', reason: 'roadmap_not_found' },
      ));
      return;
    }
    sendRouteError(ctx.res, deps, 'planning.roadmaps.read', error);
  }
}

function handleCreateRoadmap(ctx, deps) {
  readRequestBody(ctx.req, deps)
    .then((body) => {
      const selector = normalizeRepoSelector(ctx.u.searchParams, body);
      const { repo } = resolveRepoContext(ctx, deps, selector);
      const slug = deps.roadmapArtifacts.assertRoadmapSlug(body.slug || body.roadmapSlug);
      const filePath = deps.roadmapArtifacts.resolveRoadmapFilePath(repo.repoPath, slug);
      if (deps.fs.existsSync(filePath)) {
        throw Object.assign(new Error(`roadmap already exists: ${slug}`), {
          statusCode: 409,
          code: 'roadmap_already_exists',
          reason: 'roadmap_already_exists',
        });
      }

      const roadmap = deps.roadmapArtifacts.writeRoadmapDocument(repo.repoPath, {
        slug,
        title: body.title,
        overview: body.overview,
        items: Array.isArray(body.items) ? body.items : [],
      });

      deps.sendJson(ctx.res, 201, {
        contractVersion: deps.contractVersion,
        kind: 'planning.roadmaps.create',
        deterministic: true,
        repo: summarizeRepo(repo),
        roadmap: summarizeRoadmap(roadmap),
      });
    })
    .catch((error) => sendRouteError(ctx.res, deps, 'planning.roadmaps.create', error));
}

function handleUpdateRoadmap(ctx, deps) {
  readRequestBody(ctx.req, deps)
    .then((body) => {
      const slug = deps.roadmapArtifacts.assertRoadmapSlug(resolveRoadmapSlug(ctx.match, 1));
      const selector = normalizeRepoSelector(ctx.u.searchParams, body);
      const { repo } = resolveRepoContext(ctx, deps, selector);
      const existing = deps.roadmapArtifacts.readRoadmapDocument(repo.repoPath, slug);
      const roadmap = deps.roadmapArtifacts.writeRoadmapDocument(
        repo.repoPath,
        deps.roadmapArtifacts.mergeRoadmapDocument(existing, body),
      );

      deps.sendJson(ctx.res, 200, {
        contractVersion: deps.contractVersion,
        kind: 'planning.roadmaps.update',
        deterministic: true,
        repo: summarizeRepo(repo),
        roadmap: summarizeRoadmap(roadmap),
      });
    })
    .catch((error) => {
      if (error && error.code === 'ENOENT') {
        sendRouteError(ctx.res, deps, 'planning.roadmaps.update', Object.assign(
          new Error('roadmap artifact not found'),
          { statusCode: 404, code: 'roadmap_not_found', reason: 'roadmap_not_found' },
        ));
        return;
      }
      sendRouteError(ctx.res, deps, 'planning.roadmaps.update', error);
    });
}

function handleReconcileRoadmap(ctx, deps) {
  readRequestBody(ctx.req, deps)
    .then((body) => {
      const slug = deps.roadmapArtifacts.assertRoadmapSlug(resolveRoadmapSlug(ctx.match, 1));
      const selector = normalizeRepoSelector(ctx.u.searchParams, body);
      const { repo } = resolveRepoContext(ctx, deps, selector);
      const existing = deps.roadmapArtifacts.readRoadmapDocument(repo.repoPath, slug);
      const result = deps.roadmapArtifacts.reconcileRoadmapItem(existing, {
        itemId: body.itemId || body.id,
        backlogIds: body.backlogIds,
        planRef: body.planRef,
        outcome: body.outcome,
      });
      const roadmap = deps.roadmapArtifacts.writeRoadmapDocument(repo.repoPath, result.roadmap);

      deps.sendJson(ctx.res, 200, {
        contractVersion: deps.contractVersion,
        kind: 'planning.roadmaps.reconcile',
        deterministic: true,
        repo: summarizeRepo(repo),
        outcome: result.outcome,
        roadmap: summarizeRoadmap(roadmap),
        item: result.item,
      });
    })
    .catch((error) => {
      if (error && error.code === 'ENOENT') {
        sendRouteError(ctx.res, deps, 'planning.roadmaps.reconcile', Object.assign(
          new Error('roadmap artifact not found'),
          { statusCode: 404, code: 'roadmap_not_found', reason: 'roadmap_not_found' },
        ));
        return;
      }
      sendRouteError(ctx.res, deps, 'planning.roadmaps.reconcile', error);
    });
}

function register(deps = {}) {
  const resolvedDeps = {
    contractVersion: deps.PLANNING_API_CONTRACT_VERSION || DEFAULT_PLANNING_API_CONTRACT_VERSION,
    fs: deps.fs || require('fs'),
    sendJson: deps.sendJson || defaultSendJson,
    readJsonBody: deps.readJsonBody || defaultReadJsonBody,
    repoInventory: deps.repoInventory || repoInventoryLib,
    roadmapArtifacts: deps.roadmapArtifacts || roadmapArtifactsLib,
  };

  return [
    {
      method: 'GET',
      path: '/api/planning/roadmaps',
      handler: (ctx) => handleListRoadmaps(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: /^\/api\/planning\/roadmaps\/([^/]+)$/,
      handler: (ctx) => handleReadRoadmap(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: '/api/planning/roadmaps',
      handler: (ctx) => handleCreateRoadmap(ctx, resolvedDeps),
    },
    {
      method: 'PATCH',
      path: /^\/api\/planning\/roadmaps\/([^/]+)$/,
      handler: (ctx) => handleUpdateRoadmap(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: /^\/api\/planning\/roadmaps\/([^/]+)\/reconcile$/,
      handler: (ctx) => handleReconcileRoadmap(ctx, resolvedDeps),
    },
  ];
}

module.exports = { register };
