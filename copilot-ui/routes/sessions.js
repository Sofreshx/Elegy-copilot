'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const sessionsLib = require('../lib/sessions');
const assetsLib = require('../lib/assets');
const assetInvocationAuditLib = require('../lib/assetInvocationAudit');
const planStateLib = require('../lib/planState');
const repoInventoryLib = require('../lib/repoInventoryService');
const roadmapArtifactsLib = require('../lib/roadmapArtifacts');
const repositoryBacklogFileLib = require('../lib/repositoryBacklogFile');
const sessionPlanRoadmapSyncLib = require('../lib/sessionPlanRoadmapSync');
const {
  SESSION_RECONCILIATION_CONTRACT_VERSION,
  SESSION_RECONCILIATION_SOURCES,
  SESSION_STATE_AUTHORITIES,
} = require('../lib/runtimeContracts');
const sessionArtifactsLib = require('../lib/sessionArtifacts');
const { sendJson: defaultSendJson, sendText: defaultSendText, readJsonBody: defaultReadJsonBody } = require('./_helpers');

const SANDBOX_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,63}$/;

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

function normalizeComparableHome(pathLib, home) {
  const normalizedHome = normalizeString(home);
  if (!normalizedHome) {
    return '';
  }

  const resolvedHome = pathLib.resolve(normalizedHome);
  return process.platform === 'win32' ? resolvedHome.toLowerCase() : resolvedHome;
}

function areSameSessionRoots(pathLib, firstHome, secondHome) {
  const normalizedFirst = normalizeComparableHome(pathLib, firstHome);
  const normalizedSecond = normalizeComparableHome(pathLib, secondHome);
  return Boolean(normalizedFirst && normalizedSecond && normalizedFirst === normalizedSecond);
}

function resolveSessionRequestHome(ctx, deps, source) {
  const { u, copilotHome, vscodeHome, sandboxesHome } = ctx;
  const { resolveSessionsHome, path } = deps;
  const home = resolveSessionsHome(source, copilotHome, vscodeHome, sandboxesHome);
  if (home.source !== 'sandbox') {
    return home;
  }

  const sandboxId = normalizeString(u && u.searchParams ? u.searchParams.get('sandbox') : '');
  if (!sandboxId) {
    const error = new Error('Missing sandbox id');
    error.statusCode = 400;
    throw error;
  }
  if (!SANDBOX_ID_PATTERN.test(sandboxId)) {
    const error = new Error('sandboxId must use only alphanumeric and hyphen characters');
    error.statusCode = 400;
    throw error;
  }

  const sandboxHome = normalizeString(home.home);
  if (!sandboxHome) {
    const error = new Error('Sandbox root is unavailable on the server.');
    error.statusCode = 503;
    throw error;
  }

  return {
    ...home,
    sandbox: sandboxId,
    home: path.resolve(sandboxHome, sandboxId),
  };
}

function resolveSessionRequestDir(ctx, deps, id, source) {
  const home = resolveSessionRequestHome(ctx, deps, source);
  return {
    home,
    sessionDir: deps.path.join(deps.path.resolve(home.home), 'session-state', id),
  };
}

