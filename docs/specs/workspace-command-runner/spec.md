---
spec_id: workspace-command-runner
title: Workspace Command Runner
status: implemented
type: feature
updated: 2026-07-31
---

# Workspace Command Runner

## Intent

Make the copilot-ui Workspace Execute tab a practical per-repository command runner: deterministically discover the key commands of an opened repository (README quickstart commands, package.json scripts, Makefile targets), categorize them with the most important actions first, run background dependency setup so commands are actually runnable, and execute/stop commands with live output — all without LLM inference and without a shell.

## Context Evidence

- `copilot-ui/ui/src/views/Workspace/WorkspaceExecutionTab.tsx`: The Execute tab today is an orchestrator-session UI over a stub backend (`copilot-ui/routes/orchestrator.js` returns `ok: false` / 503), so the tab is effectively useless in the default runtime.
- `docs/system/orchestrator-architecture-adr.md`: The ADR (implementation removed) declares the Execute tab the sole UI owner for execution (sections on UI ownership and boundaries); no second tab may be introduced. The new commands surface must live inside the existing tab.
- `copilot-ui/routes/workspace.js:123-143`: `detectPackageScripts` already extracts package.json scripts; `validateCommand`/`validateCwd` (workspace.js:40,58) define the shell-metacharacter blocklist and cwd jail reused for safe spawn.
- No backend service reads README content today (verified by search); `copilot-ui/lib/pinnedCommands.js` already models doc-sourced commands (`sourceDocPath`, `sourceBlockId`).
- `copilot-ui/lib/catalogProjectionService.js:593`: `getRepoStateKey(repoPath)` derives the per-repo state id used under `~/.elegy/repo-state/<repoId>/`.
- `copilot-ui/tests/api-contract.test.js` + `api-contract.snapshot.json` + `api-route-registry.snapshot.json`: new routes must be added to the snapshot (regenerated with `UPDATE_API_SNAPSHOT=1`).
- `docs/system/copilot-ui-guide.md`: canonical doc for the copilot-ui runtime and Workspace tabs; must stay current.

## Requirements

### Allowed Behavior

- Deterministic, LLM-free discovery of runnable commands for an opened repository from: README-style docs (README.md/README, CONTRIBUTING.md, GETTING_STARTED.md), package.json scripts, and Makefile targets.
- Categorized output with fixed group ordering — Setup (when present), Start/Dev, Test, Lint/Check, Build, Docs, Other — with key commands first.
- README commands that match a package.json script dedupe to the package.json variant as canonical; README-only commands keep source refs (doc path + line).
- Background dependency setup: detection of an install command (`npm install`, `pnpm install`, `bundle install`, `pip install -r`, `uv sync`, `poetry install`, `cargo build`, `make install`, ...), one-click start, persisted per-repo status.
- Command execution with run/stop: short commands report exit code + capped output; long-running commands (dev/docs servers) stream a live output tail and can be stopped; one active run per repository.
- Persisted discovery cache and last-run outcomes under `~/.elegy/repo-state/<repoId>/execution/`, invalidated by source-file mtime changes.

### Forbidden Behavior

- Executing any command containing shell metacharacters or escaping the repository root (reuse the workspace.js validation rules).
- Using an LLM or any non-deterministic source for command discovery or classification.
- Auto-running dependency setup without an explicit user action.
- Introducing a second Execution tab or moving the orchestrator surface out of the existing tab.
- Modifying the orchestrator backend stub or the existing `/api/workspace/commands*` routes.
- Writing to or mutating the repository during discovery.

### R1 — Deterministic command discovery

