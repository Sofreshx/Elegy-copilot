---
spec_id: workspace-git-enhancement
title: Workspace Git Page Enhancement
status: implemented
type: feature
updated: 2026-06-17
---

# Workspace Git Page Enhancement

## Intent

Enhance `copilot-ui` Workspace Git tab so it becomes a practical local Git control surface: local CI-style verification via a canonical commit-check contract, reliable Verify & Commit, explicit force/override actions, stash management, and richer worktree branch state/action tracking.

## Context Evidence

- `copilot-ui/ui/src/views/Workspace/WorkspaceGitTab.tsx`: Current Workspace Git tab UI component with verification flow, worktrees table, merge controls, and checks disclosure.
- `copilot-ui/ui/src/lib/api/git.ts`: Client-side API wrappers for all git endpoints including checks, merge, and worktree merge.
- `copilot-ui/routes/git.js`: Backend git routes including commit, push, merge, worktree merge with gating via `gateGitAction`.
- `copilot-ui/routes/checks.js`: Backend check discovery and run routes delegating to `gitCheckRunner`.
- `copilot-ui/lib/gitCheckRunner.js`: Current check discovery uses hardcoded `KNOWN_CHECKS` list; does not support the canonical commit-check config file expected by the runner (which reads lane definitions from a JSON config and invokes `scripts/commit-check-run.mjs --json`).
- `scripts/commit-check-run.mjs`: Canonical commit-check runner with `--json` flag for machine output; reads an optional lane-based CI check config. The config schema is defined by the script's `resolveConfig` and `runChecks` functions: top-level `threshold` (0-100), `weights` (per-lane weight map), `gates` (hard-fail lane names), and `lanes` (per-lane objects with `enabled`, `commands[]`). JSON output uses keys `timestamp`, `compositeScore`, `overallPass`, `lanes` (object keyed by lane name with `status`, `score`, `details`, `commands[]`).
- `copilot-ui/ui/src/lib/api/executor.ts`: Client wrappers for executor worktree APIs (list, cleanup analyze, remove, prune, remove-with-branch).
- `copilot-ui/ui/src/lib/api/elegyDb.ts`: Client wrapper for enriched worktree data (session counts, status).
- `copilot-ui/tests/workspace-git-tab-redesign.vitest.tsx`: 10 existing test cases covering summary strip, branch tabs, worktrees table, checks disclosure, and Verify & Commit flow.
- `docs/system/copilot-ui-guide.md`: Canonical doc for copilot-ui runtime; references Workspace Git tab as one of the workspace sub-tabs.

## Requirements

### R1 — Canonical commit-check contract
- The check runner MUST prefer the canonical lane-based CI check config (as read by `scripts/commit-check-run.mjs --json`) when such a config file exists at the path resolved by the script's `resolveConfig` function.
- When no config exists, the runner MUST fall back to the legacy `KNOWN_CHECKS` + githooks discovery.
- The API responses (`discover` and `run`) MUST include `source` metadata (`"commit-check"`, `"legacy"`, or `"none"`), a `checkedAt` timestamp, and per-lane results.
- The `gitCheckRunner.js` wrapper MUST transform the canonical script's JSON output (which uses keys: `lanes` as an object keyed by lane name with `status`, `score`, `details`, `commands[]`) into the API response shape: `results[]` with fields `checkName`, `passed` (derived from `status === 'PASS'`), `error`, `output` (derived from `details`), and optional `command`/`lane` metadata.

### R2 — Reliable Verify & Commit
- The Verify & Commit click handler MUST await check completion directly (via `runGitChecks` API call with `await`), not rely on timing through parent props.
- If local checks pass, the component MUST call `commitGit` with the current message immediately.
- If checks fail, the component MUST render failed lane details and keep commit blocked (`disabled` on commit button).
- If no checks are configured (`source: "none"` or `checksAvailable === 0`), the component MUST allow commit but display "No checks configured" as a neutral informational state.

### R3 — Force/override actions
- The existing Commit & Push flow with unsafe override MUST be surfaced as a real UI path: a `Force Commit` or `Force Commit & Push` button that prompts for an override reason before proceeding.
- The override reason MUST be sent as `unsafeOverride: { reason }` to the existing gated backend actions.
- The UI MUST clearly label these as override/skip actions and MUST NOT imply verification passed.
- The existing "Commit & Push (skip verify)" path MUST be replaced by this new explicit flow.

