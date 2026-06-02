import { tool } from "@opencode-ai/plugin/tool";
import { mkdir, rm, readFile, readdir, stat } from "node:fs/promises";
import { join, basename } from "node:path";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";

const WORKTREE_BASE = process.env.OPENCODE_WORKTREE_BASE
  || join(process.env.HOME || process.env.USERPROFILE || "~", ".local", "share", "opencode", "worktree");

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

async function detectSetup(worktreePath) {
  const setup = [];
  if (existsSync(join(worktreePath, "package.json"))) setup.push("npm install");
  if (existsSync(join(worktreePath, "Cargo.toml"))) setup.push("cargo build");
  if (existsSync(join(worktreePath, "go.mod"))) setup.push("go mod download");
  if (existsSync(join(worktreePath, "requirements.txt"))) setup.push("pip install -r requirements.txt");
  if (existsSync(join(worktreePath, "pyproject.toml"))) setup.push("poetry install");
  return setup;
}

function runCommand(cmd, cwd) {
  return new Promise((resolve, reject) => {
    execFile("cmd", ["/c", cmd], { cwd, timeout: 60000 }, (err, stdout, stderr) => {
      if (err) reject(new Error("Command failed: " + (stderr || err.message)));
      else resolve(stdout.trim());
    });
  });
}

async function syncFiles(fromDir, toDir, patterns) {
  if (!patterns || !Array.isArray(patterns) || patterns.length === 0) return;
  for (const pattern of patterns) {
    const src = join(fromDir, pattern);
    if (existsSync(src)) {
      try {
        const srcStat = await stat(src);
        const dest = join(toDir, pattern);
        if (srcStat.isDirectory()) {
          await runCommand("xcopy \"" + src + "\" \"" + dest + "\" /E /I /Y /Q", fromDir);
        } else {
          await runCommand("copy \"" + src + "\" \"" + dest + "\" /Y", fromDir);
        }
      } catch {
        // non-critical, skip
      }
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

export const WorktreePlugin = async ({ project, directory, worktree }) => {
  const projectPath = (project && project.path) || directory;
  const projectId = projectIdFromPath(projectPath);

  return {
    tool: {
      worktree_create: tool({
        description: "Create a new git worktree for isolated work. The worktree shares the same git repository but works on a separate branch in a separate directory. Use this before starting feature work that needs isolation.",
        args: {
          branch: tool.schema.string().describe("Branch name for the worktree (e.g. 'feature/auth')"),
          baseBranch: tool.schema.string().optional().describe("Base branch to create from (defaults to current branch)"),
        },
        async execute(args, ctx) {
          const branch = args.branch.replace(/[^a-zA-Z0-9_/-]/g, "-");
          const baseBranch = args.baseBranch || "HEAD";
          const worktreePath = join(WORKTREE_BASE, projectId, branch);

          if (existsSync(worktreePath)) {
            return "Worktree already exists at " + worktreePath + ". Use worktree_delete first if you want to recreate it.";
          }

          await mkdir(worktreePath, { recursive: true });

          try {
            await runGit(["worktree", "add", "-b", branch, worktreePath, baseBranch], projectPath);
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

          const setup = await detectSetup(worktreePath);
          if (setup.length > 0) {
            ctx.metadata({ title: "Running setup: " + setup.join(", ") });
            for (const cmd of setup) {
              try {
                await runCommand(cmd, worktreePath);
              } catch {
                // setup command failed, continue
              }
            }
          }

          return {
            output: "Worktree created at " + worktreePath + "\nBranch: " + branch + "\nBase: " + baseBranch,
            metadata: {
              worktreePath: worktreePath,
              branch: branch,
              baseBranch: baseBranch,
              projectId: projectId,
            },
          };
        },
      }),

      worktree_list: tool({
        description: "List all git worktrees for the current project. Shows path, branch, and status for each worktree.",
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

            const formatted = entries.map(function(e) {
              const parts = ["  " + e.path];
              if (e.branch) parts.push("[" + e.branch + "]");
              if (e.detached) parts.push("[detached]");
              if (e.bare) parts.push("[bare]");
              return parts.join(" ");
            });

            return "Worktrees for " + basename(projectPath) + ":\n" + formatted.join("\n");
          } catch (err) {
            return "Failed to list worktrees: " + err.message;
          }
        },
      }),

      worktree_delete: tool({
        description: "Remove a git worktree. By default does NOT auto-commit; use commitBeforeDelete=true to commit pending changes before removal. Use this to clean up after finishing work in an isolated worktree.",
        args: {
          branch: tool.schema.string().describe("Branch name of the worktree to remove"),
          force: tool.schema.boolean().optional().describe("Force removal even with uncommitted changes"),
          commitBeforeDelete: tool.schema.boolean().optional().describe("If true, auto-commit pending changes before removal (default: false)"),
        },
        async execute(args, ctx) {
          const branch = args.branch.replace(/[^a-zA-Z0-9_/-]/g, "-");
          const worktreePath = join(WORKTREE_BASE, projectId, branch);

          if (!existsSync(worktreePath)) {
            return "No worktree found at " + worktreePath;
          }

          if (args.commitBeforeDelete) {
            try {
              const status = await runGit(["status", "--porcelain"], worktreePath);
              if (status) {
                ctx.metadata({ title: "Auto-committing changes before removal" });
                await runGit(["add", "-A"], worktreePath);
                try {
                  await runGit(["-c", "user.name=opencode-worktree", "-c", "user.email=opencode@local", "commit", "-m", "auto-commit: worktree cleanup for " + branch], worktreePath);
                } catch (commitErr) {
                  // commit failed (empty tree or config issue), skip
                }
              }
            } catch {
              // no changes or git error, continue with removal
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

            return "Worktree " + branch + " removed successfully.";
          } catch (err) {
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
