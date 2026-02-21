#!/usr/bin/env node
/* eslint-disable no-console */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const childProcess = require('child_process');

const sessions = require('./lib/sessions');
const assets = require('./lib/assets');

function createChangeTracker(copilotHomeAbs, vscodeHomeAbs) {
  let version = 0;
  let lastChangedMs = Date.now();
  let timer = null;
  const watchers = [];

  function bump() {
    version += 1;
    lastChangedMs = Date.now();
  }

  function scheduleBump() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(bump, 150);
  }

  function tryWatch(dirAbs, opts = {}) {
    try {
      if (!fs.existsSync(dirAbs) || !fs.statSync(dirAbs).isDirectory()) return;
      const recursive = Boolean(opts.recursive);
      const w = fs.watch(dirAbs, { persistent: false, recursive }, () => scheduleBump());
      watchers.push(w);
    } catch {
      // best-effort
    }
  }

  // Watch the primary folders users care about.
  // Also watch the Copilot home root so newly created folders (agents/skills) trigger updates.
  tryWatch(copilotHomeAbs);
  tryWatch(path.join(copilotHomeAbs, 'session-state'), { recursive: true });
  tryWatch(path.join(copilotHomeAbs, 'agents'));
  tryWatch(path.join(copilotHomeAbs, 'skills'));
  tryWatch(path.join(copilotHomeAbs, 'prompts'));

  // VS Code session store (separate root)
  if (vscodeHomeAbs) {
    tryWatch(vscodeHomeAbs);
    tryWatch(path.join(vscodeHomeAbs, 'session-state'), { recursive: true });
    tryWatch(path.join(vscodeHomeAbs, 'sessions-archive'), { recursive: true });
    // VS Code installed assets (non-recursive watch; best-effort)
    tryWatch(path.join(vscodeHomeAbs, 'agents'));
    tryWatch(path.join(vscodeHomeAbs, 'skills'));
    tryWatch(path.join(vscodeHomeAbs, 'prompts'));
  }

  // Periodic bump as a fallback: ensures UI stays roughly current even if fs.watch is flaky.
  const interval = setInterval(() => bump(), 60 * 1000);

  return {
    get() {
      return { version, lastChangedMs };
    },
    close() {
      if (timer) clearTimeout(timer);
      clearInterval(interval);
      for (const w of watchers) {
        try {
          w.close();
        } catch {
          // ignore
        }
      }
    },
  };
}

function parseArgs(argv) {
  const args = { port: 3210, copilotHome: null, vscodeHome: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      args.help = true;
      continue;
    }
    if (a === '--port') {
      const v = argv[++i];
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid --port: ${v}`);
      args.port = Math.floor(n);
      continue;
    }
    if (a.startsWith('--port=')) {
      const v = a.slice('--port='.length);
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid --port: ${v}`);
      args.port = Math.floor(n);
      continue;
    }
    if (a === '--copilot-home') {
      args.copilotHome = argv[++i];
      if (!args.copilotHome) throw new Error('Missing value for --copilot-home');
      continue;
    }
    if (a.startsWith('--copilot-home=')) {
      args.copilotHome = a.slice('--copilot-home='.length);
      if (!args.copilotHome) throw new Error('Missing value for --copilot-home');
      continue;
    }
    if (a === '--vscode-home') {
      args.vscodeHome = argv[++i];
      if (!args.vscodeHome) throw new Error('Missing value for --vscode-home');
      continue;
    }
    if (a.startsWith('--vscode-home=')) {
      args.vscodeHome = a.slice('--vscode-home='.length);
      if (!args.vscodeHome) throw new Error('Missing value for --vscode-home');
      continue;
    }
  }
  return args;
}

function resolveCopilotHome(args) {
  if (args && typeof args.copilotHome === 'string' && args.copilotHome.trim()) {
    return path.resolve(args.copilotHome);
  }
  if (process.env.XDG_CONFIG_HOME && process.env.XDG_CONFIG_HOME.trim()) {
    return path.resolve(process.env.XDG_CONFIG_HOME);
  }
  const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
  return path.join(path.resolve(home), '.copilot');
}