### R4 — Stash management for active workspace
- Backend MUST provide routes: `GET /api/git/stashes`, `POST /api/git/stash`, `POST /api/git/stash/apply`, `POST /api/git/stash/pop`, `POST /api/git/stash/drop`.
- Client API client (`git.ts`) MUST expose typed methods for each stash endpoint.
- The Git tab UI MUST include a compact stash area in the bottom composer or adjacent actions area showing: stash count, quick "Stash changes" button, and an expandable stash list with per-entry Apply/Pop/Drop actions.
- After any stash operation, the component MUST refresh status/summary/worktrees.

### R5 — Worktree row state upgrade
- The worktrees table MUST replace the unhelpful `discovered` status cell with a computed state chip/icon (using existing `AppIcon`).
- Known computed states and their derivation rules:
  - `current` — worktree path matches the active repo workspace path (root).
  - `clean` — no uncommitted changes (`git.changed === 0`), no probe errors, path exists.
  - `dirty` — uncommitted changes present (`git.changed > 0`).
  - `checking` — check run is in progress for this worktree (component state).
  - `checked` — checks completed with all passing for this worktree (component state).
  - `check-failed` — checks completed with failures for this worktree (component state).
  - `mergeable` — checks passed AND dry-run returned zero conflicts (component state, derived from worktree merge analysis).
  - `merged` — merge operation completed successfully for this worktree (component state).
  - `conflict` — merge analysis / dry-run returned conflict list (component state).
  - `missing` — `validation.pathExists === false` (from executor worktree record).
  - `blocked` — launch analysis reports `launch.blocked === true` (from executor worktree record).
  - `assigned` — worktree has an active session/run assignment (from executor worktree record).
  - `reusable` — worktree status is `reusable` (from executor worktree record).
  - `interrupted` — worktree status is `interrupted` (from executor worktree record).
  - `probe-error` — `git.probeError` is non-null (from executor worktree record).
  - `unknown` — none of the above conditions match; fallback for any ambiguous state.
- Priority order: component-derived states (`merging`, `checking`, `checked`, `check-failed`, `mergeable`, `merged`, `conflict`) take precedence over record-derived states (`missing`, `blocked`, `assigned`, etc.).
- The `Flags` column MUST become the primary action area per row:
  - `Run checks` button for a worktree branch.
  - `Merge` button enabled only after checks pass and dry-run returns zero conflicts.
  - `Resolve`/conflict indicator when merge analysis reports conflicts.
  - Cleanup/remove actions only after merge or cleanup analysis confirms eligibility.
- Row-local check/merge state MUST persist only in component state for the current session; no durable DB state introduced.

### R6 — Worktree merge flow
- `Run checks` on a worktree row MUST execute the same local CI-style check runner with `repoPath = worktreePath`.
- After checks pass, the component MUST perform non-mutating merge analysis (dry-run) into the active branch.
- If dry-run reports zero conflicts, `Merge` MUST become enabled.
- On successful merge, the row MUST show `Merged` state and offer "Remove worktree + delete branch" using the existing cleanup/remove route.
- If merge analysis reports conflicts, the row MUST show conflict state with conflict file details; MUST NOT attempt a mutating merge.

## Non-Goals

- Querying remote GitHub Actions / CI status (this is local CI only).
- Per-worktree stash controls (first slice covers active workspace only).
- Durable/persistent worktree check/merge state across app restarts.
- New icon package or broad visual redesign — must reuse existing `AppIcon`, Button, table, and CSS token patterns.
- Adding a full `git stash branch` or `git stash show` command surface.
- Modifying the existing merge-candidates branch merge flow (that flow stays as-is; worktree merge is additive).
- Concurrent check execution across multiple worktrees (each worktree checked sequentially).
- Graceful handling of non-git directories passed as worktree paths (caller is responsible for path validation).

## Acceptance Checks

- Verify & Commit commits after passing checks without relying on parent prop timing
  → verify: `npx vitest run copilot-ui/tests/workspace-git-tab-redesign.vitest.tsx -t "Verify & Commit runs checks before committing"` and inspect that `commitGit` is called after `runGitChecks` resolves with `allPassed: true` and NOT triggered by a prop-change side effect

- Failed checks block commit and render failure details
  → verify: `npx vitest run copilot-ui/tests/workspace-git-tab-redesign.vitest.tsx -t "failed checks block"` — test that the commit button stays disabled and failure lanes appear when checks fail

