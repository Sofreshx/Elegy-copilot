'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { sendJson: defaultSendJson, readJsonBody: defaultReadJsonBody } = require('./_helpers');

function handleGatewayState(ctx, deps) {
  const { res, copilotHomeAbs } = ctx;
  const {
    sendJson,
    resolveMessagingGatewayConfigPath,
    readJsonFileSafe,
    buildPlanningPersistenceHealthEnvelope,
    getPlanningPersistenceHealth,
    resolvePlanningPersistenceAuthorityState,
    probeTrackerReadiness,
    buildGatewayStateEnvelope,
    buildGatewayProbeFailure,
    trackerUrl,
    trackerToken,
  } = deps;

  const configPath = resolveMessagingGatewayConfigPath(copilotHomeAbs);
  const gatewayConfig = readJsonFileSafe(configPath);
  const planningPersistence = buildPlanningPersistenceHealthEnvelope(
    getPlanningPersistenceHealth(ctx.planningPersistenceConfig, ctx.planningPersistenceState),
  );
  const planningAuthority = resolvePlanningPersistenceAuthorityState(ctx.planningPersistenceConfig, ctx.planningPersistenceState);

  probeTrackerReadiness(trackerUrl, trackerToken)
    .then((trackerProbe) => {
      const state = buildGatewayStateEnvelope({
        configPath,
        gatewayConfig,
        trackerProbe,
        trackerUrl,
        planningPersistence,
        planningAuthority,
      });
      sendJson(res, 200, state);
    })
    .catch((error) => {
      const state = buildGatewayStateEnvelope({
        configPath,
        gatewayConfig,
        trackerProbe: {
          deterministic: true,
          checkedAt: new Date().toISOString(),
          ready: false,
          status: 'probe_failed',
          statusCode: null,
          error: buildGatewayProbeFailure(
            'tracker_probe_failed',
            'tracker_probe_failed',
            String(error && error.message ? error.message : error),
          ),
        },
        trackerUrl,
        planningPersistence,
        planningAuthority,
      });
      sendJson(res, 200, state);
    });
}

function handleGatewayConnect(ctx, deps) {
  const { res, copilotHomeAbs } = ctx;
  const {
    sendJson,
    resolveMessagingGatewayConfigPath,
    readJsonFileSafe,
    buildPlanningPersistenceHealthEnvelope,
    getPlanningPersistenceHealth,
    resolvePlanningPersistenceAuthorityState,
    probeTrackerReadiness,
    buildGatewayStateEnvelope,
    buildGatewayProbeFailure,
    trackerUrl,
    trackerToken,
  } = deps;

  const configPath = resolveMessagingGatewayConfigPath(copilotHomeAbs);
  const gatewayConfig = readJsonFileSafe(configPath);
  const planningPersistence = buildPlanningPersistenceHealthEnvelope(
    getPlanningPersistenceHealth(ctx.planningPersistenceConfig, ctx.planningPersistenceState),
  );
  const planningAuthority = resolvePlanningPersistenceAuthorityState(ctx.planningPersistenceConfig, ctx.planningPersistenceState);

  probeTrackerReadiness(trackerUrl, trackerToken)
    .then((trackerProbe) => {
      const baseState = buildGatewayStateEnvelope({
        configPath,
        gatewayConfig,
        trackerProbe,
        trackerUrl,
        planningPersistence,
        planningAuthority,
      });
      const response = {
        ...baseState,
        kind: 'gateway.connect',
        action: 'connect',
        status: baseState.ready ? 'ready' : 'not_ready',
        ready: baseState.ready,
        connected: Boolean(trackerProbe && trackerProbe.ready === true),
        error: baseState.error || (trackerProbe && trackerProbe.error ? trackerProbe.error : null),
        errors: Array.isArray(baseState.errors) ? baseState.errors : [],
      };

      sendJson(res, response.ready ? 200 : 503, response);
    })
    .catch((error) => {
      const failure = buildGatewayProbeFailure(
        'tracker_probe_failed',
        'tracker_probe_failed',
        String(error && error.message ? error.message : error),
      );

      const baseState = buildGatewayStateEnvelope({
        configPath,
        gatewayConfig,
        trackerProbe: {
          deterministic: true,
          checkedAt: new Date().toISOString(),
          ready: false,
          status: 'probe_failed',
          statusCode: null,
          error: failure,
        },
        trackerUrl,
        planningPersistence,
        planningAuthority,
      });

      sendJson(res, 503, {
        ...baseState,
        kind: 'gateway.connect',
        action: 'connect',
        status: 'error',
        ready: false,
        connected: false,
        error: failure,
        errors: Array.isArray(baseState.errors) && baseState.errors.length
          ? baseState.errors
          : [failure],
      });
    });
}

