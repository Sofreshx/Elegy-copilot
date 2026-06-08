# Implementation Plan: align-elegy-db-assets

## Order: R2+R4 → R3 → R1

### Step 1: R2.2 — Fix ctx.env (opencode.js:346-375)
- Replace `process.env.INSTRUCTION_ENGINE_ELEGY_PLANNING_CLI_PATH` with `ctx.env.INSTRUCTION_ENGINE_ELEGY_PLANNING_CLI_PATH` at line 351
- Replace `env: process.env` with `env: ctx.env` at line 354
- 1 file, 2 edits

### Step 2: R4 — Fix TS2367 (OpenCodeView.tsx:346)
- Move `actionKind === 'install-codex-planning'` check ABOVE the `if (actionKind === 'install' || actionKind === 'update')` guard
- 1 file, restructure conditional

### Step 3: R2.4 — Add install-codex-planning handler
- Add `'install-codex-planning'` to TOOLING_INSTALL_KINDS Set at line 15
- Add `else if (kind === 'install-codex-planning')` branch in POST handler at line 719
- 1 file, 2 edits

### Step 4: R2.1 + R2.1b — Create shared elegyPlanningHealth.js
- New file: `copilot-ui/lib/elegyPlanningHealth.js`
- Export `resolvePlanningHealth(cliPath, childProcess)` → `{ ready, schemaVersion, error }`
- Replace `resolvePlanningVersion` in `opencode.js:430-447` to use new function
- Replace `resolvePlanningVersion` in `toolingUpdates.js:35-62` to use new function

### Step 5: R2.3 — Feature checks fallback
- If `resolvePlanningHealth` returns not-ready, fall back to feature checks
- Import/reuse `resolvePlanningFeatureStatus` pattern in opencode.js

### Step 6: R3.3 — Update instruction references
- Edit `catalog-assets/shared-skills/elegy-planning/SKILL.md:27` — `--version` → `health --json`
- Edit `catalog-assets/shared-skills/elegy-planning/SKILL.md:31` — default DB swap
- Edit `codex-assets/home/AGENTS.md:74` — DB path update

### Step 7: R3.1 — Install Codex planning skill
- Copy `catalog-assets/shared-skills/elegy-planning/` to `~/.codex/skills/elegy-planning/`

### Step 8: R3.2 — Refresh OpenCode assets
- Run asset sync for OpenCode home

### Step 9: R1 — DB migration
- Back up both DBs
- Read goal+roadmaps from legacy DB
- Recreate in Copilot DB with preserved IDs
- Verify

### Step 10: Validate
- Typecheck, run tests, verify DB
