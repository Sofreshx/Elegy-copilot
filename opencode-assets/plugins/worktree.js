import { tool } from "@opencode-ai/plugin/tool";
import { createHash } from "node:crypto";
import { mkdir, rm, readFile, readdir, stat, writeFile, cp, copyFile, rename } from "node:fs/promises";
import { join, basename, dirname, resolve as pathResolve } from "node:path";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";

const WORKTREE_BASE = process.env.OPENCODE_WORKTREE_BASE
  || join(process.env.HOME || process.env.USERPROFILE || "~", ".local", "share", "opencode", "worktree");

const STATE_DIR = join(WORKTREE_BASE, ".state");

const SESSION_CONTRACT_VERSION = "1";
const SESSION_SOURCE = "opencode-worktree-plugin";
const SESSION_STATES = Object.freeze({
  RUNNING: "running",
  IDLE: "idle",
  ERROR: "error",
  DELETED: "deleted",
  UNKNOWN: "unknown",
});

const WORKTREE_STATUS = Object.freeze({
  READY: "ready",
  ACTIVE: "active",
  INTERRUPTED: "interrupted",
  REUSABLE: "reusable",
});

// Windows long-path helper: prepend \\?\ for paths >=260 chars
function safePath(p) {
  if (process.platform !== "win32") return p;
  const normalized = p.replace(/\//g, "\\");
  return normalized.length >= 260 ? "\\\\?\\" + normalized : normalized;
}

function safeExists(p) {
  try {
    const sp = safePath(p);
    return existsSync(sp) || existsSync(p);
  } catch {
    return false;
  }
}

// Replicate catalogProjectionService.getRepoStateKey() for shared registry compatibility.
// Normalizes the absolute path (backslash to forward slash, lowercase, trim), then
// SHA-256 hashes it and returns the first 12 hex chars as repoId.
function computeRepoId(projectPath) {
  const normalized = pathResolve(projectPath).replace(/\\/g, "/").trim().toLowerCase();
  return createHash("sha256").update(normalized, "utf8").digest("hex").slice(0, 12);
}

function projectStatePath(projectId) {
  return join(STATE_DIR, projectId + ".json");
}

async function readProjectState(projectId) {
  try {
    const raw = await readFile(projectStatePath(projectId), "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function writeProjectState(projectId, state) {
  await mkdir(STATE_DIR, { recursive: true });
  const p = projectStatePath(projectId);
  await writeFile(p, JSON.stringify(state, null, 2), "utf8");
}

function sessionDir(copilotHome, repoId) {
  return join(copilotHome, "repo-state", String(repoId || ""), "opencode-sessions");
}

function sessionRecordPath(copilotHome, repoId, sessionId) {
  const safe = sanitizeSessionId(sessionId);
  if (!safe) return null;
  return join(sessionDir(copilotHome, repoId), safe + ".json");
}

async function readSessionRecordFile(absPath) {
  try {
    const raw = await readFile(absPath, "utf8");
    const parsed = JSON.parse(raw);
    if (!isPlainObject(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeJsonAtomic(absPath, value) {
  const dirPath = dirname(absPath);
  await mkdir(dirPath, { recursive: true });
  const base = basename(absPath);
  const tempPath = join(dirPath, "." + base + "." + process.pid + "." + Date.now() + "." + Math.random().toString(16).slice(2) + ".tmp");
  await writeFile(tempPath, JSON.stringify(value, null, 2) + "\n", "utf8");
  const maxRetries = process.platform === "win32" ? 5 : 0;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await rename(tempPath, absPath);
      return;
    } catch (err) {
      const isTransient = err && (err.code === "EPERM" || err.code === "EBUSY");
      if (isTransient && attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 100 * (attempt + 1)));
        continue;
      }
      try { await rm(tempPath, { force: true }); } catch {}
      throw err;
    }
  }
}

function buildSessionRecord(input = {}, fallback = {}) {
  const merged = { ...fallback, ...input };
  const fallbackRecord = isPlainObject(fallback) ? fallback : {};
  const lifecycle = isPlainObject(merged.lifecycle) ? merged.lifecycle : (isPlainObject(fallbackRecord.lifecycle) ? fallbackRecord.lifecycle : {});
  const lastEvent = isPlainObject(merged.lastEvent) ? merged.lastEvent : null;
  const errorInfo = isPlainObject(merged.error) ? merged.error : null;

  return {
    contractVersion: SESSION_CONTRACT_VERSION,
    source: SESSION_SOURCE,
    sessionId: String(merged.sessionId || fallbackRecord.sessionId || ""),
    repoId: String(merged.repoId || fallbackRecord.repoId || ""),
    repoPath: merged.repoPath || fallbackRecord.repoPath || null,
    repoLabel: merged.repoLabel || fallbackRecord.repoLabel || null,
    projectId: merged.projectId || fallbackRecord.projectId || null,
    worktreeId: merged.worktreeId || fallbackRecord.worktreeId || null,
    worktreePath: merged.worktreePath || fallbackRecord.worktreePath || null,
    branch: merged.branch || fallbackRecord.branch || null,
    status: normalizeSessionStatus(merged.status || fallbackRecord.status),
    lifecycle: {
      startedAt: lifecycle.startedAt || fallbackRecord.lifecycle?.startedAt || null,
      lastSeenAt: lifecycle.lastSeenAt || fallbackRecord.lifecycle?.lastSeenAt || null,
      idleAt: lifecycle.idleAt || fallbackRecord.lifecycle?.idleAt || null,
      errorAt: lifecycle.errorAt || fallbackRecord.lifecycle?.errorAt || null,
      deletedAt: lifecycle.deletedAt || fallbackRecord.lifecycle?.deletedAt || null,
    },
    lastEvent: lastEvent
      ? { type: String(lastEvent.type || ""), receivedAt: lastEvent.receivedAt || null }
      : (fallbackRecord.lastEvent || null),
    ...(errorInfo ? { error: { message: String(errorInfo.message || "") } } : (fallbackRecord.error ? { error: { message: String(fallbackRecord.error.message || "") } } : {})),
  };
}

async function updateSessionRecord(copilotHome, repoId, sessionId, mutator) {
  if (!copilotHome) return null;
  const sanitized = sanitizeSessionId(sessionId);
  if (!sanitized || !repoId) return null;
  const absPath = sessionRecordPath(copilotHome, repoId, sanitized);
  if (!absPath) return null;

  const existing = (await readSessionRecordFile(absPath)) || buildSessionRecord({
    sessionId: sanitized,
    repoId,
  });
  const next = mutator(existing) || existing;
  const normalized = buildSessionRecord(next, existing);
  normalized.sessionId = sanitized;
  normalized.repoId = String(repoId);
  if (!normalized.lifecycle.startedAt) normalized.lifecycle.startedAt = nowIso();
  if (!normalized.lifecycle.lastSeenAt) normalized.lifecycle.lastSeenAt = nowIso();

  await writeJsonAtomic(absPath, normalized);
  return normalized;
}

async function readSessionRecord(copilotHome, repoId, sessionId) {
  if (!copilotHome) return null;
  const absPath = sessionRecordPath(copilotHome, repoId, sessionId);
  if (!absPath) return null;
  return readSessionRecordFile(absPath);
}

async function listSessionRecords(copilotHome, repoId) {
  if (!copilotHome) return [];
  const dir = sessionDir(copilotHome, repoId);
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const entry of entries) {
    if (!entry || !entry.isFile() || !/\.json$/i.test(entry.name)) continue;
    const rec = await readSessionRecordFile(join(dir, entry.name));
    if (rec) out.push(rec);
  }
  return out;
}

async function removeSessionRecord(copilotHome, repoId, sessionId) {
  if (!copilotHome) return false;
  const absPath = sessionRecordPath(copilotHome, repoId, sessionId);
  if (!absPath) return false;
  try {
    await rm(absPath, { force: true });
    return true;
  } catch {
    return false;
  }
}

async function readSharedWorktreeRecord(copilotHome, repoId, worktreeId) {
  if (!copilotHome || !repoId || !worktreeId) return null;
  const p = join(copilotHome, "repo-state", String(repoId), "worktrees", worktreeId + ".json");
  return readSessionRecordFile(p);
}

async function listSharedWorktreeRecords(copilotHome, repoId) {
  if (!copilotHome || !repoId) return [];
  const dir = join(copilotHome, "repo-state", String(repoId), "worktrees");
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const entry of entries) {
    if (!entry || !entry.isFile() || !/\.json$/i.test(entry.name)) continue;
    const rec = await readSessionRecordFile(join(dir, entry.name));
    if (rec) out.push(rec);
  }
  return out;
}

async function writeSharedWorktreeRecord(copilotHome, repoId, worktreeId, mutator) {
  if (!copilotHome || !repoId || !worktreeId) return null;
  const p = join(copilotHome, "repo-state", String(repoId), "worktrees", worktreeId + ".json");
  const existing = (await readSessionRecordFile(p)) || { worktreeId, repoId };
  const next = mutator(existing) || existing;
  const normalized = normalizeWorktreeRecordForPlugin(next, existing);
  normalized.worktreeId = worktreeId;
  normalized.repoId = String(repoId);
  if (!normalized.updatedAt) normalized.updatedAt = nowIso();
  await writeJsonAtomic(p, normalized);
  return normalized;
}

function normalizeComparablePath(value) {
  if (!value) return "";
  return String(value).replace(/\\/g, "/").trim().toLowerCase();
}

async function resolveLinkedWorktreeId(copilotHome, repoId, sessionId, projectState, hints = {}) {
  if (!copilotHome || !repoId) return null;

  // 1) known active plugin state (in-process auxiliary state captured at worktree_create)
  if (projectState && projectState.sessionId && sessionId && projectState.sessionId === sessionId) {
    if (projectState.activeWorktreeBranch) {
      return "wt-oc-" + repoId + "-" + branchToWorktreeIdSuffix(projectState.activeWorktreeBranch);
    }
  }

  // 2) explicit hints (worktreePath or worktreeId) from the event/caller
  if (hints.worktreeId) return String(hints.worktreeId);
  if (hints.worktreePath) {
    const target = normalizeComparablePath(hints.worktreePath);
    if (target) {
      const all = await listSharedWorktreeRecords(copilotHome, repoId);
      const match = all.find((r) => normalizeComparablePath(r.path) === target);
      if (match && match.worktreeId) return String(match.worktreeId);
    }
  }

  // 3) try the existing session record's linked worktreeId (sticky linkage)
  if (sessionId) {
    const sess = await readSessionRecord(copilotHome, repoId, sessionId);
    if (sess && sess.worktreeId) {
      return String(sess.worktreeId);
    }
  }

  // 4) fall back to plugin auxiliary state even if sessionId didn't match
  if (projectState && projectState.activeWorktreeBranch) {
    return "wt-oc-" + repoId + "-" + branchToWorktreeIdSuffix(projectState.activeWorktreeBranch);
  }

  return null;
}

function resolveSessionIdFromEvent(event) {
  if (!event || !isPlainObject(event)) return "";
  const props = isPlainObject(event.properties) ? event.properties : {};
  return String(
    props.sessionID
    || props.sessionId
    || props.id
    || event.sessionID
    || event.sessionId
    || event.id
    || process.env.OPENCODE_SESSION_ID
    || ""
  ).trim();
}

function projectIdFromPath(projectPath) {
  const normalized = projectPath.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts.slice(-2).join("-").replace(/[^a-zA-Z0-9_-]/g, "-");
}

function branchToWorktreeIdSuffix(branch) {
  return String(branch || "").replace(/[^a-zA-Z0-9_-]/g, "-");
}

function sanitizeSessionId(sessionId) {
  const trimmed = String(sessionId || "").trim();
  if (!trimmed) return "";
  return trimmed.replace(/[^a-zA-Z0-9_.-]/g, "-").slice(0, 200) || "unknown";
}

function nowIso() {
  return new Date().toISOString();
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeSessionStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (Object.values(SESSION_STATES).includes(normalized)) return normalized;
  return SESSION_STATES.UNKNOWN;
}

function normalizeWorktreeRecordForPlugin(input = {}, fallback = {}) {
  const merged = { ...fallback, ...input };
  const record = isPlainObject(input) ? input : {};
  const fallbackRecord = isPlainObject(fallback) ? fallback : {};

  const next = {
    contractVersion: SESSION_CONTRACT_VERSION,
    worktreeId: String(merged.worktreeId || fallbackRecord.worktreeId || ""),
    repoId: String(merged.repoId || fallbackRecord.repoId || ""),
    repoPath: merged.repoPath || fallbackRecord.repoPath || null,
    repoLabel: merged.repoLabel || fallbackRecord.repoLabel || null,
    mode: merged.mode || fallbackRecord.mode || "dedicated",
    path: merged.path || fallbackRecord.path || null,
    branch: merged.branch || fallbackRecord.branch || null,
    source: merged.source || fallbackRecord.source || SESSION_SOURCE,
    status: String(merged.status || fallbackRecord.status || WORKTREE_STATUS.READY),
    launch: isPlainObject(merged.launch) ? merged.launch : (isPlainObject(fallbackRecord.launch) ? fallbackRecord.launch : { blocked: false, reason: null }),
    assignment: isPlainObject(merged.assignment)
      ? merged.assignment
      : (isPlainObject(fallbackRecord.assignment) ? fallbackRecord.assignment : { sessionId: null, runId: null, overlaySessionId: null }),
    lifecycle: isPlainObject(merged.lifecycle)
      ? merged.lifecycle
      : (isPlainObject(fallbackRecord.lifecycle) ? fallbackRecord.lifecycle : {}),
  };

  return next;
}

function runGit(args, cwd) {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, timeout: 30000 }, (err, stdout, stderr) => {
      if (err) reject(new Error("git " + args.join(" ") + " failed: " + (stderr || err.message)));
      else resolve(stdout.trim());
    });
  });
}