function defaultVscodeHome() {
  const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
  return path.join(path.resolve(home), '.copilot');
}

function resolveVscodeHome(args) {
  if (args && typeof args.vscodeHome === 'string' && args.vscodeHome.trim()) {
    return path.resolve(args.vscodeHome);
  }
  return defaultVscodeHome();
}

function resolveSessionsHome(source, copilotHome, vscodeHome) {
  const s = String(source || '').trim().toLowerCase();
  if (s === 'vscode') return { source: 'vscode', home: vscodeHome };
  return { source: 'cli', home: copilotHome };
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

function safeResolveUnder(baseAbs, relPath) {
  if (typeof relPath !== 'string' || relPath.length === 0) throw new Error('path must be a non-empty string');
  if (path.isAbsolute(relPath)) throw new Error('path must be relative');
  const base = path.resolve(baseAbs);
  const abs = path.resolve(base, relPath);
  const prefix = base.endsWith(path.sep) ? base : base + path.sep;
  if (!abs.startsWith(prefix)) throw new Error('path escapes base');
  return abs;
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendText(res, code, text, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
  res.end(text || '');
}

async function readJsonBody(req, maxBytes = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > maxBytes) {
        reject(Object.assign(new Error('Request body too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(Object.assign(new Error('Invalid JSON body'), { statusCode: 400, cause: e }));
      }
    });
    req.on('error', reject);
  });
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js') return 'application/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.txt' || ext === '.md') return 'text/plain; charset=utf-8';
  return 'application/octet-stream';
}

function serveStatic(publicDir, urlPath, res) {
  let rel = urlPath || '/';
  if (rel === '/') rel = '/index.html';
  rel = rel.split('\\').join('/');
  const cleaned = rel.replace(/^\/+/, '');
  const abs = safeResolveUnder(publicDir, cleaned);

  let stat;
  try {
    stat = fs.statSync(abs);
  } catch {
    sendText(res, 404, 'Not found');
    return;
  }
  if (!stat.isFile()) {
    sendText(res, 404, 'Not found');
    return;
  }

  res.writeHead(200, {
    'Content-Type': contentTypeFor(abs),
    'Cache-Control': 'no-store',
  });
  fs.createReadStream(abs).pipe(res);
}

function parseNumberQuery(searchParams, key, defaultValue) {
  const v = searchParams.get(key);
  if (v == null || v === '') return defaultValue;
  const n = Number(v);
  if (!Number.isFinite(n)) return defaultValue;
  return n;
}

