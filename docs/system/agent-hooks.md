---
created: 2026-02-23
updated: 2026-02-23
category: system
status: current
doc_kind: node
id: agent-hooks
summary: How to use opt-in Copilot agent hooks in this repo, including safety and hang-prevention policies.
tags: [hooks, safety]
---

# Agent Hooks Guide

This repo provides **opt-in** Copilot agent hook templates under `.github/templates/` with scripts under `scripts/hooks/`.
Hooks are disabled by default to avoid interfering with Ask mode. Enable them only for Exec3 or other automation sessions.

## What Hooks Do
- Create JSONL audit logs in `.instructions-output/hooks/`
- Enforce policy gates (no secrets in `.env*`, production access is read-only unless explicitly approved)
- Enforce hang-prevention for terminal commands (non-zero timeouts, no background, no watch/interactive test modes)
- Enforce a baseline command safety policy (deny a small set of high-risk git/GitHub/OS commands to reduce accidental data loss)
- Optionally start or stop local infrastructure via repo-local scripts

## How To Enable In Another Repo
1. Copy `.github/templates/hooks.bash.json` or `.github/templates/hooks.powershell.json` to `.github/hooks/<name>.json` in the target repo.
2. Copy `scripts/hooks/` into the target repo.
3. Commit to the default branch. Copilot coding agent only loads hooks from the default branch.

### Quick enable scripts (from instruction-engine)
- PowerShell: `pwsh ./scripts/enable-agent-hooks.ps1 -TargetRepo <path>`
- Bash: `./scripts/enable-agent-hooks.sh <path> bash`

Note: Hook enforcement applies to `execute/runInTerminal` (and compatible legacy tool names).

If your environment does not have PowerShell, use the bash template to avoid `spawn powershell.exe ENOENT` errors.

## Logs
Logs are JSON Lines files:
- `.instructions-output/hooks/session.jsonl`
- `.instructions-output/hooks/prompts.jsonl`
- `.instructions-output/hooks/pre-tool-use.jsonl`
- `.instructions-output/hooks/post-tool-use.jsonl`
- `.instructions-output/hooks/errors.jsonl`

## Optional Infra Start/Stop
Hooks can call repo-local scripts if these env vars are set:
- `HOOK_START_INFRA=1` -> runs `scripts/hooks/session-start.local.(sh|ps1)` if present
- `HOOK_STOP_INFRA=1` -> runs `scripts/hooks/session-end.local.(sh|ps1)` if present

Keep these scripts fast and deterministic. They should only start or stop local services.

## Production Access Policy
Pre-tool hooks will deny production-related commands unless both are set:
- `ALLOW_PROD_READONLY=1`
- `PROD_APPROVED=1`

Even with approval, commands that look like write operations are blocked. Use MCP tools or manual workflows for production changes.

## Secrets Policy
- Do not store secrets in `.env*` files.
- If a `.env*` edit looks like it contains secrets, hooks will deny the change.
- Use GitHub Secrets for CI and local secret storage (OS keychain, dotnet user-secrets, or environment variables set outside the repo).

## Baseline Command Safety Policy (deny list)
These hooks add a **small, conservative deny list** for commands that are frequently destructive (data loss, history rewrite, repo deletion) and are rarely needed in automated agent runs.
This is intentionally **not** a general “block all deletes” policy — common dev/test commands should continue to work.

### Denied git / GitHub CLI commands (high-risk)
- `git push ...` (includes `--force`, `--force-with-lease`, etc.) — **see CI Push Exception below**
- `git reset --hard ...`
- `git clean -fdx ...` (or equivalent flag combinations that include `-f`, `-d`, and `-x`)
- `git checkout -f ...` / `git switch -f ...` (or `--force`)
- `git rebase --onto ...` and interactive rebases (`git rebase -i` / `--interactive`)
- `gh repo delete ...`

### CI Push Exception (`ALLOW_CI_PUSH`)
When the environment variable `ALLOW_CI_PUSH=1` is set for a session, `git push` is allowed for
branches matching these safe prefixes:
- `ci-fix/*` — automated CI repair branches
- `revert/*` — automated release revert branches
- `autofix/*` — other automated fix branches

**Constraints:**
- Force-push (`--force`, `--force-with-lease`, `--force-if-includes`, `-f`) remains **unconditionally denied** even with `ALLOW_CI_PUSH=1`.
- The push target must include a remote and a branch matching the safe prefix (e.g., `git push origin ci-fix/repo-ci-lockfile`).
- Set `ALLOW_CI_PUSH=1` only for CI watcher sessions, not globally across all sessions.

### Denied destructive OS commands (obvious “break the machine” cases)
- `rm -rf /`, `rm -rf /*`, `rm -rf ~`, `rm -rf ~/*`
- `shutdown`, `reboot`, `poweroff`, `halt`
- `dd ...`, `mkfs* ...`, `format ...`, `diskpart ...`
- `Remove-Item -Recurse -Force C:\` (and similar root-drive deletes)
- `rmdir /s /q C:\` / `rd /s /q C:\`
- `del /s /q C:\` / `erase /s /q C:\`

### Explicitly allowed examples (should pass baseline policy)
- `git status`, `git diff`, `git log`, `git show`
- `npm test`
- `dotnet test --no-restore`
- `npx playwright test` (non-UI; `--ui` is denied by the anti-hang policy)

### Quick reasoning proof (examples)
The pre-tool-use hook only outputs JSON when it **denies** a command; allowed commands produce no output.
Examples:
- ✅ Allowed: `git status` (no output)
- ✅ Allowed: `git push origin ci-fix/lockfile-update` (when `ALLOW_CI_PUSH=1`)
- ❌ Denied: `git push origin main` (outputs `{"permissionDecision":"deny",...}` with a "High-risk git command" reason)
- ❌ Denied: `git push origin ci-fix/foo --force` (force-push denied even with `ALLOW_CI_PUSH=1`)
- ❌ Denied: `git push origin ci-fix/foo` (when `ALLOW_CI_PUSH` is unset)
