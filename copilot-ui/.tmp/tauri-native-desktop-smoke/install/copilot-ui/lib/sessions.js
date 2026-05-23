const fs = require('fs');
const path = require('path');
const {
  resolveSessionReconciliationAuthority,
} = require('./runtimeContracts');

function safeStat(p) {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}

function parseTime(value) {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value);
    if (Number.isFinite(n) && value.trim() !== '') return n;
    const d = new Date(value);
    const ms = d.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

function eventType(ev) {
  if (!ev || typeof ev !== 'object') return null;
  return ev.type || ev.event || ev.name || ev.kind || null;
}

function eventTime(ev) {
  if (!ev || typeof ev !== 'object') return null;
  return (
    parseTime(ev.time) ??
    parseTime(ev.timestamp) ??
    parseTime(ev.ts) ??
    parseTime(ev.createdAt) ??
    parseTime(ev.at) ??
    parseTime(ev.date) ??
    parseTime(ev.meta && (ev.meta.time || ev.meta.timestamp || ev.meta.ts)) ??
    null
  );
}

function payloadOf(ev) {
  if (!ev || typeof ev !== 'object') return {};
  return ev.payload || ev.data || ev.session || ev.context || ev;
}

function tailJsonlLines(filePath, limit) {
  const stat = safeStat(filePath);
  if (!stat || !stat.isFile() || stat.size <= 0) return [];

  const fd = fs.openSync(filePath, 'r');
  try {
    const chunkSize = 64 * 1024;
    const chunks = [];
    let bytesReadTotal = 0;
    let pos = stat.size;

    // Read backwards until we have enough newlines for the requested limit (+ a buffer)
    const targetNewlines = Math.max(1, limit) + 5;
    let newlineCount = 0;

    while (pos > 0 && newlineCount < targetNewlines && bytesReadTotal < 8 * 1024 * 1024) {
      const readSize = Math.min(chunkSize, pos);
      pos -= readSize;
      const buf = Buffer.allocUnsafe(readSize);
      fs.readSync(fd, buf, 0, readSize, pos);
      chunks.unshift(buf);
      bytesReadTotal += readSize;

      for (let i = 0; i < buf.length; i++) {
        if (buf[i] === 10) newlineCount++; // '\n'
      }
    }

    const text = Buffer.concat(chunks).toString('utf8');
    const lines = text.split(/\r?\n/).filter(Boolean);
    return lines.slice(Math.max(0, lines.length - limit));
  } finally {
    try {
      fs.closeSync(fd);
    } catch {
      // ignore
    }
  }
}

function readRecentEvents(sessionDir, limit = 200) {
  const eventsPath = path.join(sessionDir, 'events.jsonl');
  const lines = tailJsonlLines(eventsPath, limit);
  const events = [];
  for (const line of lines) {
    try {
      events.push(JSON.parse(line));
    } catch {
      // ignore parse errors (best-effort)
    }
  }
  return events;
}

function asObject(value) {
  if (!value || typeof value !== 'object') return null;
  return value;
}

