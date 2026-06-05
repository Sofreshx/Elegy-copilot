---
spec_id: align-elegy-db-assets
title: Align Elegy Planning DB, Assets, and OpenCode/Codex Status
status: draft
type: workflow
updated: 2026-06-03
---

# Align Elegy Planning DB, Assets, and OpenCode/Codex Status

## Intent

Fix three misalignment issues in the Elegy Copilot control plane:
1. Planning records exist in the legacy `~/.elegy/planning.db` but not in the canonical Copilot DB `~/.copilot/elegy-planning.db`
2. The OpenCode/Codex status route uses broken CLI detection (`--version` fails; should use `health --json` + feature checks) and raw `process.env` instead of `ctx.env`
3. Codex `skills/elegy-planning/SKILL.md` is missing, and a TypeScript type mismatch blocks typecheck

## Context Evidence

- `copilot-ui/routes/opencode.js:430-447` — `resolvePlanningVersion()` calls `elegy-planning --version` which errors (CLI does not support `--version`; use `health --json`)
- `copilot-ui/routes/opencode.js:15` — `TOOLING_INSTALL_KINDS` does NOT include `'install-codex-planning'`
- `copilot-ui/routes/opencode.js:346-375` — Codex elegy-planning check uses `process.env` (lines 351, 354) instead of `ctx.env`
- `copilot-ui/routes/toolingUpdates.js:85-113` — `resolvePlanningFeatureStatus()` already checks CLI features via `--help` subcommands (`session`, `project-run`, `search`, `update-status`)
- `copilot-ui/lib/elegyPlanningCliResolver.js` — Full CLI resolver with candidate paths, source build, and download support: `resolveElegyPlanningCliPath()`
- `copilot-ui/src/desktopRuntime/runtimeService.ts:222-231` — Sets `INSTRUCTION_ENGINE_ELEGY_PLANNING_DB_PATH` to `~/.copilot/elegy-planning.db`
- `copilot-ui/ui/src/lib/types.ts:3391` — `OpenCodeToolingInstallKind` already includes `'install-codex-planning'`
- `copilot-ui/ui/src/tabs/OpenCode/OpenCodeView.tsx:346` — TS2367: `actionKind` narrowed to `'install' | 'update'` but compared to `'install-codex-planning'`
- `codex-assets/manifest.json:140-144` — `codex-elegy-planning-skill` asset point maps `catalog-assets/shared-skills/elegy-planning` → `skills/elegy-planning`
- `copilot-ui/lib/codexConfig.js:433-443` — `getPlanningSkillStatus()` checks for `~/.codex/skills/elegy-planning/SKILL.md`
- `copilot-ui/routes/toolingUpdates.js:344-372` — `POST /api/tooling-updates/update/elegy-skills-codex` handles Codex skill install

### Current State (Verified)

| Artifact | Status |
|---|---|
| `~/.elegy/planning.db` | Exists (720KB). Contains `GOAL-COPILOT-GIT-WORKTREE-VALIDATION-20260603` + 5 roadmaps |
| `~/.copilot/elegy-planning.db` | Exists (380KB). Does NOT contain the goal |
| `~/.codex/skills/elegy-planning/SKILL.md` | MISSING |
| `elegy-planning --version` | FAILS (unexpected argument) |
| `elegy-planning health --json` | Works |
| `tsc -p copilot-ui/ui/tsconfig.json --noEmit` | 1 error: TS2367 at OpenCodeView.tsx:346 |

### Canonical Target

| Component | Path |
|---|---|
| CLI binary | `~/.copilot/managed-cli/planning/elegy-planning.exe` |
| Planning DB | `~/.copilot/elegy-planning.db` |
| OpenCode home | `~/.config/opencode` |
| Codex home | `~/.codex` |

## Requirements

### R1 — Migrate Planning Records to Copilot DB

The goal `GOAL-COPILOT-GIT-WORKTREE-VALIDATION-20260603` and its 5 roadmaps MUST exist in `~/.copilot/elegy-planning.db`.

**Acceptance:**
- Back up both `~/.elegy/planning.db` and `~/.copilot/elegy-planning.db` before any writes
- Recreate the goal and roadmaps in the Copilot DB using the `elegy-planning` CLI
- `elegy-planning --db $COPHOME/elegy-planning.db goal show --goal-id GOAL-COPILOT-GIT-WORKTREE-VALIDATION-20260603 --json` returns the goal with 5 roadmaps
- `elegy-planning --db $COPHOME/elegy-planning.db health --json` reports the goal count increment

**Migration procedure:**
1. Back up both DBs to `~/.copilot/backups/` with timestamps
2. Read goal and roadmap data from legacy DB: `elegy-planning --db $LEGACY_DB goal show --goal-id GOAL-COPILOT-GIT-WORKTREE-VALIDATION-20260603 --json`
3. Create goal in Copilot DB: `elegy-planning --db $COPHOME/elegy-planning.db goal create --correlation-id copilot-git-consolidation-20260603 --id GOAL-COPILOT-GIT-WORKTREE-VALIDATION-20260603 --title "..." --description "..." --acceptance "..." --rejection "..."`
4. For each of the 5 roadmaps, create with preserved IDs: `elegy-planning --db $COPHOME/elegy-planning.db roadmap create --goal-id GOAL-COPILOT-GIT-WORKTREE-VALIDATION-20260603 --correlation-id copilot-git-consolidation-20260603 --id <RM-ID> --title "..." --summary "..."`
5. Verify with `goal show --json` that all 5 roadmaps are present
6. If any step fails, abort and restore Copilot DB from backup

