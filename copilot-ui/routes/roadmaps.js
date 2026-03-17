'use strict';

const repoInventoryLib = require('../lib/repoInventoryService');
const roadmapArtifactsLib = require('../lib/roadmapArtifacts');
const { sendJson: defaultSendJson, readJsonBody: defaultReadJsonBody } = require('./_helpers');
const {
  DEFAULT_PLANNING_API_CONTRACT_VERSION,
  normalizeString,
  sendRouteError,
  normalizeRepoSelector,
  summarizeRepo,
  resolveReadRepoContext,
  resolveMutationRepoContext,
} = require('./_planningRepoContext');

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

function resolveRoadmapSlug(match, index = 1) {
  return decodeURIComponent((match && match[index]) || '').trim();
}

function readRequestBody(req, deps) {
  return deps.readJsonBody(req).then((body) => (body && typeof body === 'object' ? body : {}));
}

function handleListRoadmaps(ctx, deps) {
  try {
    const selector = normalizeRepoSelector(ctx.u.searchParams);
    const { repo } = resolveReadRepoContext(ctx, deps, selector);
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
    const { repo } = resolveReadRepoContext(ctx, deps, selector);
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
      const { repo } = resolveMutationRepoContext(ctx, deps, selector);
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
      const { repo } = resolveMutationRepoContext(ctx, deps, selector);
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
      const { repo } = resolveMutationRepoContext(ctx, deps, selector);
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