function parseMaybeJson(value) {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (!s) return null;
  if (!(s.startsWith('{') || s.startsWith('['))) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function normalizeAgentName(name) {
  if (typeof name !== 'string') return null;
  const v = name.trim();
  if (!v) return null;
  if (v.length > 128) return null;
  // Best-effort: avoid obviously invalid values/noise.
  if (!/^[A-Za-z0-9_.-]+$/.test(v)) return null;
  return v;
}

function getToolRequests(payload) {
  const p = asObject(payload) || {};
  const v =
    p.toolRequests ||
    p.tool_requests ||
    p.toolCalls ||
    p.tool_calls ||
    p.toolcalls ||
    p.tools ||
    null;
  return Array.isArray(v) ? v : [];
}

function extractAgentNameFromArgs(args) {
  if (typeof args === 'string') {
    const parsed = parseMaybeJson(args);
    if (parsed) return extractAgentNameFromArgs(parsed);
    return null;
  }
  const a = asObject(args);
  if (!a) return null;
  return (
    normalizeAgentName(a.agentName) ||
    normalizeAgentName(a.agent) ||
    normalizeAgentName(a.name) ||
    normalizeAgentName(a.agent_name) ||
    null
  );
}

function addUsage(usage, agentName, count = 1) {
  if (!agentName) return;
  usage[agentName] = (usage[agentName] || 0) + (Number.isFinite(count) ? count : 1);
}

function extractAgentUsage(events) {
  const usage = {};
  const list = Array.isArray(events) ? events : [];
  for (const ev of list) {
    const t = (eventType(ev) || '').toLowerCase();
    const p = payloadOf(ev);

    if (t === 'assistant.message') {
      for (const tr of getToolRequests(p)) {
        const toolNameRaw = tr && (tr.name || tr.toolName || tr.tool || tr.function || tr.type);
        const toolName = typeof toolNameRaw === 'string' ? toolNameRaw : '';
        const toolNameLower = toolName.toLowerCase();
        if (!(toolNameLower.includes('agent') || toolNameLower.includes('runsubagent'))) continue;

        const args = (tr && (tr.arguments || tr.args || tr.input || tr.parameters)) ?? null;
        const agentName = extractAgentNameFromArgs(args) || normalizeAgentName(tr && tr.agentName) || null;
        addUsage(usage, agentName);
      }
      continue;
    }

    if (t === 'tool.execution_start') {
      const toolNameRaw = p && (p.toolName || p.name || p.tool || p.function);
      const toolName = typeof toolNameRaw === 'string' ? toolNameRaw : '';
      if (!toolName.toLowerCase().includes('agent')) continue;

      const agentName =
        extractAgentNameFromArgs(p && (p.arguments || p.args || p.input || p.parameters)) ||
        normalizeAgentName(p && (p.agentName || p.agent || p.name)) ||
        null;
      addUsage(usage, agentName);
      continue;
    }

    // Weak signal: explicit @agent-name mentions in user messages.
    if (t === 'user.message') {
      const content = p && (p.content || p.text || p.message);
      if (typeof content !== 'string') continue;
      const re = /@([A-Za-z0-9_.-]{1,64})/g;
      let m;
      while ((m = re.exec(content))) {
        addUsage(usage, normalizeAgentName(m[1]));
      }
    }
  }
  return usage;
}

function getAgentUsage(sessionDir, limit = 500) {
  const events = readRecentEvents(sessionDir, limit);
  return extractAgentUsage(events);
}

function readStartEvent(sessionDir) {
  const eventsPath = path.join(sessionDir, 'events.jsonl');
  const stat = safeStat(eventsPath);
  if (!stat || !stat.isFile() || stat.size <= 0) return null;

  const fd = fs.openSync(eventsPath, 'r');
  try {
    const maxBytes = Math.min(stat.size, 5 * 1024 * 1024); // best-effort cap
    const chunkSize = 64 * 1024;
    let pos = 0;
    let carry = '';

    while (pos < maxBytes) {
      const readSize = Math.min(chunkSize, maxBytes - pos);
      const buf = Buffer.allocUnsafe(readSize);
      fs.readSync(fd, buf, 0, readSize, pos);
      pos += readSize;

      const text = carry + buf.toString('utf8');
      const parts = text.split(/\r?\n/);
      carry = parts.pop() || '';

      for (const line of parts) {
        if (!line) continue;
        let ev;
        try {
          ev = JSON.parse(line);
        } catch {
          continue;
        }

        if (eventType(ev) !== 'session.start') continue;

        const p = payloadOf(ev);
        return {
          repo: p.repo || p.repository || (p.git && (p.git.repo || p.git.repository)) || null,
          branch: p.branch || (p.git && p.git.branch) || null,
          cwd: p.cwd || p.workingDirectory || p.workdir || (p.git && p.git.cwd) || null,
          startTime:
            parseTime(p.startTime) ??
            parseTime(p.startedAt) ??
            parseTime(p.start) ??
            eventTime(ev) ??
            null,
        };
      }
    }

    return null;
  } finally {
    try {
      fs.closeSync(fd);
    } catch {
      // ignore
    }
  }
}

function getSessionStartContext(sessionDir) {
  return readStartEvent(sessionDir);
}

function listRepoStateTasks(copilotHome, repoId, options = {}) {
  const normalizedRepoId = typeof repoId === 'string' ? repoId.trim() : '';
  if (!normalizedRepoId) {
    return [];
  }

  const tasksDir = path.join(path.resolve(String(copilotHome || '.')), 'repo-state', normalizedRepoId, 'tasks');
  let dirEntries;
  try {
    dirEntries = fs.readdirSync(tasksDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const sessionId = typeof options.sessionId === 'string' ? options.sessionId.trim() : '';
  const workflowRunIds = new Set(
    (Array.isArray(options.workflowRunIds) ? options.workflowRunIds : [])
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter(Boolean)
  );
  const worktreeIds = new Set(
    (Array.isArray(options.worktreeIds) ? options.worktreeIds : [])
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter(Boolean)
  );
  const hasScopedFilters = Boolean(sessionId) || workflowRunIds.size > 0 || worktreeIds.size > 0;
  const maxEntries = Number.isFinite(Number(options.maxEntries)) ? Math.max(1, Number(options.maxEntries)) : 500;
  const tasks = [];

  for (const entry of dirEntries) {
    if (!entry || !entry.isFile() || !/\.json$/i.test(entry.name)) {
      continue;
    }
    const filePath = path.join(tasksDir, entry.name);
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        continue;
      }
      const normalized = {
        taskId: typeof parsed.taskId === 'string' ? parsed.taskId.trim() : '',
        repoId: normalizedRepoId,
        title: typeof parsed.title === 'string' ? parsed.title.trim() : null,
        status: typeof parsed.status === 'string' ? parsed.status.trim() : null,
        ownerSessionId: typeof parsed.ownerSessionId === 'string' ? parsed.ownerSessionId.trim() : null,
        activeActorId: typeof parsed.activeActorId === 'string' ? parsed.activeActorId.trim() : null,
        activeActorLabel: typeof parsed.activeActorLabel === 'string' ? parsed.activeActorLabel.trim() : null,
        workflow: parsed.workflow && typeof parsed.workflow === 'object' && !Array.isArray(parsed.workflow)
          ? JSON.parse(JSON.stringify(parsed.workflow))
          : {},
        worktree: parsed.worktree && typeof parsed.worktree === 'object' && !Array.isArray(parsed.worktree)
          ? JSON.parse(JSON.stringify(parsed.worktree))
          : {},
        linkedPlanning: parsed.linkedPlanning && typeof parsed.linkedPlanning === 'object' && !Array.isArray(parsed.linkedPlanning)
          ? JSON.parse(JSON.stringify(parsed.linkedPlanning))
          : {},
        createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt.trim() : null,
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt.trim() : null,
        durablePath: filePath,
      };
      if (!normalized.taskId) {
        continue;
      }
      if (hasScopedFilters) {
        const latestRunId = normalized.workflow && typeof normalized.workflow.latestRunId === 'string'
          ? normalized.workflow.latestRunId.trim()
          : '';
        const worktreeId = normalized.worktree && typeof normalized.worktree.worktreeId === 'string'
          ? normalized.worktree.worktreeId.trim()
          : '';
        const matchesSession = Boolean(sessionId) && normalized.ownerSessionId === sessionId;
        const matchesWorkflowRun = Boolean(latestRunId) && workflowRunIds.has(latestRunId);
        const matchesWorktree = Boolean(worktreeId) && worktreeIds.has(worktreeId);
        if (!matchesSession && !matchesWorkflowRun && !matchesWorktree) {
          continue;
        }
      }
      tasks.push(normalized);
      if (tasks.length >= maxEntries) {
        break;
      }
    } catch {
      // Ignore malformed task records; structured-state remains best-effort.
    }
  }

  return tasks;
}

function readRepoStateWorktree(copilotHome, repoId, worktreeId) {
  const normalizedRepoId = typeof repoId === 'string' ? repoId.trim() : '';
  const normalizedWorktreeId = typeof worktreeId === 'string' ? worktreeId.trim() : '';
  if (!normalizedRepoId || !normalizedWorktreeId) {
    return null;
  }

  const filePath = path.join(
    path.resolve(String(copilotHome || '.')),
    'repo-state',
    normalizedRepoId,
    'worktrees',
    `${normalizedWorktreeId}.json`
  );

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return {
      ...JSON.parse(JSON.stringify(parsed)),
      durablePath: filePath,
    };
  } catch {
    return null;
  }
}

