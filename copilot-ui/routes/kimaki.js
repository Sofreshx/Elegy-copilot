'use strict';

/**
 * Kimaki remote session routes.
 * Exposes /api/remote/* endpoints for the Remote tab UI.
 */

const path = require('path');

const ROUTES = [
  { method: 'GET', path: '/api/remote/status' },
  { method: 'POST', path: '/api/remote/restart' },
  { method: 'GET', path: '/api/remote/projects' },
  { method: 'GET', path: '/api/remote/sessions' },
  { method: 'POST', path: '/api/remote/send' },
  { method: 'POST', path: '/api/remote/projects/add' },
  { method: 'GET', path: '/api/remote/logs' },
];

function register(context) {
  const { kimakiRuntimeService, kimakiCli, sqliteReader, logReader, sendJson } = context;

  function handleStatus(ctx) {
    const service = kimakiRuntimeService;
    if (!service) {
      sendJson(ctx.res, 200, {
        state: 'unavailable',
        installUrl: null,
        guildIds: [],
        appId: null,
        dataDir: null,
        lastError: 'Kimaki service not initialized',
      });
      return;
    }

    sendJson(ctx.res, 200, {
      state: service.getState(),
      installUrl: service.getInstallUrl(),
      guildIds: service.getGuildIds(),
      appId: service.getAppId(),
      dataDir: service.getDataDir(),
      lastError: service.getLastError(),
    });
  }

  async function handleProjects(ctx) {
    if (!sqliteReader || !kimakiRuntimeService || !kimakiCli) {
      sendJson(ctx.res, 503, { error: 'Kimaki runtime is not available' });
      return;
    }

    try {
      const service = kimakiRuntimeService;
      const dbPath = path.join(service.getDataDir(), 'discord-sessions.db');
      const guildId = service.getGuildIds()[0];
      const projects = sqliteReader.listProjects(dbPath).map((project) => ({
        ...project,
        guildId,
      }));
      sendJson(ctx.res, 200, { projects });
    } catch (err) {
      sendJson(ctx.res, 500, { error: err.message });
    }
  }

  async function handleRestart(ctx) {
    if (!kimakiRuntimeService) {
      sendJson(ctx.res, 503, { error: 'Kimaki runtime is not available' });
      return;
    }
    try {
      await kimakiRuntimeService.restart();
      sendJson(ctx.res, 200, { success: true, state: kimakiRuntimeService.getState() });
    } catch (err) {
      sendJson(ctx.res, 500, { error: err.message });
    }
  }

  async function handleSessions(ctx) {
    if (!sqliteReader || !kimakiRuntimeService) {
      sendJson(ctx.res, 503, { error: 'Kimaki runtime is not available' });
      return;
    }

    try {
      const service = kimakiRuntimeService;
      const projectDir = ctx.u.searchParams.get('project') || undefined;
      const limit = ctx.u.searchParams.get('limit') ? Number(ctx.u.searchParams.get('limit')) : undefined;
      const dbPath = path.join(service.getDataDir(), 'discord-sessions.db');
      const projectDirectories = projectDir
        ? [projectDir]
        : sqliteReader.listProjects(dbPath).map((project) => project.directory);
      const sessionGroups = await Promise.all(
        projectDirectories.map(async (directory) => {
          const result = await kimakiCli.sessionList(directory);
          return Array.isArray(result) ? result : [];
        }),
      );
      const sessions = sessionGroups
        .flat()
        .map((session) => ({
          sessionId: session.id,
          threadId: session.threadId,
          threadName: session.title,
          source: session.source,
          project: session.directory,
          updatedAt: session.updated,
        }))
        .filter((session) => session.threadId)
        .slice(0, Number.isFinite(limit) && limit > 0 ? limit : undefined);
      sendJson(ctx.res, 200, { sessions });
    } catch (err) {
      sendJson(ctx.res, 500, { error: err.message });
    }
  }

  async function handleSend(ctx) {
    if (!kimakiCli) {
      sendJson(ctx.res, 503, { error: 'Kimaki CLI not available' });
      return;
    }

    try {
      const body = await readBody(ctx.req);
      const { project, prompt, threadId, permission } = JSON.parse(body);

      if (!project || !prompt) {
        sendJson(ctx.res, 400, { error: 'project and prompt are required' });
        return;
      }

      const result = await kimakiCli.send({ project, prompt, threadId, permission });
      sendJson(ctx.res, 200, { success: true, result });
    } catch (err) {
      sendJson(ctx.res, 500, { error: err.message });
    }
  }

  async function handleProjectAdd(ctx) {
    if (!kimakiCli) {
      sendJson(ctx.res, 503, { error: 'Kimaki CLI not available' });
      return;
    }

    try {
      const body = await readBody(ctx.req);
      const { directory, guildId } = JSON.parse(body);

      if (!directory) {
        sendJson(ctx.res, 400, { error: 'directory is required' });
        return;
      }

      const result = await kimakiCli.projectAdd(directory, guildId);
      sendJson(ctx.res, 200, { success: true, result });
    } catch (err) {
      sendJson(ctx.res, 500, { error: err.message });
    }
  }

  function handleLogs(ctx) {
    if (!logReader || !kimakiRuntimeService) {
      sendJson(ctx.res, 503, { error: 'Kimaki runtime is not available' });
      return;
    }

    try {
      const service = kimakiRuntimeService;
      const logPath = path.join(service.getDataDir(), 'kimaki.log');
      const tail = ctx.u.searchParams.get('tail') ? Number(ctx.u.searchParams.get('tail')) : 50;
      const lines = logReader.tailLog(logPath, tail);
      sendJson(ctx.res, 200, { lines });
    } catch (err) {
      sendJson(ctx.res, 500, { error: err.message });
    }
  }

  return [
    { method: 'GET', path: '/api/remote/status', handler: handleStatus },
    { method: 'POST', path: '/api/remote/restart', handler: handleRestart },
    { method: 'GET', path: '/api/remote/projects', handler: handleProjects },
    { method: 'GET', path: '/api/remote/sessions', handler: handleSessions },
    { method: 'POST', path: '/api/remote/send', handler: handleSend },
    { method: 'POST', path: '/api/remote/projects/add', handler: handleProjectAdd },
    { method: 'GET', path: '/api/remote/logs', handler: handleLogs },
  ];
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

module.exports = { register };
