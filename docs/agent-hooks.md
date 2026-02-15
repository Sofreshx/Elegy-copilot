# Agent Hooks Guide

This repo provides **opt-in** Copilot agent hook templates under `.github/templates/` with scripts under `scripts/hooks/`.
Hooks are disabled by default to avoid interfering with Ask mode. Enable them only for Exec3 or other automation sessions.

## What Hooks Do
- Create JSONL audit logs in `.instructions-output/hooks/`
- Enforce policy gates (no secrets in `.env*`, production access is read-only unless explicitly approved)
- Enforce hang-prevention for terminal commands (non-zero timeouts, no background, no watch/interactive test modes)
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