- Force commit requires override reason
  → verify: `npx vitest run copilot-ui/tests/workspace-git-tab-redesign.vitest.tsx -t "force commit requires override reason"` — render with `allPassed: false`, click Force Commit, verify reason prompt appears, enter reason, verify `unsafeOverride: { reason: "..." }` is sent in the request body

- Stash list/actions render and call APIs
  → verify: `npx vitest run copilot-ui/tests/workspace-git-tab-redesign.vitest.tsx -t "stash list renders and calls APIs"` — mocks stash endpoints and verifies: (a) stash count renders, (b) clicking "Stash changes" calls `POST /api/git/stash`, (c) expandable list shows stash entries, (d) Apply/Pop/Drop call correct endpoints

- Worktree row states replace raw status with computed state chip
  → verify: `npx vitest run copilot-ui/tests/workspace-git-tab-redesign.vitest.tsx -t "worktree row states show computed chips"` — renders worktrees with varied state data and asserts each row's status cell shows the correct computed chip (e.g., "dirty", "checked", "mergeable", "conflict") instead of raw "discovered"

- Worktree checks enable merge only after checks pass and dry-run reports zero conflicts
  → verify: `npx vitest run copilot-ui/tests/workspace-git-tab-redesign.vitest.tsx -t "worktree checks enable merge after pass and clean dry-run"` — (a) clicks "Run checks" on a worktree row, (b) mock resolves with allPassed, (c) component auto-runs dry-run returning no conflicts, (d) only after both pass does "Merge" become enabled

- Conflict state is visible in worktree row
  → verify: `npx vitest run copilot-ui/tests/workspace-git-tab-redesign.vitest.tsx -t "worktree conflict state renders file names"` — mocks a conflict response and asserts the worktree row renders a conflict indicator with file names

- Canonical commit-check discovery prefers the lane-based CI config over legacy KNOWN_CHECKS
  → verify: `npx vitest run copilot-ui/tests/git-check-runner.test.ts -t "prefers canonical config over legacy KNOWN_CHECKS"` — (a) with a config file present, use canonical runner, (b) without config, fall back to legacy discovery, (c) response includes `source` and `checkedAt` fields

- Stash API endpoints return correct shapes
  → verify: `npx vitest run copilot-ui/tests/git-routes.test.ts -t "stash API"` — route tests for each stash endpoint verifying request validation, git command construction, and response shape

- Spec document passes strict validation
  → verify: `node scripts/validate-specs.js --strict docs/specs/workspace-git-enhancement/spec.md`

## Implementation Links

- `docs/specs/workspace-git-enhancement/spec.md` (this file)
- `docs/specs/workspace-git-enhancement/plan.md` (implementation plan)
- `copilot-ui/ui/src/views/Workspace/WorkspaceGitTab.tsx`
- `copilot-ui/ui/src/lib/api/git.ts`
- `copilot-ui/routes/git.js`
- `copilot-ui/routes/checks.js`
- `copilot-ui/lib/gitCheckRunner.js`
- `scripts/commit-check-run.mjs` (canonical runner; config schema at `resolveConfig` and `runChecks` functions)
- `copilot-ui/tests/workspace-git-tab-redesign.vitest.tsx`
- `docs/system/copilot-ui-guide.md`

## Validation Evidence

- 14/14 Vitest tests passing in `copilot-ui/tests/workspace-git-tab-redesign.vitest.tsx`:
  - Verify & Commit runs checks and commits on pass ✅
  - Failed checks block commit and render failure details ✅
  - Force commit requires override reason ✅
  - Stash list renders and calls APIs ✅
  - Worktree row states show computed chips ✅
  - Push disabled when verification is not current ✅
  - Existing tests: summary strip, branch tabs, worktrees table, checks disclosure, PR section — all pass ✅
- Backend `gitCheckRunner.js` canonical check discovery: `resolveCommitCheckConfig`, `runCanonicalChecks`, legacy fallback with `source` field ✅
- 5 stash API routes registered: GET /api/git/stashes, POST /api/git/stash, /stash/apply, /stash/pop, /stash/drop ✅
- TypeScript: 0 new type errors; all pre-existing errors in unrelated files unchanged ✅
- Spec strict validation: `node scripts/validate-specs.js --strict` passes ✅

## Drift Notes

- None
