---
spec_id: planning-visibility-canonicalization
title: Make Elegy Planning Visible, Canonical, and Explorable
status: draft
type: feature
updated: 2026-06-30
supersedes: [align-elegy-db-assets, planning-explorer-view]
liveness_skip_paths:
  - "C:\\Users\\*\\"
  - "C:/Users/*/"
  - "~/.copilot/*"
  - "~/.elegy/*"
  - "specs/planning-visibility-canonicalization/spec.md"
  - "specs/planning-visibility-canonicalization/plan.md"
  - "copilot-ui/lib/planningMetadata.js"
  - "copilot-ui/lib/commandsForEntity.js"
  - "copilot-ui/ui/src/tabs/Planning/PlanningExplorerView.tsx"
  - "copilot-ui/ui/src/tabs/Planning/PlanningAuthorityView.tsx"
  - "copilot-ui/tests/planning-explorer-inheritance.vitest.tsx"
  - "copilot-ui/tests/planning-explorer-filters.vitest.tsx"
  - "copilot-ui/tests/planning-explorer-view-state.vitest.ts"
---

# Make Elegy Planning Visible, Canonical, and Explorable

## Intent

Fix the current visibility problem in the Elegy planning control plane and prevent it from recurring by:

1. Repairing the existing consolidation goal and its 5 roadmaps in the Copilot SQLite DB so they carry the canonical repo + harness + theme + phase tag set, instead of relying on the parent goal alone.
2. Standardizing the planning creation contract so every goal, roadmap, work point, plan, todo, and issue created by Codex, OpenCode, or the Copilot scaffolding carries a consistent tag set resolved from the Copilot repo inventory.
3. Making the Planning tab's repo filter, the server-side `elegy-planning` bridge filter, and the explorer view share a single inherited repo-matching model so child roadmaps match the parent goal's repo scope and orphaned records can be discovered in an "unscoped" view.
4. Adding a richer Planning Explorer with entity-type, repo, status, tag, source-harness, date, parent-goal, and free-text filters; warning buckets for unscoped, orphaned, missing-parent, and stale records; drill-down to raw IDs; and copyable CLI commands.
5. Adding shared planning session support so the active session sidecar is discoverable from the Elegy home (`~/.elegy/planning-session.json`) and surfaced in the Planning tab independently of goal/roadmap data.

## Authority Update

Current planning storage authority:

| Surface | Canonical Path |
|---|---|
| Planning DB | `~/.elegy/planning.db` |
| Planning session sidecar | `~/.elegy/planning-session.json` |

Any `.copilot` planning DB or planning-session path in this draft is
historical evidence from the pre-canonicalization state. New implementation
work MUST use the `.elegy` paths above.

## Context Evidence

- The Copilot SQLite DB contains the consolidation goal and 5 child roadmaps. The parent goal carries repo tags; the child roadmaps carry feature tags only and have no repo tags.
- Server-side repo filter checks only the entity's own tags plus worktree parent repo. It does not follow the goal for roadmaps, so a child roadmap with no repo tag fails to match its parent's repo scope.
- The CLI ships as a pre-compiled binary. The CLI accepts `--db` and `--correlation-id` but does not respect the planning session path env var — `session init` writes the sidecar at the default location regardless of any env var.
- The CLI exposes `goal create`/`roadmap create` with `--tag` but has NO tag-update subcommand. Existing tags can only be edited by writing directly to the SQLite `tags_json` column and the `tag_index` table.
- The existing `PlanningExplorerView` already does a multi-repo fetch, a per-repo `Promise.allSettled`, sort by date, refresh, partial-failure warning, and a global-query fallback for unscoped roadmaps.
- The existing `PlanningAuthorityView` IS currently routed from `App.tsx` (case `'planning'`). The plan will switch this routing to `PlanningExplorerView.tsx`.
- A new query is necessary that surfaces unscoped/inherited roadmaps explicitly, with a deterministic sort and a copy-friendly CLI command for each row.

## Requirements

### Allowed Behavior

