# Implementation Plan: Planning Explorer View

**Spec:** `docs/specs/planning-explorer-view/spec.md`
**Date:** 2026-06-03
**Status:** Draft

## Overview

Replace the `PlanningAuthorityView` tab with a clean explorer view that lists roadmaps across all tracked repos, filters by repo, sorts by date, and opens detail views in separate windows via URL parameters.

## Steps

### Step 0 — Verify existing contracts (5 min)

Before any code changes, verify the following are true:
- `copilot-ui/ui/src/tabs/Planning/PlanningGraphView.tsx` renders correctly with `roadmapId` and `repoQuery` props when called standalone (no parent state leakage)
- `listPlanningLiveRoadmaps({repoId, repoPath, repoLabel})` in `planning.ts:537-551` works correctly per-repo
- `catalogWorkspaceStore.repoInventory.repos[]` returns an array (may be empty, may be null before `loadWorkspace()`)
- `normalizeCatalogRepoEntry()` in `PlanningAuthorityView.tsx:50-68` normalises entries correctly

Run: `cd copilot-ui/ui && npx tsc --noEmit` to confirm no existing type errors before starting.

**Tauri-specific verification:**
- Verify Tauri `window.open()` / `window.close()` behavior: launch the Tauri dev instance (`npm run desktop:dev` from copilot-ui), open a test URL via `window.open(url)`, confirm a new window opens independently, and confirm `window.close()` closes it. Verify `window.location.origin` resolves correctly in both dev and production Tauri builds.

### Step 1 — Extract pure functions (spec R6) (30 min)

**New file:** `copilot-ui/ui/src/tabs/Planning/planningExplorerContracts.ts`

Extract and export the following pure functions:

1. **normalizeRepoEntries** — normalises raw repo entries, filters nulls, rejects entries missing both repoId and repoPath
2. **resolveRepoLabel** — returns repoLabel, fallback to repoId, fallback to repoPath, fallback to "Unknown repo"
3. **mergeRepoRoadmaps** — iterates results, collecting fulfilled roadmaps augmented with repo source, collects failed repos
4. **filterBySelectedRepos** — matches roadmaps where compound key is in the selected set
5. **sortRoadmaps** — sorts descending by date field, null dates sort to end, stable sort

**New test file:** `copilot-ui/tests/planning-explorer-contracts.vitest.ts`
- Test each pure function independently:
  - `resolveRepoLabel` with all fallback chains
  - `mergeRepoRoadmaps` with mixed fulfilled/rejected results
  - `filterBySelectedRepos` with various set membership scenarios
  - `sortRoadmaps` with null dates, equal dates, mixed dates
- Run tests: `cd copilot-ui && npm test -- --testPathPattern planningExplorerContracts`

### Step 2 — Create PlanningExplorerView component (spec R1, R2, R3, R5) (60 min)

**New file:** `copilot-ui/ui/src/tabs/Planning/PlanningExplorerView.tsx`

The component:

#### State
```ts
const [roadmaps, setRoadmaps] = useState<AugmentedRoadmap[]>([]);
const [failedRepos, setFailedRepos] = useState<RepoChoice[]>([]);
const [loading, setLoading] = useState(true);
const [error, setError] = useState<string | null>(null);
const [sortBy, setSortBy] = useState<'updated' | 'created'>('updated');
// Use compound key "repoPath|repoId" to avoid collisions when repoId is empty
const [selectedRepoIds, setSelectedRepoIds] = useState<Set<string>>(new Set());
```

#### Data fetching (on mount + repo inventory change)
- Read `repoInventory` from `catalogWorkspaceStore` via `useStoreValue`
- If `repoInventory` is null, call `catalogWorkspaceStore.loadWorkspace()` (replicate pattern from `PlanningAuthorityView.tsx:391-397`)
- Normalise repos with `normalizeRepoEntries(repoInventory.repos)`
- Call `listPlanningLiveRoadmaps(...)` for each repo in parallel via `Promise.allSettled`
- Merge results with `mergeRepoRoadmaps()`
- Set `selectedRepoIds` to all repo IDs initially (showing all repos)
- On refresh: re-fetch all

#### Rendering (R1)
- `<section className="planning-explorer-view">` wrapper
- Header with "Planning Explorer" title + Refresh button
- **Filter bar:** If repos.length > 1, render toggleable repo chips. Each chip:
  - Displays `resolveRepoLabel(repo)`
  - Toggles the repo ID in/out of `selectedRepoIds`
  - Visual selected/unselected state (class toggle or `Button` variant)