function handleGatewayConfigGet(ctx, deps) {
  const { res, copilotHomeAbs } = ctx;
  const { sendJson, resolveMessagingGatewayConfigPath, readJsonFileSafe } = deps;
  const configPath = resolveMessagingGatewayConfigPath(copilotHomeAbs);
  const config = readJsonFileSafe(configPath);
  sendJson(res, 200, { exists: config !== null, configPath, config: config || null });
}

function handleGatewayConfigPost(ctx, deps) {
  const { req, res, copilotHomeAbs } = ctx;
  const { sendJson, readJsonBody, ensureDir, resolveMessagingGatewayConfigPath, fs, path } = deps;

  readJsonBody(req)
    .then((body) => {
      const discord = body && body.discord;
      const telegram = body && body.telegram;

      let normalizedDiscord;
      if (discord !== undefined && discord !== null) {
        if (!discord || typeof discord.guildId !== 'string' || typeof discord.channelId !== 'string' || !Array.isArray(discord.allowlistedUserIds)) {
          throw Object.assign(new Error('discord.guildId, discord.channelId, discord.allowlistedUserIds are required when discord is provided'), { statusCode: 400 });
        }

        const allowlistedUserIds = discord.allowlistedUserIds
          .map((id) => String(id).trim())
          .filter(Boolean);
        if (allowlistedUserIds.length === 0) {
          throw Object.assign(new Error('discord.allowlistedUserIds must contain at least one entry'), { statusCode: 400 });
        }

        normalizedDiscord = {
          allowlistedUserIds,
          guildId: String(discord.guildId).trim(),
          channelId: String(discord.channelId).trim(),
          ...(discord.permissionsChannelId ? { permissionsChannelId: String(discord.permissionsChannelId).trim() } : {}),
        };

        if (!normalizedDiscord.guildId || !normalizedDiscord.channelId) {
          throw Object.assign(new Error('discord.guildId and discord.channelId must be non-empty strings'), { statusCode: 400 });
        }
      }

      let normalizedTelegram;
      if (telegram !== undefined && telegram !== null) {
        if (!telegram || !Array.isArray(telegram.allowlistedUserIds)) {
          throw Object.assign(new Error('telegram.allowlistedUserIds is required when telegram is provided'), { statusCode: 400 });
        }

        const allowlistedUserIds = telegram.allowlistedUserIds
          .map((id) => String(id).trim())
          .filter(Boolean);
        if (allowlistedUserIds.length === 0) {
          throw Object.assign(new Error('telegram.allowlistedUserIds must contain at least one entry'), { statusCode: 400 });
        }

        normalizedTelegram = {
          allowlistedUserIds,
        };
      }

      if (!normalizedDiscord && !normalizedTelegram) {
        throw Object.assign(new Error('At least one platform must be configured (discord or telegram)'), { statusCode: 400 });
      }

      const ws = body && body.workspaces;
      if (!ws || !Array.isArray(ws.allowedRoots) || ws.allowedRoots.length === 0 || typeof ws.activeRoot !== 'string') {
        throw Object.assign(new Error('workspaces.allowedRoots (non-empty) and workspaces.activeRoot are required'), { statusCode: 400 });
      }
      const normalizedActive = path.resolve(ws.activeRoot);
      const normalizedRoots = ws.allowedRoots.map((r) => path.resolve(String(r)));
      const isWinPlatform = process.platform === 'win32';
      const inAllowed = normalizedRoots.some((r) =>
        isWinPlatform ? r.toLowerCase() === normalizedActive.toLowerCase() : r === normalizedActive
      );
      if (!inAllowed) {
        throw Object.assign(new Error('workspaces.activeRoot must be one of workspaces.allowedRoots'), { statusCode: 400 });
      }
      const normalized = {
        mode: body.mode || 'auto',
        acp: { host: (body.acp && body.acp.host) || '127.0.0.1', port: Number((body.acp && body.acp.port) || 3000) },
        ...(normalizedDiscord ? { discord: normalizedDiscord } : {}),
        ...(normalizedTelegram ? { telegram: normalizedTelegram } : {}),
        workspaces: { allowedRoots: normalizedRoots, activeRoot: normalizedActive },
      };
      const configPath = resolveMessagingGatewayConfigPath(copilotHomeAbs);
      const tmpPath = `${configPath}.tmp.${Date.now()}`;
      ensureDir(path.dirname(configPath));
      fs.writeFileSync(tmpPath, JSON.stringify(normalized, null, 2), 'utf8');
      fs.renameSync(tmpPath, configPath);
      sendJson(res, 200, { ok: true, configPath });
    })
    .catch((e) => sendJson(res, e.statusCode || 400, { error: String(e.message || e) }));
}