function isValidSessionId(id) {
  if (typeof id !== 'string' || id.length === 0 || id.length > 256) return false;
  if (id.includes('..') || id.includes('/') || id.includes('\\')) return false;
  return true;
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

const TERMINAL_EXECUTION_STATE_TOKENS = new Set([
  'aborted',
  'canceled',
  'cancelled',
  'closed',
  'complete',
  'completed',
  'done',
  'error',
  'failed',
  'finished',
  'stopped',
  'terminated',
]);

function isTerminalExecutionState(executionState) {
  if (!executionState || typeof executionState !== 'object') {
    return false;
  }

  const lifecycle = normalizeString(executionState.lifecycle).toLowerCase();
  const status = normalizeString(executionState.status).toLowerCase();
  return TERMINAL_EXECUTION_STATE_TOKENS.has(lifecycle) || TERMINAL_EXECUTION_STATE_TOKENS.has(status);
}

function hasCompatibilityFinalCloseoutEvidence(executionState) {
  return isTerminalExecutionState(executionState);
}

function normalizePlanContent(value) {
  if (typeof value !== 'string') {
    return '';
  }

  const normalized = value.replace(/\r\n/g, '\n');
  return normalized.endsWith('\n') ? normalized : `${normalized}\n`;
}

function buildGeneratedSessionId(cryptoLib) {
  if (cryptoLib && typeof cryptoLib.randomUUID === 'function') {
    return `planning-${cryptoLib.randomUUID()}`;
  }

  return `planning-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function appendJsonLine(fsLib, filePath, value) {
  fsLib.appendFileSync(filePath, `${JSON.stringify(value)}\n`, 'utf8');
}

function firstDefined(...values) {
  for (const value of values) {
    if (value != null) {
      return value;
    }
  }
  return undefined;
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

function resolveRepoContext(ctx, deps, selector) {
  const inventory = deps.repoInventory.listKnownRepos({
    copilotHome: ctx.copilotHomeAbs || ctx.copilotHome,
    engineRoot: ctx.engineRoot,
    explicitRepoPaths: selector.repoPath ? [selector.repoPath] : [],
  });
  const repo = deps.repoInventory.resolveRepoEntry(inventory, selector);
  if (!repo || !repo.repoPath) {
    throw Object.assign(new Error('Catalog repo selection is required for roadmap sync'), {
      statusCode: 409,
      code: 'catalog_repo_not_selected',
      reason: 'catalog_repo_not_selected',
    });
  }
  return repo;
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

function buildSessionsListResponse(data, options = {}) {
  const source = String(options.source || 'cli').trim().toLowerCase() || 'cli';
  const dedupe = String(options.dedupe || 'on').trim().toLowerCase() || 'on';

  let listingSurface = 'artifact_inventory';
  if (source === 'all' && dedupe === 'off') {
    listingSurface = 'artifact_inventory_multi_source';
  } else if (source === 'all') {
    listingSurface = 'artifact_inventory_deduped';
  } else if (source === 'sandbox') {
    listingSurface = 'artifact_inventory_sandbox';
  }

  return {
    sessions: Array.isArray(data) ? data : [],
    authorityModel: {
      contractVersion: SESSION_RECONCILIATION_CONTRACT_VERSION,
      liveAuthority: SESSION_STATE_AUTHORITIES.RUNTIME,
      artifactFallbackAuthority: SESSION_STATE_AUTHORITIES.ARTIFACT,
      runtimeSourceOfTruth: SESSION_RECONCILIATION_SOURCES.RUNTIME,
      artifactSourceOfTruth: SESSION_RECONCILIATION_SOURCES.ARTIFACT,
      listingSurface,
      artifactAccessRole: 'archive_offline',
    },
  };
}

function handleSessionsList(ctx, deps) {
  const { req, res, u, copilotHome, vscodeHome, sandboxesHome } = ctx;
  const { path, sendJson, parseNumberQuery, resolveSessionsHome, sessions } = deps;

  const activeWindowMinutes = parseNumberQuery(u.searchParams, 'activeWindowMinutes', 30);
  const source = (u.searchParams.get('source') || 'cli').toLowerCase();
  if (source === 'all') {
    const dedupe = (u.searchParams.get('dedupe') || 'on').toLowerCase();
    const sharedCliAndVscodeRoot = areSameSessionRoots(path, copilotHome, vscodeHome);
    const listedCliSessions = sessions.listSessions(copilotHome, { activeWindowMinutes, recentLimit: 250 });
    const listedVscodeSessions = sharedCliAndVscodeRoot
      ? listedCliSessions
      : sessions.listSessions(vscodeHome, { activeWindowMinutes, recentLimit: 250 });
    const cli = listedCliSessions.map((s) => ({ ...s, source: 'cli' }));
    const vs = listedVscodeSessions.map((s) => ({ ...s, source: 'vscode' }));
    const sandbox = sessions.listSandboxSessions(sandboxesHome, { activeWindowMinutes, recentLimit: 250 });
    const all = [...cli, ...vs, ...sandbox];
    const result = (dedupe === 'off')
      ? all.map((s) => sessions.applySessionReconciliation({
        ...s,
        ...sessions.buildSessionIdentity(s),
      }))
      : sessions.dedupeAllSources(all);
    sendJson(res, 200, buildSessionsListResponse(result, { source, dedupe }));
    return;
  }
  if (source === 'sandbox') {
    const data = sessions.listSandboxSessions(sandboxesHome, { activeWindowMinutes, recentLimit: 250 })
      .map((s) => sessions.applySessionReconciliation(s));
    sendJson(res, 200, buildSessionsListResponse(data, { source }));
    return;
  }
  const home = resolveSessionsHome(source, copilotHome, vscodeHome, sandboxesHome);
  const data = sessions.listSessions(home.home, { activeWindowMinutes, recentLimit: 250 })
    .map((s) => sessions.applySessionReconciliation({ ...s, source: home.source }));
  sendJson(res, 200, buildSessionsListResponse(data, { source: home.source }));
}

function handleSessionEvents(ctx, deps) {
  const { req, res, u, match, copilotHome, vscodeHome, sandboxesHome } = ctx;
  const { sendJson, parseNumberQuery, resolveSessionsHome, isValidSessionId, sessions, path } = deps;

  const id = decodeURIComponent(match[1]);
  if (!isValidSessionId(id)) { sendJson(res, 400, { error: 'Invalid session id' }); return; }
  const limit = Math.max(1, Math.min(500, Math.floor(parseNumberQuery(u.searchParams, 'limit', 20))));
  const source = (u.searchParams.get('source') || 'cli').toLowerCase();
  try {
    const { home, sessionDir } = resolveSessionRequestDir(ctx, deps, id, source);
    const events = sessions.readRecentEvents(sessionDir, limit);
    sendJson(res, 200, { id, source: home.source, events });
  } catch (e) {
    sendJson(res, e.statusCode || 400, { error: String(e.message || e), id, source });
  }
}

function handleSessionAgentUsage(ctx, deps) {
  const { req, res, u, match, copilotHome, vscodeHome, sandboxesHome } = ctx;
  const {
    sendJson,
    parseNumberQuery,
    resolveSessionsHome,
    isValidSessionId,
    sessions,
    assetInvocationAudit,
    path,
  } = deps;

  const id = decodeURIComponent(match[1]);
  if (!isValidSessionId(id)) { sendJson(res, 400, { error: 'Invalid session id' }); return; }
  const limit = Math.max(1, Math.min(500, Math.floor(parseNumberQuery(u.searchParams, 'limit', 500))));
  const source = (u.searchParams.get('source') || 'cli').toLowerCase();
  try {
    const { home, sessionDir } = resolveSessionRequestDir(ctx, deps, id, source);
    const usage = sessions.getAgentUsage(sessionDir, limit);
    const skillUsage = assetInvocationAudit.getSessionSkillUsageSummary({
      copilotHome: path.resolve(home.home),
      sessionId: id,
      limit: Math.max(limit * 4, 200),
    });
    sendJson(res, 200, { id, source: home.source, usage, skillUsage });
  } catch (e) {
    sendJson(res, e.statusCode || 400, { error: String(e.message || e), id, source });
  }
}

function handleSessionPlan(ctx, deps) {
  const { res, u, match, copilotHome, vscodeHome, sandboxesHome } = ctx;
  const { sendJson, sendText, resolveSessionsHome, isValidSessionId, assets, path } = deps;

  const id = decodeURIComponent(match[1]);
  if (!isValidSessionId(id)) { sendJson(res, 400, { error: 'Invalid session id' }); return; }
  const source = (u.searchParams.get('source') || 'cli').toLowerCase();
  try {
    const { sessionDir } = resolveSessionRequestDir(ctx, deps, id, source);
    const planPath = path.join(sessionDir, 'plan.md');
    const text = assets.readTextFileSafe(planPath, 512 * 1024);
    if (text == null) {
      sendText(res, 404, 'Not found');
      return;
    }
    sendText(res, 200, text, 'text/plain; charset=utf-8');
  } catch {
    sendText(res, 404, 'Not found');
  }
}

function handleSessionPlanMutation(ctx, deps) {
  const { req, res, u, copilotHome, vscodeHome, sandboxesHome } = ctx;
  const {
    sendJson,
    readJsonBody,
    isValidSessionId,
    ensureDir,
    fs,
    path,
    crypto,
  } = deps;

  readJsonBody(req)
    .then((body) => {
      const requestBody = body && typeof body === 'object' ? body : {};
      const requestSource = normalizeString(firstDefined(requestBody.source, u.searchParams.get('source'))).toLowerCase();
      const home = resolveSessionRequestHome(ctx, deps, requestSource || 'cli');
      const requestedSessionId = normalizeString(requestBody.sessionId);
      const sessionId = requestedSessionId || buildGeneratedSessionId(crypto);

      if (!isValidSessionId(sessionId)) {
        sendJson(res, 400, { error: 'Invalid session id' });
        return;
      }

      const content = normalizePlanContent(requestBody.content);
      if (!content.trim()) {
        sendJson(res, 400, { error: 'Plan content is required' });
        return;
      }

      const repoId = normalizeString(requestBody.repoId);
      const repoPath = normalizeString(requestBody.repoPath);
      const title = normalizeString(requestBody.title);
      const seedArtifact = requestBody.seedArtifact && typeof requestBody.seedArtifact === 'object'
        ? requestBody.seedArtifact
        : null;
      const seedArtifactId = normalizeString(seedArtifact && seedArtifact.id);
      const seedArtifactCategory = normalizeString(seedArtifact && seedArtifact.category);
      const seedArtifactTitle = normalizeString(seedArtifact && seedArtifact.title);

      const sessionDir = path.join(path.resolve(home.home), 'session-state', sessionId);
      const planPath = path.join(sessionDir, 'plan.md');
      const eventsPath = path.join(sessionDir, 'events.jsonl');
      const created = !fs.existsSync(sessionDir);
      const wroteStartEvent = created || !fs.existsSync(eventsPath);
      const timestamp = new Date().toISOString();

      ensureDir(sessionDir);

      if (wroteStartEvent) {
        appendJsonLine(fs, eventsPath, {
          type: 'session.start',
          time: timestamp,
          payload: {
            sessionId,
            source: 'instruction-engine-ui',
            mode: 'planning',
            startTime: timestamp,
            cwd: repoPath || null,
            repo: repoId || null,
          },
        });
      }

      fs.writeFileSync(planPath, content, 'utf8');
      appendJsonLine(fs, eventsPath, {
        type: 'session.plan_updated',
        time: timestamp,
        payload: {
          sessionId,
          title: title || null,
          updatedAt: timestamp,
          repoId: repoId || null,
          repoPath: repoPath || null,
          seededFromArtifactId: seedArtifactId || null,
          seededFromArtifactCategory: seedArtifactCategory || null,
          seededFromArtifactTitle: seedArtifactTitle || null,
        },
      });

      sendJson(res, 200, {
        sessionId,
        source: home.source,
        planPath,
        created,
        updatedAt: timestamp,
        content,
        linkedRepoId: repoId || undefined,
        linkedRepoPath: repoPath || undefined,
        seededFromArtifactId: seedArtifactId || null,
      });
    })
    .catch((error) => {
      sendJson(res, 400, { error: String(error.message || error) });
    });
}

function handleSessionPlans(ctx, deps) {
  const { res, u, match, copilotHome, vscodeHome, sandboxesHome } = ctx;
  const { sendJson, resolveSessionsHome, isValidSessionId, listPlanArtifacts, fs, path } = deps;

  const id = decodeURIComponent(match[1]);
  if (!isValidSessionId(id)) { sendJson(res, 400, { error: 'Invalid session id' }); return; }
  const source = (u.searchParams.get('source') || 'cli').toLowerCase();
  try {
    const { home, sessionDir } = resolveSessionRequestDir(ctx, deps, id, source);
    if (!fs.existsSync(sessionDir) || !fs.statSync(sessionDir).isDirectory()) {
      sendJson(res, 404, { error: 'Session not found', id, source: home.source });
      return;
    }
    const plans = listPlanArtifacts(sessionDir);
    sendJson(res, 200, { id, source: home.source, plans });
  } catch (e) {
    sendJson(res, e.statusCode || 400, { error: String(e.message || e), id, source });
  }
}

function handleSessionPlanById(ctx, deps) {
  const { res, u, match, copilotHome, vscodeHome, sandboxesHome } = ctx;
  const { sendJson, sendText, resolveSessionsHome, isValidSessionId, readPlanArtifact, path } = deps;

  const id = decodeURIComponent(match[1]);
  if (!isValidSessionId(id)) { sendJson(res, 400, { error: 'Invalid session id' }); return; }
  const planId = decodeURIComponent(match[2]);
  const source = (u.searchParams.get('source') || 'cli').toLowerCase();
  try {
    const { sessionDir } = resolveSessionRequestDir(ctx, deps, id, source);
    const text = readPlanArtifact(sessionDir, planId);
    if (text == null) {
      sendText(res, 404, 'Not found');
      return;
    }
    sendText(res, 200, text, 'text/plain; charset=utf-8');
  } catch {
    sendText(res, 404, 'Not found');
  }
}

function handleSessionFinal(ctx, deps) {
  const { res, u, match, copilotHome, vscodeHome, sandboxesHome } = ctx;
  const {
    sendJson,
    sendText,
    resolveSessionsHome,
    isValidSessionId,
    assets,
    fs,
    path,
    readPlanArtifact,
    planState,
  } = deps;

  const id = decodeURIComponent(match[1]);
  if (!isValidSessionId(id)) { sendJson(res, 400, { error: 'Invalid session id' }); return; }
  const source = (u.searchParams.get('source') || 'cli').toLowerCase();
  try {
    const { sessionDir } = resolveSessionRequestDir(ctx, deps, id, source);
    const finalPath = path.join(sessionDir, 'final.md');
    const text = assets.readTextFileSafe(finalPath, 2 * 1024 * 1024);
    if (text != null) {
      sendText(res, 200, text, 'text/plain; charset=utf-8');
      return;
    }

    if (!fs.existsSync(sessionDir) || !fs.statSync(sessionDir).isDirectory()) {
      sendText(res, 404, 'Not found');
      return;
    }

    if (typeof readPlanArtifact !== 'function' || !planState || typeof planState.parseStructuredState !== 'function') {
      sendText(res, 404, 'Not found');
      return;
    }

    const planText = readPlanArtifact(sessionDir, 'latest');
    if (!planText) {
      sendText(res, 404, 'Not found');
      return;
    }

    const handoffText = assets.readTextFileSafe(path.join(sessionDir, 'handoff.md'), 256 * 1024);
    const propositionText = assets.readTextFileSafe(path.join(sessionDir, 'proposition.md'), 512 * 1024);
    const verificationGuideText = assets.readTextFileSafe(path.join(sessionDir, 'verification-guide.md'), 512 * 1024);
    const executionStateText = assets.readTextFileSafe(path.join(sessionDir, 'execution-state.json'), 512 * 1024);
    const structured = planState.parseStructuredState(planText, {
      handoffText,
      propositionText,
      verificationGuideText,
      executionStateText,
      sessionId: id,
    });
    const compatibilityFinal = formatCompatibilityFinalCloseout(structured);
    if (!compatibilityFinal) {
      sendText(res, 404, 'Not found');
      return;
    }
    sendText(res, 200, compatibilityFinal, 'text/plain; charset=utf-8');
  } catch {
    sendText(res, 404, 'Not found');
  }
}

function formatCompatibilityFinalCloseout(structured) {
  const closureSummary = structured && structured.meta && structured.meta.closureSummary
    && typeof structured.meta.closureSummary === 'object'
    ? structured.meta.closureSummary
    : null;
  const executionState = structured && structured.meta && structured.meta.executionState
    && typeof structured.meta.executionState === 'object'
    ? structured.meta.executionState
    : null;
  const terminalExecutionState = isTerminalExecutionState(executionState);

  if (!hasCompatibilityFinalCloseoutEvidence(executionState)) {
    return null;
  }

  const summary = normalizeString(closureSummary && closureSummary.summary)
    || (terminalExecutionState ? normalizeString(executionState && executionState.summary) : '');
  if (!summary) {
    return null;
  }

  const lines = [
    '## Summary',
    `- ${summary}`,
  ];

  const statusItems = [
    closureSummary && closureSummary.outcome ? `Outcome: ${closureSummary.outcome}` : null,
    closureSummary && closureSummary.confidence ? `Confidence: ${closureSummary.confidence}` : null,
    closureSummary && closureSummary.reviewVerdict ? `Review verdict: ${closureSummary.reviewVerdict}` : null,
    executionState && executionState.status ? `Execution status: ${executionState.status}` : null,
  ].filter(Boolean);

  if (statusItems.length > 0) {
    lines.push('', '## Status', ...statusItems.map((item) => `- ${item}`));
  }

  const delivered = closureSummary && Array.isArray(closureSummary.delivered)
    ? closureSummary.delivered.filter((item) => normalizeString(item))
    : [];
  if (delivered.length > 0) {
    lines.push('', '## Delivered', ...delivered.map((item) => `- ${item}`));
  }

  const validationEvidence = closureSummary && Array.isArray(closureSummary.validationEvidence)
    ? closureSummary.validationEvidence.filter((item) => normalizeString(item))
    : [];
  if (validationEvidence.length > 0) {
    lines.push('', '## Validation Evidence', ...validationEvidence.map((item) => `- ${item}`));
  }

  const activeContinuation = closureSummary
    && closureSummary.followUps
    && Array.isArray(closureSummary.followUps.activeContinuation)
    ? closureSummary.followUps.activeContinuation.filter((item) => normalizeString(item))
    : [];
  if (activeContinuation.length > 0) {
    lines.push('', '## Immediate Next Actions', ...activeContinuation.map((item) => `- ${item}`));
  }

  return `${lines.join('\n')}\n`;
}

function handleSessionStructuredState(ctx, deps) {
  const { res, u, match, copilotHome, vscodeHome, sandboxesHome } = ctx;
  const { sendJson, resolveSessionsHome, isValidSessionId, readPlanArtifact, planState, assets, fs, path } = deps;

  const id = decodeURIComponent(match[1]);
  if (!isValidSessionId(id)) { sendJson(res, 400, { error: 'Invalid session id' }); return; }
  const source = (u.searchParams.get('source') || 'cli').toLowerCase();
  const planId = u.searchParams.get('planId') || 'latest';

  try {
    const { home, sessionDir } = resolveSessionRequestDir(ctx, deps, id, source);
    if (!fs.existsSync(sessionDir) || !fs.statSync(sessionDir).isDirectory()) {
      sendJson(res, 404, { error: 'Session not found', id, source: home.source });
      return;
    }

    const planText = readPlanArtifact(sessionDir, planId);
    if (!planText) {
      sendJson(res, 404, { error: 'Plan artifact not found', id, source: home.source, planId });
      return;
    }

    const useLatestSessionArtifacts = planId === 'latest';
    const handoffPath = path.join(sessionDir, 'handoff.md');
    const propositionPath = path.join(sessionDir, 'proposition.md');
    const verificationGuidePath = path.join(sessionDir, 'verification-guide.md');
    const executionStatePath = path.join(sessionDir, 'execution-state.json');
    const handoffText = useLatestSessionArtifacts
      ? assets.readTextFileSafe(handoffPath, 256 * 1024)
      : null;
    const propositionText = useLatestSessionArtifacts
      ? assets.readTextFileSafe(propositionPath, 512 * 1024)
      : null;
    const verificationGuideText = useLatestSessionArtifacts
      ? assets.readTextFileSafe(verificationGuidePath, 512 * 1024)
      : null;
    const executionStateText = useLatestSessionArtifacts
      ? assets.readTextFileSafe(executionStatePath, 512 * 1024)
      : null;
    const structured = planState.parseStructuredState(planText, {
      handoffText,
      propositionText,
      verificationGuideText,
      executionStateText,
      requireHandoff: useLatestSessionArtifacts,
      sessionId: id,
    });
    sendJson(res, 200, {
      id,
      source: home.source,
      planId,
      ...structured,
    });
  } catch (e) {
    sendJson(res, e.statusCode || 400, { error: String(e.message || e), id, source });
  }
}

function handleSessionProposition(ctx, deps) {
  const { res, u, match, copilotHome, vscodeHome, sandboxesHome } = ctx;
  const { sendJson, resolveSessionsHome, isValidSessionId, assets, sessionArtifacts, path } = deps;

  const id = decodeURIComponent(match[1]);
  if (!isValidSessionId(id)) { sendJson(res, 400, { error: 'Invalid session id' }); return; }
  const source = (u.searchParams.get('source') || 'cli').toLowerCase();
  try {
    const { home, sessionDir } = resolveSessionRequestDir(ctx, deps, id, source);
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
      ...sessionArtifacts.parsePropositionText(text),
    });
  } catch (e) {
    sendJson(res, e.statusCode || 400, { error: String(e.message || e), id, source });
  }
}

function handleSessionHandoff(ctx, deps) {
  const { res, u, match, copilotHome, vscodeHome, sandboxesHome } = ctx;
  const { sendJson, resolveSessionsHome, isValidSessionId, assets, sessionArtifacts, path } = deps;

  const id = decodeURIComponent(match[1]);
  if (!isValidSessionId(id)) { sendJson(res, 400, { error: 'Invalid session id' }); return; }
  const source = (u.searchParams.get('source') || 'cli').toLowerCase();
  try {
    const { home, sessionDir } = resolveSessionRequestDir(ctx, deps, id, source);
    const handoffPath = path.join(sessionDir, 'handoff.md');

    const text = assets.readTextFileSafe(handoffPath, 256 * 1024);
    if (text == null) {
      sendJson(res, 404, { error: 'Handoff not found', id, source: home.source });
      return;
    }

    sendJson(res, 200, {
      id,
      source: home.source,
      content: text,
      parsed: sessionArtifacts.parseHandoffText(text, { sessionId: id }),
    });
  } catch (e) {
    sendJson(res, e.statusCode || 400, { error: String(e.message || e), id, source });
  }
}

function handleSessionRoadmapSync(ctx, deps) {
  const { req, res, u, match, copilotHome, vscodeHome, sandboxesHome } = ctx;
  const {
    sendJson,
    readJsonBody,
    resolveSessionsHome,
    isValidSessionId,
    readPlanArtifact,
    path,
  } = deps;

  const id = decodeURIComponent(match[1]);
  if (!isValidSessionId(id)) { sendJson(res, 400, { error: 'Invalid session id' }); return; }

  readJsonBody(req)
    .then((body) => {
      const requestBody = body && typeof body === 'object' ? body : {};
      const selector = normalizeRepoSelector(u.searchParams, requestBody);
      const repo = resolveRepoContext(ctx, deps, selector);

      const source = (u.searchParams.get('source') || requestBody.source || 'cli').toLowerCase();
      const { home, sessionDir } = resolveSessionRequestDir(ctx, deps, id, source);
      const planId = normalizeString(requestBody.planId || u.searchParams.get('planId')) || 'latest';
      const planText = readPlanArtifact(sessionDir, planId);
      if (!planText) {
        throw Object.assign(new Error('Plan artifact not found'), {
          statusCode: 404,
          code: 'session_plan_not_found',
          reason: 'session_plan_not_found',
        });
      }

      const result = deps.sessionPlanRoadmapSync.syncSessionPlanToRoadmap(
        repo.repoPath,
        id,
        planText,
        {
          planState: deps.planState,
          repositoryBacklogFile: deps.repositoryBacklogFile,
          roadmapArtifacts: deps.roadmapArtifacts,
        },
      );

      sendJson(res, 200, {
        contractVersion: 'planning_api_v1',
        kind: 'sessions.roadmap-sync',
        deterministic: true,
        session: {
          id,
          source: home.source,
          planId,
        },
        repo: {
          repoId: repo.repoId || null,
          repoPath: repo.repoPath || null,
          repoLabel: repo.repoLabel || null,
        },
        ...result,
      });
    })
    .catch((e) => {
      sendJson(res, e.statusCode || 400, {
        contractVersion: 'planning_api_v1',
        kind: 'sessions.roadmap-sync',
        deterministic: true,
        error: String(e.message || e),
        code: normalizeString(e.code) || 'session_roadmap_sync_failed',
        reason: normalizeString(e.reason) || normalizeString(e.code) || 'session_roadmap_sync_failed',
      });
    });
}

function handleSessionVerificationGuide(ctx, deps) {
  const { res, u, match, copilotHome, vscodeHome, sandboxesHome } = ctx;
  const { sendJson, resolveSessionsHome, isValidSessionId, assets, path } = deps;

  const id = decodeURIComponent(match[1]);
  if (!isValidSessionId(id)) { sendJson(res, 400, { error: 'Invalid session id' }); return; }
  const source = (u.searchParams.get('source') || 'cli').toLowerCase();
  try {
    const { home, sessionDir } = resolveSessionRequestDir(ctx, deps, id, source);
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
  } catch (e) {
    sendJson(res, e.statusCode || 400, { error: String(e.message || e), id, source });
  }
}

function handleSessionArchive(ctx, deps) {
  const { res, u, match, copilotHome, vscodeHome, sandboxesHome } = ctx;
  const { sendJson, resolveSessionsHome, isValidSessionId, ensureDir, uniqueArchiveDir, fs, path } = deps;

  const id = decodeURIComponent(match[1]);
  if (!isValidSessionId(id)) { sendJson(res, 400, { error: 'Invalid session id' }); return; }
  const source = (u.searchParams.get('source') || 'cli').toLowerCase();
  try {
    const { home } = resolveSessionRequestDir(ctx, deps, id, source);
    const homeAbs = path.resolve(home.home);
    const sessionDir = path.join(homeAbs, 'session-state', id);
    const archiveRoot = path.join(homeAbs, 'sessions-archive');
    if (!fs.existsSync(sessionDir) || !fs.statSync(sessionDir).isDirectory()) {
      sendJson(res, 404, { error: 'Session not found', id, source: home.source });
      return;
    }
    ensureDir(archiveRoot);
    const dest = uniqueArchiveDir(archiveRoot, id);
    fs.renameSync(sessionDir, dest);
    sendJson(res, 200, { ok: true, id, source: home.source, archivedTo: dest });
  } catch (e) {
    sendJson(res, e.statusCode || 400, { error: String(e.message || e), id, source });
  }
}

function handleSessionDelete(ctx, deps) {
  const { req, res, u, match, copilotHome, vscodeHome, sandboxesHome } = ctx;
  const { sendJson, resolveSessionsHome, isValidSessionId, readJsonBody, fs, path } = deps;

  const id = decodeURIComponent(match[1]);
  if (!isValidSessionId(id)) { sendJson(res, 400, { error: 'Invalid session id' }); return; }
  const source = (u.searchParams.get('source') || 'cli').toLowerCase();

  readJsonBody(req)
    .then((body) => {
      const { home } = resolveSessionRequestDir(ctx, deps, id, source);
      const homeAbs = path.resolve(home.home);
      const sessionDir = path.join(homeAbs, 'session-state', id);
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
    .catch((e) => sendJson(res, e.statusCode || 400, { error: String(e.message || e), id, source }));
}

function register(deps = {}) {
  const resolvedDeps = {
    crypto: deps.crypto || crypto,
    fs: deps.fs || fs,
    path: deps.path || path,
    sessions: deps.sessions || sessionsLib,
    assets: deps.assets || assetsLib,
    assetInvocationAudit: deps.assetInvocationAudit || assetInvocationAuditLib,
    planState: deps.planState || planStateLib,
    repoInventory: deps.repoInventory || repoInventoryLib,
    roadmapArtifacts: deps.roadmapArtifacts || roadmapArtifactsLib,
    repositoryBacklogFile: deps.repositoryBacklogFile || repositoryBacklogFileLib,
    sessionPlanRoadmapSync: deps.sessionPlanRoadmapSync || sessionPlanRoadmapSyncLib,
    sessionArtifacts: deps.sessionArtifacts || sessionArtifactsLib,
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
      method: 'POST',
      path: '/api/sessions/plan',
      handler: (ctx) => handleSessionPlanMutation(ctx, resolvedDeps),
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
      path: /^\/api\/sessions\/([^/]+)\/handoff$/,
      handler: (ctx) => handleSessionHandoff(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: /^\/api\/sessions\/([^/]+)\/verification-guide$/,
      handler: (ctx) => handleSessionVerificationGuide(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: /^\/api\/sessions\/([^/]+)\/roadmap-sync$/,
      handler: (ctx) => handleSessionRoadmapSync(ctx, resolvedDeps),
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

module.exports = { register, buildSessionsListResponse };
