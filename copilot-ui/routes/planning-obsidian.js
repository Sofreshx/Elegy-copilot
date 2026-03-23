'use strict';

const obsidianNotesLib = require('../lib/obsidianNotes');
const obsidianCliLib = require('../lib/obsidianCli');
const obsidianRemoteSyncLib = require('../lib/obsidianRemoteSync');
const obsidianPlanningRepresentationsLib = require('../lib/obsidianPlanningRepresentations');
const { createObsidianSyncService } = require('../lib/obsidianSyncService');
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

function mapObsidianError(error) {
  if (error && error.statusCode) {
    return error;
  }

  const message = normalizeString(error && error.message ? error.message : error);
  if (!message) {
    return buildRouteError('obsidian planning route failed', 500, 'obsidian_planning_route_failed');
  }

  if (message.includes('parent-directory traversal') || message.includes('must be a JSON object')) {
    return buildRouteError(message, 409, 'obsidian_config_invalid');
  }

  return buildRouteError(message, 400, 'obsidian_planning_route_failed');
}

function createService(deps) {
  if (deps.obsidianSyncService) {
    return deps.obsidianSyncService;
  }

  return createObsidianSyncService({
    obsidianNotes: deps.obsidianNotes,
    obsidianCli: deps.obsidianCli,
    obsidianRemoteSync: deps.obsidianRemoteSync,
    childProcess: deps.childProcess,
    process: deps.process,
    fetch: deps.fetch,
  });
}

function buildOptions(ctx, deps) {
  const selector = normalizeRepoSelector(ctx.u.searchParams);
  const { repo } = resolveReadRepoContext(ctx, deps, selector);
  return {
    repo,
    options: {
      repo,
      copilotHomeAbs: ctx.copilotHomeAbs || ctx.copilotHome,
      copilotHome: ctx.copilotHome,
      process: deps.process,
    },
  };
}

function buildMutationOptions(ctx, deps, body = {}) {
  const selector = normalizeRepoSelector(ctx.u.searchParams, body);
  const { repo } = resolveMutationRepoContext(ctx, deps, selector);
  return {
    repo,
    options: {
      repo,
      copilotHomeAbs: ctx.copilotHomeAbs || ctx.copilotHome,
      copilotHome: ctx.copilotHome,
      process: deps.process,
    },
  };
}

function readRequestBody(req, deps) {
  if (!req || typeof req.on !== 'function') {
    return Promise.resolve(req && typeof req.body === 'object' && req.body ? req.body : {});
  }
  return deps.readJsonBody(req).then((body) => (body && typeof body === 'object' ? body : {}));
}

async function handleGetObsidianStatus(ctx, deps) {
  try {
    const { repo, options } = buildOptions(ctx, deps);
    const status = await deps.obsidianSyncService.getStatus(options);

    deps.sendJson(ctx.res, 200, {
      contractVersion: deps.contractVersion,
      kind: 'planning.obsidian.status',
      deterministic: true,
      repo: summarizeRepo(repo),
      status,
    });
  } catch (error) {
    sendRouteError(ctx.res, deps, 'planning.obsidian.status', mapObsidianError(error));
  }
}

async function handleListObsidianNotes(ctx, deps) {
  try {
    const { repo, options } = buildOptions(ctx, deps);
    const result = await deps.obsidianSyncService.listNotes(options);

    deps.sendJson(ctx.res, 200, {
      contractVersion: deps.contractVersion,
      kind: 'planning.obsidian.notes',
      deterministic: true,
      repo: summarizeRepo(repo),
      status: result.status,
      count: result.notes.length,
      notes: result.notes,
    });
  } catch (error) {
    sendRouteError(ctx.res, deps, 'planning.obsidian.notes', mapObsidianError(error));
  }
}

async function handleGetObsidianNote(ctx, deps) {
  try {
    const { repo, options } = buildOptions(ctx, deps);
    const noteId = decodeURIComponent((ctx.match && ctx.match[1]) || '').trim();
    if (!noteId) {
      throw buildRouteError('Obsidian note id is required', 400, 'obsidian_note_id_required');
    }

    const result = await deps.obsidianSyncService.readNote(options, noteId);

    if (!result.status.readAvailable) {
      throw buildRouteError(
        result.status.message || 'External Obsidian notes are unavailable',
        409,
        normalizeString(result.status.code) || 'obsidian_notes_unavailable',
      );
    }

    if (!result.note) {
      throw buildRouteError(`Obsidian note not found: ${noteId}`, 404, 'obsidian_note_not_found');
    }

    deps.sendJson(ctx.res, 200, {
      contractVersion: deps.contractVersion,
      kind: 'planning.obsidian.note.read',
      deterministic: true,
      repo: summarizeRepo(repo),
      status: result.status,
      note: result.note,
    });
  } catch (error) {
    sendRouteError(ctx.res, deps, 'planning.obsidian.note.read', mapObsidianError(error));
  }
}

