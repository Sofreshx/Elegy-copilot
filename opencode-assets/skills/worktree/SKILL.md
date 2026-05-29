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
- `baseBranch` (optional): Base branch to create from (defaults to current branch)

**Example:** Create a worktree for auth feature work:
```
worktree_create(branch: "feature/auth")
```

### worktree_list

Lists all git worktrees for the current project. No parameters needed.

### worktree_delete

Removes a git worktree. Auto-commits uncommitted changes before removal.

**Parameters:**
- `branch` (required): Branch name of the worktree to remove
- `force` (optional): Force removal even with uncommitted changes

## Workflow

### 1. Create Worktree

```bash
# Use the worktree_create tool
worktree_create(branch: "feature/my-feature")
```

The tool will:
- Create a git worktree at `~/.local/share/opencode/worktree/<project>/<branch>`
- Create a new branch from the current HEAD
- Copy any files listed in `.opencode/worktree.json` (syncFiles config)
- Auto-detect and run project setup (npm install, cargo build, etc.)

### 2. Work in Isolation

All changes in the worktree are isolated from your main checkout. The worktree shares the same git history but has its own working directory.

### 3. Clean Up

When done with the worktree:

```bash
# List worktrees to find the one to remove
worktree_list()

# Remove the worktree (auto-commits uncommitted changes)
worktree_delete(branch: "feature/my-feature")
```

## Configuration

Create `.opencode/worktree.json` in your project root to customize behavior:

```json
{
  "syncFiles": [".env", ".env.local", "config/local.json"]
}
```

Files listed in `syncFiles` will be copied from the main checkout to new worktrees.

## Environment Variables

The worktree plugin injects these env vars into all shell commands:

- `OPENCODE_WORKTREE_BASE`: Base directory for all worktrees
- `OPENCODE_PROJECT_ID`: Project identifier derived from path
- `OPENCODE_WORKTREE_PATH`: Current worktree path (when in a worktree)
- `OPENCODE_WORKTREE_ROOT`: Same as WORKTREE_PATH

## Safety

- Worktrees are created under `~/.local/share/opencode/worktree/<project>/`
- Each worktree gets its own branch
- Uncommitted changes are auto-committed before deletion
- The main checkout is never modified

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