- `copilot-ui/lib/commandDiscovery.js` MUST expose a pure `discover(repoRoot)` function returning `{ schemaVersion, detectedAt, sources, setup, categories, commands }`.
- Doc sources (README.md, README, CONTRIBUTING.md, GETTING_STARTED.md) MUST be scanned for fenced code blocks (bash/shell/console/zsh/sh/ps/powershell languages) and lines prefixed with `$ `.
- Candidate lines MUST be filtered: comments, `echo`, `ls`, bare `cd`, `export` alone, editor invocations, and line continuations are ignored.
- A candidate MUST be runnable only if its first segment passes the workspace.js command/args validation rules; candidates with shell metacharacters are skipped and counted in `meta.skipped`.
- package.json scripts MUST be mapped to categories by script name via a deterministic classifier table (dev/start/serve/watch/preview/storybook, test, lint/typecheck/check/format, build, docs/doc, install/setup; everything else → Other).
- Makefile targets MUST be extracted and classified by target name using the same classifier vocabulary.
- Dedupe key MUST be the normalized (command, args) pair; the package.json variant wins, README/Makefile duplicates are dropped, and README-only commands MUST carry `source: { docPath, line }`.

### R2 — Categorization and ordering

- Group order MUST be fixed: Setup, Start/Dev, Test, Lint/Check, Build, Docs, Other.
- Within a group, package.json scripts sort before Makefile targets before README-only commands, then by stable name.
- Commands classified into Start/Dev, Docs, or known server classes (serve/watch/preview/storybook/docs:dev) MUST be flagged `longRunning: true`.

### R3 — Background setup

- Discovery MUST produce at most one `setup` entry per repo by matching known install verbs (`install`, `setup`, `bootstrap`, `sync`, `build` for cargo/make) across the same sources.
- The Execute tab MUST render a Setup card with status (`not-started` | `running` | `done` | `failed`) and a Run Setup / Re-run button; setup runs in the background through the same run registry as commands.
- Setup state MUST persist per repo under `~/.elegy/repo-state/<repoId>/execution/` so restarts do not forget a completed install.

### R4 — Run/stop API

- New route module `copilot-ui/routes/execution.js` registered in `routes/index.js`:
  - `GET /api/execution/overview?repoPath=` — cached discovery + setup status + active run + last-run map
  - `POST /api/execution/refresh` — re-run discovery, persist cache, return result
  - `POST /api/execution/run` — start a discovered command, return `runId`
  - `POST /api/execution/setup` — start the setup command (404 when none)
  - `GET /api/execution/runs/:runId` — status, exit code, capped stdout/stderr, timestamps
  - `POST /api/execution/runs/:runId/stop` — terminate the process tree
- Only commands returned by discovery are runnable via `POST /api/execution/run`.
- At most one active run per repository; a second start MUST return 409.
- Spawn MUST use `shell: false` with the workspace.js command/cwd validation rules; output ring buffer capped (~50k chars).
- Run registry MAY be in-memory (runs are not durable across server restarts); last-run outcomes (`lastRunAt`, `lastExitCode`) MUST persist per command id.

### R5 — Execute tab composition

- `WorkspaceExecutionTab.tsx` MUST keep the existing orchestrator-session surface, but move it below the new commands surface in a collapsible section; its controls are disabled when `health.pilot.enabled` is false.
- The commands surface MUST show: header with repo label and scan timestamp, Setup card, ordered command groups with per-row Run/Stop, description, source badge, and last exit code, and an expandable output area with live tail while running.
- The tab MUST poll an active run's status while running and refresh discovery on mount; a manual Refresh button MUST re-run discovery.
- Empty state MUST show a guidance message when no commands are found.

### R6 — Persistence

- Discovery cache and last-run outcomes MUST live under `~/.elegy/repo-state/<repoId>/execution/` (`discovery.json`, `runs.json`).
- Cache MUST be invalidated when any scanned source file's mtime changes; `GET /api/execution/overview` MUST re-run discovery on stale cache or missing cache.
- File writes MUST be atomic (tmp + rename), matching the `pinnedCommands.js` pattern.

## Non-Goals

- PTY / interactive terminal; a real terminal emulator is out of scope (run output is a buffered tail).
- Executing shell-metacharacter commands or shell pipelines (`&&`, `|`, redirects, variable expansion).
- Monorepo workspace discovery (only repo-root package.json, docs, and Makefile are scanned in v1).
- Binary availability probing (e.g., `which npm`) — v1 shows commands even when the binary may be missing.
- Auto-install on repo open; setup always requires an explicit user action.
- Changes to the orchestrator backend (`copilot-ui/routes/orchestrator.js`) or the existing `/api/workspace/commands*` routes.
- A second Execution tab or moving execution out of the Workspace.
- Any mutation of the repository during discovery.

