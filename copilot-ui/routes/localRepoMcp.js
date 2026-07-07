'use strict';

const { sendJson: defaultSendJson, readJsonBody: defaultReadJsonBody } = require('./_helpers');
const managerDefault = require('../lib/localRepoMcpManager');
const accessDefault = require('../lib/localRepoReaderAccess');
const repoInventoryDefault = require('../lib/repoInventoryService');

function sendError(res, sendJson, error) {
  sendJson(res, error.statusCode || 500, { error: error.message || String(error) });
}

function resolveRegisteredRepo(deps, ctx, request) {
  const inventory = deps.repoInventory.listKnownRepos({
    elegyHome: ctx.elegyHomeAbs,
    engineRoot: ctx.engineRoot,
  });
  return deps.repoInventory.resolveRepoEntry(inventory, {
    repoId: request.repoId,
    repoPath: request.repoPath,
  }) || null;
}

function register(deps = {}) {
  const resolvedDeps = {
    sendJson: deps.sendJson || defaultSendJson,
    readJsonBody: deps.readJsonBody || defaultReadJsonBody,
    manager: deps.manager || managerDefault,
    access: deps.access || accessDefault,
    repoInventory: deps.repoInventory || repoInventoryDefault,
  };

  return [
    {
      method: 'GET',
      path: '/api/local-repo-mcp/status',
      handler: (ctx) => {
        try {
          resolvedDeps.sendJson(ctx.res, 200, resolvedDeps.manager.getStatus(ctx));
        } catch (error) {
          sendError(ctx.res, resolvedDeps.sendJson, error);
        }
      },
    },
    {
      method: 'GET',
      path: '/api/local-repo-mcp/config',
      handler: (ctx) => {
        try {
          resolvedDeps.sendJson(ctx.res, 200, {
            config: resolvedDeps.manager.loadConfig(ctx),
            access: resolvedDeps.access.listAccess({ elegyHome: ctx.elegyHomeAbs }),
          });
        } catch (error) {
          sendError(ctx.res, resolvedDeps.sendJson, error);
        }
      },
    },
    {
      method: 'PUT',
      path: '/api/local-repo-mcp/config',
      handler: async (ctx) => {
        try {
          const body = await resolvedDeps.readJsonBody(ctx.req);
          const config = resolvedDeps.manager.saveConfig({ ...ctx, config: body && body.config ? body.config : body });
          resolvedDeps.sendJson(ctx.res, 200, { config });
        } catch (error) {
          sendError(ctx.res, resolvedDeps.sendJson, error);
        }
      },
    },
    {
      method: 'POST',
      path: '/api/local-repo-mcp/roots/add',
      handler: async (ctx) => {
        try {
          const request = await resolvedDeps.readJsonBody(ctx.req);
          const repo = resolveRegisteredRepo(resolvedDeps, ctx, request || {});
          if (!repo || !repo.repoPath || repo.registered !== true) {
            throw Object.assign(new Error('Unknown registered repo'), { statusCode: 404 });
          }
          const result = resolvedDeps.access.enableRepo({
            elegyHome: ctx.elegyHomeAbs,
            repoId: repo.repoId,
            repoPath: repo.repoPath,
            repoLabel: repo.repoLabel,
            alias: request.alias || repo.repoLabel || repo.repoId,
          });
          resolvedDeps.sendJson(ctx.res, 200, result);
        } catch (error) {
          sendError(ctx.res, resolvedDeps.sendJson, error);
        }
      },
    },
    {
      method: 'POST',
      path: '/api/local-repo-mcp/roots/remove',
      handler: async (ctx) => {
        try {
          const request = await resolvedDeps.readJsonBody(ctx.req);
          const result = resolvedDeps.access.disableRepo({
            elegyHome: ctx.elegyHomeAbs,
            repoId: request.repoId,
            repoPath: request.repoPath,
            alias: request.alias,
          });
          resolvedDeps.sendJson(ctx.res, 200, result);
        } catch (error) {
          sendError(ctx.res, resolvedDeps.sendJson, error);
        }
      },
    },
    {
      method: 'POST',
      path: '/api/local-repo-mcp/start',
      handler: (ctx) => {
        try {
          resolvedDeps.sendJson(ctx.res, 200, resolvedDeps.manager.startServer(ctx));
        } catch (error) {
          sendError(ctx.res, resolvedDeps.sendJson, error);
        }
      },
    },
    {
      method: 'POST',
      path: '/api/local-repo-mcp/stop',
      handler: async (ctx) => {
        try {
          resolvedDeps.sendJson(ctx.res, 200, await resolvedDeps.manager.stopServer(ctx));
        } catch (error) {
          sendError(ctx.res, resolvedDeps.sendJson, error);
        }
      },
    },
    {
      method: 'POST',
      path: '/api/local-repo-mcp/tunnel/start',
      handler: async (ctx) => {
        try {
          resolvedDeps.sendJson(ctx.res, 200, await resolvedDeps.manager.startTunnel(ctx));
        } catch (error) {
          sendError(ctx.res, resolvedDeps.sendJson, error);
        }
      },
    },
    {
      method: 'POST',
      path: '/api/local-repo-mcp/tunnel/quick/start',
      handler: async (ctx) => {
        try {
          resolvedDeps.sendJson(ctx.res, 200, await resolvedDeps.manager.startQuickTunnel(ctx));
        } catch (error) {
          sendError(ctx.res, resolvedDeps.sendJson, error);
        }
      },
    },
    {
      method: 'POST',
      path: '/api/local-repo-mcp/tunnel/stop',
      handler: async (ctx) => {
        try {
          resolvedDeps.sendJson(ctx.res, 200, await resolvedDeps.manager.stopTunnel(ctx));
        } catch (error) {
          sendError(ctx.res, resolvedDeps.sendJson, error);
        }
      },
    },
    {
      method: 'POST',
      path: '/api/local-repo-mcp/probe',
      handler: async (ctx) => {
        try {
          resolvedDeps.sendJson(ctx.res, 200, await resolvedDeps.manager.probe(ctx));
        } catch (error) {
          sendError(ctx.res, resolvedDeps.sendJson, error);
        }
      },
    },
    {
      method: 'GET',
      path: '/api/local-repo-mcp/oauth/pending',
      handler: async (ctx) => {
        try {
          resolvedDeps.sendJson(ctx.res, 200, await resolvedDeps.manager.getPendingAuthorizations(ctx));
        } catch (error) {
          sendError(ctx.res, resolvedDeps.sendJson, error);
        }
      },
    },
    {
      method: 'POST',
      path: '/api/local-repo-mcp/oauth/approve',
      handler: async (ctx) => {
        try {
          const body = await resolvedDeps.readJsonBody(ctx.req);
          resolvedDeps.sendJson(ctx.res, 200, await resolvedDeps.manager.approveAuthorization({ ...ctx, id: body?.id }));
        } catch (error) {
          sendError(ctx.res, resolvedDeps.sendJson, error);
        }
      },
    },
  ];
}

module.exports = { register };