**Atomicity:** All-or-nothing. If any `goal create` or `roadmap create` command fails, the Copilot DB MUST be restored from backup and the migration aborted.

### R2 — Fix OpenCode/Codex Status Route

The `routes/opencode.js` status checks MUST use reliable CLI detection and correct context.

**R2.1 — Replace `--version` with `health --json`:**
- `resolvePlanningVersion()` at line 430-447 MUST be replaced with a readiness check that uses `elegy-planning health --json`
- The new function MUST parse the JSON output's `data.schemaVersion` and `data.goalCount` fields
- If `health --json` succeeds, the CLI is considered ready (the specific values are informational)

**R2.1b — Fix duplicate `resolvePlanningVersion` in toolingUpdates.js:**
- `copilot-ui/routes/toolingUpdates.js:35-59` contains a second copy of `resolvePlanningVersion()` that also uses `['--version']`
- This feeds into `/api/tooling-updates/status` (line 152), so it MUST also be replaced with `health --json`
- Implementation choice: either extract a shared `resolvePlanningHealth()` function into a common library, or apply the same fix in both modules
- The shared library approach is preferred to avoid future divergence
- A suitable shared location is `copilot-ui/lib/elegyPlanningHealth.js` (new file), exporting a `resolvePlanningHealth(cliPath, childProcess)` function that runs `health --json`, parses the output, and returns `{ ready: boolean, schemaVersion: string | null, error: string | null }`

**R2.2 — Use `ctx.env` consistently:**
- Lines 351 and 354 in the codex-elegy-planning check (inside `buildSetupChecks`) MUST use `ctx.env` instead of `process.env`
- The `resolveElegyPlanningCliPath()` call MUST pass `env: ctx.env` (not `process.env`)

**R2.3 — Mirror feature checks for readiness:**
- The CLI readiness signal MUST use the same feature checks already established in `resolvePlanningFeatureStatus()` (toolingUpdates.js:85-113), specifically verifying `session`, `project-run`, `search`, and `update-status` subcommands are available
- If `health --json` fails, fall back to these feature checks

**R2.4 — Add `install-codex-planning` to `TOOLING_INSTALL_KINDS`:**
- `TOOLING_INSTALL_KINDS` Set at line 15 MUST include `'install-codex-planning'` to match the TypeScript union type
- When the `'install-codex-planning'` kind is submitted to `POST /api/opencode/tooling/install`, the handler MUST delegate to the existing Codex skill sync logic (mirroring `POST /api/tooling-updates/update/elegy-skills-codex` at toolingUpdates.js:344-372)
- The handler MUST require `codexHome` in the context; if unavailable, return 400 with an appropriate error message
- After sync, rebuild the OpenCode status (as other branches do with `buildOpenCodeStatus`) and include it in the response

**R2.5 — Verify `/api/codex-planning-status` endpoint compliance:**
- The `/api/codex-planning-status` endpoint at opencode.js:765-788 already uses `ctx.env` correctly (lines 772, 775, 781)
- No changes required; verify during implementation that the endpoint returns correct `planningCliPath`, `planningSkill`, and `planningDbPath` fields
- Smoke-test: `GET /api/codex-planning-status` returns `{ ready: boolean, planningSkill: { installed: boolean }, planningCliPath: string | null }`

**Acceptance:**
- OpenCode status endpoint returns `elegyPlanningCli.cliPath` correctly (CLI found at `~/.copilot/managed-cli/planning/elegy-planning.exe`)
- No `process.env` references remain in the buildSetupChecks or computeToolingStatus code paths for elegy-planning
- CLI detection works when the binary exists

### R3 — Refresh Installed Assets

**R3.1 — Install Codex elegy-planning skill:**
- The file `~/.codex/skills/elegy-planning/SKILL.md` MUST exist after operations
- Use the existing asset sync flow: `POST /api/tooling-updates/update/elegy-skills-codex` OR direct file copy from `catalog-assets/shared-skills/elegy-planning/` to `~/.codex/skills/elegy-planning/`

**R3.2 — Refresh OpenCode assets:**
- OpenCode managed assets at `~/.config/opencode` MUST be refreshed using the existing `syncAll()` mechanism
- After refresh, the managed asset status MUST report all assets up to date (no outdated/missing counts)