function runVscodeSettingsPatcher({ engineRoot, vscodeHome, settingsPath, dryRun }) {
  const patcher = path.join(path.resolve(engineRoot), 'scripts', 'vscode-settings-patch.mjs');
  if (!fs.existsSync(patcher)) {
    throw new Error(`Missing settings patcher script: ${patcher}`);
  }

  const args = [patcher, '--vscode-home', String(vscodeHome || '')];
  if (dryRun) args.push('--dry-run');
  if (settingsPath) args.push('--settings', String(settingsPath));

  const result = childProcess.spawnSync(process.execPath, args, {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024,
  });

  return {
    ok: result.status === 0,
    exitCode: result.status,
    signal: result.signal || null,
    patcher,
    args: args.slice(1),
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function readJsonFileSafe(filePath) {
  try {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function looksLikePlanText(text) {
  const t = String(text || '');
  return (
    t.includes('# Plan Pack') ||
    t.includes('Plan Pack —') ||
    t.includes('# Plan-Pack Progress Tracker') ||
    t.includes('## Work Unit Specs')
  );
}

function extractPlanFromText(text) {
  const t = String(text || '');
  if (!looksLikePlanText(t)) return null;
  // Store/display the full blob; avoid brittle slicing/parsing.
  return t;
}

function readTextFileIfExists(absPath, maxBytes) {
  return assets.readTextFileSafe(absPath, maxBytes);
}

function listPlanArtifacts(sessionDirAbs) {
  const sessionDir = path.resolve(sessionDirAbs);
  const results = [];

  const planPath = path.join(sessionDir, 'plan.md');
  const finalPath = path.join(sessionDir, 'final.md');
  const plansDir = path.join(sessionDir, 'plans');
  const indexPath = path.join(plansDir, 'index.json');
  const metaPath = path.join(sessionDir, 'meta.json');

  const meta = readJsonFileSafe(metaPath);
  const sessionStatus = meta && typeof meta.status === 'string' ? meta.status : null;

  if (fs.existsSync(planPath) && fs.statSync(planPath).isFile()) {
    const st = fs.statSync(planPath);
    results.push({
      id: 'latest',
      kind: 'latest',
      status: null,
      source: 'plan.md',
      bytes: st.size,
      updatedMs: st.mtimeMs,
      sessionStatus,
    });
  }

  // Prefer an explicit plans index if present.
  const index = readJsonFileSafe(indexPath);
  if (index && typeof index === 'object' && !Array.isArray(index) && Array.isArray(index.plans)) {
    for (const p of index.plans) {
      if (!p || typeof p !== 'object') continue;
      const id = p.id;
      const file = p.file;
      if (typeof id !== 'string' || !id) continue;
      if (typeof file !== 'string' || !file) continue;
      const abs = path.join(plansDir, file);
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
      const st = fs.statSync(abs);
      results.push({
        id,
        kind: 'revision',
        status: typeof p.status === 'string' ? p.status : null,
        verdict: typeof p.verdict === 'string' ? p.verdict : null,
        source: `plans/${file}`,
        bytes: st.size,
        updatedMs: st.mtimeMs,
        sessionStatus,
      });
    }
    return results;
  }

  // Fallback: list plans/*.md if present.
  try {
    if (fs.existsSync(plansDir) && fs.statSync(plansDir).isDirectory()) {
      const entries = fs.readdirSync(plansDir, { withFileTypes: true });
      for (const e of entries) {
        if (!e.isFile() || !e.name.toLowerCase().endsWith('.md')) continue;
        const abs = path.join(plansDir, e.name);
        const st = fs.statSync(abs);
        results.push({
          id: e.name.replace(/\.md$/i, ''),
          kind: 'revision',
          status: null,
          source: `plans/${e.name}`,
          bytes: st.size,
          updatedMs: st.mtimeMs,
          sessionStatus,
        });
      }
    }
  } catch {
    // ignore
  }

  // If no plan.md exists, offer a derived plan from final.md (display-only).
  if (!results.some((r) => r.id === 'latest')) {
    const finalText = readTextFileIfExists(finalPath, 2 * 1024 * 1024);
    const derived = finalText ? extractPlanFromText(finalText) : null;
    if (derived) {
      results.push({
        id: 'derived-from-final',
        kind: 'derived',
        status: sessionStatus && sessionStatus !== 'completed' ? 'dropped' : null,
        source: 'final.md',
        bytes: Buffer.byteLength(derived, 'utf8'),
        updatedMs: fs.existsSync(finalPath) ? fs.statSync(finalPath).mtimeMs : null,
        sessionStatus,
      });
    }
  }

  return results;
}

function readPlanArtifact(sessionDirAbs, planId) {
  const sessionDir = path.resolve(sessionDirAbs);
  const id = String(planId || '').trim();
  if (!id) return null;

  const planPath = path.join(sessionDir, 'plan.md');
  const finalPath = path.join(sessionDir, 'final.md');
  const plansDir = path.join(sessionDir, 'plans');

  if (id === 'latest') {
    return readTextFileIfExists(planPath, 2 * 1024 * 1024);
  }

  if (id === 'derived-from-final') {
    const finalText = readTextFileIfExists(finalPath, 2 * 1024 * 1024);
    return finalText ? extractPlanFromText(finalText) : null;
  }

  // revision id: map to plans/<id>.md
  const abs = path.join(plansDir, `${id}.md`);
  return readTextFileIfExists(abs, 2 * 1024 * 1024);
}

function backupFile(filePath) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = path.join(dir, `${base}.bak.${stamp}`);
  fs.copyFileSync(filePath, backup);
  return backup;
}

function ensureApproval(toolApprovals, kind) {
  if (!Array.isArray(toolApprovals)) return false;
  const k = String(kind || '').trim();
  if (!k) return false;
  if (toolApprovals.some((x) => x && typeof x === 'object' && String(x.kind || '').trim() === k)) {
    return false;
  }
  toolApprovals.push({ kind: k });
  return true;
}

function patchCopilotPermissionsConfig({ copilotHomeAbs, vscodeHomeAbs, dryRun }) {
  const copilotHome = path.resolve(copilotHomeAbs);
  const vscodeHome = path.resolve(vscodeHomeAbs);
  const filePath = path.join(copilotHome, 'permissions-config.json');

  const existing = readJsonFileSafe(filePath);
  const root = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {};
  if (!root.locations || typeof root.locations !== 'object' || Array.isArray(root.locations)) {
    root.locations = {};
  }

  const desired = [copilotHome, vscodeHome].filter(Boolean);
  let changed = false;

  for (const loc of desired) {
    if (!root.locations[loc] || typeof root.locations[loc] !== 'object' || Array.isArray(root.locations[loc])) {
      root.locations[loc] = {};
      changed = true;
    }
    const slot = root.locations[loc];
    if (!Array.isArray(slot.tool_approvals)) {
      slot.tool_approvals = [];
      changed = true;
    }

    changed = ensureApproval(slot.tool_approvals, 'write') || changed;
    changed = ensureApproval(slot.tool_approvals, 'memory') || changed;
  }

  if (!changed) {
    return { ok: true, action: 'noop', filePath, locations: desired };
  }

  if (dryRun) {
    return { ok: true, action: 'would_patch', filePath, locations: desired };
  }

  let backup = null;
  if (fs.existsSync(filePath)) {
    backup = backupFile(filePath);
  } else {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(root, null, 2) + '\n', 'utf8');

  return { ok: true, action: 'patched', filePath, backup, locations: desired };
}

function handleApi({ req, res, u, copilotHome, vscodeHome, engineRoot, changeTracker }) {
  const pathname = u.pathname;
  const copilotHomeAbs = path.resolve(copilotHome);
  const vscodeHomeAbs = copilotHomeAbs;
  const assetsHomeAbs = copilotHomeAbs;

  if (req.method === 'GET' && pathname === '/api/health') {
    const changes = changeTracker ? changeTracker.get() : null;
    sendJson(res, 200, { ok: true, now: Date.now(), engineRoot, copilotHome, vscodeHome, changes });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/version') {
    const changes = changeTracker ? changeTracker.get() : { version: 0, lastChangedMs: null };
    sendJson(res, 200, changes);
    return;
  }

  if (req.method === 'GET' && pathname === '/api/sessions') {
    const activeWindowMinutes = parseNumberQuery(u.searchParams, 'activeWindowMinutes', 30);
    const source = (u.searchParams.get('source') || 'cli').toLowerCase();
    if (source === 'all') {
      const cli = sessions.listSessions(copilotHome, { activeWindowMinutes, recentLimit: 250 }).map((s) => ({ ...s, source: 'cli' }));
      const vs = sessions.listSessions(vscodeHome, { activeWindowMinutes, recentLimit: 250 }).map((s) => ({ ...s, source: 'vscode' }));
      sendJson(res, 200, { sessions: [...cli, ...vs] });
      return;
    }
    const home = resolveSessionsHome(source, copilotHome, vscodeHome);
    const data = sessions.listSessions(home.home, { activeWindowMinutes, recentLimit: 250 }).map((s) => ({ ...s, source: home.source }));
    sendJson(res, 200, { sessions: data });
    return;
  }

  {
    const m = pathname.match(/^\/api\/sessions\/([^/]+)\/events$/);
    if (req.method === 'GET' && m) {
      const id = decodeURIComponent(m[1]);
      const limit = Math.max(1, Math.min(500, Math.floor(parseNumberQuery(u.searchParams, 'limit', 20))));
      const source = (u.searchParams.get('source') || 'cli').toLowerCase();
      const home = resolveSessionsHome(source, copilotHome, vscodeHome);
      const sessionDir = path.join(path.resolve(home.home), 'session-state', id);
      const events = sessions.readRecentEvents(sessionDir, limit);
      sendJson(res, 200, { id, source: home.source, events });
      return;
    }
  }

  {
    const m = pathname.match(/^\/api\/sessions\/([^/]+)\/agent-usage$/);
    if (req.method === 'GET' && m) {
      const id = decodeURIComponent(m[1]);
      const limit = Math.max(1, Math.min(500, Math.floor(parseNumberQuery(u.searchParams, 'limit', 500))));
      const source = (u.searchParams.get('source') || 'cli').toLowerCase();
      const home = resolveSessionsHome(source, copilotHome, vscodeHome);
      const sessionDir = path.join(path.resolve(home.home), 'session-state', id);
      const usage = sessions.getAgentUsage(sessionDir, limit);
      sendJson(res, 200, { id, source: home.source, usage });
      return;
    }
  }

  {
    const m = pathname.match(/^\/api\/sessions\/([^/]+)\/plan$/);
    if (req.method === 'GET' && m) {
      const id = decodeURIComponent(m[1]);
      const source = (u.searchParams.get('source') || 'cli').toLowerCase();
      const home = resolveSessionsHome(source, copilotHome, vscodeHome);
      const planPath = path.join(path.resolve(home.home), 'session-state', id, 'plan.md');
      const text = assets.readTextFileSafe(planPath, 512 * 1024);
      if (text == null) {
        sendText(res, 404, 'Not found');
        return;
      }
      sendText(res, 200, text, 'text/plain; charset=utf-8');
      return;
    }
  }

  {
    const m = pathname.match(/^\/api\/sessions\/([^/]+)\/plans$/);
    if (req.method === 'GET' && m) {
      const id = decodeURIComponent(m[1]);
      const source = (u.searchParams.get('source') || 'cli').toLowerCase();
      const home = resolveSessionsHome(source, copilotHome, vscodeHome);
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
      return;
    }
  }

  {
    const m = pathname.match(/^\/api\/sessions\/([^/]+)\/plans\/([^/]+)$/);
    if (req.method === 'GET' && m) {
      const id = decodeURIComponent(m[1]);
      const planId = decodeURIComponent(m[2]);
      const source = (u.searchParams.get('source') || 'cli').toLowerCase();
      const home = resolveSessionsHome(source, copilotHome, vscodeHome);
      const sessionDir = path.join(path.resolve(home.home), 'session-state', id);
      const text = readPlanArtifact(sessionDir, planId);
      if (text == null) {
        sendText(res, 404, 'Not found');
        return;
      }
      sendText(res, 200, text, 'text/plain; charset=utf-8');
      return;
    }
  }

  {
    const m = pathname.match(/^\/api\/sessions\/([^/]+)\/final$/);
    if (req.method === 'GET' && m) {
      const id = decodeURIComponent(m[1]);
      const source = (u.searchParams.get('source') || 'cli').toLowerCase();
      const home = resolveSessionsHome(source, copilotHome, vscodeHome);
      const finalPath = path.join(path.resolve(home.home), 'session-state', id, 'final.md');
      const text = assets.readTextFileSafe(finalPath, 2 * 1024 * 1024);
      if (text == null) {
        sendText(res, 404, 'Not found');
        return;
      }
      sendText(res, 200, text, 'text/plain; charset=utf-8');
      return;
    }
  }

  {
    const m = pathname.match(/^\/api\/sessions\/([^/]+)\/archive$/);
    if (req.method === 'POST' && m) {
      const id = decodeURIComponent(m[1]);
      const source = (u.searchParams.get('source') || 'cli').toLowerCase();
      const home = resolveSessionsHome(source, copilotHome, vscodeHome);
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
      return;
    }
  }

  {
    const m = pathname.match(/^\/api\/sessions\/([^/]+)\/delete$/);
    if (req.method === 'POST' && m) {
      const id = decodeURIComponent(m[1]);
      const source = (u.searchParams.get('source') || 'cli').toLowerCase();
      const home = resolveSessionsHome(source, copilotHome, vscodeHome);
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
      return;
    }
  }

  if (req.method === 'GET' && pathname === '/api/assets/managed') {
    const managed = assets.getManagedAssetStatuses(engineRoot, assetsHomeAbs);
    sendJson(res, 200, { managed });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/assets/installed') {
    const agents = assets.listInstalledAgents(assetsHomeAbs);
    const skills = assets.listInstalledSkills(assetsHomeAbs);
    const prompts = assets.listInstalledPrompts(assetsHomeAbs);
    const instructions = assets.getInstalledInstructions(assetsHomeAbs);
    sendJson(res, 200, { agents, skills, prompts, instructions });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/assets/sync-all') {
    readJsonBody(req)
      .then((body) => {
        const result = assets.syncAll(engineRoot, assetsHomeAbs, {
          dryRun: Boolean(body.dryRun),
          force: Boolean(body.force),
          
        });
        sendJson(res, 200, { result });
      })
      .catch((e) => sendJson(res, e.statusCode || 400, { error: String(e.message || e) }));
    return;
  }

  if (req.method === 'POST' && pathname === '/api/assets/sync') {
    readJsonBody(req)
      .then((body) => {
        const assetId = body.assetId;
        if (typeof assetId !== 'string' || !assetId) throw Object.assign(new Error('assetId is required'), { statusCode: 400 });
        const result = assets.syncAsset(engineRoot, assetsHomeAbs, assetId, {
          dryRun: Boolean(body.dryRun),
          force: Boolean(body.force),
          
        });
        sendJson(res, 200, { result });
      })
      .catch((e) => sendJson(res, e.statusCode || 400, { error: String(e.message || e) }));
    return;
  }

  if (req.method === 'POST' && pathname === '/api/assets/remove') {
    readJsonBody(req)
      .then((body) => {
        const assetId = body.assetId;
        if (typeof assetId !== 'string' || !assetId) throw Object.assign(new Error('assetId is required'), { statusCode: 400 });
        const managed = assets.getManagedAssetStatuses(engineRoot, assetsHomeAbs);
        const asset = managed.find((a) => a.id === assetId);
        if (!asset) throw Object.assign(new Error(`Unknown assetId: ${assetId}`), { statusCode: 404 });
        const result = assets.removeAsset(assetsHomeAbs, asset, { force: Boolean(body.force) });
        sendJson(res, 200, { result });
      })
      .catch((e) => sendJson(res, e.statusCode || 400, { error: String(e.message || e) }));
    return;
  }

  if (req.method === 'GET' && pathname === '/api/assets/view') {
    const rel = u.searchParams.get('path');
    if (!rel) {
      sendJson(res, 400, { error: 'Missing ?path=' });
      return;
    }
    try {
      const abs = safeResolveUnder(assetsHomeAbs, rel);
      const text = assets.readTextFileSafe(abs, 512 * 1024);
      if (text == null) {
        sendText(res, 404, 'Not found');
        return;
      }
      sendText(res, 200, text, 'text/plain; charset=utf-8');
    } catch (e) {
      sendJson(res, 400, { error: String(e.message || e) });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/assets/delete') {
    readJsonBody(req)
      .then((body) => {
        const relPath = body.path;
        const force = Boolean(body.force);
        if (typeof relPath !== 'string' || !relPath.trim()) throw Object.assign(new Error('path is required'), { statusCode: 400 });

        // Guardrails: only delete within agents/ or skills/.
        const normalized = relPath.split('\\').join('/').replace(/^\/+/, '');
        if (!(normalized.startsWith('agents/') || normalized.startsWith('skills/'))) {
          throw Object.assign(new Error('Only agents/* or skills/* may be deleted'), { statusCode: 400 });
        }
        if (normalized === 'agents' || normalized === 'skills' || normalized === 'agents/' || normalized === 'skills/') {
          throw Object.assign(new Error('Refusing to delete top-level directory'), { statusCode: 400 });
        }
        if (normalized.startsWith('agents/') && !normalized.toLowerCase().endsWith('.agent.md')) {
          throw Object.assign(new Error('Refusing to delete non-agent file under agents/ (expected *.agent.md)'), { statusCode: 400 });
        }

        if (!force) {
          throw Object.assign(new Error('Deletion requires force=true'), { statusCode: 400 });
        }

        const abs = safeResolveUnder(assetsHomeAbs, normalized);
        if (!fs.existsSync(abs)) {
          throw Object.assign(new Error('Not found'), { statusCode: 404 });
        }

        const stat = fs.statSync(abs);
        if (stat.isDirectory()) {
          fs.rmSync(abs, { recursive: true, force: true });
        } else {
          fs.unlinkSync(abs);
        }

        sendJson(res, 200, { ok: true, deleted: normalized });
      })
      .catch((e) => sendJson(res, e.statusCode || 400, { error: String(e.message || e) }));
    return;
  }

  if (req.method === 'POST' && pathname === '/api/vscode/patch-settings') {
    readJsonBody(req)
      .then((body) => {
        const settingsPath = body && body.settingsPath ? String(body.settingsPath) : null;
        const dryRun = Boolean(body && body.dryRun);

        if (!vscodeHomeAbs || !String(vscodeHomeAbs).trim()) {
          throw Object.assign(new Error('vscodeHome is not configured'), { statusCode: 400 });
        }

        const result = runVscodeSettingsPatcher({ engineRoot, vscodeHome: vscodeHomeAbs, settingsPath, dryRun });
        sendJson(res, result.ok ? 200 : 400, { result });
      })
      .catch((e) => sendJson(res, e.statusCode || 400, { error: String(e.message || e) }));
    return;
  }

  if (req.method === 'POST' && pathname === '/api/copilot/authorize') {
    readJsonBody(req)
      .then((body) => {
        const dryRun = Boolean(body && body.dryRun);
        const result = patchCopilotPermissionsConfig({ copilotHomeAbs, vscodeHomeAbs, dryRun });
        sendJson(res, 200, { result });
      })
      .catch((e) => sendJson(res, e.statusCode || 400, { error: String(e.message || e) }));
    return;
  }

  if (req.method === 'GET' && pathname === '/api/lsp/config') {
    const lspConfigPath = path.join(copilotHomeAbs, 'lsp-config.json');
    const config = readJsonFileSafe(lspConfigPath);
    sendJson(res, 200, { config: config || {} });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/lsp/install') {
    const isWin = process.platform === 'win32';
    const scriptName = isWin ? 'install-lsp.ps1' : 'install-lsp.sh';
    const scriptPath = path.join(engineRoot, 'scripts', scriptName);
    
    if (!fs.existsSync(scriptPath)) {
      sendJson(res, 404, { error: `Install script not found: ${scriptPath}` });
      return;
    }

    let cmd, args;
    if (isWin) {
      cmd = 'powershell.exe';
      args = ['-ExecutionPolicy', 'Bypass', '-File', scriptPath];
    } else {
      cmd = 'bash';
      args = [scriptPath];
    }

    childProcess.execFile(cmd, args, { maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      sendJson(res, 200, {
        ok: !error,
        stdout,
        stderr,
        error: error ? error.message : null
      });
    });
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node copilot-ui/server.js [--port 3210] [--copilot-home <path>]');
    process.exit(0);
  }

  const engineRoot = path.resolve(__dirname, '..');
  const copilotHome = resolveCopilotHome(args);
  const vscodeHome = resolveVscodeHome(args);
  const changeTracker = createChangeTracker(path.resolve(copilotHome), path.resolve(vscodeHome));
  const publicDir = path.join(__dirname, 'public');

  const server = http.createServer((req, res) => {
    const u = new URL(req.url || '/', 'http://127.0.0.1');
    try {
      if (u.pathname.startsWith('/api/')) {
        handleApi({ req, res, u, copilotHome, vscodeHome, engineRoot, changeTracker });
        return;
      }
      serveStatic(publicDir, u.pathname, res);
    } catch (e) {
      sendJson(res, 500, { error: String(e.message || e) });
    }
  });

  server.listen(args.port, '127.0.0.1', () => {
    console.log(`CLI UI server: http://127.0.0.1:${args.port}/`);
    console.log(`copilotHome: ${copilotHome}`);
    console.log(`vscodeHome:  ${vscodeHome}`);
    console.log(`engineRoot:  ${engineRoot}`);
  });
}

main();

