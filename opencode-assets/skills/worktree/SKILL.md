---
name: worktree
description: Use when starting feature work that needs isolation from the current workspace - creates isolated git worktrees with automatic project setup
triggers:
  - worktree
  - isolated workspace
  - parallel work
  - feature branch isolation
---

# Git Worktree Isolation

## Overview

Git worktrees create isolated workspaces sharing the same repository, allowing work on multiple branches simultaneously without switching.

**Announce at start:** "I'm using the worktree skill to set up an isolated workspace."

## Available Tools

Three worktree tools are available via the worktree plugin:

### worktree_create

Creates a new git worktree for isolated work.

**Parameters:**
- `branch` (required): Branch name for the worktree (e.g. `feature/auth`)
- `baseBranch` (optional): Base branch to create from (defaults to current checkout HEAD)
- `runSetup` (optional): If true, run detected setup commands (npm install, etc.). Default: false — only detect and report.

**Example:** Create a worktree branching from current HEAD:
```
worktree_create(branch: "feature/auth")
```

**Example:** Create a worktree from a specific base:
```
worktree_create(branch: "feature/auth", baseBranch: "main")
```

### worktree_list

Lists all git worktrees for the current project. Shows active worktree branch, base branch, path existence, and cleanup readiness. No parameters needed.

### worktree_delete

Removes a git worktree. Does NOT auto-commit. Dirty worktrees require `force: true`. Stage and commit changes manually before deletion if needed.

**Parameters:**
- `branch` (required): Branch name of the worktree to remove
- `force` (optional): Force removal even with uncommitted changes — discards changes (default: false)

**Example — clean removal:**
```
worktree_delete(branch: "feature/my-feature")
```

**Example — force removal of dirty worktree (discards changes):**
```
worktree_delete(branch: "feature/my-feature", force: true)
```

## Workflow

### 1. Create Worktree

```bash
# Use the worktree_create tool
worktree_create(branch: "feature/my-feature")
```

The tool will:
- Create a git worktree at `~/.local/share/opencode/worktree/<project>/<branch>`
- Create a new branch from the current checkout HEAD (or explicit baseBranch)
- Copy any files listed in `.opencode/worktree.json` (syncFiles config) using Node filesystem APIs
- Detect setup commands (npm install, cargo build, etc.) and report them — does NOT run them by default
- Write a compatible record into the shared Elegy Copilot worktree registry (when discoverable)

### 2. Work in Isolation

All changes in the worktree are isolated from your main checkout. The worktree shares the same git history but has its own working directory.

**Git workflow in the worktree:**
- Make small, targeted commits: inspect diff, stage intended files only, propose commit message, wait for approval
- Never auto-push, auto-merge, or delete branches without explicit user approval

### 3. Clean Up

When done with the worktree:

```bash
# List worktrees to find the one to remove
worktree_list()

# Remove a clean worktree
worktree_delete(branch: "feature/my-feature")

# If worktree has uncommitted changes, commit or stash first, then:
worktree_delete(branch: "feature/my-feature")

# Or force removal to discard uncommitted changes:
worktree_delete(branch: "feature/my-feature", force: true)
```

## Configuration

Create `.opencode/worktree.json` in your project root to customize behavior:

```json
{
  "syncFiles": [".env", ".env.local", "config/local.json"]
}
```

Files listed in `syncFiles` will be copied from the main checkout to new worktrees using Node filesystem copy APIs (cross-platform, no shell commands).

## Environment Variables

The worktree plugin injects these env vars into all shell commands:

- `OPENCODE_WORKTREE_BASE`: Base directory for all worktrees
- `OPENCODE_PROJECT_ID`: Project identifier derived from path
- `OPENCODE_WORKTREE_PATH`: Current worktree path (when in a worktree)
- `OPENCODE_WORKTREE_ROOT`: Same as WORKTREE_PATH

## Shared Registry

The plugin writes compatible records into the Elegy Copilot shared worktree registry at `<copilotHome>/repo-state/<repoId>/worktrees/` when the Elegy Copilot home directory is discoverable. This provides durable visibility for the dashboard, executor, and session coordination.

The plugin-local state at `<WORKTREE_BASE>/.state/<project-id>.json` is auxiliary only — it caches branch and session metadata for the OpenCode plugin. The shared registry is the durable authority.

## Safety

- Worktrees are created under `~/.local/share/opencode/worktree/<project>/`
- Each worktree branches from current checkout HEAD by default (not from a previous feature branch)
- Uncommitted changes are NOT auto-committed before deletion by default
- Dirty worktrees require `force: true` for removal (discards changes)
- The main checkout is never modified
- Setup commands are detected but not run by default

## Common Mistakes

### Skipping isolation for feature work
- **Problem:** Changes pollute the main checkout, making it hard to context-switch
- **Fix:** Always create a worktree before starting feature work

### Forgetting to clean up worktrees
- **Problem:** Disk usage grows with abandoned worktrees
- **Fix:** Use `worktree_list()` periodically and `worktree_delete()` when done

### Not configuring syncFiles
- **Problem:** Missing environment variables or config files in the worktree
- **Fix:** Add needed files to `.opencode/worktree.json` syncFiles array
