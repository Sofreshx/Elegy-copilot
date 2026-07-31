'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const childProcess = require('child_process');

const { validateCommandShape } = require('./commandDiscovery');
const { getRepoStateKey } = require('./catalogProjectionService');

const MAX_OUTPUT_CHARS = 50000;
const MAX_TAIL_CHARS = 4000;
const MAX_COMPLETED_PER_REPO = 5;
const STOP_CLOSE_TIMEOUT_MS = 3000;

const ELEGY_HOME = path.join(os.homedir(), '.elegy');
const REPO_STATE_DIR = path.join(ELEGY_HOME, 'repo-state');

// In-memory run registry: repoPath -> run record. One active run per repo.
const runsByRepo = new Map();
const runsById = new Map();

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function getExecutionStateDir(repoPath) {
  const repoId = getRepoStateKey(repoPath).repoId;
  return path.join(REPO_STATE_DIR, repoId, 'execution');
}

function getRunOutcomesPath(repoPath) {
  return path.join(getExecutionStateDir(repoPath), 'runs.json');
}

function readRunOutcomes(repoPath) {
  const filePath = getRunOutcomesPath(repoPath);
  if (!fs.existsSync(filePath)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeRunOutcome(repoPath, commandId, outcome) {
  const outcomes = readRunOutcomes(repoPath);
  outcomes[commandId] = { ...(outcomes[commandId] || {}), ...outcome };
  const filePath = getRunOutcomesPath(repoPath);
  ensureDir(path.dirname(filePath));
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(outcomes, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

function appendOutput(record, stream, data) {
  const text = data.toString();
  const bucket = stream === 'stdout' ? record.stdout : record.stderr;
  bucket.push(text);
  record.outputChars += text.length;
  while (record.outputChars > MAX_OUTPUT_CHARS && bucket.length > 0) {
    record.outputChars -= bucket[0].length;
    bucket.shift();
  }
}

function truncateTail(parts) {
  let joined = parts.join('');
  if (joined.length > MAX_TAIL_CHARS) {
    joined = joined.slice(-MAX_TAIL_CHARS);
  }
  return joined;
}

function killProcessTree(child) {
  if (!child || child.exitCode !== null || child.killed) return false;
  if (process.platform === 'win32') {
    try {
      childProcess.execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
      return true;
    } catch {
      try {
        child.kill();
      } catch {
        // already gone
      }
      return true;
    }
  }
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    try {
      child.kill();
    } catch {
      // already gone
    }
  }
  return true;
}

function createRunId() {
  return crypto.randomUUID();
}

function isWindows() {
  return process.platform === 'win32';
}

function quoteCmdArg(arg) {
  return /[\s"]/.test(arg) ? `"${arg.replace(/"/g, '""')}"` : arg;
}

// On Windows, npm/yarn/pnpm/bun are .cmd/.bat shims that cannot be spawned
// directly with shell:false. Resolve the shim and run it through cmd.exe
// (args are already validated metachar-free by validateCommandShape).
function resolveWindowsExecutable(command) {
  try {
    const out = childProcess.execFileSync('where.exe', [command], {
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    }).toString();
    const candidates = out.split(/\r?\n/).map((c) => c.trim()).filter(Boolean);
    const shim = candidates.find((c) => /\.(cmd|bat)$/i.test(c));
    const exe = candidates.find((c) => /\.exe$/i.test(c));
    if (shim) return { kind: 'cmd', path: shim };
    if (exe) return { kind: 'exe', path: exe };
    return { kind: 'exe', path: command };
  } catch {
    return { kind: 'exe', path: command };
  }
}

function buildSpawnTarget(command, args) {
  if (!isWindows()) return { command, args };
  const resolved = resolveWindowsExecutable(command);
  if (resolved.kind === 'cmd') {
    const line = [resolved.path, ...args.map(quoteCmdArg)].join(' ');
    return { command: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', `"${line}"`] };
  }
  return { command: resolved.path, args };
}

function buildRunRecord({ repoPath, commandId, command, args, cwd, kind }) {
  const runId = createRunId();
  return {
    runId,
    repoPath,
    commandId: commandId || null,
    kind, // 'command' | 'setup'
    command,
    args,
    cwd,
    status: 'starting',
    exitCode: null,
    stdout: [],
    stderr: [],
    outputChars: 0,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    child: null,
  };
}

function startRun({ repoPath, commandId, command, args, cwd, kind }) {
  const validation = validateCommandShape(command, args);
  if (!validation.ok) {
    return { ok: false, error: `Command validation failed: ${validation.error}`, code: 'invalid_command' };
  }
  if (runsByRepo.has(repoPath)) {
    return { ok: false, error: 'A run is already active for this repository', code: 'busy' };
  }

  const record = buildRunRecord({ repoPath, commandId, command, args, cwd, kind });
  const target = buildSpawnTarget(command, args);
  const child = childProcess.spawn(target.command, target.args, {
    cwd,
    shell: false,
    detached: !isWindows(),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  });
  record.child = child;
  record.status = 'running';

  child.stdout.on('data', (data) => appendOutput(record, 'stdout', data));
  child.stderr.on('data', (data) => appendOutput(record, 'stderr', data));

  child.on('error', (err) => {
    record.status = 'failed';
    record.exitCode = -2;
    record.finishedAt = new Date().toISOString();
    appendOutput(record, 'stderr', Buffer.from(`\nspawn error: ${err.message}\n`));
    finalizeRun(record);
  });

  child.on('close', (code) => {
    if (record.status === 'running' || record.status === 'stopping') {
      record.status = record.status === 'stopping' ? 'stopped' : (code === 0 ? 'done' : 'failed');
      record.exitCode = code;
      record.finishedAt = new Date().toISOString();
      finalizeRun(record);
    }
  });

  runsByRepo.set(repoPath, record);
  runsById.set(record.runId, record);
  evictCompletedRuns(repoPath);
  return { ok: true, runId: record.runId, record: toPublicRecord(record) };
}

// Completed runs stay queryable (UI shows final results) up to a per-repo cap.
function evictCompletedRuns(repoPath) {
  const completed = [...runsById.values()]
    .filter((r) => r.repoPath === repoPath && r.status !== 'running' && r.status !== 'stopping')
    .sort((a, b) => String(a.finishedAt || '').localeCompare(String(b.finishedAt || '')));
  while (completed.length > MAX_COMPLETED_PER_REPO) {
    const oldest = completed.shift();
    runsById.delete(oldest.runId);
  }
}

function finalizeRun(record) {
  if (runsById.get(record.runId) === record) {
    runsByRepo.delete(record.repoPath);
    writeRunOutcome(record.repoPath, commandIdFor(record), {
      lastRunAt: record.finishedAt || new Date().toISOString(),
      lastExitCode: record.exitCode ?? -1,
    });
  }
}

function commandIdFor(record) {
  return record.kind === 'setup' ? 'setup' : record.commandId || 'command';
}

async function stopRun(runId) {
  const record = runsById.get(runId);
  if (!record) return { ok: false, error: `Run '${runId}' not found`, code: 'not_found' };
  if (record.status !== 'running') {
    return { ok: true, record: toPublicRecord(record) };
  }
  record.status = 'stopping';
  killProcessTree(record.child);
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (record.status === 'stopping') {
        record.status = 'stopped';
        record.exitCode = null;
        record.finishedAt = new Date().toISOString();
        finalizeRun(record);
      }
      resolve();
    }, STOP_CLOSE_TIMEOUT_MS);
    const onClose = () => {
      clearTimeout(timer);
      resolve();
    };
    if (record.child.exitCode !== null) onClose();
    else record.child.once('close', onClose);
  });
  return { ok: true, record: toPublicRecord(record) };
}

function getRun(runId) {
  const record = runsById.get(runId);
  if (!record) return null;
  return toPublicRecord(record);
}

function getActiveRun(repoPath) {
  const record = runsByRepo.get(repoPath);
  if (!record) return null;
  return toPublicRecord(record);
}

function toPublicRecord(record) {
  return {
    runId: record.runId,
    repoPath: record.repoPath,
    kind: record.kind,
    commandId: record.commandId || null,
    command: record.command,
    args: record.args,
    status: record.status,
    exitCode: record.exitCode,
    stdout: truncateTail(record.stdout),
    stderr: truncateTail(record.stderr),
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
  };
}

function shutdownActiveRuns() {
  for (const record of runsById.values()) {
    if (record.status === 'running' || record.status === 'stopping') {
      killProcessTree(record.child);
    }
  }
}

module.exports = {
  startRun,
  stopRun,
  getRun,
  getActiveRun,
  readRunOutcomes,
  writeRunOutcome,
  getExecutionStateDir,
  shutdownActiveRuns,
};