function runShellCommand(cmd, cwd) {
  return new Promise((resolve, reject) => {
    const isWin = process.platform === "win32";
    const shell = isWin ? "cmd" : "/bin/sh";
    const shellArgs = isWin ? ["/c", cmd] : ["-c", cmd];
    execFile(shell, shellArgs, { cwd, timeout: 120000 }, (err, stdout, stderr) => {
      if (err) reject(new Error("Command failed: " + cmd + ": " + (stderr || err.message)));
      else resolve(stdout.trim());
    });
  });
}

function detectSetupCommands(worktreePath) {
  const commands = [];
  if (safeExists(join(worktreePath, "package.json"))) commands.push("npm install");
  if (safeExists(join(worktreePath, "Cargo.toml"))) commands.push("cargo build");
  if (safeExists(join(worktreePath, "go.mod"))) commands.push("go mod download");
  if (safeExists(join(worktreePath, "requirements.txt"))) commands.push("pip install -r requirements.txt");
  if (safeExists(join(worktreePath, "pyproject.toml"))) commands.push("poetry install");
  return commands;
}

async function syncFiles(fromDir, toDir, patterns) {
  if (!patterns || !Array.isArray(patterns) || patterns.length === 0) return;
  for (const pattern of patterns) {
    const src = join(fromDir, pattern);
    if (!safeExists(src)) continue;
    try {
      const srcStat = await stat(src);
      const dest = join(toDir, pattern);
      if (srcStat.isDirectory()) {
        await cp(src, dest, { recursive: true, force: true });
      } else {
        await mkdir(dirname(dest), { recursive: true });
        await copyFile(src, dest);
      }
    } catch {
      // non-critical, skip
    }
  }
}