function buildSessionActorSummaries(sessionDir, options = {}) {
  const runtimeActors = Array.isArray(options.runtimeActors) ? options.runtimeActors : [];
  const taskRecords = Array.isArray(options.taskRecords) ? options.taskRecords : [];
  const usage = getAgentUsage(sessionDir, options.limit || 500);
  const actors = new Map();

  function upsert(actor) {
    if (!actor || typeof actor !== 'object') {
      return;
    }
    const actorId = typeof actor.actorId === 'string' && actor.actorId.trim()
      ? actor.actorId.trim()
      : (typeof actor.label === 'string' ? actor.label.trim() : '');
    if (!actorId) {
      return;
    }
    const key = actorId.toLowerCase();
    const existing = actors.get(key) || {
      actorId,
      label: actor.label || actorId,
      role: actor.role || null,
      source: actor.source || null,
      invocationCount: 0,
      taskIds: [],
    };
    existing.label = existing.label || actor.label || actorId;
    existing.role = existing.role || actor.role || null;
    existing.source = existing.source || actor.source || null;
    if (Number.isFinite(Number(actor.invocationCount))) {
      existing.invocationCount = Math.max(existing.invocationCount, Number(actor.invocationCount));
    }
    const taskIds = Array.isArray(actor.taskIds)
      ? actor.taskIds
      : (actor.taskId ? [actor.taskId] : []);
    for (const taskId of taskIds) {
      if (typeof taskId === 'string' && taskId.trim() && !existing.taskIds.includes(taskId.trim())) {
        existing.taskIds.push(taskId.trim());
      }
    }
    actors.set(key, existing);
  }

  for (const [actorName, invocationCount] of Object.entries(usage)) {
    upsert({
      actorId: actorName,
      label: actorName,
      role: null,
      source: 'artifact-events',
      invocationCount,
    });
  }

  for (const actor of runtimeActors) {
    upsert(actor);
  }

  for (const task of taskRecords) {
    const actorId = typeof task.activeActorId === 'string' && task.activeActorId.trim()
      ? task.activeActorId.trim()
      : (typeof task.activeActorLabel === 'string' ? task.activeActorLabel.trim() : '');
    if (!actorId) {
      continue;
    }
    upsert({
      actorId,
      label: typeof task.activeActorLabel === 'string' && task.activeActorLabel.trim() ? task.activeActorLabel.trim() : actorId,
      role: null,
      source: 'repo-state-task',
      taskId: task.taskId,
    });
  }

  return Array.from(actors.values()).sort((left, right) => left.actorId.localeCompare(right.actorId));
}

