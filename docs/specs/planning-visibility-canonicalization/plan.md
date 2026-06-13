# Implementation Plan: planning-visibility-canonicalization

**Spec:** `specs/planning-visibility-canonicalization/spec.md`
**Date:** 2026-06-04
**Status:** Draft
**Lane:** Spec (per AGENTS.md — user-facing behavior change, multi-file surface)

## Authority Update

Current planning storage authority:

| Surface | Canonical Path |
|---|---|
| Planning DB | `~/.elegy/planning.db` |
| Planning session sidecar | `~/.elegy/planning-session.json` |

Treat `.copilot` planning DB and planning-session paths below as historical
evidence from the earlier draft, not as current implementation targets.

## Overview

Repair the consolidation goal + 5 roadmaps in place, add canonical-repo metadata contract, fix server-side inherited scope matching, extend the planning explorer with full filter/drill-down/warning-bucket surface, and add shared session sidecar support. Six ordered steps, each independently verifiable.

## Dependency Order

```
Step 1 (validate baselines) →
Step 2 (DB backup + repair script + run repair) →
Step 3 (planning metadata + planning session lib + new endpoints) →
Step 4 (validate-planning-metadata.js) →
Step 5 (UI explorer extension + filter/drill-down) →
Step 6 (env var wiring in install scripts + runtime) →
Step 7 (final validation: typecheck, unit tests, run validator, run repair) →
Step 8 (implementation review)
```

Steps 2 and 3 are independent; both must precede step 5 because the UI consumes the new endpoints. Step 4 depends on Step 2 (the validator must know what to look for). Step 6 is independent and can run in parallel with Step 5.

## Step 1 — Verify baselines (15 min)

**Verify the repo is in the expected state before any change.**

- [ ] `node -e "const db=require('better-sqlite3')('C:/Users/lolzi/.copilot/elegy-planning.db',{readonly:true}); ..."` confirms the consolidation goal and 5 child roadmaps exist and the goal carries the human-readable repo tags but the roadmaps do not.
  → verify: run the one-liner; expect 6 rows: goal (with 2 repo:* tags) + 5 roadmaps (with 0 repo:* tags).
- [ ] `node -e "const db=require('better-sqlite3')('C:/Users/lolzi/.copilot/elegy-planning.db',{readonly:true}); const r=db.prepare(\"SELECT COUNT(*) AS wp FROM work_points WHERE goal_id=? OR roadmap_id IN (SELECT id FROM roadmaps WHERE goal_id=?)\").get('GOAL-COPILOT-GIT-WORKTREE-VALIDATION-20260603','GOAL-COPILOT-GIT-WORKTREE-VALIDATION-20260603'); console.log(r)"` returns 0 (confirms the gap reported in R0).
- [ ] `node copilot-ui/tests/planning-roadmap-inheritance.test.js` is not yet present (we will create it in Step 3).
- [ ] `node copilot-ui/tests/planning-session-endpoint.test.js` is not yet present.
- [ ] `node copilot-ui/tests/planning-explorer-inheritance.vitest.tsx` is not yet present.
- [ ] `rg -n "PlanningAuthorityView" copilot-ui/ui/src` returns 4 matches (App.tsx:15 import, App.tsx:96 render, planningExplorerContracts.ts:23 docstring reference, PlanningAuthorityView.tsx:307 export). Confirms the authority view IS currently routed — we will switch routing to PlanningExplorerView in Step 5.
- [ ] `rg -n "PlanningExplorerView" copilot-ui/ui/src` returns 1 match (only its own export at PlanningExplorerView.tsx:30 — no imports, confirms it is NOT currently routed). We will route it in Step 5.
- [ ] `rg -n "INSTRUCTION_ENGINE_ELEGY_PLANNING_SESSION_PATH" copilot-ui catalog-assets` returns 0 matches (we are introducing this env var).

**Stop if any baseline does not hold. Surface the discrepancy in the spec's Drift Notes.**

## Step 2 — DB backup + repair script (45 min)

**New file:** `scripts/repair-consolidation-tags.mjs`

A pure Node script (no CLI dependency) that:

