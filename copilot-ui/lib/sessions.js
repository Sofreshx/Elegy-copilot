const fs = require('fs');
const path = require('path');

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

function listSessions(copilotHome, options = {}) {
  const sessionStateDir = path.join(copilotHome, 'session-state');
  let dirents;
  try {
    dirents = fs.readdirSync(sessionStateDir, { withFileTypes: true });
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
    const sessionDir = path.join(sessionStateDir, id);
    const sessionStat = safeStat(sessionDir);
    const fallbackStart = sessionStat ? parseTime(sessionStat.birthtimeMs) : null;

    const start = readStartEvent(sessionDir);
    const recent = readRecentEvents(sessionDir, recentLimit);

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

    sessions.push({
      id,
      repo: (start && start.repo) || null,
      branch: (start && start.branch) || null,
      cwd: (start && start.cwd) || null,
      mode: mode || null,
      startTime: startTime || null,
      lastEventTime: lastEventTime || null,
      status,
    });
  }

  sessions.sort((a, b) => (b.lastEventTime || b.startTime || 0) - (a.lastEventTime || a.startTime || 0));
  return sessions;
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

module.exports = {
  listSessions,
  readRecentEvents,
  getAgentUsage,
  extractAgentUsage,
  computeStatus,
  watchSessions,
  listSandboxSessions,
  watchSandboxSessions,
};

