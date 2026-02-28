'use strict';

const fs = require('fs');
const path = require('path');

const sessionsLib = require('../lib/sessions');
const assetsLib = require('../lib/assets');
const planStateLib = require('../lib/planState');
const { sendJson: defaultSendJson, sendText: defaultSendText, readJsonBody: defaultReadJsonBody } = require('./_helpers');

function parseNumberQuery(searchParams, key, defaultValue) {
  const v = searchParams.get(key);
  if (v == null || v === '') return defaultValue;
  const n = Number(v);
  if (!Number.isFinite(n)) return defaultValue;
  return n;
}

function resolveSessionsHome(source, copilotHome, vscodeHome, sandboxesHome) {
  const s = String(source || '').trim().toLowerCase();
  if (s === 'vscode') return { source: 'vscode', home: vscodeHome };
  if (s === 'sandbox') return { source: 'sandbox', home: sandboxesHome };
  return { source: 'cli', home: copilotHome };
}

function isValidSessionId(id) {
  if (typeof id !== 'string' || id.length === 0 || id.length > 256) return false;
  if (id.includes('..') || id.includes('/') || id.includes('\\')) return false;
  return true;
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function uniqueArchiveDir(baseArchiveDir, id) {
  const safe = String(id || '').replace(/[^A-Za-z0-9_.-]/g, '_');
  const first = path.join(baseArchiveDir, safe);
  if (!fs.existsSync(first)) return first;
  for (let i = 2; i < 10000; i++) {
    const candidate = path.join(baseArchiveDir, `${safe}--archived-${i}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new Error('Unable to allocate archive folder');
}

function handleSessionsList(ctx, deps) {
  const { req, res, u, copilotHome, vscodeHome, sandboxesHome } = ctx;
  const { sendJson, parseNumberQuery, resolveSessionsHome, sessions } = deps;

  const activeWindowMinutes = parseNumberQuery(u.searchParams, 'activeWindowMinutes', 30);
  const source = (u.searchParams.get('source') || 'cli').toLowerCase();
  if (source === 'all') {
    const dedupe = (u.searchParams.get('dedupe') || 'on').toLowerCase();
    const cli = sessions.listSessions(copilotHome, { activeWindowMinutes, recentLimit: 250 }).map((s) => ({ ...s, source: 'cli' }));
    const vs = sessions.listSessions(vscodeHome, { activeWindowMinutes, recentLimit: 250 }).map((s) => ({ ...s, source: 'vscode' }));
    const sandbox = sessions.listSandboxSessions(sandboxesHome, { activeWindowMinutes, recentLimit: 250 });
    const all = [...cli, ...vs, ...sandbox];
    const result = (dedupe === 'off')
      ? all.map((s) => sessions.applySessionReconciliation({
        ...s,
        ...sessions.buildSessionIdentity(s),
      }))
      : sessions.dedupeAllSources(all);
    sendJson(res, 200, { sessions: result });
    return;
  }
  if (source === 'sandbox') {
    const data = sessions.listSandboxSessions(sandboxesHome, { activeWindowMinutes, recentLimit: 250 })
      .map((s) => sessions.applySessionReconciliation(s));
    sendJson(res, 200, { sessions: data });
    return;
  }
  const home = resolveSessionsHome(source, copilotHome, vscodeHome, sandboxesHome);
  const data = sessions.listSessions(home.home, { activeWindowMinutes, recentLimit: 250 })
    .map((s) => sessions.applySessionReconciliation({ ...s, source: home.source }));
  sendJson(res, 200, { sessions: data });
}

function handleSessionEvents(ctx, deps) {
  const { req, res, u, match, copilotHome, vscodeHome, sandboxesHome } = ctx;
  const { sendJson, parseNumberQuery, resolveSessionsHome, isValidSessionId, sessions, path } = deps;

  const id = decodeURIComponent(match[1]);
  if (!isValidSessionId(id)) { sendJson(res, 400, { error: 'Invalid session id' }); return; }
  const limit = Math.max(1, Math.min(500, Math.floor(parseNumberQuery(u.searchParams, 'limit', 20))));
  const source = (u.searchParams.get('source') || 'cli').toLowerCase();
  const home = resolveSessionsHome(source, copilotHome, vscodeHome, sandboxesHome);
  const sessionDir = path.join(path.resolve(home.home), 'session-state', id);
  const events = sessions.readRecentEvents(sessionDir, limit);
  sendJson(res, 200, { id, source: home.source, events });
}

function handleSessionAgentUsage(ctx, deps) {
  const { req, res, u, match, copilotHome, vscodeHome, sandboxesHome } = ctx;
  const { sendJson, parseNumberQuery, resolveSessionsHome, isValidSessionId, sessions, path } = deps;

  const id = decodeURIComponent(match[1]);
  if (!isValidSessionId(id)) { sendJson(res, 400, { error: 'Invalid session id' }); return; }
  const limit = Math.max(1, Math.min(500, Math.floor(parseNumberQuery(u.searchParams, 'limit', 500))));
  const source = (u.searchParams.get('source') || 'cli').toLowerCase();
  const home = resolveSessionsHome(source, copilotHome, vscodeHome, sandboxesHome);
  const sessionDir = path.join(path.resolve(home.home), 'session-state', id);
  const usage = sessions.getAgentUsage(sessionDir, limit);
  sendJson(res, 200, { id, source: home.source, usage });
}

function handleSessionPlan(ctx, deps) {
  const { res, u, match, copilotHome, vscodeHome, sandboxesHome } = ctx;
  const { sendJson, sendText, resolveSessionsHome, isValidSessionId, assets, path } = deps;

  const id = decodeURIComponent(match[1]);
  if (!isValidSessionId(id)) { sendJson(res, 400, { error: 'Invalid session id' }); return; }
  const source = (u.searchParams.get('source') || 'cli').toLowerCase();
  const home = resolveSessionsHome(source, copilotHome, vscodeHome, sandboxesHome);
  const planPath = path.join(path.resolve(home.home), 'session-state', id, 'plan.md');
  const text = assets.readTextFileSafe(planPath, 512 * 1024);
  if (text == null) {
    sendText(res, 404, 'Not found');
    return;
  }
  sendText(res, 200, text, 'text/plain; charset=utf-8');
}

function handleSessionPlans(ctx, deps) {
  const { res, u, match, copilotHome, vscodeHome, sandboxesHome } = ctx;
  const { sendJson, resolveSessionsHome, isValidSessionId, listPlanArtifacts, fs, path } = deps;

  const id = decodeURIComponent(match[1]);
  if (!isValidSessionId(id)) { sendJson(res, 400, { error: 'Invalid session id' }); return; }
  const source = (u.searchParams.get('source') || 'cli').toLowerCase();
  const home = resolveSessionsHome(source, copilotHome, vscodeHome, sandboxesHome);
  const sessionDir = path.join(path.resolve(home.home), 'session-state', id);
  try {
    if (!fs.existsSync(sessionDir) || !fs.statSync(sessionDir).isDirectory()) {
      sendJson(res, 404, { error: 'Session not found', id, source: home.source });
      return;
    }
    const plans = listPlanArtifacts(sessionDir);
    sendJson(res, 200, { id, source: home.source, plans });
  } catch (e) {
    sendJson(res, 400, { error: String(e.message || e), id, source: home.source });
  }
}

function handleSessionPlanById(ctx, deps) {
  const { res, u, match, copilotHome, vscodeHome, sandboxesHome } = ctx;
  const { sendJson, sendText, resolveSessionsHome, isValidSessionId, readPlanArtifact, path } = deps;

  const id = decodeURIComponent(match[1]);
  if (!isValidSessionId(id)) { sendJson(res, 400, { error: 'Invalid session id' }); return; }
  const planId = decodeURIComponent(match[2]);
  const source = (u.searchParams.get('source') || 'cli').toLowerCase();
  const home = resolveSessionsHome(source, copilotHome, vscodeHome, sandboxesHome);
  const sessionDir = path.join(path.resolve(home.home), 'session-state', id);
  const text = readPlanArtifact(sessionDir, planId);
  if (text == null) {
    sendText(res, 404, 'Not found');
    return;
  }
  sendText(res, 200, text, 'text/plain; charset=utf-8');
}

function handleSessionFinal(ctx, deps) {
  const { res, u, match, copilotHome, vscodeHome, sandboxesHome } = ctx;
  const { sendJson, sendText, resolveSessionsHome, isValidSessionId, assets, path } = deps;

  const id = decodeURIComponent(match[1]);
  if (!isValidSessionId(id)) { sendJson(res, 400, { error: 'Invalid session id' }); return; }
  const source = (u.searchParams.get('source') || 'cli').toLowerCase();
  const home = resolveSessionsHome(source, copilotHome, vscodeHome, sandboxesHome);
  const finalPath = path.join(path.resolve(home.home), 'session-state', id, 'final.md');
  const text = assets.readTextFileSafe(finalPath, 2 * 1024 * 1024);
  if (text == null) {
    sendText(res, 404, 'Not found');
    return;
  }
  sendText(res, 200, text, 'text/plain; charset=utf-8');
}

function handleSessionStructuredState(ctx, deps) {
  const { res, u, match, copilotHome, vscodeHome, sandboxesHome } = ctx;
  const { sendJson, resolveSessionsHome, isValidSessionId, readPlanArtifact, planState, fs, path } = deps;

  const id = decodeURIComponent(match[1]);
  if (!isValidSessionId(id)) { sendJson(res, 400, { error: 'Invalid session id' }); return; }
  const source = (u.searchParams.get('source') || 'cli').toLowerCase();
  const planId = u.searchParams.get('planId') || 'latest';
  const home = resolveSessionsHome(source, copilotHome, vscodeHome, sandboxesHome);
  const sessionDir = path.join(path.resolve(home.home), 'session-state', id);

  try {
    if (!fs.existsSync(sessionDir) || !fs.statSync(sessionDir).isDirectory()) {
      sendJson(res, 404, { error: 'Session not found', id, source: home.source });
      return;
    }

    const planText = readPlanArtifact(sessionDir, planId);
    if (!planText) {
      sendJson(res, 404, { error: 'Plan artifact not found', id, source: home.source, planId });
      return;
    }

    const structured = planState.parseStructuredState(planText);
    sendJson(res, 200, {
      id,
      source: home.source,
      planId,
      ...structured,
    });
  } catch (e) {
    sendJson(res, 400, { error: String(e.message || e), id, source: home.source });
  }
}

function handleSessionProposition(ctx, deps) {
  const { res, u, match, copilotHome, vscodeHome, sandboxesHome } = ctx;
  const { sendJson, resolveSessionsHome, isValidSessionId, assets, path } = deps;

  const id = decodeURIComponent(match[1]);
  if (!isValidSessionId(id)) { sendJson(res, 400, { error: 'Invalid session id' }); return; }
  const source = (u.searchParams.get('source') || 'cli').toLowerCase();
  const home = resolveSessionsHome(source, copilotHome, vscodeHome, sandboxesHome);
  const sessionDir = path.join(path.resolve(home.home), 'session-state', id);
  const propositionPath = path.join(sessionDir, 'proposition.md');

  const text = assets.readTextFileSafe(propositionPath, 512 * 1024);
  if (text == null) {
    sendJson(res, 404, { error: 'Proposition not found', id, source: home.source });
    return;
  }

  sendJson(res, 200, {
    id,
    source: home.source,
    content: text,
  });
}

function handleSessionVerificationGuide(ctx, deps) {
  const { res, u, match, copilotHome, vscodeHome, sandboxesHome } = ctx;
  const { sendJson, resolveSessionsHome, isValidSessionId, assets, path } = deps;

  const id = decodeURIComponent(match[1]);
  if (!isValidSessionId(id)) { sendJson(res, 400, { error: 'Invalid session id' }); return; }
  const source = (u.searchParams.get('source') || 'cli').toLowerCase();
  const home = resolveSessionsHome(source, copilotHome, vscodeHome, sandboxesHome);
  const sessionDir = path.join(path.resolve(home.home), 'session-state', id);
  const guidePath = path.join(sessionDir, 'verification-guide.md');

  const text = assets.readTextFileSafe(guidePath, 512 * 1024);
  if (text == null) {
    sendJson(res, 404, { error: 'Verification guide not found', id, source: home.source });
    return;
  }

  sendJson(res, 200, {
    id,
    source: home.source,
    content: text,
  });
}

function handleSessionArchive(ctx, deps) {
  const { res, u, match, copilotHome, vscodeHome, sandboxesHome } = ctx;
  const { sendJson, resolveSessionsHome, isValidSessionId, ensureDir, uniqueArchiveDir, fs, path } = deps;

  const id = decodeURIComponent(match[1]);
  if (!isValidSessionId(id)) { sendJson(res, 400, { error: 'Invalid session id' }); return; }
  const source = (u.searchParams.get('source') || 'cli').toLowerCase();
  const home = resolveSessionsHome(source, copilotHome, vscodeHome, sandboxesHome);
  const homeAbs = path.resolve(home.home);
  const sessionDir = path.join(homeAbs, 'session-state', id);
  const archiveRoot = path.join(homeAbs, 'sessions-archive');
  try {
    if (!fs.existsSync(sessionDir) || !fs.statSync(sessionDir).isDirectory()) {
      sendJson(res, 404, { error: 'Session not found', id, source: home.source });
      return;
    }
    ensureDir(archiveRoot);
    const dest = uniqueArchiveDir(archiveRoot, id);
    fs.renameSync(sessionDir, dest);
    sendJson(res, 200, { ok: true, id, source: home.source, archivedTo: dest });
  } catch (e) {
    sendJson(res, 400, { error: String(e.message || e), id, source: home.source });
  }
}

function handleSessionDelete(ctx, deps) {
  const { req, res, u, match, copilotHome, vscodeHome, sandboxesHome } = ctx;
  const { sendJson, resolveSessionsHome, isValidSessionId, readJsonBody, fs, path } = deps;

  const id = decodeURIComponent(match[1]);
  if (!isValidSessionId(id)) { sendJson(res, 400, { error: 'Invalid session id' }); return; }
  const source = (u.searchParams.get('source') || 'cli').toLowerCase();
  const home = resolveSessionsHome(source, copilotHome, vscodeHome, sandboxesHome);
  const homeAbs = path.resolve(home.home);
  const sessionDir = path.join(homeAbs, 'session-state', id);

  readJsonBody(req)
    .then((body) => {
      const force = Boolean(body && (body.force || body.confirm));
      if (!force) throw Object.assign(new Error('Deletion requires {"force": true}'), { statusCode: 400 });
      if (!fs.existsSync(sessionDir) || !fs.statSync(sessionDir).isDirectory()) {
        throw Object.assign(new Error('Session not found'), { statusCode: 404 });
      }

      // Guardrail: never allow deleting outside the configured session-state root.
      const expectedRoot = path.join(homeAbs, 'session-state');
      const resolved = path.resolve(sessionDir);
      const prefix = expectedRoot.endsWith(path.sep) ? expectedRoot : expectedRoot + path.sep;
      if (!resolved.startsWith(prefix)) {
        throw Object.assign(new Error('Refusing to delete path outside session-state'), { statusCode: 400 });
      }

      fs.rmSync(sessionDir, { recursive: true, force: true });
      sendJson(res, 200, { ok: true, id, source: home.source, deleted: true });
    })
    .catch((e) => sendJson(res, e.statusCode || 400, { error: String(e.message || e), id, source: home.source }));
}

function register(deps = {}) {
  const resolvedDeps = {
    fs: deps.fs || fs,
    path: deps.path || path,
    sessions: deps.sessions || sessionsLib,
    assets: deps.assets || assetsLib,
    planState: deps.planState || planStateLib,
    sendJson: deps.sendJson || defaultSendJson,
    sendText: deps.sendText || defaultSendText,
    readJsonBody: deps.readJsonBody || defaultReadJsonBody,
    parseNumberQuery: deps.parseNumberQuery || parseNumberQuery,
    resolveSessionsHome: deps.resolveSessionsHome || resolveSessionsHome,
    isValidSessionId: deps.isValidSessionId || isValidSessionId,
    ensureDir: deps.ensureDir || ensureDir,
    uniqueArchiveDir: deps.uniqueArchiveDir || uniqueArchiveDir,
    listPlanArtifacts: deps.listPlanArtifacts,
    readPlanArtifact: deps.readPlanArtifact,
  };

  return [
    {
      method: 'GET',
      path: '/api/sessions',
      handler: (ctx) => handleSessionsList(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: /^\/api\/sessions\/([^/]+)\/events$/,
      handler: (ctx) => handleSessionEvents(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: /^\/api\/sessions\/([^/]+)\/agent-usage$/,
      handler: (ctx) => handleSessionAgentUsage(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: /^\/api\/sessions\/([^/]+)\/plan$/,
      handler: (ctx) => handleSessionPlan(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: /^\/api\/sessions\/([^/]+)\/plans$/,
      handler: (ctx) => handleSessionPlans(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: /^\/api\/sessions\/([^/]+)\/plans\/([^/]+)$/,
      handler: (ctx) => handleSessionPlanById(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: /^\/api\/sessions\/([^/]+)\/final$/,
      handler: (ctx) => handleSessionFinal(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: /^\/api\/sessions\/([^/]+)\/structured-state$/,
      handler: (ctx) => handleSessionStructuredState(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: /^\/api\/sessions\/([^/]+)\/proposition$/,
      handler: (ctx) => handleSessionProposition(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: /^\/api\/sessions\/([^/]+)\/verification-guide$/,
      handler: (ctx) => handleSessionVerificationGuide(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: /^\/api\/sessions\/([^/]+)\/archive$/,
      handler: (ctx) => handleSessionArchive(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: /^\/api\/sessions\/([^/]+)\/delete$/,
      handler: (ctx) => handleSessionDelete(ctx, resolvedDeps),
    },
  ];
}

module.exports = { register };
