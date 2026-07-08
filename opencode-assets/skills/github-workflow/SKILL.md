---
name: github-workflow
description: "Reliable GitHub operations via gh CLI. Use when creating PRs, monitoring CI, managing issues, or performing any GitHub operation. Ensures auth is valid before operations, prevents interactive prompt hangs, and provides proper gh command patterns. Triggers on: github, pull request, pr create, pr merge, ci status, github actions, gh cli, gh auth, create pr, merge pr, github workflow."
triggers:
  - github
  - pull request
  - pr create
  - pr merge
  - ci status
  - github actions
  - gh cli
  - gh auth
  - create pr
  - merge pr
  - github workflow
---

# GitHub Workflow via gh CLI

## Purpose

Provide reliable GitHub operations through the `gh` CLI. The agent must verify
authentication before any GitHub operation, prevent interactive prompt hangs,
and use proper `gh` command patterns for PRs, CI, issues, and releases.

## When to use

Load this skill when the task involves any GitHub operation: creating or
merging pull requests, monitoring CI runs, managing issues, creating releases,
or checking GitHub auth status.

## Auth Preflight (Critical)

Before ANY GitHub operation, verify the environment:

### 1. Check gh installed

```bash
gh --version
```

If not installed, install before proceeding:
- Windows: `winget install GitHub.cli`
- macOS: `brew install gh`
- Linux (Debian/Ubuntu): `sudo apt install gh`

### 2. Check authentication

```bash
gh auth status
```

If authenticated, proceed. If not, resolve via Auth Setup below.

### 3. Prevent interactive hangs

Before running any `gh` command, set:

```bash
export GH_PROMPT_DISABLED=1
```

This prevents `gh` from launching interactive prompts that hang the agent.

## Auth Setup

Three paths to authentication, in order of reliability:

### Path 1: GH_TOKEN env var (most reliable)

If a GitHub personal access token is available:

```bash
export GH_TOKEN="ghp_xxxxxxxxxxxx"
```

Takes highest precedence over stored credentials. Non-interactive. Best for
automation and headless environments. Minimum scopes: `repo`, `read:org`, `gist`.

To derive from existing gh auth:

```bash
export GH_TOKEN=$(gh auth token)
```

### Path 2: Device flow (interactive, one-time)

If no token is available and a browser is accessible:

```bash
gh auth login
```

When prompted, select "GitHub.com" → "Login with a web browser" → copy the
8-character code → visit https://github.com/login/device → enter the code.

After this one-time setup, `gh` stores credentials in the system credential
store and all subsequent operations work non-interactively.

### Path 3: Web flow (if terminal supports it)

```bash
gh auth login --web
```

Opens the default browser for OAuth. Only works when a browser is available.

### Verification

After auth setup, confirm:

```bash
gh auth status
gh api user --jq .login
```

## PR Workflow

### Create PR

```bash
# Auto-fill title and body from commits
gh pr create --fill

# Explicit title and body
gh pr create --title "feat: add auth" --body "Adds OAuth support"

# Explicit base and head branches
gh pr create --fill --base main --head feature/auth
```

Always return the PR URL after creation.

### View PR

```bash
# PR for current branch
gh pr view

# Specific PR
gh pr view 123

# PR diff
gh pr diff

# PR checks (CI status)
gh pr checks
```

### Merge PR

```bash
# Default merge strategy
gh pr merge

# Squash merge
gh pr merge --squash

# Rebase merge
gh pr merge --rebase

# Delete branch after merge
gh pr merge --delete-branch

# Combine: squash + delete branch
gh pr merge --squash --delete-branch
```

Never merge without explicit user confirmation. Always check CI status first:

```bash
gh pr checks  # verify all checks pass before merging
```

## CI Monitoring

### List recent runs

```bash
gh run list --limit 10
```

### View run details

```bash
# Run summary
gh run view <run-id>

# Full logs
gh run view <run-id> --log

# Failed logs only
gh run view --log-failed
```

### Watch run until completion

```bash
gh run watch <run-id>
```

### Check PR CI status

```bash
gh pr checks
```

## Issue Management

```bash
# Create issue
gh issue create --title "Bug: auth fails" --body "Description..."

# List open issues
gh issue list --state open

# View issue
gh issue view 456
```

## Release Management

```bash
# Create release from tag
gh release create v1.0.0 --title "v1.0.0" --notes "Release notes"

# List releases
gh release list

# View release
gh release view v1.0.0
```

## Safety Rules

- Never push without explicit user request
- Never force-push without explicit confirmation
- Never merge without explicit confirmation
- Always check CI (`gh pr checks`) before suggesting merge
- Always return PR URL after creation
- Set `GH_PROMPT_DISABLED=1` before any `gh` command to prevent hangs

## Error Recovery

| Error | Cause | Fix |
|---|---|---|
| `gh: command not found` | gh not installed | Install: `winget install GitHub.cli` (Win) / `brew install gh` (Mac) / `sudo apt install gh` (Linux) |
| `authentication required` | not authenticated | Run Auth Setup (device flow or GH_TOKEN) |
| `could not resolve host` | no network or wrong remote | Check network; verify `git remote -v` |
| `no git remote` | remote not configured | `git remote add origin <url>` |
| `no upstream` | branch not pushed yet | `git push -u origin <branch>` |
| `gh pr create` fails with no commits | branch has no commits ahead of base | Ensure commits exist: `git log main..HEAD` |
| `gh pr create` fails with base mismatch | wrong base branch | Use `--base <branch>` to specify correct base |
| Interactive prompt hangs | `GH_PROMPT_DISABLED` not set | Set `export GH_PROMPT_DISABLED=1` before running `gh` |
| `permission denied` | token lacks required scopes | Re-auth with `gh auth login` or use token with `repo`, `read:org`, `gist` scopes |
| `gh run view` fails | run ID invalid or expired | Use `gh run list` to find valid run IDs |
