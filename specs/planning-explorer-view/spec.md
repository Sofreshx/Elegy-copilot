---
spec_id: planning-explorer-view
title: Planning Explorer View
status: draft
type: feature
updated: 2026-06-03
---

# Planning Explorer View

## Intent

Replace the current `PlanningAuthorityView` tab with a clean, focused explorer view for browsing existing `elegy-planning` sessions (roadmaps). The new view prioritises discoverability: it lists roadmaps across all tracked repositories, allows filtering by repository, supports sorting by date, and opens the existing `PlanningGraphView` detail in a separate browser window so multiple sessions can be examined simultaneously.

## Context Evidence

- `copilot-ui/ui/src/tabs/Planning/PlanningAuthorityView.tsx` — current tab component (~1084 lines). Contains metric grid, Planning Authority status panel, repo-scoped roadmap sidebar, Explorer panel, Transfer tab, and an inline graph view when a roadmap is clicked.
- `copilot-ui/ui/src/tabs/Planning/PlanningGraphView.tsx` — existing interactive SVG tree graph detail view (~1198 lines). Accepts `roadmapId`, `repoQuery`, `onBack`, `onRefreshNeeded` props. Fetches its own data on mount. Used inline within `PlanningAuthorityView`.
- `copilot-ui/ui/src/lib/api/planning.ts:537-551` — `listPlanningLiveRoadmaps(query)` fetches roadmaps scoped to a single repo via `repoId`/`repoPath`/`repoLabel` query params. Only truthy params are sent.
- `copilot-ui/ui/src/lib/types.ts:178-190` — `PlanningLiveRoadmapSummary` has `id`, `goalId`, `title`, `summary`, `status`, `tags`, `createdAt`, `updatedAt`. Does NOT have a `repoId` field — the repo association is only known from the fetch context.
- `copilot-ui/ui/src/tabs/Assets/catalogWorkspaceStore.ts` — provides `repoInventory.repos[]` (list of tracked repos with `repoId`, `repoPath`, `repoLabel`, all optional/nullable) and `loadWorkspace()`.
- `copilot-ui/ui/src/tabs/Planning/PlanningAuthorityView.tsx:42-68` — `normalizeCatalogRepoEntry()` normalises raw repo entries. The original function only rejects entries where ALL four fields (repoId, repoPath, repoLabel, sources) are empty. An additional stricter filter (requiring `repoId` OR `repoPath`) MUST be applied after normalisation.
- `copilot-ui/ui/src/tabs/Planning/PlanningAuthorityView.tsx:391-397` — auto-load pattern: triggers `catalogWorkspaceStore.loadWorkspace()` on mount if `repoInventory` is null.
- `copilot-ui/ui/src/lib/stateDiagnostics.ts` — provides `humanizeToken()` for status display.
- `copilot-ui/ui/src/stores/navigation.ts` — sidebar item index 4 (`'planning'`) routes to `PlanningAuthorityView`.
- `copilot-ui/ui/src/App.tsx:83-102` — `renderContent()` switch-case dispatches to tab components. Must be modified to support standalone graph window mode via URL params.
- `copilot-ui/ui/vite.config.ts` — single-entry-point Vite config. No build changes in scope.
- `docs/system/spec-driven-development.md` — spec contract reference.

## Requirements

### R1 — Clean Planning List
Replace the entire `PlanningAuthorityView` tab content with a single-purpose roadmap list view. The component MUST render:
- A header region with the view title ("Planning Explorer") and a refresh button.
- A repository filter bar showing all tracked repos as toggleable chips/buttons.
- A sort control with options: "Created (newest first)" and "Last updated (newest first)".
- An empty state when no roadmaps match the current filters.

The following MUST be removed from this tab:
- The metric grid (`planning-metric-grid`).
- The Planning Authority panel.
- The Transfer tab and all session transfer UI.
- The inline `PlanningGraphView` (moved to a separate window — see R4).
- The "Explorer" detail panel.

### R2 — Repository Filtering
Roadmaps MUST be loaded across ALL known tracked repositories by default. The view MUST:
- On mount, trigger `catalogWorkspaceStore.loadWorkspace()` if `repoInventory` is null (replicating the existing auto-load pattern from `PlanningAuthorityView.tsx:391-397`).
- Normalise tracked repos using `normalizeCatalogRepoEntry()` (from `PlanningAuthorityView.tsx:50-68`) for per-field cleaning, then apply a SECOND filter that rejects entries where both `repoId` AND `repoPath` are empty/null — since we need at least one of them to scope the API call.
- Fetch roadmaps from each normalised repo with a separate `listPlanningLiveRoadmaps()` call. Each call passes only the defined, non-empty fields: `repoId` (if set), `repoPath` (if set), `repoLabel` (if set). Use `Promise.allSettled` for parallel execution.
- Merge results into a single flat list. Each roadmap object MUST be augmented with a synthetic `_repoSource` field containing `{ repoId: string; repoPath: string; repoLabel: string }` to preserve the repo association.
- Render roadmap list items with composite React keys: `${repoId}|${roadmap.id}` to prevent key collisions when the same roadmap ID exists in multiple repos.