1. Accepts `--db <path>` (default `path.join(os.homedir(), '.elegy', 'planning.db')`).
2. Accepts `--dry-run` (default `false`) and `--correlation-id` (default `copilot-git-consolidation-20260603`).
3. On startup, copies the DB to `<dbDir>/../backups/elegy-planning.db.bak-<ISO8601 timestamp>`. If the copy fails, exit 1 with the error.
4. Opens the DB with `better-sqlite3` in read-write mode.
5. Defines a canonical tag merge function:
   - `buildGoalTags(existing) → tags`: starts from existing tags, de-duplicates case-insensitively on `repo:*`/`source:*` labels, then adds `repo:74af0f7b5cc4`, `repo:55f0c2816d6a`, `repo:instruction-engine`, `repo:elegy`, `source:codex`, `theme:consolidation`, `phase:1` (only if missing). Returns a JSON string.
   - `buildRoadmapTags(existing, theme) → tags`: same pattern with the four repo tags (hashed + label), `source:codex`, `theme:git-ui | theme:worktrees | theme:validation | theme:hooks | theme:codex-planning` (chosen per roadmap from the existing feature tags), `phase:1`.
6. Computes a plan: for the goal and 5 roadmaps, the desired tag set and the diff (added tags).
7. Inside a single transaction:
   - Updates `goals.tags_json` and `roadmaps.tags_json` WHERE id matches and tags_json differs.
   - Deletes existing `tag_index` rows for those entities and re-inserts them from the new tag set.
   - Inserts one `planning_events` row per change with `event_type='tag_repair_direct_sqlite'` (AUTHORITATIVE value from `docs/system/direct-sqlite-repair-for-planning-tags-adr.md` Decision 5; do NOT use `tag.merge` or any other value), `correlation_id='copilot-git-consolidation-20260603'`, and `payload_json` = `{ scriptVersion, operator, runs, before, after, idempotencyKey }` (the AUTHORITATIVE payload shape from the same ADR Decision 5; do NOT use `{ entityType, entityId, added, before, after }`). The `idempotencyKey` is `sha256(concatenation of sorted(entityId, "|", join("|", canonicalTags[])) tuples)` — one hash per entity's full canonical tag array (matches the ADR's definition exactly).
8. Idempotency: the WHERE clause `tags_json != <new>` plus the tag_index clear-and-rebuild, plus the pre-insert check for an existing `planning_events` row with the same `idempotencyKey`, guarantees that re-running on already-repaired data makes 0 row changes and 0 inserts.
9. Exit 0 on success, 1 on any failure, 2 on dry-run-with-no-diff-needed.

**Required tests:**

- `scripts/repair-consolidation-tags.test.js` (new): temp DB, run with `--dry-run`, run with apply, assert tags and idempotency.

**Run sequence:**

1. `node scripts/repair-consolidation-tags.mjs --db "C:\Users\lolzi\.copilot\elegy-planning.db" --dry-run` — confirm the plan.
2. `node scripts/repair-consolidation-tags.mjs --db "C:\Users\lolzi\.copilot\elegy-planning.db"` — apply.
3. `& "C:\Users\lolzi\.copilot\managed-cli\planning\elegy-planning.exe" --db "C:\Users\lolzi\.copilot\elegy-planning.db" tags --json` — confirm 2 new tag entries appear with `entityCount >= 6`.

## Step 3 — Shared libs + server endpoints (135 min)

**New files:**

- `copilot-ui/lib/planningMetadata.js` — exports:
  - `loadRepoInventory(copilotHome = ~/.copilot) → { repos: [{ repoId, repoPath, repoLabel }], byId, byLabel, byPath }`. Reads `catalog/projections/repo-*.json` and `catalog/repo-inventory.json`.
  - `resolveRepoIdentity(input, inventory) → { repoId, repoLabel, repoPath } | null`. Accepts any of: 12-char hex, label, absolute path, or `{ repoId, repoPath, repoLabel }`. Returns the canonical triple.
  - `buildCanonicalRepoTags(identity) → string[]`. Returns `['repo:<id>', 'repo:<label>']` plus any worktree parent tags.
  - `buildHarnessTag(harness) → string`. Normalises to `source:<harness>` and validates against the allowlist.