- **Sort control:** `<select>` or Button pair with options "Last updated" / "Created"
- **Warning banner:** If `failedRepos.length > 0`, show "Failed to load from: repo1, repo2" warning
- **Loading state:** "Loading roadmaps across tracked repositories..." text
- **Error state:** If ALL fetches failed, show error message
- **Empty state:** "No roadmaps found" when filtered list is empty
- **Roadmap list:** Iterate `visibleRoadmaps` (filtered + sorted). Each card (R5):
  - Title (`roadmap.title || roadmap.id`)
  - Repo label (`resolveRepoLabel(roadmap._repoSource)`)
  - Status chip (`humanizeToken(roadmap.status)`)
  - Summary (single line, CSS `text-overflow: ellipsis`)
  - Last updated (`new Date(roadmap.updatedAt).toLocaleString()`)
  - `data-testid="planning-explorer-roadmap-${roadmap.id}"`
  - React key uses compound identifier to prevent key collisions across repos (spec R2)
    `key={\`\${roadmap._repoSource.repoPath}|\${roadmap._repoSource.repoId}|\${roadmap.id}\`}`
  - On click → call `openRoadmapDetail(roadmap)`

#### openRoadmapDetail (R4 window opening)
```ts
function openRoadmapDetail(roadmap: AugmentedRoadmap) {
  const params = new URLSearchParams();
  params.set('roadmapId', roadmap.id);
  if (roadmap._repoSource.repoId) params.set('repoId', roadmap._repoSource.repoId);
  if (roadmap._repoSource.repoPath) params.set('repoPath', roadmap._repoSource.repoPath);
  if (roadmap._repoSource.repoLabel) params.set('repoLabel', roadmap._repoSource.repoLabel);
  window.open(`${window.location.origin}/?${params.toString()}`);
}
```

#### Derived values (useMemo)
- `visibleRoadmaps` = `filterBySelectedRepos(roadmaps, selectedRepoIds)` → then `sortRoadmaps(..., sortBy)`
  - `selectedRepoIds` uses compound keys: `${repo.repoPath}|${repo.repoId}`
- `repos` = normalised repo list

### Step 3 — Create StandaloneGraphWindow wrapper (spec R4) (20 min)

**New file:** `copilot-ui/ui/src/tabs/Planning/StandaloneGraphWindow.tsx`

```
StandaloneGraphWindow
├── Reads URLSearchParams: roadmapId, repoId, repoPath, repoLabel
├── Builds repoQuery from URL params (omit undefined/null)
├── Renders <PlanningGraphView>
│   ├── roadmapId={fromParams}
│   ├── repoQuery={builtFromParams}
│   ├── onBack={() => window.close()}  // fallback: "Close Window" button in overlay
│   └── onRefreshNeeded={() => {}}     // no-op
└── If roadmapId is missing, render error: "No roadmap specified"
```

Key details:
- Check `typeof window !== 'undefined'` before reading URL params (SSR guard)
- The `window.close()` fallback: if `window.opener` is null (not opened by script), show a prominent "Close Window" button that calls `window.close()`
- The "Back to Roadmaps" button in `PlanningGraphView` will call `onBack` → `window.close()`
- Import `PlanningGraphView` from same directory

### Step 4 — Modify App.tsx (spec R4 integration) (15 min)

**File:** `copilot-ui/ui/src/App.tsx`

**4a. Early return for standalone graph window (before AppLayout)**

Add at the START of the `App()` component function body, before the `<AppLayout>` return:

```tsx
export default function App() {
  // R4: Standalone graph window via URL params — render without AppLayout/Sidebar/StatusBar
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    const roadmapId = params.get('roadmapId');
    if (roadmapId) {
      return (
        <>
          <ToastContainer />
          <StandaloneGraphWindow />
        </>
      );
    }
  }

  const navigationState = useStoreValue(navigationStore);
  ...
```

The guard MUST go BEFORE the `useStoreValue` call (or use a hook-safe approach). Consider extracting the guard into a separate component or using conditional rendering.

Add import at top:
```ts
import StandaloneGraphWindow from './tabs/Planning/StandaloneGraphWindow';
```

**4b. Update planning tab route**