**Partial API failure:** If some repo API calls fail, roadmaps from successful calls are still displayed. A non-blocking warning banner at the top of the list MUST indicate which repos failed to load (by repo label, with fallback to repoPath → repoId → "unknown repo").

**Repo label display:** Display `repoLabel`. If null/empty, fall back to `repoId`. If also null/empty, fall back to `repoPath`. If all three are absent, display "Unknown repo".

**Repo filter UI:** Display a row of toggleable repository chips above the roadmap list. Each chip shows the repo label (with the same fallback chain) and a selected/unselected state. When ALL repos are selected, show all roadmaps. When one or more repos are deselected, hide roadmaps belonging to those repos. When only a single repo is tracked, the chip row MAY be hidden to reduce UI noise (implementation discretion).

Persist the repo filter selection in component state only (not across sessions or tab switches).

### R3 — Sort
The view MUST support sorting the roadmap list by date:
- Default sort: "Last updated (newest first)" — descending by `updatedAt`.
- Alternative: "Created (newest first)" — descending by `createdAt`.
- Sort control as a dropdown or segmented button pair near the filters.
- Roadmaps with null/missing dates for the active sort field sort to the end of the list.
- Within each date-nullity group (null dates vs non-null dates), preserve API response order (stable sort).
- Sorting operates on the already-filtered result set.

### R4 — Open Detail in New Window (URL-Param Approach)
Clicking a roadmap card MUST open the `PlanningGraphView` in a separate browser window via the URL-parameter approach.

**Window opening:**
- Use `window.open()` to open a new browser window/tab with the URL `{window.location.origin}/?roadmapId={roadmap.id}&repoId={repo._repoSource.repoId}&repoPath={repo._repoSource.repoPath}&repoLabel={repo._repoSource.repoLabel}`.
- Omit query parameters whose values are null/empty/undefined.
- Do NOT specify a window name string — this ensures each click opens a new window, enabling multiple simultaneous detail windows.

**Standalone graph rendering in App.tsx:**
- `App.tsx` MUST check for the presence of `?roadmapId=` in `URLSearchParams` on mount.
- When `roadmapId` is present, App.tsx MUST render only a standalone `<StandaloneGraphWindow>` (which internally renders `<PlanningGraphView>`) WITHOUT the normal `AppLayout`/`Sidebar`/`StatusBar`/tab chrome.
- The `roadmapId` is read from the URL param; `repoQuery` is constructed from `repoId`, `repoPath`, `repoLabel` URL params.
- When `roadmapId` is NOT present, App.tsx renders the normal layout including sidebar and tab content (existing behaviour unchanged).

**Callback adaptation in standalone mode (wrapper component):**
- A thin wrapper component (`StandaloneGraphWindow`) renders `PlanningGraphView` with adapted callbacks:
  - `roadmapId` — from URL param.
  - `repoQuery` — from URL params.
  - `onBack` — calls `window.close()`. When `window.close()` is unavailable (popup blocker or non-script-opened window), renders a "Close Window" button in the controls overlay as a fallback.
  - `onRefreshNeeded` — no-op (there is no parent tab to notify; the graph view already fetches its own data and auto-polls).
- `PlanningGraphView.tsx` MUST NOT be modified internally. The adaptation is handled entirely by the wrapper and props.

**Independence guarantee:**
- Each standalone window fetches its own data independently.
- No shared state, no parent-window dependency.
- Closing one window does not affect others.
- Zoom/pan state, selected nodes, and detail panels are independent per window.

### R5 — Roadmap Card
Each roadmap entry in the list MUST display:
- Title (or ID if no title).
- Repo label (from the `_repoSource.repoLabel` with fallback chain per R2).
- Status chip (using `humanizeToken(roadmap.status)` from `stateDiagnostics.ts`).
- Summary text (truncated to one line if long, using CSS `text-overflow: ellipsis`).
- Last updated timestamp formatted via `new Date(value).toLocaleString()` (reusing the pattern from `PlanningAuthorityView.tsx:131-142`).

### R6 — Contracts (Extractable Pure Functions)
The following pure functions MUST be extractable from the view component and unit-testable independently:

- `normalizeRepoEntries(repos: unknown[]): RepoChoice[]` — wraps `normalizeCatalogRepoEntry`, filters nulls.
- `mergeRepoRoadmaps(results: PromiseSettledResult<PlanningLiveRoadmapsResponse>[], reposByIndex: RepoChoice[]): { roadmaps: AugmentedRoadmap[]; failedRepos: RepoChoice[] }` — merges successful fetches, augments roadmaps with `_repoSource`, collects failed repos.
- `filterBySelectedRepos(roadmaps: AugmentedRoadmap[], selectedRepoIds: Set<string>): AugmentedRoadmap[]` — predicate filter.
- `sortRoadmaps(roadmaps: AugmentedRoadmap[], by: 'created' | 'updated'): AugmentedRoadmap[]` — stable sort with nulls-last.
- `resolveRepoLabel(repo: { repoLabel?: string | null; repoId?: string | null; repoPath?: string | null }): string` — fallback chain.

Where `AugmentedRoadmap` is `PlanningLiveRoadmapSummary & { _repoSource: { repoId: string; repoPath: string; repoLabel: string } }`.

## Non-Goals

- No backend API changes. All repo-level filtering and merging is client-side.
- No pagination (initial scope; add if roadmap count exceeds 50+ in production).
- No text search bar (can be added later).
- No roadmap creation or editing from this view.
- No drag-and-drop reordering.
- No persistence of filter/sort state across tab switches or app restarts.
- No changes to `PlanningGraphView.tsx` internals (adaptation via wrapper component only).
- No changes to the Vite build configuration (single entry point preserved).
- No redesign of existing `planning-*` CSS classes (new classes may be added; existing classes reused if applicable).
- Test IDs for the new view use a `planning-explorer-*` prefix to avoid collision with removed components.

## Acceptance Checks

- **AC1 — Replaced tab:** Opening the Planning tab (sidebar item 4 or Ctrl+4) renders the new explorer view. The old metric grid, authority panel, transfer tab, and inline graph view are absent.
- **AC2 — Repo filter loads roadmaps:** With tracked repos configured, roadmaps from all repos appear in the list. Each roadmap card shows its repo label.
- **AC3 — Repo filter toggles:** Deselecting a repo chip hides roadmaps from that repo. Re-selecting it shows them again. Deselecting all repos shows the empty state.
- **AC4 — Sort:** Selecting "Created (newest first)" reorders the list by `createdAt` descending. Selecting "Last updated (newest first)" reorders by `updatedAt` descending. Items with null dates appear last. Ties preserve order.
- **AC5 — Open detail window:** Clicking a roadmap card opens a new browser window/tab.
  - AC5a: The window URL contains `?roadmapId=...` and relevant repo params.
  - AC5b: The window renders `PlanningGraphView` (SVG graph with at least one visible node).
  - AC5c: Clicking a node opens the detail panel with entity information.
  - AC5d: Zoom controls (+/−) change the graph scale.
  - AC5e: The "Close Window" / back button closes the window.
- **AC6 — Multiple windows:** Opening a second roadmap opens a second independent window. Zooming in window A does not affect window B. Closing window A does not close window B. Each displays the correct roadmap title.
- **AC7 — Empty state:** When no repos are selected, an appropriate empty-state message is shown.
- **AC8 — Refresh:** The refresh button re-fetches roadmaps from all tracked repos and re-applies the current filter and sort. If new repos appeared since last load, they are included.
- **AC9 — Partial API failure:** If one or more repo API calls fail, roadmaps from successful repos are shown, and a non-blocking warning lists the failed repos by label.

## Implementation Links

- `copilot-ui/ui/src/tabs/Planning/PlanningAuthorityView.tsx` — to be replaced.
- `copilot-ui/ui/src/tabs/Planning/PlanningGraphView.tsx` — reused in standalone window (no internal changes).
- `copilot-ui/ui/src/tabs/Planning/StandaloneGraphWindow.tsx` — new thin wrapper component for standalone mode.
- `copilot-ui/ui/src/tabs/Planning/PlanningExplorerView.tsx` — new replacment list view component.
- `copilot-ui/ui/src/tabs/Planning/planningExplorerContracts.ts` — new file for extractable pure functions (R6).
- `copilot-ui/ui/src/lib/api/planning.ts` — `listPlanningLiveRoadmaps` called per-repo.
- `copilot-ui/ui/src/tabs/Assets/catalogWorkspaceStore.ts` — source of tracked repos.
- `copilot-ui/ui/src/App.tsx` — add URL-param guard for standalone graph rendering; update tab routing to new `PlanningExplorerView`.

## Validation Evidence

- Pending implementation.

## Drift Notes

- None.