async function handleManualObsidianSync(ctx, deps) {
  try {
    const body = await readRequestBody(ctx.req, deps);
    const { repo, options } = buildMutationOptions(ctx, deps, body);
    const result = await deps.obsidianSyncService.syncNow(options, 'manual');
    const status = await deps.obsidianSyncService.getStatus(options);

    deps.sendJson(ctx.res, 200, {
      contractVersion: deps.contractVersion,
      kind: 'planning.obsidian.sync',
      deterministic: false,
      repo: summarizeRepo(repo),
      status,
      result,
    });
  } catch (error) {
    sendRouteError(ctx.res, deps, 'planning.obsidian.sync', mapObsidianError(error));
  }
}

async function handleGetObsidianRepresentationStatus(ctx, deps) {
  try {
    const { repo, options } = buildOptions(ctx, deps);
    const result = deps.obsidianPlanningRepresentations.getPlanningRepresentationStatus(options);

    deps.sendJson(ctx.res, 200, {
      contractVersion: deps.contractVersion,
      kind: 'planning.obsidian.representations.status',
      deterministic: true,
      repo: summarizeRepo(repo),
      status: result.status,
      representationsStatus: result.representationsStatus,
    });
  } catch (error) {
    sendRouteError(ctx.res, deps, 'planning.obsidian.representations.status', mapObsidianError(error));
  }
}

async function handleListObsidianRepresentations(ctx, deps) {
  try {
    const { repo, options } = buildOptions(ctx, deps);
    const result = deps.obsidianPlanningRepresentations.listPlanningRepresentations(options);

    deps.sendJson(ctx.res, 200, {
      contractVersion: deps.contractVersion,
      kind: 'planning.obsidian.representations',
      deterministic: true,
      repo: summarizeRepo(repo),
      status: result.status,
      representationsStatus: result.representationsStatus,
      count: result.representations.length,
      representations: result.representations,
    });
  } catch (error) {
    sendRouteError(ctx.res, deps, 'planning.obsidian.representations', mapObsidianError(error));
  }
}

async function handleRefreshObsidianRepresentations(ctx, deps) {
  readRequestBody(ctx.req, deps)
    .then((body) => {
      const { repo, options } = buildMutationOptions(ctx, deps, body);
      const result = deps.obsidianPlanningRepresentations.refreshPlanningRepresentations(options);

      deps.sendJson(ctx.res, 200, {
        contractVersion: deps.contractVersion,
        kind: 'planning.obsidian.representations.refresh',
        deterministic: true,
        repo: summarizeRepo(repo),
        status: result.status,
        representationsStatus: result.representationsStatus,
        count: result.representations.length,
        representations: result.representations,
        result: result.result,
      });
    })
    .catch((error) => {
      sendRouteError(ctx.res, deps, 'planning.obsidian.representations.refresh', mapObsidianError(error));
    });
}

function register(deps = {}) {
  const resolvedDeps = {
    contractVersion: deps.PLANNING_API_CONTRACT_VERSION || DEFAULT_PLANNING_API_CONTRACT_VERSION,
    sendJson: deps.sendJson || defaultSendJson,
    repoInventory: deps.repoInventory || repoInventoryLib,
    obsidianNotes: deps.obsidianNotes || obsidianNotesLib,
    obsidianCli: deps.obsidianCli || obsidianCliLib,
    obsidianRemoteSync: deps.obsidianRemoteSync || obsidianRemoteSyncLib,
    obsidianPlanningRepresentations: deps.obsidianPlanningRepresentations || obsidianPlanningRepresentationsLib,
    childProcess: deps.childProcess,
    process: deps.process || process,
    fetch: deps.fetch,
    readJsonBody: deps.readJsonBody || defaultReadJsonBody,
  };
  resolvedDeps.obsidianSyncService = createService(resolvedDeps);

  return [
    {
      method: 'GET',
      path: '/api/planning/obsidian/status',
      handler: (ctx) => handleGetObsidianStatus(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: '/api/planning/obsidian/notes',
      handler: (ctx) => handleListObsidianNotes(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: /^\/api\/planning\/obsidian\/notes\/([^/]+)$/,
      handler: (ctx) => handleGetObsidianNote(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: '/api/planning/obsidian/sync',
      handler: (ctx) => handleManualObsidianSync(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: '/api/planning/obsidian/representations/status',
      handler: (ctx) => handleGetObsidianRepresentationStatus(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: '/api/planning/obsidian/representations',
      handler: (ctx) => handleListObsidianRepresentations(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: '/api/planning/obsidian/representations/refresh',
      handler: (ctx) => handleRefreshObsidianRepresentations(ctx, resolvedDeps),
    },
  ];
}

module.exports = { register };
