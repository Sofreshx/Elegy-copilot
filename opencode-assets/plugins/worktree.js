import { tool } from "@opencode-ai/plugin/tool";
import { createHash } from "node:crypto";
import { mkdir, rm, readFile, readdir, stat, writeFile, cp, copyFile } from "node:fs/promises";
import { join, basename, dirname, resolve as pathResolve } from "node:path";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";

const WORKTREE_BASE = process.env.OPENCODE_WORKTREE_BASE
  || join(process.env.HOME || process.env.USERPROFILE || "~", ".local", "share", "opencode", "worktree");

const STATE_DIR = join(WORKTREE_BASE, ".state");

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

function projectIdFromPath(projectPath) {
  const normalized = projectPath.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts.slice(-2).join("-").replace(/[^a-zA-Z0-9_-]/g, "-");
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

    const worktreeId = "wt-oc-" + repoId + "-" + branch.replace(/[^a-zA-Z0-9_-]/g, "-");
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
      source: "opencode-worktree-plugin",
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

    await writeFile(recordPath, JSON.stringify(record, null, 2) + "\n", "utf8");
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
      if (event.type === "session.create" || event.type === "session.delete") {
        const sessionId = (event.properties && event.properties.sessionID) || "unknown";
        console.log("[worktree] " + event.type + " session=" + sessionId + " worktree=" + (worktree || "none") + " project=" + projectId);
      }
    },
  };
};

export default WorktreePlugin;