- `copilot-ui/lib/planningSession.js` — exports:
  - `resolveSessionSidecarPath(env, homedir, dbPath) → string`. Returns `env.INSTRUCTION_ENGINE_ELEGY_PLANNING_SESSION_PATH` if set, else `<dbDir>/planning-session.json` (CLI's default behaviour), else `~/.elegy/planning-session.json`.
  - `readPlanningSession(env, opts) → { sidecarPath, exists, sidecar, candidatePaths }`. Tries the resolved path first, then the alternates, returns the first one that exists.
  - `mirrorSessionSidecar({ resolvedPath, defaultSourcePath, homedir }) → { copiedFrom, copiedTo } | null`. If the resolved path's parent directory exists and the source exists but the override does not, copy the source to the override. Returns null if no copy was needed. `homedir` defaults to `os.homedir()`; the function reads `defaultSourcePath` from `path.join(homedir, '.elegy', 'planning-session.json')` when not supplied.

**Modified file:** `copilot-ui/routes/planning.js`

- Add `loadGoalTagsForRoadmaps(roadmaps, bridge)` helper at the top of the file (after `requirePlanningLiveAuthorityBridge`). It batches: groups roadmap IDs by `goalId`, calls `bridge.showGoal` for each unique goal, returns `Map<roadmapId, parentGoalTags>`.
- Modify `planningEntityMatchesRepoSelection` (line 110-152) to accept an optional 4th argument `parentTags: Set<string>`. When the entity has no direct `repo:*` tag, fall back to `parentTags`.
- Modify `filterPlanningLiveRoadmaps` (line 164-169) to:
  1. Call `loadGoalTagsForRoadmaps(items, bridge)` once.
  2. Pass the parent tag set into `planningEntityMatchesRepoSelection` for each roadmap.
  3. When `roadmapInheritsGoalScope=true` (default, taken from `process.env.PLANNING_ROADMAP_INHERIT_GOAL_SCOPE !== 'false'`), include inherited matches.
- Add a new flag on `filterPlanningLiveRoadmaps`: `includeUnscoped` (default `false`). When `true`, the filter also returns roadmaps that have NO `repo:*` tag AND no inherited repo tag.
- Modify `filterPlanningLivePlans` and `filterPlanningLiveTodos` to chain inheritance (plan → roadmap → goal).
- Modify `assertPlanningEntityInRepo` to accept parent tags too.
- Add new endpoint `GET /api/planning/session` that:
  - Reads `INSTRUCTION_ENGINE_ELEGY_PLANNING_SESSION_PATH` and DB path from `ctx.env`.
  - Returns `{ ready, sidecarPath, exists, sidecar, lastChecked, correlationId, availableAt }` where `ready` is `true` when `exists` is `true` OR (`exists` is `false` AND the resolved `sidecarPath`'s parent directory exists and is writable; checked with `fs.statSync(parent).isDirectory() && fs.accessSync(parent, fs.constants.W_OK)`).
  - NEVER creates the sidecar; only reads.
- Add new endpoint `GET /api/planning/explorer` that:
  - Accepts query params: `entityType`, `repoId`, `repoPath`, `repoLabel`, `status`, `tag`, `source`, `createdFrom`, `createdTo`, `updatedFrom`, `updatedTo`, `parentGoalId`, `q` (free-text), `includeUnscoped`, `includeOrphaned`, `limit`, `offset`.
  - Pulls all goals/roadmaps/work-points/plans/todos/issues/review-points from the bridge, applies filters in JS, and returns `{ entities, total, filterWarnings, summary }` where:
    - `entities[]` is the wire-contract shape from R5.6: `{ entityType, entityId, title, summary?, status?, tags, repoScope: { direct, inherited }, parentChain: { goalId?, roadmapId?, planId? }, createdAt?, updatedAt?, raw }`.
    - `filterWarnings[]` is `{ entityType, entityId, bucket, reason }` per R5.6.
    - `summary` is `{ byType, byRepoScope, byBucket }`.

**Modified file:** `copilot-ui/ui/src/lib/api/planning.ts`

- Add `includeUnscoped?: boolean` to `PlanningLiveRoadmapsQuery` and pass it as a query param.
- Add `getPlanningSession(baseUrl?) → PlanningSessionResponse`.
- Add `searchPlanningExplorer(query, baseUrl?) → PlanningExplorerResponse`.

**Required tests:**

- `copilot-ui/tests/planning-roadmap-inheritance.test.js` — node:test style; uses a mock bridge; covers direct match, inherited match, no-match, parent missing.
- `copilot-ui/tests/planning-session-endpoint.test.js` — node:test style; covers `exists: true`, `exists: false`, env var override, candidate paths in priority order.
- `copilot-ui/tests/planning-explorer.test.js` — node:test style; covers each filter, combined filters, warning bucket counts.

## Step 4 — Validation script (30 min)

**New file:** `scripts/validate-planning-metadata.js`

A pure node script (CommonJS) that:

1. Accepts `--db <path>`, `--json`, `--strict` (default false).
2. Opens the DB with `better-sqlite3` in read-only mode.
3. Runs the following checks in this order:
   - **Unscoped**: every goal/roadmap/work-point/plan/todo/issue/review-point with no `repo:*` tag in its `tags_json` is added to `unscoped[]`.
   - **Orphaned**: every roadmap/work-point/plan/todo whose `goalId`/`planId`/`workPointId` points to a non-existent entity is added to `orphaned[]`. Done in JS by building `Set<id>` per entity type.
   - **InvalidParents**: every entity whose parent field is non-null but malformed (e.g. `goalId` set to `""` or a non-string value).
   - **DuplicateTitles**: every group of 2+ entities within the same scope and entity type that share a non-empty `title`.
   - **InconsistentTags**: every roadmap under a goal that has `repo:*` tags but the roadmap lacks at least one of the goal's `repo:*` tags. Only flagged for goal→roadmap and roadmap→work-point→plan chains.
   - **MissingWorkItems**: every roadmap with zero work points, plans, or todos. Surfaces the documented data-depth gap.
4. Prints either:
   - JSON on stdout (`--json`), with `{ unscoped, orphaned, invalidParents, duplicateTitles, inconsistentTags, missingWorkItems, summary, strict }`.
   - Pretty text on stdout (default), with check names + counts + the first 10 items per check.
5. Exit codes:
   - `--strict` mode: exit 1 if `unscoped.length > 0` OR `orphaned.length > 0` OR `inconsistentTags.length > 0` OR `missingWorkItems.length > 0`. Otherwise exit 0.
   - Default mode: exit 0 always (unless DB open fails).
6. Exit 2 on argument errors.

**Required tests:**

- `scripts/validate-planning-metadata.test.js` — new; uses an in-memory SQLite DB (`:memory:`), seeds it with fixtures, asserts each check.
- `scripts/roundtrip-validator-strict.test.js` — new; copies the live DB to a temp file, runs the validator (assert exit 1 in `--strict` mode), runs the repair script (assert exit 0 and tags added), re-runs the validator (assert exit 0). Cleans up the temp file.

## Step 5 — UI Explorer extension (135 min)

**Modified file:** `copilot-ui/ui/src/App.tsx`

- Change the import on line 15 from `import PlanningAuthorityView ...` to `import PlanningExplorerView ...`.
- Change the route on line 96 from `return <PlanningAuthorityView />` to `return <PlanningExplorerView />`.
- Remove the unused `PlanningAuthorityView` import; the file is kept as historical reference only.
  → verify: `rg -n "PlanningAuthorityView" copilot-ui/ui/src/App.tsx` returns 0 matches.

**Modified file:** `copilot-ui/ui/src/tabs/Planning/PlanningExplorerView.tsx`

- Add a `ViewMode = 'roadmaps' | 'explorer'` state (default `roadmaps` for backward compatibility; the spec says Explorer is the new primary view, so a `defaultViewMode` query param can flip it).
- Add the FilterBar component (or inline) with the facets from R5.1. The Parent Goal facet is a "Pick from loaded goals" `<select>` populated from the most recent explorer fetch result, NOT a debounced async typeahead.
- Add the warning-bucket chip row from R5.2.
- Add the drill-down side panel from R5.3.
- Add the "Show all" / "Unscoped only" preset toggles from R5.4.
- Add the Session Status panel from R5.5.

**Refactor** the existing card list into a smaller sub-component `RoadmapCard` so the new `EntityTable` can sit alongside it. Reuse `planningExplorerContracts.ts` helpers.

**New files:**

- `copilot-ui/ui/src/tabs/Planning/planningExplorerViewState.ts` — hook returning the filter state, the resolved repos, and the merged roadmaps + warning buckets. Pure function over the inputs so it's unit-testable.
- `copilot-ui/ui/src/tabs/Planning/EntityTable.tsx` — renders rows for the explorer view.
- `copilot-ui/ui/src/tabs/Planning/DrillDownPanel.tsx` — renders the side panel.
- `copilot-ui/ui/src/tabs/Planning/SessionStatusPanel.tsx` — renders the session status.

**New helper:** `copilot-ui/lib/commandsForEntity.js` — exports `buildCopyableCliCommands(entity, dbPath)` returning the 4-5 copyable commands (`show`, `list --tag`, `validate`, etc.).

**Modified file:** `copilot-ui/ui/src/lib/api/planning.ts` — already extended in Step 3.

**Required tests:**

- `copilot-ui/tests/planning-explorer-inheritance.vitest.tsx` — RTL render; verify the explorer renders 5 cards in "All repos" mode + the session status panel.
- `copilot-ui/tests/planning-explorer-filters.vitest.tsx` — RTL render; verify each filter facet changes the row count deterministically.
- `copilot-ui/tests/planning-explorer-view-state.vitest.ts` — pure function tests for the new hook.

**CSS additions:**

- `.planning-explorer-filters`, `.planning-explorer-bucket-row`, `.planning-explorer-entity-table`, `.planning-explorer-drilldown`, `.planning-explorer-session-panel`. New `planning-explorer-*` prefix to avoid clobbering the existing `planning-*` classes.

## Step 6 — Env var wiring (25 min)

**Modified files:**

- `scripts/codex-install.mjs` — when `process.platform === 'win32'`, set `INSTRUCTION_ENGINE_ELEGY_PLANNING_SESSION_PATH=~/.elegy/planning-session.json` in generated env output. Add `--print-env-only` flag for tests.
- `scripts/opencode-install.mjs` — same, including the `mirrorSessionSidecar` call.
- `copilot-ui/src/desktopRuntime/runtimeService.ts` — set the same env var on the spawned Tauri process env.
- `catalog-assets/shared-skills/elegy-planning/SKILL.md` — add a new section under "Environment Variables" documenting the override AND a note that the install scripts perform the one-time mirror; re-running the install refreshes the mirror.

**Required tests:**

- `scripts/codex-install.test.js` (existing) — add an assertion for the new env var line.
- `scripts/opencode-install.test.js` (existing) — same.

## Step 7 — Final validation (15 min)

- [ ] `node scripts/validate-specs.js specs/planning-visibility-canonicalization` exits 0.
- [ ] `node scripts/validate-planning-metadata.js --db "C:\Users\lolzi\.copilot\elegy-planning.db" --json` reports 0 unscoped, 0 orphaned, 0 inconsistent tags for the consolidation subtree.
- [ ] `node scripts/repair-consolidation-tags.mjs --db "C:\Users\lolzi\.copilot\elegy-planning.db"` is a no-op (idempotent).
- [ ] `& "C:\Users\lolzi\.copilot\managed-cli\planning\elegy-planning.exe" --db "C:\Users\lolzi\.copilot\elegy-planning.db" goal show --goal-id GOAL-COPILOT-GIT-WORKTREE-VALIDATION-20260603 --json` shows 5 roadmaps with the new tags.
- [ ] `cd copilot-ui && node ../node_modules/typescript/bin/tsc -p ui/tsconfig.json --noEmit` exits 0.
- [ ] `node copilot-ui/tests/planning-roadmap-inheritance.test.js` exits 0.
- [ ] `node copilot-ui/tests/planning-session-endpoint.test.js` exits 0.
- [ ] `node --test copilot-ui/tests/planning-explorer-inheritance.vitest.tsx copilot-ui/tests/planning-explorer-filters.vitest.tsx` exits 0.
- [ ] `node scripts/codex-install.test.js` and `node scripts/opencode-install.test.js` exit 0.
- [ ] `node scripts/repair-consolidation-tags.test.js` and `node scripts/validate-planning-metadata.test.js` and `node scripts/roundtrip-validator-strict.test.js` exit 0.
- [ ] `node copilot-ui/tests/planning-live-roadmaps-repo-filter.test.js` exits 0.

## Step 8 — Implementation review

Run the implementation-review skill against the diff before handoff.

## Risk Points

| Risk | Mitigation |
|------|-----------|
| Direct SQLite write corrupts DB | Backup step is the first action; transaction wraps every change; idempotency means re-runs are safe. The decision to bypass the CLI is documented in `docs/system/direct-sqlite-repair-for-planning-tags-adr.md` (R2.2). |
| `--tag` on the CLI does not exist; we cannot use it for repair | Direct SQLite writes are scoped to a single transaction; the writes are tested with a fresh in-memory DB and against a copy before live. |
| Server-side change to `filterPlanningLiveRoadmaps` regresses the existing 7-roadmap dataset | Test suite covers direct match, inherited match, no-match, parent missing. The wire format returned to the UI is unchanged. |
| `includeUnscoped=true` is interpreted as "return everything" by future code | The flag is honoured only inside the new behaviour-aware filter; the legacy per-repo filter is unchanged. |
| The CLI's session sidecar is at `~/.elegy/planning-session.json` and won't move | The Copilot layer reads from the override path if set, else from the legacy location. The install scripts copy the file at install time. |
| Tauri env var injection does not propagate to child processes | Tauri `command` builder accepts `env` per-process; verify with a smoke test. |
| `node:sqlite` is not available (Node 22.12) | Use `better-sqlite3` from the root `node_modules`; already available. |
| `PlanningAuthorityView` removal breaks a hidden reference | Step 1 grep confirms only the export is referenced. The file is kept as historical reference, not removed. |

## Spec Coverage Map

| Spec Requirement | Implemented In |
|------------------|---------------|
| R1.1 — Canonical repo tag format | `copilot-ui/lib/planningMetadata.js` + `scripts/elegy-planning-create.mjs` |
| R1.2 — Source harness tag | Same |
| R1.3 — Theme/phase format | Same |
| R1.4 — Create helper | `scripts/elegy-planning-create.mjs` |
| R2.1 — DB backup | `scripts/repair-consolidation-tags.mjs` |
| R2.2 — Repair logic | Same |
| R2.3 — Tag list verification | Manual CLI call in Step 7 |
| R2.4 — Goal show verification | Manual CLI call in Step 7 |
| R3.1 — Inherited scope flag | `copilot-ui/routes/planning.js` (`roadmapInheritsGoalScope`) |
| R3.2 — Goal tags batch loader | `loadGoalTagsForRoadmaps` helper |
| R3.3 — Plan/todo inheritance | `filterPlanningLivePlans` / `filterPlanningLiveTodos` updates |
| R3.4 — Detail read guard | `assertPlanningEntityInRepo` accepts parent tags |
| R4.1 — `includeUnscoped` flag | New query param + UI pass-through |
| R4.2 — Replace view with explorer | `App.tsx` (routing switch) + `PlanningExplorerView.tsx` (extended with new features); `PlanningAuthorityView.tsx` is kept as historical reference and is NOT modified |
| R4.3 — Inherited section in UI | `EntityTable` + warning bucket chip |
| R5.1 — Filter facets | `planningExplorerViewState.ts` |
| R5.2 — Warning buckets | Same |
| R5.3 — Drill-down + copyable commands | `DrillDownPanel.tsx` + `commandsForEntity.js` |
| R5.4 — Preset toggles | `FilterBar` UI |
| R5.5 — Session status panel | `SessionStatusPanel.tsx` + `getPlanningSession()` |
| R6.1 — Validator report | `scripts/validate-planning-metadata.js` |
| R6.2 — Strict mode | Same |
| R6.3 — Additive | Same (new file, not a replacement) |
| R7.1 — Env var docs | `catalog-assets/shared-skills/elegy-planning/SKILL.md` |
| R7.2 — `GET /api/planning/session` | `copilot-ui/routes/planning.js` |
| R7.3 — `availableAt` paths | Same |
| R7.4 — Install scripts set the env | `scripts/codex-install.mjs`, `scripts/opencode-install.mjs` |
| R7.5 — Tauri runtime env | `copilot-ui/src/desktopRuntime/runtimeService.ts` |
| R8.1 — Bridge contract unchanged | No changes to `roadmapWorkflowPlanningBridge.js` |