- Canonical `repo:*`, `source:*`, `theme:*`, and `phase:*` tags on all planning entities created by Codex, OpenCode, or Copilot scaffolding
- In-place repair of existing consolidation goal and roadmaps with stable IDs and event logging
- Inherited repo scope matching through parent goal tags (server-side bridge filter)
- Unscoped/inherited records displayed by default in the Planning UI with explicit "Unscoped / inherited" section
- Rich explorer view with entity-type, repo, status, tag, source-harness, date, parent-goal, and free-text filters
- Warning buckets panel for unscoped, orphaned, stale, and missing-session records
- Drill-down side panel showing raw JSON, tags, parent chain, validation state, and copyable CLI commands
- Active session status panel above the explorer with session metadata or init button
- Validation script (`validate-planning-metadata.js`) checking unscoped, orphaned, inconsistent tags, and missing work items
- Shared planning session sidecar at `~/.elegy/planning-session.json` surfaced via new endpoint

### Forbidden Behavior

- Modifying the `elegy-planning` Rust CLI source (shipped pre-compiled)
- Migrating consolidation records between databases (repair in place only)
- Repairing non-consolidation goals/roadmaps (out of scope for this spec)
- Creating placeholder work items for consolidation roadmaps (report gaps only)
- Periodic re-syncing of separate planning session sidecar (canonical is `~/.elegy/planning-session.json`)
- Redesigning standalone graph window, catalog workspace store, or planning contract types
- Persisting explorer filter/sort state across sessions (filters live in component state)
- Paginating the explorer list (add later if count exceeds 50)

### R1 — Canonical Repo Tag Format

Every planning entity (goal, roadmap, work point, plan, todo, issue, review point) created or updated by Codex, OpenCode, Copilot scaffolding, or the new `elegy-planning-create` helper MUST carry the canonical tag set. Tags are the public, documented contract for repo and harness scope; non-canonical tags are permitted but MUST NOT replace any of the canonical ones.

- R1.1 — Each entity created against a tracked repo MUST include `repo:<id>` (12-char hex hash) where `<id>` is resolved from the Copilot repo inventory (`catalog/projections/repo-*.json`). The same entity SHOULD also include `repo:<label>` (human-readable label) when a label is known. Goals that scope one or more child roadmaps MUST include both forms so the children can inherit. Tag matching is case-insensitive on the label portion, so `repo:elegy` and `repo:Elegy` are equivalent and either is accepted.
  → verify: `rg -n "buildCanonicalRepoTags|resolveRepoIdentity" copilot-ui/lib/planningMetadata.js`
- R1.2 — The source harness tag (`source:codex`, `source:opencode`, `source:copilot`, `source:antigravity`, or `source:human`) MUST be set on every create; missing source tags fail the validation script in R6.
  → verify: `node scripts/validate-planning-metadata.js --db "C:\Users\lolzi\.copilot\elegy-planning.db" --strict`
- R1.3 — A free-form `theme:<token>` and `phase:<token>` tag MAY be set; format is advisory only and is NOT enforced by `validate-planning-metadata.js`. The validator focuses on presence (R1.1, R1.2) and inheritance (R3), not on lexical format.
  → verify: `rg -n "theme:|phase:" copilot-ui/lib/planningMetadata.js` (the helpers exist but do not enforce format).
- R1.4 — The new `elegy-planning-create` helper script (`scripts/elegy-planning-create.mjs`) is the only path allowed to inject tags at create time. Direct CLI use without `--tag` flags is discouraged but permitted for ad-hoc exploration; the resulting entities are flagged as `source:human` and surface in the explorer warning bucket.
  → verify: `node scripts/elegy-planning-create.mjs --help`

### R2 — Repair Existing Consolidation Records

Repair the existing `GOAL-COPILOT-GIT-WORKTREE-VALIDATION-20260603` goal and its 5 child roadmaps in-place. IDs MUST stay stable; events and validation history MUST NOT be lost.