function handleGatewayScanRepos(ctx, deps) {
  const { res, u } = ctx;
  const { sendJson, fs, path, os } = deps;

  const extraParam = u.searchParams.get('extra');
  const home = os.homedir();
  const isWin = process.platform === 'win32';
  const candidateRoots = [
    isWin ? path.join(home, 'Documents', 'GitHub') : null,
    isWin ? path.join(home, 'source', 'repos') : null,
    path.join(home, 'GitHub'),
    path.join(home, 'projects'),
    path.join(home, 'dev'),
    path.join(home, 'workspace'),
    path.join(home, 'code'),
    path.join(home, 'repos'),
  ].filter(Boolean);
  if (extraParam && extraParam.trim()) {
    candidateRoots.push(path.resolve(extraParam.trim()));
  }
  function isDir(p) {
    try { return fs.statSync(p).isDirectory(); } catch { return false; }
  }
  function hasGit(p) {
    return isDir(path.join(p, '.git'));
  }
  function listSubdirs(p) {
    try { return fs.readdirSync(p).map((n) => path.join(p, n)).filter(isDir); } catch { return []; }
  }
  const roots = [];
  for (const scanRoot of candidateRoots) {
    if (!isDir(scanRoot)) continue;
    const repos = [];
    const level1 = listSubdirs(scanRoot);
    for (const l1 of level1) {
      if (hasGit(l1)) {
        repos.push({ absPath: l1, name: path.basename(l1), isGit: true });
      } else {
        const level2 = listSubdirs(l1);
        for (const l2 of level2) {
          if (hasGit(l2)) {
            repos.push({ absPath: l2, name: path.join(path.basename(l1), path.basename(l2)), isGit: true });
          }
        }
      }
    }
    if (repos.length > 0) roots.push({ scanRoot, repos });
  }
  sendJson(res, 200, { roots });
}

function register(deps = {}) {
  const resolvedDeps = {
    fs: deps.fs || fs,
    path: deps.path || path,
    os: deps.os || os,
    sendJson: deps.sendJson || defaultSendJson,
    readJsonBody: deps.readJsonBody || defaultReadJsonBody,
    ensureDir: deps.ensureDir,
    resolveMessagingGatewayConfigPath: deps.resolveMessagingGatewayConfigPath,
    readJsonFileSafe: deps.readJsonFileSafe,
    buildPlanningPersistenceHealthEnvelope: deps.buildPlanningPersistenceHealthEnvelope,
    getPlanningPersistenceHealth: deps.getPlanningPersistenceHealth,
    resolvePlanningPersistenceAuthorityState: deps.resolvePlanningPersistenceAuthorityState,
    probeTrackerReadiness: deps.probeTrackerReadiness,
    buildGatewayStateEnvelope: deps.buildGatewayStateEnvelope,
    buildGatewayProbeFailure: deps.buildGatewayProbeFailure,
    trackerUrl: deps.trackerUrl,
    trackerToken: deps.trackerToken,
  };

  return [
    {
      method: 'GET',
      path: '/api/gateway/state',
      handler: (ctx) => handleGatewayState(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: '/api/gateway/connect',
      handler: (ctx) => handleGatewayConnect(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: '/api/gateway/config',
      handler: (ctx) => handleGatewayConfigGet(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: '/api/gateway/config',
      handler: (ctx) => handleGatewayConfigPost(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: '/api/gateway/scan-repos',
      handler: (ctx) => handleGatewayScanRepos(ctx, resolvedDeps),
    },
  ];
}

module.exports = { register };