async function readWorktreeConfig(projectPath) {
  const configPath = join(projectPath, ".opencode", "worktree.json");
  try {
    const raw = await readFile(configPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function resolveSharedRegistryHome() {
  const candidates = [
    process.env.ELEGY_COPILOT_HOME,
    process.env.COPILOT_HOME,
    join(process.env.HOME || process.env.USERPROFILE || "~", ".copilot"),
  ];
  for (const candidate of candidates) {
    if (candidate && safeExists(candidate)) return candidate;
  }
  return null;
}

async function writeSharedRegistryRecord(repoId, branch, worktreePath, projectPath, sessionId) {
  const copilotHome = resolveSharedRegistryHome();
  if (!copilotHome) return null;

  try {
    const repoStateDir = join(copilotHome, "repo-state", repoId, "worktrees");
    await mkdir(repoStateDir, { recursive: true });

    const worktreeId = "wt-oc-" + repoId + "-" + branchToWorktreeIdSuffix(branch);
    const recordPath = join(repoStateDir, worktreeId + ".json");
    const now = new Date().toISOString();

    const record = {
      contractVersion: "1",
      worktreeId,
      repoId,
      repoPath: pathResolve(projectPath),
      repoLabel: basename(projectPath),
      mode: "dedicated",
      path: worktreePath,
      branch,
      source: SESSION_SOURCE,
      status: "ready",
      launch: { blocked: false, reason: null },
      assignment: {
        sessionId: sessionId || null,
        runId: null,
        overlaySessionId: null,
      },
      cleanup: { policy: "manual", status: "manual_required", lastAttemptAt: null, lastError: null },
      recovery: { mode: "reuse", orphaned: false, reason: null },
      validation: { pathExists: true, gitWorktree: true, repoMatches: true, checkedAt: now, reason: null },
      lifecycle: {
        requestedAt: now,
        allocatedAt: now,
        activatedAt: null,
        releasedAt: null,
        interruptedAt: null,
        lastSeenAt: now,
      },
      createdAt: now,
      updatedAt: now,
    };

    await writeJsonAtomic(recordPath, record);
    return { worktreeId, recordPath };
  } catch {
    return null;
  }
}

async function removeSharedRegistryRecord(repoId, branch) {
  const copilotHome = resolveSharedRegistryHome();
  if (!copilotHome) return;

  try {
    const repoStateDir = join(copilotHome, "repo-state", repoId, "worktrees");
    if (!safeExists(repoStateDir)) return;

    const worktreeId = "wt-oc-" + repoId + "-" + branch.replace(/[^a-zA-Z0-9_-]/g, "-");
    const recordPath = join(repoStateDir, worktreeId + ".json");
    if (safeExists(recordPath)) {
      await rm(recordPath, { force: true });
    }
  } catch {
    // non-critical
  }
}

async function getDirtyStatus(worktreePath) {
  try {
    const status = await runGit(["status", "--porcelain"], worktreePath);
    return { known: true, files: status ? status.split("\n").filter(Boolean) : [] };
  } catch {
    // Fail closed: if we can't determine status, treat as potentially dirty
    return { known: false, files: [] };
  }
}

export const WorktreePlugin = async ({ project, directory, worktree }) => {
  const projectPath = (project && project.path) || directory;
  const projectId = projectIdFromPath(projectPath);
  const repoId = computeRepoId(projectPath);
  const repoLabel = basename(projectPath);

  return {
    tool: {
      worktree_create: tool({
        description: "Create a new git worktree for isolated work. The worktree shares the same git repository but works on a separate branch in a separate directory. Use this before starting feature work that needs isolation.",
        args: {
          branch: tool.schema.string().describe("Branch name for the worktree (e.g. 'feature/auth')"),
          baseBranch: tool.schema.string().optional().describe("Base branch to create from (defaults to current checkout HEAD)"),
          runSetup: tool.schema.boolean().optional().describe("If true, run detected setup commands (npm install, etc.) after creation. Default: false — only detect and report."),
        },
        async execute(args, ctx) {
          const branch = args.branch.replace(/[^a-zA-Z0-9_/-]/g, "-");
          const resolvedBase = args.baseBranch || "HEAD";
          const worktreePath = join(WORKTREE_BASE, projectId, branch);

          if (safeExists(worktreePath)) {
            return "Worktree already exists at " + worktreePath + ". Use worktree_delete first if you want to recreate it.";
          }

          await mkdir(worktreePath, { recursive: true });

          try {
            await runGit(["worktree", "add", "-b", branch, worktreePath, resolvedBase], projectPath);
          } catch (err) {
            try {
              await runGit(["worktree", "add", worktreePath, branch], projectPath);
            } catch (err2) {
              await rm(worktreePath, { recursive: true, force: true });
              return "Failed to create worktree: " + err2.message;
            }
          }

          const config = await readWorktreeConfig(projectPath);
          if (config.syncFiles) {
            await syncFiles(projectPath, worktreePath, config.syncFiles);
          }

          const detectedSetup = detectSetupCommands(worktreePath);
          let setupResult = "";
          if (detectedSetup.length > 0) {
            if (args.runSetup) {
              if (ctx && typeof ctx.metadata === 'function') {
                ctx.metadata({ title: "Running setup: " + detectedSetup.join(", ") });
              }
              const results = [];
              for (const cmd of detectedSetup) {
                try {
                  const stdout = await runShellCommand(cmd, worktreePath);
                  results.push(cmd + ": ok" + (stdout ? " (" + stdout.split("\n").length + " lines)" : ""));
                } catch (setupErr) {
                  results.push(cmd + ": failed (" + setupErr.message + ")");
                }
              }
              setupResult = "\nSetup results:\n" + results.join("\n");
            } else {
              setupResult = "\nSetup commands detected (not run): " + detectedSetup.join(", ") + ". Run them manually or pass runSetup: true to execute automatically.";
            }
          }

          const sessionId = process.env.OPENCODE_SESSION_ID || null;

          // Update plugin-local auxiliary state
          const state = await readProjectState(projectId);
          state.activeWorktreeBranch = branch;
          state.baseBranch = resolvedBase === "HEAD" ? null : resolvedBase;
          state.worktreePath = worktreePath;
          state.lastCreatedAt = new Date().toISOString();
          if (sessionId) state.sessionId = sessionId;
          state.repoId = repoId;
          await writeProjectState(projectId, state);

          // Write compatible record into shared Elegy Copilot registry
          const sharedResult = await writeSharedRegistryRecord(repoId, branch, worktreePath, projectPath, sessionId);
          const worktreeId = sharedResult ? sharedResult.worktreeId : null;

          // If we have a session id, also write the OpenCode session projection
          if (sessionId) {
            const copilotHome = resolveSharedRegistryHome();
            if (copilotHome) {
              try {
                await updateSessionRecord(copilotHome, repoId, sessionId, (existing) => {
                  return {
                    ...(existing || {}),
                    sessionId,
                    repoId,
                    repoPath: pathResolve(projectPath),
                    repoLabel: repoLabel,
                    projectId,
                    worktreeId: worktreeId || (existing && existing.worktreeId) || null,
                    worktreePath,
                    branch,
                    status: SESSION_STATES.RUNNING,
                    lifecycle: {
                      ...((existing && existing.lifecycle) || {}),
                      startedAt: (existing && existing.lifecycle && existing.lifecycle.startedAt) || new Date().toISOString(),
                      lastSeenAt: new Date().toISOString(),
                    },
                    lastEvent: { type: "worktree_create", receivedAt: new Date().toISOString() },
                  };
                });
              } catch {
                // session record writes are best-effort
              }
            }
          }

          let output = "Worktree created at " + worktreePath + "\nBranch: " + branch + "\nBase: " + resolvedBase;
          if (setupResult) output += setupResult;
          if (sharedResult) {
            output += "\nShared registry: " + sharedResult.worktreeId;
          }

          return {
            output,
            metadata: {
              worktreePath,
              branch,
              baseBranch: resolvedBase,
              projectId,
              repoId,
              sessionId,
              sharedRegistry: sharedResult ? sharedResult.worktreeId : null,
            },
          };
        },
      }),

      worktree_list: tool({
        description: "List all git worktrees for the current project. Shows path, branch, status, project branch metadata, path existence, and cleanup readiness.",
        args: {},
        async execute() {
          try {
            const output = await runGit(["worktree", "list", "--porcelain"], projectPath);
            const entries = [];
            let current = {};

            for (const line of output.split("\n")) {
              if (line.startsWith("worktree ")) {
                if (current.path) entries.push(current);
                current = { path: line.slice(9) };
              } else if (line.startsWith("HEAD ")) {
                current.head = line.slice(5);
              } else if (line.startsWith("branch ")) {
                current.branch = line.slice(7).replace("refs/heads/", "");
              } else if (line === "bare") {
                current.bare = true;
              } else if (line === "detached") {
                current.detached = true;
              }
            }
            if (current.path) entries.push(current);

            if (entries.length === 0) return "No worktrees found.";

            const projectState = await readProjectState(projectId);

            const formatted = entries.map(function(e) {
              const parts = ["  " + e.path];
              if (e.branch) parts.push("[" + e.branch + "]");
              if (e.detached) parts.push("[detached]");
              if (e.bare) parts.push("[bare]");

              if (projectState.activeWorktreeBranch && e.branch === projectState.activeWorktreeBranch) {
                parts.push("← active worktree");
              }

              try {
                if (!existsSync(e.path)) {
                  parts.push("[path missing]");
                }
              } catch {
                parts.push("[path check failed]");
              }

              if (e.branch && e.branch !== projectState.activeWorktreeBranch && !e.detached) {
                parts.push("[cleanup-ready]");
              }

              return parts.join(" ");
            });

            let result = "Worktrees for " + basename(projectPath) + ":\n" + formatted.join("\n");

            if (projectState.activeWorktreeBranch) {
              result += "\n\nActive worktree branch: " + projectState.activeWorktreeBranch;
              if (projectState.baseBranch) {
                result += " (base: " + projectState.baseBranch + ")";
              }
              if (projectState.lastCreatedAt) {
                result += " (last created: " + projectState.lastCreatedAt + ")";
              }
              if (projectState.sessionId) {
                result += "\nSession: " + projectState.sessionId;
              }
            } else {
              result += "\n\nNo active worktree. Use worktree_create to establish one.";
            }

            const sharedHome = resolveSharedRegistryHome();
            if (sharedHome) {
              result += "\nShared registry: " + sharedHome;
            }

            return result;
          } catch (err) {
            return "Failed to list worktrees: " + err.message;
          }
        },
      }),

      worktree_delete: tool({
        description: "Remove a git worktree. Dirty worktrees require force=true. Does NOT auto-commit — stage and commit changes manually before deletion if needed.",
        args: {
          branch: tool.schema.string().describe("Branch name of the worktree to remove"),
          force: tool.schema.boolean().optional().describe("Force removal even with uncommitted changes (discards changes)"),
        },
        async execute(args) {
          const branch = args.branch.replace(/[^a-zA-Z0-9_/-]/g, "-");
          const worktreePath = join(WORKTREE_BASE, projectId, branch);

          if (!safeExists(worktreePath)) {
            return "No worktree found at " + worktreePath;
          }

          // Check for dirty state before deletion
          const dirtyStatus = await getDirtyStatus(worktreePath);
          if (!args.force) {
            if (!dirtyStatus.known) {
              return "Unable to determine worktree status for " + branch + ". Pass force=true to delete anyway.";
            }
            if (dirtyStatus.files.length > 0) {
              return "Worktree " + branch + " has " + dirtyStatus.files.length + " uncommitted change(s). Commit or stash changes manually, then retry with force=true to discard them.\nDirty files:\n" + dirtyStatus.files.join("\n");
            }
          }

          try {
            const removeArgs = ["worktree", "remove"];
            if (args.force) removeArgs.push("--force");
            removeArgs.push(worktreePath);
            await runGit(removeArgs, projectPath);

            const baseDir = join(WORKTREE_BASE, projectId);
            try {
              const remaining = await readdir(baseDir);
              if (remaining.length === 0) {
                await rm(baseDir, { recursive: true, force: true });
              }
            } catch {
              // non-critical
            }

            // Clear from plugin-local auxiliary state
            const projState = await readProjectState(projectId);
            if (projState.activeWorktreeBranch === branch) {
              delete projState.activeWorktreeBranch;
              delete projState.baseBranch;
              delete projState.worktreePath;
              delete projState.lastCreatedAt;
              delete projState.sessionId;
              await writeProjectState(projectId, projState);
            }

            // Remove from shared registry
            await removeSharedRegistryRecord(repoId, branch);

            return "Worktree " + branch + " removed successfully.";
          } catch (err) {
            if (process.platform === "win32" && args.force) {
              try {
                await runGit(["worktree", "remove", "--force", worktreePath], projectPath);
                await removeSharedRegistryRecord(repoId, branch);
                return "Worktree " + branch + " removed (force via long-path).";
              } catch {
                try {
                  await rm(worktreePath, { recursive: true, force: true });
                  try {
                    await runGit(["worktree", "prune"], projectPath);
                  } catch {
                    // prune failure is non-fatal
                  }
                  await removeSharedRegistryRecord(repoId, branch);
                  return "Worktree " + branch + " removed (filesystem fallback). Run 'git worktree prune' to clean metadata.";
                } catch (fsErr) {
                  return "Failed to remove worktree: " + fsErr.message + ". Try manual removal of " + worktreePath;
                }
              }
            }
            return "Failed to remove worktree: " + err.message + ". Use force=true if needed.";
          }
        },
      }),
    },

    "shell.env": async function(input, output) {
      output.env.OPENCODE_WORKTREE_BASE = WORKTREE_BASE;
      output.env.OPENCODE_PROJECT_ID = projectId;
      if (worktree) {
        output.env.OPENCODE_WORKTREE_PATH = worktree;
        output.env.OPENCODE_WORKTREE_ROOT = worktree;
      }
    },

    event: async function({ event }) {
      if (!event || !event.type) return;

      const copilotHome = resolveSharedRegistryHome();
      if (!copilotHome) return;

      const sessionId = resolveSessionIdFromEvent(event);
      if (!sessionId) return;

      const props = isPlainObject(event.properties) ? event.properties : {};
      const hintWorktreePath = props.worktreePath || worktree || null;
      const hintWorktreeId = props.worktreeId || null;
      const eventType = String(event.type);

      let nextStatus = null;
      let touchedWorktreeAction = null;
      if (eventType === "session.created" || eventType === "session.create" || eventType === "session.status") {
        nextStatus = SESSION_STATES.RUNNING;
        touchedWorktreeAction = "active";
      } else if (eventType === "session.idle") {
        nextStatus = SESSION_STATES.IDLE;
        touchedWorktreeAction = "keep";
      } else if (eventType === "session.error") {
        nextStatus = SESSION_STATES.ERROR;
        touchedWorktreeAction = "interrupted";
      } else if (eventType === "session.deleted" || eventType === "session.delete") {
        nextStatus = SESSION_STATES.DELETED;
        touchedWorktreeAction = "reusable";
      } else {
        return;
      }

      try {
        const projectState = await readProjectState(projectId);
        const receivedAt = nowIso();
        const updated = await updateSessionRecord(copilotHome, repoId, sessionId, (existing) => {
          const wasCreated = !existing || !existing.lifecycle || !existing.lifecycle.startedAt;
          const lifecycle = (existing && existing.lifecycle) || {};
          const next = {
            ...(existing || {}),
            sessionId,
            repoId,
            repoPath: pathResolve(projectPath),
            repoLabel,
            projectId,
            worktreePath: (existing && existing.worktreePath) || hintWorktreePath,
            worktreeId: (existing && existing.worktreeId) || hintWorktreeId,
            branch: (existing && existing.branch) || (projectState && projectState.activeWorktreeBranch) || null,
            status: nextStatus,
            lifecycle: {
              startedAt: lifecycle.startedAt || (wasCreated ? receivedAt : null),
              lastSeenAt: receivedAt,
              idleAt: nextStatus === SESSION_STATES.IDLE ? receivedAt : (lifecycle.idleAt || null),
              errorAt: nextStatus === SESSION_STATES.ERROR ? receivedAt : (lifecycle.errorAt || null),
              deletedAt: nextStatus === SESSION_STATES.DELETED ? receivedAt : (lifecycle.deletedAt || null),
            },
            lastEvent: { type: eventType, receivedAt },
          };
          if (nextStatus === SESSION_STATES.ERROR) {
            const message = (event.properties && (event.properties.error || event.properties.message))
              || (event.error && event.error.message)
              || (event.message)
              || "session error";
            next.error = { message: String(message) };
          } else if (nextStatus !== SESSION_STATES.ERROR && nextStatus !== SESSION_STATES.UNKNOWN) {
            delete next.error;
          }
          return next;
        });

        if (touchedWorktreeAction && touchedWorktreeAction !== "keep") {
          const linkedWorktreeId = await resolveLinkedWorktreeId(copilotHome, repoId, sessionId, projectState, {
            worktreeId: hintWorktreeId || (updated && updated.worktreeId) || null,
            worktreePath: hintWorktreePath || (updated && updated.worktreePath) || null,
          });
          if (linkedWorktreeId) {
            if (touchedWorktreeAction === "active") {
              await writeSharedWorktreeRecord(copilotHome, repoId, linkedWorktreeId, (existing) => {
                const wasActive = existing && existing.status === WORKTREE_STATUS.ACTIVE
                  && existing.assignment && existing.assignment.sessionId === sessionId;
                return {
                  ...existing,
                  status: WORKTREE_STATUS.ACTIVE,
                  assignment: {
                    ...(existing && existing.assignment ? existing.assignment : {}),
                    sessionId,
                    runId: (existing && existing.assignment && existing.assignment.runId) || null,
                    overlaySessionId: (existing && existing.assignment && existing.assignment.overlaySessionId) || null,
                  },
                  lifecycle: {
                    ...(existing && existing.lifecycle ? existing.lifecycle : {}),
                    activatedAt: wasActive
                      ? ((existing && existing.lifecycle && existing.lifecycle.activatedAt) || receivedAt)
                      : receivedAt,
                    lastSeenAt: receivedAt,
                  },
                  updatedAt: receivedAt,
                };
              });
            } else if (touchedWorktreeAction === "interrupted") {
              await writeSharedWorktreeRecord(copilotHome, repoId, linkedWorktreeId, (existing) => {
                return {
                  ...existing,
                  status: WORKTREE_STATUS.INTERRUPTED,
                  assignment: {
                    ...(existing && existing.assignment ? existing.assignment : {}),
                    sessionId,
                  },
                  lifecycle: {
                    ...(existing && existing.lifecycle ? existing.lifecycle : {}),
                    interruptedAt: receivedAt,
                    lastSeenAt: receivedAt,
                  },
                  updatedAt: receivedAt,
                };
              });
            } else if (touchedWorktreeAction === "reusable") {
              await writeSharedWorktreeRecord(copilotHome, repoId, linkedWorktreeId, (existing) => {
                return {
                  ...existing,
                  status: WORKTREE_STATUS.REUSABLE,
                  assignment: {
                    sessionId: null,
                    runId: null,
                    overlaySessionId: null,
                  },
                  lifecycle: {
                    ...(existing && existing.lifecycle ? existing.lifecycle : {}),
                    releasedAt: receivedAt,
                    lastSeenAt: receivedAt,
                  },
                  updatedAt: receivedAt,
                };
              });
            }
          }
        }
      } catch (err) {
        console.log("[worktree] session event failed: " + (err && err.message ? err.message : err));
      }
    },
  };
};

export default WorktreePlugin;