function computeStatus(lastEventTime, opts = {}) {
  const activeWindowMinutes =
    typeof opts.activeWindowMinutes === 'number' && Number.isFinite(opts.activeWindowMinutes)
      ? opts.activeWindowMinutes
      : 30;
  const now = parseTime(opts.now) ?? Date.now();
  const last = parseTime(lastEventTime);
  if (!last) return 'missing';
  const ageMs = Math.max(0, now - last);
  return ageMs <= activeWindowMinutes * 60 * 1000 ? 'active' : 'idle';
}

function readSessionSummary(sessionDir, id, options = {}) {
  const sessionStat = safeStat(sessionDir);
  if (!sessionStat || !sessionStat.isDirectory()) {
    return null;
  }

  const fallbackStart = parseTime(sessionStat.birthtimeMs);
  const start = readStartEvent(sessionDir);
  const recent = readRecentEvents(sessionDir, options.recentLimit);

  let mode = null;
  let lastEventTime = null;
  for (let i = recent.length - 1; i >= 0; i--) {
    const ev = recent[i];
    lastEventTime = lastEventTime ?? eventTime(ev);
    if (mode == null && eventType(ev) === 'session.mode_changed') {
      const p = payloadOf(ev);
      mode = p.mode || p.newMode || p.to || p.value || null;
    }
    if (mode != null && lastEventTime != null) break;
  }

  if (!lastEventTime && sessionStat) lastEventTime = parseTime(sessionStat.mtimeMs);

  const startTime = start && start.startTime ? start.startTime : fallbackStart;
  const status = computeStatus(lastEventTime, {
    activeWindowMinutes: options.activeWindowMinutes,
    now: options.now,
  });
  const startSessionId =
    start && typeof start.sessionId === 'string' && start.sessionId.trim()
      ? start.sessionId.trim()
      : null;

  return {
    id: startSessionId || id,
    storageId: id,
    repo: (start && start.repo) || null,
    branch: (start && start.branch) || null,
    cwd: (start && start.cwd) || null,
    mode: mode || null,
    startTime: startTime || null,
    lastEventTime: lastEventTime || null,
    status,
  };
}