**R3.3 — Update instruction references:**
- **`catalog-assets/shared-skills/elegy-planning/SKILL.md:27`** — Replace `elegy-planning --version` with `elegy-planning health --json`
- **`catalog-assets/shared-skills/elegy-planning/SKILL.md:31`** — Update default DB path from `~/.elegy/planning.db (or ~/.copilot/elegy-planning.db)` to `~/.copilot/elegy-planning.db (legacy: ~/.elegy/planning.db)` — make Copilot DB primary
- **`codex-assets/home/AGENTS.md:74`** — Replace `~/.elegy/planning.db` with `~/.copilot/elegy-planning.db`

**Acceptance:**
- `~/.codex/skills/elegy-planning/SKILL.md` exists
- OpenCode managed asset status reports all assets up to date (no outdated/missing counts)
- Codex planning status check reports `planningSkill.installed === true`

### R4 — Fix TypeScript Type Mismatch

The typecheck error at `OpenCodeView.tsx:346` MUST be resolved.

**Root cause:** `actionKind` is narrowed by prior type guards to `'install' | 'update'` (from `OpenCodeSetupCheck.action.kind` or the install-handler switch), but the `install-codex-planning` case compares against the narrowed type.

**Fix:** Either widen the type guard or add a type assertion. Minimal change preferred.

**Acceptance:**
- `tsc -p copilot-ui/ui/tsconfig.json --noEmit` exits with zero errors
- The `install-codex-planning` button in the OpenCode Setup tab remains functional (calls `opencodeStore.installCodexPlanning()`)

## Non-Goals

- Do NOT make `~/.elegy/planning.db` authoritative. The legacy DB is migration source only.
- No changes to the Elegy Planning CLI itself.
- No changes to the Copilot UI routing structure beyond the specific fixes listed.

## Acceptance Checks

- Goal and 5 roadmaps exist in Copilot DB after migration.
  → verify: `elegy-planning --db ~/.copilot/elegy-planning.db goal show --goal-id GOAL-COPILOT-GIT-WORKTREE-VALIDATION-20260603 --json`
- Backups of both DBs exist before migration.
  → verify: pending — manual verification of backup files in `~/.copilot/backups/`
- OpenCode status endpoint returns correct CLI path.
  → verify: `curl -s http://localhost:PORT/api/opencode/status | jq .elegyPlanningCli.cliPath`
- No `process.env` references remain in elegy-planning code paths.
  → verify: `Select-String -Path copilot-ui/routes/opencode.js -Pattern "process\.env"` returns no matches in elegy-planning-related functions
- `install-codex-planning` is in `TOOLING_INSTALL_KINDS`.
  → verify: `Select-String -Path copilot-ui/routes/opencode.js -Pattern "install-codex-planning"`
- `elegy-planning --version` no longer called in opencode.js.
  → verify: `Select-String -Path copilot-ui/routes/opencode.js -Pattern "--version"` returns no matches in resolvePlanningVersion
- `elegy-planning --version` no longer called in toolingUpdates.js.
  → verify: `Select-String -Path copilot-ui/routes/toolingUpdates.js -Pattern "--version"` returns no matches in resolvePlanningVersion
- `~/.codex/skills/elegy-planning/SKILL.md` exists.
  → verify: `Test-Path ~/.codex/skills/elegy-planning/SKILL.md`
- OpenCode managed asset status reports all assets up to date.
  → verify: pending — requires running dashboard UI check
- Codex planning status reports `planningSkill.installed === true`.
  → verify: `curl -s http://localhost:PORT/api/codex-planning-status | jq .planningSkill.installed`
- TypeScript typecheck passes with zero errors.
  → verify: `tsc -p copilot-ui/ui/tsconfig.json --noEmit`

## Implementation Links

- `copilot-ui/routes/opencode.js`
- `copilot-ui/routes/toolingUpdates.js`
- `copilot-ui/lib/elegyPlanningCliResolver.js`
- `catalog-assets/shared-skills/elegy-planning/SKILL.md`
- `codex-assets/home/AGENTS.md`
- `copilot-ui/ui/src/tabs/OpenCode/OpenCodeView.tsx`

## Validation Evidence

- Pending implementation.

## Drift Notes

- None.

## Test Plan

- **DB migration:** `elegy-planning --db $COPHOME/elegy-planning.db goal show --goal-id GOAL-COPILOT-GIT-WORKTREE-VALIDATION-20260603 --json` returns the goal with 5 roadmaps
- **CLI detection:** OpenCode status route returns correct CLI path and readiness
- **Asset sync:** Codex planning skill exists, OpenCode assets synced
- **Code validation:**
  - `node copilot-ui/tests/elegy-planning-cli-resolver.test.js`
  - `node --test copilot-ui/routes/toolingUpdates.test.js`
  - `tsc -p copilot-ui/ui/tsconfig.json --noEmit` — zero errors
- **Manual:** Click "Install Codex Planning" button in OpenCode setup tab — skill installs without errors

## Assumptions

- `~/.copilot/elegy-planning.db` is the canonical runtime DB
- `~/.elegy/planning.db` is legacy and used only as migration source
- Asset refresh is safe for both OpenCode and Codex homes
- The existing unrelated dirty files in the repo will be preserved
- Implementation order: R2 and R4 (code fixes, TS fix) first, then R3 (asset refresh), then R1 (DB migration — riskiest step, done last)