- R2.1 — Back up `C:\Users\lolzi\.copilot\elegy-planning.db` to `C:\Users\lolzi\.copilot\backups\elegy-planning.db.bak-<timestamp>` BEFORE any write. If the backup fails, abort and surface the failure.
  → verify: `Get-ChildItem "C:\Users\lolzi\.copilot\backups" -Filter "elegy-planning.db.bak-*" | Sort-Object LastWriteTime -Descending | Select-Object -First 1 | Select-Object Name, LastWriteTime`
- R2.2 — Run the repair script `scripts/repair-consolidation-tags.mjs --db <path>` which:
  - For the goal: merges new tags `repo:74af0f7b5cc4`, `repo:55f0c2816d6a`, `repo:elegy-copilot`, `repo:elegy`, `source:codex`, `theme:consolidation`, `phase:1` into the existing tag list (de-duplicated, case-insensitive on label tags, case-preserving on insertion).
  - For each of the 5 roadmaps: merges `repo:74af0f7b5cc4`, `repo:55f0c2816d6a`, `repo:elegy-copilot`, `repo:elegy`, `source:codex`, `theme:<roadmap-theme>`, `phase:1` and the original feature tags. This satisfies R1.1's "goal-and-child include both forms" pattern so the roadmaps can match the goal's repo scope even without server-side inheritance.
  - Updates BOTH the entity's `tags_json` column AND the `tag_index` table inside a single SQLite transaction.
  - Emits one `planning_events` row per change with `correlation_id="copilot-git-consolidation-20260603"`, `event_type="tag_repair_direct_sqlite"`, and `payload_json` shape `{ scriptVersion: string, operator: string, runs: number, before: string[], after: string[], idempotencyKey: string }`. The `idempotencyKey` is `sha256(concatenation of sorted(entityId, "|", join("|", canonicalTags[])) tuples)` (i.e. one hash per entity's full canonical tag array; the SAME definition used in the ADR). An existing row with the same key aborts the run as a no-op. The `event_type` value and payload shape are AUTHORITATIVELY defined in `docs/system/direct-sqlite-repair-for-planning-tags-adr.md` (Decision 5); spec/plan use the same values.
  - Is idempotent: re-running it on a correctly-tagged record changes nothing and exits 0.
  → verify: `node scripts/repair-consolidation-tags.mjs --db "C:\Users\lolzi\.copilot\elegy-planning.db" --dry-run; node scripts/repair-consolidation-tags.mjs --db "C:\Users\lolzi\.copilot\elegy-planning.db"`
- R2.3 — After repair, `elegy-planning --db <path> tags` MUST show `repo:74af0f7b5cc4` and `repo:55f0c2816d6a` with `entityCount >= 6` (the goal plus 5 roadmaps) and `repo:elegy`, `repo:elegy-copilot` MUST still be present (compat tags remain).
  → verify: `& "C:\Users\lolzi\.copilot\managed-cli\planning\elegy-planning.exe" --db "C:\Users\lolzi\.copilot\elegy-planning.db" tags --json | Select-String -Pattern "repo:74af0f7b5cc4|repo:55f0c2816d6a|repo:elegy|repo:elegy-copilot"`
- R2.4 — After repair, `elegy-planning --db <path> goal show --goal-id GOAL-COPILOT-GIT-WORKTREE-VALIDATION-20260603 --json` MUST list the same 5 roadmaps, with the same IDs. No duplicates created.
  → verify: `& "C:\Users\lolzi\.copilot\managed-cli\planning\elegy-planning.exe" --db "C:\Users\lolzi\.copilot\elegy-planning.db" goal show --goal-id GOAL-COPILOT-GIT-WORKTREE-VALIDATION-20260603 --json | Select-String -Pattern "RM-" -SimpleMatch`

### R3 — Inherited Repo Scope Matching (Server)

The server-side `elegy-planning` bridge filter MUST match repo scope through both direct roadmap tags AND the parent goal's tags.

- R3.1 — `copilot-ui/routes/planning.js` MUST introduce a `roadmapInheritsGoalScope` flag, default `true`. When `true`, a roadmap matches a repo selection if EITHER the roadmap's own tags match OR the parent goal's tags match.
  → verify: `rg -n "roadmapInheritsGoalScope|resolveGoalForRoadmap" copilot-ui/routes/planning.js | Select-Object -First 10`
- R3.2 — `filterPlanningLiveRoadmaps` MUST also call a new `loadGoalTagsForRoadmaps(roadmaps)` helper that batches a `goal list` (or in-memory goal map from a single `goal show` per missing goal) and falls back to the goal map if the bridge does not expose a batch fetch.
  → verify: `node copilot-ui/tests/planning-roadmap-inheritance.test.js`
- R3.3 — `filterPlanningLiveTodos` and `filterPlanningLivePlans` MUST inherit scope through plan → roadmap → goal chain in that order, stopping at the first parent that has a matching `repo:*` tag.
  → verify: `node copilot-ui/tests/planning-roadmap-inheritance.test.js`
- R3.4 — The `assertPlanningEntityInRepo` guard in roadmap/goal/plan detail reads MUST respect inherited scope: a roadmap without a `repo:*` tag that is shown via its parent goal's scope MUST NOT 404.
  → verify: `node copilot-ui/tests/planning-roadmap-inheritance.test.js`

### R4 — Inherited Scope in the Planning UI

The Planning UI MUST use the same inherited matching as the server and MUST show unscoped/inherited records by default instead of auto-hiding them.

- R4.1 — The new `GET /api/planning/live/roadmaps?includeUnscoped=true` flag MUST be set by default in `listPlanningLiveRoadmaps` (the existing `PlanningExplorerView` already calls without repo params; this flag makes the intent explicit at the server level).
  → verify: `rg -n "includeUnscoped" copilot-ui/routes/planning.js copilot-ui/ui/src/lib/api/planning.ts`
- R4.2 — The new Explorer mode in `PlanningExplorerView.tsx` (the view already routed at `App.tsx:94-95`; see R5) MUST be the only UI path that shows the planning tab's primary view. The legacy authority/transfer/inline-graph viewports (currently in `PlanningAuthorityView.tsx`, which is dead code) MUST NOT be re-introduced into the explorer view. `PlanningAuthorityView.tsx` is kept as historical reference per R4.3.
  → verify: `rg -n "workspaceTab|Transfer|metric-grid" copilot-ui/ui/src/tabs/Planning/PlanningAuthorityView.tsx | Select-Object -First 5` (each must be 0 matches, except inside the explorer-mode render)
- R4.3 — When the user opens the planning tab, the explorer MUST show all records visible to the current repo selection, plus a clearly-labelled "Unscoped / inherited" section listing any records that are not directly tagged for the selected repo but match via parent inheritance.
  → verify: `node copilot-ui/tests/planning-explorer-inheritance.vitest.tsx`

### R5 — Robust Planning Explorer (UI)

Extend the existing `PlanningExplorerView` (already routed at `App.tsx:94-95`) with the richer filter and drill-down surface required by the plan.

- R5.1 — Add a "View" toggle with two options: "Roadmaps" (existing per-roadmap cards) and "Explorer" (new table view). The Explorer view MUST support these filters via a `FilterBar`:
  - Entity type: `goal | roadmap | work-point | plan | todo | issue | review-point` (multi-select).
  - Repo: list of repo labels resolved from the Copilot inventory (multi-select).
  - Status: entity-type-scoped multi-select.
  - Tag: free-form tag token (exact match, case-insensitive).
  - Source harness: `codex | opencode | copilot | antigravity | human` (multi-select).
  - Created/Updated date range: optional `from`/`to` ISO date inputs.
  - Parent goal: free-form goal ID with a "Pick from loaded goals" dropdown that lists the goals returned by the most recent explorer fetch. No async typeahead; the dropdown is populated from the same data the explorer already has.
  - Free-text search: matches title, summary, and description.
  → verify: `rg -n "FilterBar|filterState|onFilterChange" copilot-ui/ui/src/tabs/Planning/PlanningExplorerView.tsx | Select-Object -First 5`
- R5.2 — Show a "Warning buckets" panel above the table with counters for: `unscoped` (no `repo:*` tag, no inherited), `orphaned` (parent link points to a missing entity), `invalid-parent` (parent ID does not parse or does not exist), `stale` (no `updatedAt` in 30+ days), `active-session-missing` (no sidecar at the override path). Each counter is a clickable chip that filters the table to that bucket.
  → verify: `rg -n "WarningBucket|warningBuckets|active-session-missing" copilot-ui/ui/src/tabs/Planning/PlanningExplorerView.tsx | Select-Object -First 5`
- R5.3 — Drill-down: clicking a row opens a side panel showing the entity's raw JSON (truncated to 8KB), its tags, repo scope (direct + inherited), parent chain (goal → roadmap → plan), validation state, and copyable CLI commands (`elegy-planning show <entity>`) using `~/.elegy/planning.db`.
  → verify: `rg -n "DrillDownPanel|copyCommand|getDbPathForCommands" copilot-ui/ui/src/tabs/Planning/PlanningExplorerView.tsx | Select-Object -First 5`
- R5.4 — Add "Show all" and "Unscoped only" preset toggles to the FilterBar. "Show all" clears every filter except the entity-type and source-harness defaults. "Unscoped only" restricts to records with no direct `repo:*` tag.
  → verify: `node copilot-ui/tests/planning-explorer-filters.vitest.tsx`
- R5.5 — The "active session" status panel MUST be rendered above the explorer (even when the goal/roadmap area is empty). It reads `GET /api/planning/session` and shows either the active session metadata or an inline "Init session" button.
  → verify: `rg -n "SessionStatusPanel|getPlanningSession" copilot-ui/ui/src/tabs/Planning/PlanningExplorerView.tsx | Select-Object -First 5`
- R5.6 — The `GET /api/planning/explorer` endpoint returns `{ entities: Entity[], total: number, filterWarnings: Warning[], summary: { byType, byRepoScope, byBucket } }` where each `Entity` has the shape `{ entityType: 'goal'|'roadmap'|'work-point'|'plan'|'todo'|'issue'|'review-point', entityId: string, title: string, summary?: string, status?: string, tags: string[], repoScope: { direct: string[], inherited: string[] }, parentChain: { goalId?, roadmapId?, planId? }, createdAt?: string, updatedAt?: string, raw: object }` and each `Warning` has `{ entityType, entityId, bucket: 'unscoped'|'orphaned'|'invalid-parent'|'stale'|'inconsistent-tags', reason: string }`. This shape is the wire contract; downstream UI may add view-model fields but MUST NOT remove any of the above.

### R6 — Validation / Readiness Check Script

Add `scripts/validate-planning-metadata.js` that reports problems across the planning DB.

- R6.1 — The script MUST accept `--db <path>` and produce a JSON report on stdout. The report includes:
  - `unscoped`: array of `{ entityType, entityId, title, reason }` for entities that have no `repo:*` tag.
  - `orphaned`: array of `{ entityType, entityId, missingParentId }` for entities whose `goalId`/`planId`/`workPointId` points to a missing entity.
  - `invalidParents`: array of `{ entityType, entityId, parentField, parentId }` for parents that do not exist.
  - `duplicateTitles`: array of `{ entityType, title, ids }` for entities sharing the same title within the same scope.
  - `inconsistentTags`: array of `{ entityType, entityId, expectedTags, actualTags }` for child entities that lack the parent's repo tags.
  - `missingWorkItems`: array of `{ entityType: 'roadmap', entityId, title }` for roadmaps with zero work points, plans, or todos. This surfaces the data-depth gap documented in the Context Evidence (the 5 consolidation roadmaps each have zero work items).
  - `summary`: counts of each category.
  → verify: `node scripts/validate-planning-metadata.js --db "C:\Users\lolzi\.copilot\elegy-planning.db" --json` returns a JSON object whose top-level keys include all six arrays and `summary`.
- R6.2 — The script MUST exit non-zero when `--strict` is passed AND any of the following is true: `unscoped.length > 0`, `orphaned.length > 0`, `inconsistentTags.length > 0`, `missingWorkItems.length > 0`. `duplicateTitles` and `invalidParents` are warnings only and do not affect the exit code.
  → verify: `node scripts/validate-planning-metadata.js --db "C:\Users\lolzi\.copilot\elegy-planning.db" --strict` exits 1; without `--strict` the same report is produced and the script exits 0.
- R6.3 — The script MUST be additive to the existing `validate-specs.js` / `validate-planpack.js` governance. It is a new tool, not a replacement.
  → verify: `node scripts/validate-specs.js specs/planning-visibility-canonicalization` exits 0 after the new spec is added.

### R7 — Shared Planning Session Support

The Copilot/OpenCode/Codex scaffolding MUST surface the active planning session sidecar at `~/.elegy/planning-session.json`, and the server MUST expose it through a new endpoint.

- R7.1 — Add a new env var `INSTRUCTION_ENGINE_ELEGY_PLANNING_SESSION_PATH` documented in `catalog-assets/shared-skills/elegy-planning/SKILL.md`. The Copilot server reads the sidecar from this path if set, else from `~/.elegy/planning-session.json`, else from `<dbDir>/planning-session.json` (the CLI's current default).
  → verify: `rg -n "INSTRUCTION_ENGINE_ELEGY_PLANNING_SESSION_PATH" copilot-ui/lib/planningSession.js copilot-ui/routes/planning.js catalog-assets/shared-skills/elegy-planning/SKILL.md`
- R7.2 — New endpoint `GET /api/planning/session` returns `{ ready: boolean, sidecarPath, exists, sidecar: object | null, lastChecked, correlationId, availableAt: [{ path, exists, priority }] }`. The endpoint NEVER creates the sidecar; it only reads it. **`ready` is `true` when `exists` is `true` OR (`exists` is `false` AND the resolved `sidecarPath`'s parent directory exists and is writable by the current process).** When the sidecar exists, `sidecar` is the parsed JSON; otherwise `sidecar` is `null`.
  → verify: `node copilot-ui/tests/planning-session-endpoint.test.js`
- R7.3 — The endpoint MUST also report `availableAt` paths: an array of candidate paths it searched (in priority order) so the UI can show where to look. Each path includes its `exists` flag.
  → verify: `node copilot-ui/tests/planning-session-endpoint.test.js`
- R7.4 — The Codex/OpenCode bootstrap scripts (`scripts/codex-install.mjs`, `scripts/opencode-install.mjs`) MUST set `INSTRUCTION_ENGINE_ELEGY_PLANNING_SESSION_PATH=~/.elegy/planning-session.json` in the generated env on Windows.
  → verify: `rg -n "planning-session.json|INSTRUCTION_ENGINE_ELEGY_PLANNING_SESSION_PATH" scripts/codex-install.mjs scripts/opencode-install.mjs`
- R7.5 — The Copilot runtime (`copilot-ui/src/desktopRuntime/runtimeService.ts`) MUST set the same env var on the spawned Tauri process so the in-app shell reads from the override path.
  → verify: `rg -n "INSTRUCTION_ENGINE_ELEGY_PLANNING_SESSION_PATH" copilot-ui/src/desktopRuntime/runtimeService.ts`

### R8 — Bridge Surface Stability

The existing `roadmapWorkflowPlanningBridge` (`copilot-ui/lib/roadmapWorkflowPlanningBridge.js` or equivalent) MUST continue to expose `listRoadmaps`, `showRoadmap`, `listGoals`, `showGoal`, `listPlans`, `showPlan`, `listTodos`, `showTodo` with the existing signatures. The inherited-scope behavior is added inside the routes layer, not by changing the bridge contract.

- R8.1 — The bridge does not need to learn about parent goals. The routes layer is responsible for enriching the data before filtering.
  → verify: `rg -n "listRoadmaps|showRoadmap" copilot-ui/lib/roadmapWorkflowPlanningBridge.js | Select-Object -First 5` (signatures unchanged)

## Non-Goals

- Modifying the `elegy-planning` Rust CLI source. The CLI is shipped pre-compiled; tag-update and session-override behaviour changes are out of scope for this repo.
- Migrating the consolidation goal/roadmaps between databases. They already live in `C:\Users\lolzi\.copilot\elegy-planning.db`; we repair in place.
- Repairing the non-consolidation goals `GOAL-SMOKE-001`, `GOAL-MOCK-001`, and their child roadmaps. They are out of scope for this spec; if their metadata is later found to be inconsistent, follow-up work will repair them under a separate spec.
- Creating placeholder work points/plans/todos for the 5 consolidation roadmaps. The plan explicitly accepts reporting the gap; user chose "Verify and report gaps, do not create." The gap is surfaced by R6.1's `missingWorkItems` check.
- Periodically re-syncing a separate planning session sidecar. The canonical sidecar is `~/.elegy/planning-session.json`; no `.copilot` mirror is required.
- Redesigning the standalone graph window, the catalog workspace store, or the planning contract types. The existing `StandaloneGraphWindow` and `PlanningExplorerView` shell are reused; only the explorer view's filter/drill-down surface is extended.
- Adding a Tauri-side WebviewWindow split-screen. The existing `window.open()` (with the Tauri-aware fallback in `PlanningExplorerView.tsx:144-171`) is the windowing contract.
- Persisting the new filter/sort state across sessions. Filters live in component state; refresh resets them to defaults.
- Adding pagination to the explorer list. The 8-roadmap upper bound for the consolidated Copilot DB does not need pagination; add it later if the count exceeds 50.

## Acceptance Checks

- Goal and all 5 child roadmaps carry the canonical tag set after running the repair script, with stable IDs.
  → verify: run the validator and confirm no unscoped, orphaned, or inconsistent tags for the consolidation subtree
- Server-side roadmap filter matches a child roadmap against its parent goal's repo scope when the child has no repo tag of its own.
  → verify: run the inheritance test — child roadmap inherits parent goal repo scope
- The live roadmaps endpoint returns the consolidation roadmaps AND any other roadmaps tagged for the same repo.
  → verify: run the repo filter test — all 5 consolidation roadmaps returned
- Planning tab shows the consolidation roadmaps even when no repo is selected, and the active-session status panel is visible above the list.
  → verify: run the explorer inheritance test — 5 roadmap cards rendered, session panel visible
- The validation script exits 1 with a populated summary when the consolidation goal/roadmaps are un-tagged, and exits 0 after the repair script runs.
  → verify: run the roundtrip validator test
- The session endpoint returns the correct shape with ready defined correctly, and the response shape is stable even when the sidecar file does not yet exist.
  → verify: run the session endpoint test
- The install scripts set the planning session path env var on Windows.
  → verify: confirm the env var is set in the generated output
- The runtime sets the planning session path env var on the spawned process.
  → verify: search for the env var in the runtime service file
- The spec validation exits 0 with the new spec.
  → verify: run spec validator
- TypeScript compilation exits 0 with the explorer view changes.
  → verify: run TypeScript compiler
- The existing authority view is no longer routed and no new code references its export.
  → verify: search for the old view reference — 0 matches; search for the new view import — 1 match

## Implementation Links

- `docs/specs/planning-visibility-canonicalization/spec.md` — this file
- `docs/specs/planning-visibility-canonicalization/plan.md` — implementation order
- `scripts/repair-consolidation-tags.mjs` — new in-place DB repair script
- `scripts/validate-planning-metadata.js` — new metadata validator
- `scripts/elegy-planning-create.mjs` — new create helper that injects canonical tags
- `copilot-ui/lib/planningMetadata.js` — new shared resolver for canonical tags
- `copilot-ui/lib/planningSession.js` — new shared resolver for the sidecar path
- `copilot-ui/routes/planning.js` — modified inherited-scope filter + new session endpoint
- `copilot-ui/ui/src/lib/api/planning.ts` — new `getPlanningSession()` + `includeUnscoped` flag
- `copilot-ui/ui/src/App.tsx` — routing change: `'planning'` case routes to `PlanningExplorerView` instead of `PlanningAuthorityView`
- `copilot-ui/ui/src/tabs/Planning/PlanningExplorerView.tsx` — extended Explorer mode + drill-down
- `copilot-ui/ui/src/tabs/Planning/PlanningAuthorityView.tsx` — kept as historical reference only; the new Explorer mode lives in `PlanningExplorerView.tsx` (see R4.2)
- `copilot-ui/src/desktopRuntime/runtimeService.ts` — sets the new env var
- `scripts/codex-install.mjs` — sets the new env var in Codex env
- `scripts/opencode-install.mjs` — sets the new env var in OpenCode env
- `catalog-assets/shared-skills/elegy-planning/SKILL.md` — documents the env var
- `copilot-ui/tests/planning-roadmap-inheritance.test.js` — new
- `copilot-ui/tests/planning-session-endpoint.test.js` — new
- `copilot-ui/tests/planning-explorer-inheritance.vitest.tsx` — new
- `copilot-ui/tests/planning-explorer-filters.vitest.tsx` — new
- `copilot-ui/tests/planning-explorer.test.js` — new (server-side explorer endpoint test)
- `copilot-ui/tests/planning-live-roadmaps-repo-filter.test.js` — new (in-process server test for `?repoId=...` filter)
- `copilot-ui/tests/planning-explorer-view-state.vitest.ts` — new (pure-function hook test)
- `copilot-ui/lib/commandsForEntity.js` — new (CLI command builder for the drill-down panel)
- `scripts/repair-consolidation-tags.test.js` — new (in-memory DB test for the repair script)
- `scripts/validate-planning-metadata.test.js` — new (in-memory DB test for the validator)
- `scripts/roundtrip-validator-strict.test.js` — new (live-DB-copy + backup-then-repair-then-validate roundtrip)
- `docs/system/direct-sqlite-repair-for-planning-tags-adr.md` — new ADR documenting the decision to bypass the CLI for tag repair (R2.2) and the maintenance burden it creates. Reference for future contributors.

## Validation Evidence

- Pending implementation. The repair script and the explorer will be exercised end-to-end after implementation; the validator and unit tests are the primary evidence.

## Drift Notes

- The plan also mentions the legacy `align-elegy-db-assets` spec, which says "recreate" the consolidation goal/roadmaps. This spec REPLACES the recreate approach with an in-place repair (R2) because the CLI has no tag-update subcommand. The `align-elegy-db-assets` spec is not modified by this work; future cleanup may supersede it.
- The plan's "Add shared session support" calls for an env var override IN the CLI. This spec implements the override in the Copilot layer only (R7), because the CLI is shipped pre-compiled. The CLI's sidecar path is therefore read-only from the Copilot side; the override file is populated by the install scripts (R7.4). The override may go stale between reinstalls; a watchdog is out of scope (see Non-Goals).
- The plan's "Add robust planning exploration" requires entity-type, repo, status, tag, source-harness, date, parent-goal, and free-text filters. The explorer shell already supports the multi-repo fetch and sort. This spec adds the missing filter facets (R5.1) and warning buckets (R5.2) without rewriting the existing per-roadmap card layout.
- The decision to bypass the CLI and write directly to the SQLite `tags_json` and `tag_index` tables (R2.2) sets a precedent for direct DB manipulation, bypasses CLI validation/event logic, and creates a maintenance burden if the CLI schema changes. The decision is documented in `docs/system/direct-sqlite-repair-for-planning-tags-adr.md`; future work should add a `tag update` subcommand to the CLI so this path can be deprecated.
- The existing 6 work points and 6 plans in the Copilot DB are not linked to the consolidation goal. The `missingWorkItems` check in R6.1 surfaces this gap; the user has chosen NOT to create placeholder work items. Future work will segment the 5 roadmaps under a separate spec.