Change line 92-93 from:
```ts
case 'planning':
  return <PlanningAuthorityView />;
```
to:
```ts
case 'planning':
  return <PlanningExplorerView />;
```

Update imports:
- Add: `import PlanningExplorerView from './tabs/Planning/PlanningExplorerView';`
- Remove: the line `import PlanningAuthorityView from './tabs/Planning/PlanningAuthorityView';`

### Step 5 — Cleanup & final verification (15 min)

- Remove `import PlanningAuthorityView` from App.tsx (if no longer referenced)
- Verify `PlanningAuthorityView.tsx` file is NOT deleted (it may be referenced elsewhere; check with grep). If only App.tsx imports it, mark as deprecated but keep the file.
- Verify no other file imports `PlanningAuthorityView` via grep: `rg "PlanningAuthorityView" copilot-ui/ui/src/ --include "*.tsx" --include "*.ts"`
- Run typecheck: `cd copilot-ui/ui && npx tsc --noEmit`
- Run all existing tests: `cd copilot-ui && npm test`
- Manual smoke test:
  - Open app → click Planning tab → see new explorer view
  - Verify repo chips appear and toggle
  - Verify sort works
  - Click a roadmap → new window opens with graph
  - Open a second roadmap → second window, both independent

### Step 6 — CSS (10 min)

- Add minimal CSS classes in `copilot-ui/ui/src/app.css`:
  - `.planning-explorer-view` — main wrapper
  - `.planning-explorer-header` — title + refresh
  - `.planning-explorer-filter-bar` — repo chip row
  - `.planning-explorer-sort` — sort control
  - `.planning-explorer-warning` — partial failure banner
  - `.planning-explorer-list` — roadmap card list
  - `.planning-explorer-card` — individual card (reuse some `.planning-entity-card` styles)
  - `.planning-explorer-empty` — empty state

- Reuse existing utility classes where applicable (`.form-input`, `.form-label`, `.planning-chip`, `.state-message`)

## Dependency Order

```
Step 0 (verify) → Step 1 (contracts + tests) → Step 2 (main view) → Step 3 (standalone wrapper) → Step 4 (App.tsx) → Step 5 (cleanup) → Step 6 (CSS)
```

Steps 1-2-3 can partially overlap, but Step 4 MUST come after Steps 2 and 3.

## Risk Points

| Risk | Mitigation |
|------|-----------|
| `PlanningGraphView` leaks parent state | Verified in Step 0 — it fetches its own data (line 560-615 of graph view) |
| `window.close()` blocked by browser | Fallback: Show "Close Window" button. Documented in Step 3 |
| Multiple repos cause slow load | Use `Promise.allSettled` for parallelism. Add loading indicator per Step 2 |
| `normalizeCatalogRepoEntry` not exportable | Step 1 copies the logic; no import dependency needed |
| Old Planning view imported elsewhere | Step 5 grep check before cleanup |
| CSS conflicts with existing `planning-*` classes | New `planning-explorer-*` prefix avoids collisions |

## Spec Coverage Map

| Spec Requirement | Implemented In |
|-----------------|----------------|
| R1 — Clean list | Step 2 (PlanningExplorerView.tsx), Step 6 (CSS) |
| R2 — Multi-repo + filter | Step 1 (mergeRepoRoadmaps), Step 2 (fetch + filter UI) |
| R3 — Sort | Step 1 (sortRoadmaps), Step 2 (sort control) |
| R4 — New window | Step 3 (StandaloneGraphWindow), Step 4 (App.tsx guard) |
| R5 — Card layout | Step 2 (rendering) |
| R6 — Contracts | Step 1 (planningExplorerContracts.ts + tests) |
| AC1 — Tab replaced | Step 4 (route change), Step 5 (old import removal) |
| AC2 — Repos load | Step 2 (fetch logic) |
| AC3 — Filter toggles | Step 2 (filter chips + filterBySelectedRepos) |
| AC4 — Sort | Step 2 (sort control + sortRoadmaps) |
| AC5 — Detail window | Step 3 (wrapper), Step 4 (URL guard) |
| AC6 — Multiple windows | Step 2 (no window name in open()) |
| AC7 — Empty state | Step 2 (empty state rendering) |
| AC8 — Refresh | Step 2 (refresh button) |
| AC9 — Partial failure | Step 1 (mergeRepoRoadmaps), Step 2 (warning banner) |
