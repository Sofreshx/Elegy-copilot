'use strict';

/**
 * Kimaki remote session routes.
 * Exposes /api/remote/* endpoints for the Remote tab UI.
 */

const path = require('path');

const ROUTES = [
  { method: 'GET', path: '/api/remote/status' },
  { method: 'GET', path: '/api/remote/projects' },
  { method: 'GET', path: '/api/remote/sessions' },
  { method: 'POST', path: '/api/remote/send' },
  { method: 'POST', path: '/api/remote/projects/add' },
  { method: 'DELETE', path: '/api/remote/projects/remove' },
  { method: 'GET', path: '/api/remote/logs' },
];

function register(context) {
  const { kimakiRuntimeService, kimakiCli, sqliteReader, logReader, sendJson, requireAuth } = context;

  function handleStatus(ctx) {
    const service = kimakiRuntimeService;
    if (!service) {
      sendJson(ctx.res, 200, { state: 'unavailable', error: 'Kimaki service not initialized' });
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
    if (!sqliteReader) {
      sendJson(ctx.res, 503, { error: 'SQLite reader not available' });
      return;
    }

    try {
      const service = kimakiRuntimeService;
      const dbPath = path.join(service.getDataDir(), 'discord-sessions.db');
      const projects = sqliteReader.listProjects(dbPath);
      sendJson(ctx.res, 200, { projects });
    } catch (err) {
      sendJson(ctx.res, 500, { error: err.message });
    }
  }

  async function handleSessions(ctx) {
    if (!sqliteReader) {
      sendJson(ctx.res, 503, { error: 'SQLite reader not available' });
      return;
    }

    try {
      const service = kimakiRuntimeService;
      const dbPath = path.join(service.getDataDir(), 'discord-sessions.db');
      const projectDir = ctx.u.searchParams.get('project') || undefined;
      const limit = ctx.u.searchParams.get('limit') ? Number(ctx.u.searchParams.get('limit')) : undefined;
      const sessions = sqliteReader.listSessions(dbPath, { projectDir, limit });
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

  async function handleProjectRemove(ctx) {
    if (!kimakiCli) {
      sendJson(ctx.res, 503, { error: 'Kimaki CLI not available' });
      return;
    }

    try {
      const body = await readBody(ctx.req);
      const { directory } = JSON.parse(body);

      if (!directory) {
        sendJson(ctx.res, 400, { error: 'directory is required' });
        return;
      }

      const result = await kimakiCli.projectRemove(directory);
      sendJson(ctx.res, 200, { success: true, result });
    } catch (err) {
      sendJson(ctx.res, 500, { error: err.message });
    }
  }

  function handleLogs(ctx) {
    if (!logReader) {
      sendJson(ctx.res, 503, { error: 'Log reader not available' });
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
    { method: 'GET', path: '/api/remote/projects', handler: handleProjects },
    { method: 'GET', path: '/api/remote/sessions', handler: handleSessions },
    { method: 'POST', path: '/api/remote/send', handler: handleSend },
    { method: 'POST', path: '/api/remote/projects/add', handler: handleProjectAdd },
    { method: 'DELETE', path: '/api/remote/projects/remove', handler: handleProjectRemove },
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