function listSessionsInDirectory(sessionRootDir, options = {}) {
  let dirents;
  try {
    dirents = fs.readdirSync(sessionRootDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const recentLimit =
    typeof options.recentLimit === 'number' && Number.isFinite(options.recentLimit)
      ? Math.max(1, options.recentLimit)
      : 200;

  const sessions = [];
  for (const d of dirents) {
    if (!d.isDirectory()) continue;
    const id = d.name;
    const sessionDir = path.join(sessionRootDir, id);
    const session = readSessionSummary(sessionDir, id, {
      ...options,
      recentLimit,
    });
    if (session) {
      sessions.push(session);
    }
  }

  sessions.sort((a, b) => (b.lastEventTime || b.startTime || 0) - (a.lastEventTime || a.startTime || 0));
  return sessions;
}

function listSessions(copilotHome, options = {}) {
  return listSessionsInDirectory(path.join(copilotHome, 'session-state'), options);
}

function listArchivedSessions(copilotHome, options = {}) {
  return listSessionsInDirectory(path.join(copilotHome, 'sessions-archive'), options)
    .map((session) => ({
      ...session,
      archiveId: session.storageId || session.id,
      status: 'archived',
      archived: true,
    }));
}

function watchSessions(copilotHome, onChange) {
  const sessionStateDir = path.join(copilotHome, 'session-state');
  let watcher = null;
  let timer = null;
  let closed = false;
  let restarting = false;

  function safeEmit() {
    if (closed) return;
    try {
      onChange(listSessions(copilotHome));
    } catch {
      // swallow callback errors (resilient watcher)
    }
  }

  function scheduleEmit() {
    if (closed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(safeEmit, 200);
  }

  function cleanupWatcher() {
    if (!watcher) return;
    try {
      watcher.close();
    } catch {
      // ignore
    }
    watcher = null;
  }

  function restartWatch() {
    if (closed || restarting) return;
    restarting = true;
    cleanupWatcher();
    setTimeout(() => {
      restarting = false;
      startWatch();
    }, 500);
  }

  function startWatch() {
    if (closed) return;
    cleanupWatcher();

    try {
      watcher = fs.watch(sessionStateDir, { recursive: true }, scheduleEmit);
    } catch {
      // session-state may not exist yet; best-effort watch copilot home for creation.
      try {
        watcher = fs.watch(copilotHome, { recursive: false }, scheduleEmit);
      } catch {
        watcher = null;
      }
    }

    if (watcher) {
      watcher.on('error', restartWatch);
    }

    scheduleEmit(); // initial scan (debounced)
  }

  startWatch();

  return {
    close: () => {
      closed = true;
      if (timer) clearTimeout(timer);
      cleanupWatcher();
    },
  };
}

function listSandboxSessions(sandboxesHome, options = {}) {
  const home = path.resolve(sandboxesHome);
  let dirents;
  try {
    dirents = fs.readdirSync(home, { withFileTypes: true });
  } catch {
    return [];
  }

  const allSessions = [];
  for (const d of dirents) {
    if (!d.isDirectory()) continue;
    const sandboxId = d.name;
    if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,63}$/.test(sandboxId)) continue;
    const sandboxSessionHome = path.join(home, sandboxId);
    const sessionStateDir = path.join(sandboxSessionHome, 'session-state');
    const stat = safeStat(sessionStateDir);
    if (!stat || !stat.isDirectory()) continue;

    const sessions = listSessions(sandboxSessionHome, options);
    for (const s of sessions) {
      allSessions.push({ ...s, source: 'sandbox', sandbox: sandboxId });
    }
  }

  allSessions.sort((a, b) => (b.lastEventTime || b.startTime || 0) - (a.lastEventTime || a.startTime || 0));
  return allSessions;
}

function listSandboxArchivedSessions(sandboxesHome, options = {}) {
  const home = path.resolve(sandboxesHome);
  let dirents;
  try {
    dirents = fs.readdirSync(home, { withFileTypes: true });
  } catch {
    return [];
  }

  const allSessions = [];
  for (const d of dirents) {
    if (!d.isDirectory()) continue;
    const sandboxId = d.name;
    if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,63}$/.test(sandboxId)) continue;
    const sandboxSessionHome = path.join(home, sandboxId);
    const archiveDir = path.join(sandboxSessionHome, 'sessions-archive');
    const stat = safeStat(archiveDir);
    if (!stat || !stat.isDirectory()) continue;

    const sessions = listArchivedSessions(sandboxSessionHome, options);
    for (const s of sessions) {
      allSessions.push({ ...s, source: 'sandbox', sandbox: sandboxId });
    }
  }

  allSessions.sort((a, b) => (b.lastEventTime || b.startTime || 0) - (a.lastEventTime || a.startTime || 0));
  return allSessions;
}

