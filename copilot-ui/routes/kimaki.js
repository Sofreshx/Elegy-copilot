'use strict';

/**
 * Kimaki remote session routes.
 * Exposes /api/remote/* endpoints for the Remote tab UI.
 */

const path = require('path');
const Database = require('better-sqlite3');
const os = require('node:os');
const copilotConfig = require('../lib/copilotConfig');

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

  function sendRemoteError(res, status, code, message) {
    sendJson(res, status, { error: code, code, message });
  }

  function sendCliError(res, error) {
    sendRemoteError(
      res,
      500,
      'remote_cli_error',
      error instanceof Error ? error.message : String(error),
    );
  }

  function requireReady(res) {
    if (!kimakiRuntimeService || !kimakiCli) {
      sendRemoteError(res, 503, 'remote_runtime_unavailable', 'Kimaki runtime files are unavailable.');
      return false;
    }
    if (!kimakiRuntimeService.getReady()) {
      sendRemoteError(res, 409, 'remote_not_ready', 'Complete Discord setup before using remote sessions.');
      return false;
    }
    return true;
  }

  async function handleEnable(ctx) {
    const { res, elegyHome } = ctx;
    const service = kimakiRuntimeService;

    try {
      copilotConfig.setRemoteSessions(elegyHome, true);
      if (service) {
        await service.start({});
      }
      sendJson(res, 200, {
        ok: true,
        enabled: true,
        state: service ? service.getState() : 'idle',
      });
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        error: String(error.message || error),
      });
    }
  }

  async function handleDisable(ctx) {
    const { res, elegyHome } = ctx;
    const service = kimakiRuntimeService;

    try {
      copilotConfig.setRemoteSessions(elegyHome, false);
      if (service) {
        await service.stop();
      }
      sendJson(res, 200, {
        ok: true,
        enabled: false,
        state: 'idle',
      });
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        error: String(error.message || error),
      });
    }
  }

  function handleStatus(ctx) {
    const service = kimakiRuntimeService;
    if (!service) {
      sendJson(ctx.res, 200, {
        state: 'unavailable',
        available: false,
        ready: false,
        enabled: false,
        pid: null,
        uptimeMs: null,
        phase: 'error',
        reason: 'kimaki_entrypoint_missing',
        message: 'Kimaki runtime files are unavailable.',
        runtime: 'node',
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
      available: service.getAvailable(),
      ready: service.getReady(),
      enabled: copilotConfig.getRemoteSessions(ctx.elegyHome),
      pid: typeof service.getPid === 'function' ? service.getPid() : null,
      uptimeMs: typeof service.getStartedAt === 'function' ? (service.getStartedAt() ? Date.now() - service.getStartedAt() : null) : null,
      phase: service.getState(),
      reason: service.getReason(),
      message: service.getReady()
        ? 'Discord remote sessions are connected.'
        : service.getLastError() || 'Complete the Discord installation to connect remote sessions.',
      runtime: 'node',
      installUrl: service.getInstallUrl(),
      guildIds: service.getGuildIds(),
      appId: service.getAppId(),
      dataDir: service.getDataDir(),
      lastError: service.getLastError(),
    });
  }

  async function handleProjects(ctx) {
    if (!sqliteReader) {
      sendRemoteError(ctx.res, 503, 'remote_storage_unavailable', 'Kimaki storage reader is unavailable.');
      return;
    }
    if (!requireReady(ctx.res)) {
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
      sendRemoteError(ctx.res, 503, 'remote_runtime_unavailable', 'Kimaki runtime files are unavailable.');
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
    if (!sqliteReader) {
      sendRemoteError(ctx.res, 503, 'remote_storage_unavailable', 'Kimaki storage reader is unavailable.');
      return;
    }
    if (!requireReady(ctx.res)) {
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
      const requestedLimit = Number.isFinite(limit) && limit > 0 ? limit : 50;
      const openCodeSessions = sqliteReader.listOpenCodeSessions(projectDirectories, requestedLimit);
      const kimakiSessions = sqliteReader.listSessions(dbPath);
      const kimakiBySessionId = new Map(
        kimakiSessions.map((session) => [session.sessionId, session]),
      );
      const guildId = service.getGuildIds()[0] || null;
      const sessions = openCodeSessions.map((session) => {
        const mapping = kimakiBySessionId.get(session.sessionId);
        const threadId = mapping?.threadId || null;
        const rawName = mapping?.threadName || session.threadName || '';
        const threadName = /^New session\b/i.test(rawName)
          ? session.sessionId.slice(0, 8) || 'Unnamed'
          : rawName;
        return {
          sessionId: session.sessionId,
          threadId,
          threadName,
          source: threadId ? 'kimaki' : 'opencode',
          syncStatus: threadId ? 'connected' : 'pending',
          project: session.project,
          updatedAt: session.updatedAt,
          guildId: threadId ? guildId : null,
          discordUrl: threadId && guildId
            ? `https://discord.com/channels/${guildId}/${threadId}`
            : null,
        };
      });
      sendJson(ctx.res, 200, { sessions });
    } catch (err) {
      sendRemoteError(
        ctx.res,
        500,
        'remote_storage_error',
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  async function handleSend(ctx) {
    if (!requireReady(ctx.res)) {
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
      sendCliError(ctx.res, err);
    }
  }

  async function handleProjectAdd(ctx) {
    if (!requireReady(ctx.res)) {
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
      sendCliError(ctx.res, err);
    }
  }

  function handleLogs(ctx) {
    if (!logReader || !kimakiRuntimeService) {
      sendJson(ctx.res, 200, { lines: [] });
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

  async function handleSessionRename(ctx) {
    try {
      const body = await readBody(ctx.req);
      const { sessionId, title } = JSON.parse(body);

      if (!sessionId || !title) {
        sendJson(ctx.res, 400, { error: 'sessionId and title are required' });
        return;
      }

      const dbPath = process.env.OPENCODE_DB_PATH
        || path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db');

      const db = new Database(dbPath, { readonly: false });
      try {
        db.pragma('busy_timeout = 3000');
        const result = db.prepare('UPDATE session SET title = ? WHERE id = ?').run(title, sessionId);
        if (result.changes === 0) {
          sendJson(ctx.res, 404, { error: `No session found with id ${sessionId}` });
          return;
        }
        sendJson(ctx.res, 200, { ok: true, sessionId, title });
      } finally {
        db.close();
      }
    } catch (err) {
      sendJson(ctx.res, 500, { error: err instanceof Error ? err.message : String(err) });
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
    { method: 'POST', path: '/api/remote/sessions/rename', handler: handleSessionRename },
    { method: 'POST', path: '/api/remote/enable', handler: (ctx) => handleEnable(ctx) },
    { method: 'POST', path: '/api/remote/disable', handler: (ctx) => handleDisable(ctx) },
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