## Acceptance Checks

- Discovery classifies, dedupes, and orders fixture repos deterministically
  → verify: `node --test copilot-ui/lib/commandDiscovery.test.js` — fixture READMEs (dev server, tests, docs, install commands), package.json scripts, and Makefile targets produce the fixed group order (Setup, Start/Dev, Test, Lint/Check, Build, Docs, Other), package.json wins dedupe, README-only commands carry `source` refs, and shell-metachar candidates are skipped

- Setup detection returns at most one entry across sources
  → verify: `node --test copilot-ui/lib/commandDiscovery.test.js` — fixtures with `npm install`, `bundle install`, `make install`, and `cargo build` each yield a single `setup` entry; no fixture yields more than one

- Execution routes validate, run, stop, and enforce one active run per repo
  → verify: `node --test copilot-ui/routes/execution.test.js` — overview/refresh/run/setup/stop with fake ctx: shell-meta command rejected 403, unknown command 404, missing setup 404, second concurrent run 409, stop terminates and returns final status

- New routes appear in the API contract snapshot with intended-only diff
  → verify: `UPDATE_API_SNAPSHOT=1 node copilot-ui/tests/api-contract.test.js` then `git diff copilot-ui/tests/api-contract.snapshot.json copilot-ui/tests/api-route-registry.snapshot.json` — diff contains only the new execution routes

- Execute tab renders commands, setup, and run/stop flows
  → verify: `npm run vitest` (copilot-ui) — `workspace-execution-tab.vitest.tsx` covers: setup card statuses, grouped command rows with source badges, run → polling → completed with exit code, stop action for long-running commands, orchestrator section rendered below the commands list

- UI integration checks pass
  → verify: `npm run ui:check`

- Spec document passes strict validation
  → verify: `node scripts/validate-specs.js --strict docs/specs/workspace-command-runner/spec.md`

## Implementation Links

- `docs/specs/workspace-command-runner/spec.md` (this file)
- `docs/specs/workspace-command-runner/plan.md` (implementation plan)
- `copilot-ui/lib/commandDiscovery.js` (new)
- `copilot-ui/lib/executionRunner.js` (new)
- `copilot-ui/routes/execution.js` (new) + registration in `copilot-ui/routes/index.js`
- `copilot-ui/ui/src/lib/api/execution.ts` (new)
- `copilot-ui/ui/src/views/Workspace/WorkspaceExecutionTab.tsx` (rework)
- `copilot-ui/ui/src/app.css` (workspace-execution styles)
- `copilot-ui/tests/api-contract.test.js` + snapshots
- `copilot-ui/lib/commandDiscovery.test.js`, `copilot-ui/routes/execution.test.js`, `copilot-ui/tests/workspace-execution-tab.vitest.tsx`
- `docs/system/copilot-ui-guide.md`
- `docs/system/orchestrator-architecture-adr.md` (stale placeholder description fix only)

## Validation Evidence

- 2026-07-31: Backend — `node --test copilot-ui/lib/commandDiscovery.test.js copilot-ui/routes/execution.test.js copilot-ui/routes/workspace.test.js` → 100/100 pass; `node --test copilot-ui/tests/api-contract.test.js` → pass (snapshots regenerated with `UPDATE_API_SNAPSHOT=1`; route inventory 158 → 164 with the six execution routes).
- 2026-07-31: Frontend — `npm --prefix copilot-ui run test:vitest -- workspace-execution-tab` → 21/21 pass; `npm run quality:typecheck` → clean; `npm run ui:check` → all suites PASS (settings, catalog, repositories, workspace, workspace-git, workspace-checks, workspace-assets); `npm --prefix copilot-ui test` → 58 files / 519 tests pass.
- 2026-07-31: Docs — `npm run docs:check:links` → OK (162 files); `node scripts/validate-specs.js --strict docs/specs/workspace-command-runner/spec.md` → specs ok.

## Drift Notes

- None.