function watchSandboxSessions(sandboxesHome, onChange) {
  const home = path.resolve(sandboxesHome);
  let watcher = null;
  let timer = null;
  let closed = false;

  function safeEmit() {
    if (closed) return;
    try {
      onChange(listSandboxSessions(home));
    } catch {
      // swallow callback errors
    }
  }

  function scheduleEmit() {
    if (closed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(safeEmit, 200);
  }

  function startWatch() {
    if (closed) return;
    try {
      fs.mkdirSync(home, { recursive: true });
    } catch {
      // ignore
    }
    try {
      watcher = fs.watch(home, { recursive: true }, scheduleEmit);
      watcher.on('error', () => {
        if (closed) return;
        try { watcher.close(); } catch { /* ignore */ }
        watcher = null;
        setTimeout(startWatch, 500);
      });
    } catch {
      watcher = null;
    }
    scheduleEmit(); // initial scan
  }

  startWatch();

  return {
    close: () => {
      closed = true;
      if (timer) clearTimeout(timer);
      if (watcher) try { watcher.close(); } catch { /* ignore */ }
    },
  };
}

// --- Session aggregation / deduplication (WU-101 through WU-103) ---

const SOURCE_RANK = { vscode: 0, cli: 1, sandbox: 2 };

function normalizeSourceSet(values) {
  const normalized = [];
  const seen = new Set();
  for (const value of values) {
    const source = String(value || '').trim().toLowerCase();
    if (!source || seen.has(source)) continue;
    seen.add(source);
    normalized.push(source);
  }
  normalized.sort((a, b) => a.localeCompare(b));
  return normalized;
}

function resolveSessionSourceSet(session, options = {}) {
  const fromOptions = Array.isArray(options.sourceSet) ? options.sourceSet : null;
  const fromSession = Array.isArray(session && session.sources)
    ? session.sources
    : [session && session.canonicalSource, session && session.source];
  return normalizeSourceSet(fromOptions || fromSession || []);
}

function normalizeSessionResolvedStatus(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized || 'missing';
}

function buildSessionReconciliationReason(hasRuntimeState, hasArtifactState) {
  if (hasRuntimeState && hasArtifactState) return 'runtime_and_artifact';
  if (hasRuntimeState) return 'runtime_only';
  if (hasArtifactState) return 'artifact_only';
  return 'artifact_fallback';
}

function applySessionReconciliation(session, options = {}) {
  const hasRuntimeState = options.hasRuntimeState === true;
  const hasArtifactState = options.hasArtifactState !== false;
  const resolvedStatus = normalizeSessionResolvedStatus(
    options.resolvedStatus != null
      ? options.resolvedStatus
      : (session && session.resolvedStatus != null ? session.resolvedStatus : session && session.status)
  );
  const sourceSet = resolveSessionSourceSet(session, options);

  const authorityState = resolveSessionReconciliationAuthority({
    hasRuntimeState,
    hasArtifactState,
  });
  const reason = String(
    options.reason || buildSessionReconciliationReason(hasRuntimeState, hasArtifactState)
  ).trim().toLowerCase();

  const reconciliation = {
    contractVersion: authorityState.contractVersion,
    deterministic: true,
    authority: authorityState.authority,
    reason,
    resolvedStatus,
    sourceSet,
    sourceOfTruth: authorityState.sourceOfTruth,
    sourcePrecedence: authorityState.sourcePrecedence,
    hasRuntimeState: authorityState.hasRuntimeState,
    hasArtifactState: authorityState.hasArtifactState,
  };

  return {
    ...session,
    authority: authorityState.authority,
    reconciliation,
    reconciliationReason: reason,
    resolvedStatus,
    resolvedSourceSet: sourceSet,
  };
}

function buildSessionIdentity(session) {
  if (!session || typeof session.id !== 'string' || !session.id.trim()) {
    return { canonicalKey: null, dedupeEligible: false };
  }
  return { canonicalKey: session.id.trim().toLowerCase(), dedupeEligible: true };
}

function countNonNull(obj) {
  let n = 0;
  for (const k of Object.keys(obj)) {
    if (obj[k] != null) n++;
  }
  return n;
}

function mergeSessionGroup(sessionsWithSameKey) {
  if (!Array.isArray(sessionsWithSameKey) || sessionsWithSameKey.length === 0) return null;
  if (sessionsWithSameKey.length === 1) {
    const s = sessionsWithSameKey[0];
    const identity = buildSessionIdentity(s);
    return applySessionReconciliation({
      ...s,
      ...identity,
      sources: [s.source || 'cli'],
      canonicalSource: s.source || 'cli',
      mergedCount: 1,
    });
  }

  const sorted = sessionsWithSameKey.slice().sort((a, b) => {
    // 1. Most recent lastEventTime
    const ta = parseTime(a.lastEventTime) || 0;
    const tb = parseTime(b.lastEventTime) || 0;
    if (tb !== ta) return tb - ta;
    // 2. Completeness (more non-null fields wins)
    const ca = countNonNull(a);
    const cb = countNonNull(b);
    if (cb !== ca) return cb - ca;
    // 3. Source rank
    const ra = SOURCE_RANK[a.source] ?? 99;
    const rb = SOURCE_RANK[b.source] ?? 99;
    if (ra !== rb) return ra - rb;
    // 4. Stable lexical tie-break
    const sa = JSON.stringify(a);
    const sb = JSON.stringify(b);
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  });

  const winner = sorted[0];
  const identity = buildSessionIdentity(winner);
  const allSources = [];
  const seen = new Set();
  for (const s of sessionsWithSameKey) {
    const src = s.source || 'cli';
    if (!seen.has(src)) { seen.add(src); allSources.push(src); }
  }

  return applySessionReconciliation({
    ...winner,
    ...identity,
    sources: allSources,
    canonicalSource: winner.source || 'cli',
    mergedCount: sessionsWithSameKey.length,
  });
}

function dedupeAllSources(allSessions) {
  const groups = new Map();
  const nonEligible = [];

  for (const s of allSessions) {
    const identity = buildSessionIdentity(s);
    if (!identity.dedupeEligible) {
      nonEligible.push(applySessionReconciliation({
        ...s,
        ...identity,
        dedupeReason: 'no-id',
        sources: [s.source || 'cli'],
        canonicalSource: s.source || 'cli',
        provenance: s.source || 'cli',
        mergedCount: 1,
      }));
      continue;
    }
    const key = identity.canonicalKey;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }

  const result = [];
  for (const [, group] of groups) {
    const merged = mergeSessionGroup(group);
    if (!merged) continue;
    merged.dedupeEligible = true;
    merged.dedupeReason = group.length > 1 ? `merged-${group.length}-sources` : 'unique';
    merged.provenance = merged.source || 'cli';
    result.push(merged);
  }

  return [...result, ...nonEligible];
}

module.exports = {
  listSessions,
  readRecentEvents,
  getAgentUsage,
  extractAgentUsage,
  getSessionStartContext,
  listRepoStateTasks,
  readRepoStateWorktree,
  buildSessionActorSummaries,
  computeStatus,
  watchSessions,
  listSandboxSessions,
  listArchivedSessions,
  listSandboxArchivedSessions,
  watchSandboxSessions,
  buildSessionIdentity,
  mergeSessionGroup,
  dedupeAllSources,
  applySessionReconciliation,
};

