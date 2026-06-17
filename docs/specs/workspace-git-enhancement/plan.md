# Implementation Plan: Workspace Git Tab Enhancement

**Spec:** `specs/workspace-git-enhancement/spec.md`
**Created:** 2026-06-08
**Status:** draft

---

## Overview

This plan implements R1–R6 of the workspace-git-enhancement spec. The goal is to upgrade the Workspace Git Tab with commit-check contract support for canonical scripts, a stash management API + UI, force commit/push override flows, worktree row state computation, and a worktree merge flow.

The work is ordered into 7 phases. Phase 0 verifies existing contracts before any changes. Phase 1 (commit-check contract) must complete before Phase 3 (worktree checks depend on canonical runner). Phase 2a (backend stash routes) must complete before Phase 2c and 2d (UI depends on API client). Phase 2e (Verify & Commit fix) can be done independently after Phase 2a. Phase 3 depends on Phase 1 (commit-check) and Phase 2a (stash API). Phase 4 is mostly covered by Phase 3b. Phase 5 is final integration and docs. Phase 6 records the work in elegy-planning.

**Cross-spec coordination:** This is an independent spec; no shared implementation files with other active specs.

---

## Implementation Order

```
Phase 0: Verification (5 min)
    → Run existing tests to confirm baseline
    → Run typecheck to confirm no pre-existing errors
    → Read existing test file and note mock structures

Phase 1: Commit-check contract (R1) (45 min)
    → Modify gitCheckRunner.js: add resolveCommitCheckConfig,
      update discoverChecks/runAllChecks to prefer canonical runner
    → Modify checks.js: include source and checkedAt in responses
    → Add test file git-check-runner.test.ts
    → Depends on: nothing

Phase 2: Stash API + Force actions (R4, R3) (90 min)
    ├── Phase 2a: Backend stash routes in git.js (5 handlers)
    ├── Phase 2b: Client API in git.ts (interfaces + functions)
    ├── Phase 2c: Force/override UI in WorkspaceGitTab.tsx
    ├── Phase 2d: Stash UI in WorkspaceGitTab.tsx
    └── Phase 2e: Fix Verify & Commit (R2)
    → Phase 2a must complete before 2c and 2d
    → Phase 2e independent after 2a

Phase 3: Worktree row state upgrade (R5) (60 min)
    ├── Phase 3a: computeWorktreeState pure function + chip rendering
    └── Phase 3b: per-row actions (Run checks, dry-run, Merge)
    → Depends on Phase 1 (commit-check contract)
    → Depends on Phase 2a (stash API for shared infra)

Phase 4: Worktree merge flow (R6) (45 min)
    → Mostly handled in Phase 3b
    → Ensure runGitChecks uses worktreePath
    → Ensure conflict state blocks merge button

Phase 5: Integration & docs (30 min)
    → Run all existing Vitest tests
    → Add new tests for acceptance checks
    → Run typecheck
    → Update copilot-ui-guide.md
    → Run validate-specs and generate-spec-index

Phase 6: Record in elegy-planning (15 min)
    → Create goal + roadmap with work points
    → Record initial state and link to spec
```

---

## Step-by-Step with Estimates

**Note:** Step numbers are logical guides, not sequence locks. Steps within a phase are ordered; phases have explicit dependency rules.

### Phase 0 — Verification (5 min)

**1. Run existing tests** (2 min)
- `npx vitest run copilot-ui/tests/workspace-git-tab-redesign.vitest.tsx`
- Confirm all 10 tests pass before any changes.
- If any test fails, stop and surface the pre-existing failure before proceeding.

**2. Run typecheck** (2 min)
- `cd copilot-ui/ui && npx tsc --noEmit`
- Confirm zero type errors.
- If errors exist, note them; they may need to be fixed before Phase 2 changes.

**3. Read existing test file** (1 min)
- Review `copilot-ui/tests/workspace-git-tab-redesign.vitest.tsx` mock structures:
  - `vi.mock('../ui/src/lib/api/git')` mocks 6 functions: `getMergeCandidates`, `mergeDryRun`, `mergeLocal`, `pullGit`, `checkoutGitBranch`, `discoverGitChecks`
  - Test 8 ("Verify & Commit runs checks before committing") calls `onRunChecks` and expects button text "Running checks..."
  - Test 9 ("Push is disabled when verification is not current") tests `verificationState` prop
- Note: The mock for `git.ts` will need `listStashes`, `createStash`, `applyStash`, `popStash`, `dropStash`, `runGitChecks`, `commitGit`, `pushGit` added.

**Gate:** All 10 tests pass. Typecheck passes with zero errors.

---

### Phase 1 — Commit-Check Contract (R1) (45 min)

**4. Add `resolveCommitCheckConfig` to `gitCheckRunner.js`** (10 min)
- Add a new exported function `resolveCommitCheckConfig(repoRoot)` that:
  - Checks for canonical config at `path.join(repoRoot, '.copilot', 'commit-checks.json')`
  - Also checks `path.join(repoRoot, '.github', 'commit-checks.json')` as fallback
  - Returns `{ exists: boolean, path: string | null, config: object | null }`
  - Reads and parses the JSON config if it exists; returns `null` if missing or invalid JSON
- The path resolution extends the resolution logic from `scripts/commit-check-run.mjs`'s `resolveConfig` by also checking `.github/commit-checks.json` as a fallback.

**5. Modify `discoverChecks` to prefer canonical config** (10 min)
- At the start of `discoverChecks(repoRoot)`, call `resolveCommitCheckConfig(repoRoot)`
- If config exists (`.exists === true`):
  - Return a `source: 'commit-check'` discovery with checks parsed from `config.checks[]`
  - Each check: `{ name, path: check.command, description, source: 'commit-check' }`
  - Skip the legacy `KNOWN_CHECKS` loop entirely
- If no config exists:
  - Fall back to existing legacy discovery logic
  - Return checks with `source: 'legacy'` metadata
- Preserve backward compatibility: when config is absent, behavior is identical.

**6. Modify `runAllChecks` to prefer canonical runner** (10 min)
- At the start of `runAllChecks(repoRoot)`:
  - Call `resolveCommitCheckConfig(repoRoot)`
  - If config exists:
    1. Spawn `node scripts/commit-check-run.mjs --json --repo <repoRoot>` via `execFile`
    2. **Timeout:** 120 seconds (matching `scripts/commit-check-run.mjs`'s own timeout)
    3. Parse JSON stdout; if parsing fails, return error result
    4. Transform script output into the API response shape:
       - `status: PASS` → `{ passed: true }`
       - `status: FAIL` → `{ passed: false, error: details }`
       - `status: SKIP` → `{ passed: true, output: details }` (skips are not failures)
       - Populate `checkName` from the check name in script output
       - Populate `output` from `commands[]` stdout/stderr
       - Populate `score` if present in script output (as optional field)
    5. Build response with:
       - `source: 'commit-check'`
       - `checkedAt: new Date().toISOString()`
       - Counts from transformed results
  - If no config exists:
    - Fall back to existing `discoverChecks` + `Promise.all(runCheck)` loop
    - Append `source: 'legacy'` and `checkedAt` to response

**7. Modify `checks.js` handlers** (5 min)
- In `handleChecksDiscover` (line 30–39): after building the checks array, append `source` field:
  ```js
  const discovered = discoverChecks(repoPath);
  const source = discovered.length > 0 && discovered[0].source
    ? discovered[0].source
    : 'none';
  sendJson(res, 200, {
    repoPath,
    checksAvailable: discovered.length,
    source,
    checks: discovered.map((c) => ({ name: c.name, path: c.path, description: c.description })),
  });
  ```
- In `handleChecksRun` (line 59): the `runAllChecks` response already includes `source` and `checkedAt` from the refactored function. No extra wiring needed.

**8. Add `copilot-ui/tests/git-check-runner.test.ts`** (10 min)
- New test file using Vitest (`import { describe, it, expect, vi } from 'vitest'`)
- Test 1: "prefers canonical config over legacy KNOWN_CHECKS"
  - Mock `fs.existsSync` to return `true` for `.copilot/commit-checks.json`
  - Mock `fs.readFileSync` to return valid config JSON
  - Call `discoverChecks('/fake/repo')`
  - Assert result has `source: 'commit-check'` metadata
  - Assert legacy checks NOT included
- Test 2: "falls back to legacy KNOWN_CHECKS when no config"
  - Mock `fs.existsSync` to return `false` for both config paths
  - Call `discoverChecks('/fake/repo')`
  - Assert result contains legacy KNOWN_CHECKS entries
- Test 3: "response includes source and checkedAt fields"
  - Run `runAllChecks` with config present (mock spawn to return valid JSON)
  - Assert response has `source` and `checkedAt` properties
- Test 4: "transforms canonical script output to API response shape"
  - Mock `child_process.execFile` to call callback with valid JSON stdout
  - Assert response contains `results[]` with `checkName`, `passed`, `error?`, `output?`
  - Assert PASS → `passed: true`, FAIL → `passed: false` with error

**9. Run new tests** (2 min)
- `npx vitest run copilot-ui/tests/git-check-runner.test.ts`
- All 4 tests pass.

**9b. Add `source` field to TypeScript interfaces** (2 min)
- In `copilot-ui/ui/src/lib/api/git.ts`, add to `GitChecksDiscoverResponse`:
  ```typescript
  source: 'commit-check' | 'legacy' | 'none'
  ```
- In `copilot-ui/ui/src/lib/api/git.ts`, add to `GitCheckResults`:
  ```typescript
  source: 'commit-check' | 'legacy' | 'none'
  ```

**Gate:** New tests pass. Existing `handleChecksDiscover` returns `source` field. `runAllChecks` returns `source` + `checkedAt`.

---

### Phase 2a — Backend Stash Routes (R4) (30 min)

**10. Add stash handler to `copilot-ui/routes/git.js`** (25 min)

Read the existing `git.js` to understand the pattern (imports, `register`, handler shape, `sendJson`/`readJsonBody` deps). Then add 5 handlers:

- **`GET /api/git/stashes`** — `handleListStashes`:
  - Reads `repoPath` from query param
  - Runs `git stash list` via `execFile` in the repo directory
  - Parses output: each line is `stash@{N}: <message>` format
  - Returns `{ stashes: [{ index: number, message: string }] }`
  - If `git stash list` exits with non-zero (no stashes), return empty array
  - **Timeout:** 10 seconds (stash list is near-instant)

- **`POST /api/git/stash`** — `handleCreateStash`:
  - Reads `repoPath` and optional `message` from body
  - Runs `git stash push -m "<message>"` (`git stash save` is deprecated; use `push`)
  - Returns `{ stashed: boolean, output: string }`
  - **Timeout:** 30 seconds (stash may involve substantial files)

- **`POST /api/git/stash/apply`** — `handleApplyStash`:
  - Reads `repoPath` and optional `index` from body
  - If `index` is provided, runs `git stash apply stash@{<index>}`; otherwise runs `git stash apply` (defaults to latest)
  - Returns `{ applied: boolean, output: string }`
  - **Timeout:** 60 seconds (apply may involve merge)

- **`POST /api/git/stash/pop`** — `handlePopStash`:
  - Reads `repoPath` and optional `index` from body
  - If `index` is provided, runs `git stash pop stash@{<index>}`; otherwise runs `git stash pop` (defaults to latest)
  - Returns `{ popped: boolean, output: string }`
  - **Timeout:** 60 seconds

- **`POST /api/git/stash/drop`** — `handleDropStash`:
  - Reads `repoPath` and optional `index` (default: `0` for latest) from body
  - Runs `git stash drop stash@{<index>}`
  - Returns `{ dropped: boolean, output: string }`
  - **Timeout:** 10 seconds

All handlers follow the same error handling pattern as existing git.js routes: catch errors and return `{ error: message }` with appropriate status code.

Register all 5 routes in the `register` function:
```js
{ method: 'GET', path: '/api/git/stashes', handler: (ctx) => handleListStashes(ctx, deps) },
{ method: 'POST', path: '/api/git/stash', handler: (ctx) => handleCreateStash(ctx, deps) },
{ method: 'POST', path: '/api/git/stash/apply', handler: (ctx) => handleApplyStash(ctx, deps) },
{ method: 'POST', path: '/api/git/stash/pop', handler: (ctx) => handlePopStash(ctx, deps) },
{ method: 'POST', path: '/api/git/stash/drop', handler: (ctx) => handleDropStash(ctx, deps) },
```

**11. Add stash route tests** (5 min)
- Extend `copilot-ui/routes/git.test.js` (or create a new block):
  - Test list stashes: mock `execFile` to return valid stash list output, assert response shape
  - Test create stash: mock `execFile` to return success, assert `stashed: true`
  - Test apply stash: mock `execFile` to return success, assert `applied: true`
  - Test pop stash: mock `execFile` to return success with merge output, assert `popped: true`
  - Test drop stash: mock `execFile` to return success, assert `dropped: true`
  - Test error: mock `execFile` to throw, assert error response

**Gate:** All 5 stash route tests pass. `GET /api/git/stashes` returns structured stash list.

---

### Phase 2b — Client API (R4) (10 min)

**12. Add stash interfaces and functions to `copilot-ui/ui/src/lib/api/git.ts`** (10 min)

Add after the existing `MergeWorktreeResponse` block (after line 331):

```typescript
// ─── Stash APIs ─────────────────────────────────────────────────────────────

export interface GitStashEntry {
  index: number;
  message: string;
}

export interface GitStashListResponse {
  stashes: GitStashEntry[];
}

export interface GitStashOperationResponse {
  stashed?: boolean;
  applied?: boolean;
  popped?: boolean;
  dropped?: boolean;
  output: string;
  error?: string;
}

export async function listStashes(repoPath: string, baseUrl?: string): Promise<GitStashListResponse> {
  const url = `/api/git/stashes?repoPath=${encodeURIComponent(repoPath)}`;
  return apiRequest<GitStashListResponse>(url, { baseUrl });
}

export async function createStash(
  repoPath: string,
  message?: string,
  baseUrl?: string,
): Promise<GitStashOperationResponse> {
  return apiRequest<GitStashOperationResponse>('/api/git/stash', {
    baseUrl,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoPath, message }),
  });
}

export async function applyStash(repoPath: string, index?: number, baseUrl?: string): Promise<GitStashOperationResponse> {
  return apiRequest<GitStashOperationResponse>('/api/git/stash/apply', {
    baseUrl,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoPath, index }),
  });
}

export async function popStash(repoPath: string, index?: number, baseUrl?: string): Promise<GitStashOperationResponse> {
  return apiRequest<GitStashOperationResponse>('/api/git/stash/pop', {
    baseUrl,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoPath, index }),
  });
}

export async function dropStash(repoPath: string, index?: number, baseUrl?: string): Promise<GitStashOperationResponse> {
  return apiRequest<GitStashOperationResponse>('/api/git/stash/drop', {
    baseUrl,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoPath, index: index ?? 0 }),
  });
}
```

**Gate:** TypeScript compilation passes. No new type errors.

---

### Phase 2c — Force/Override UI (R3) (30 min)

**13. Add force commit state and UI to `WorkspaceGitTab.tsx`** (30 min)

Add new state (near line 283, after `skipVerifyCommitting`):
```typescript
// ─── Force commit/override state ───────────────────────────────────────────
const [showForceCommitDialog, setShowForceCommitDialog] = useState(false);
const [forceOverrideReason, setForceOverrideReason] = useState('');
const [forceCommitting, setForceCommitting] = useState(false);
```

Import `commitGit` and `pushGit` in the existing import block (line 13–21):
```typescript
import {
  getMergeCandidates,
  mergeDryRun,
  mergeLocal,
  pullGit,
  checkoutGitBranch,
  discoverGitChecks,
  mergeWorktree,
  commitGit,
  pushGit,
  runGitChecks,
} from '../../lib/api/git';
```

Replace the Verify & Commit handler (lines 478–484) and its associated `useEffect` synchronization (lines 486–518) with a new direct-flow handler:

```typescript
// ─── Verify & Commit handler (direct flow, no useEffect sync) ──────────────
async function handleVerifyAndCommit() {
  if (!gitState.commitMessage.trim() || !repoPath) return;
  setCommitPhase('running-checks');
  try {
    const results = await runGitChecks(repoPath);
    if (results.allPassed) {
      setCommitPhase('committing');
      await commitGit(repoPath, gitState.commitMessage);
      notificationStore.success('Committed', { message: gitState.commitMessage });
      setCommitPhase('idle');
    } else if (results.checksAvailable === 0) {
      // No checks configured — allow commit directly
      setCommitPhase('committing');
      await commitGit(repoPath, gitState.commitMessage);
      notificationStore.success('Committed', { message: gitState.commitMessage });
      setCommitPhase('idle');
    } else {
      // Checks failed
      setCheckResults(results); // Store locally for force commit UI
      setShowForceCommitDialog(true);
      setCommitPhase('idle');
    }
  } catch (err) {
    notificationStore.error('Verification failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    setCommitPhase('idle');
  }
}

// New local state for check results in the component (separate from prop)
const [localCheckResults, setCheckResults] = useState<GitCheckResults | null>(null);
```

Remove the old `useEffect` blocks (lines 487–518):
- Remove the useEffect that syncs `commitPhase` with `runningChecks` / `checkResults`
- Remove the useEffect that shows error notification on check failure
- Remove the useEffect that auto-commits when checks pass

Add force commit handler:
```typescript
async function handleForceCommit() {
  if (!repoPath || !gitState.commitMessage.trim() || !forceOverrideReason.trim()) return;
  setForceCommitting(true);
  try {
    await commitGit(repoPath, gitState.commitMessage, { reason: forceOverrideReason });
    notificationStore.success('Force committed', { message: `Override: ${forceOverrideReason}` });
    setShowForceCommitDialog(false);
    setForceOverrideReason('');
    setCheckResults(null);
  } catch (err) {
    notificationStore.error('Force commit failed', {
      message: err instanceof Error ? err.message : String(err),
    });
  } finally {
    setForceCommitting(false);
  }
}

async function handleForcePush() {
  if (!repoPath || !gitState.commitMessage.trim() || !forceOverrideReason.trim()) return;
  setForceCommitting(true);
  try {
    await commitGit(repoPath, gitState.commitMessage, { reason: forceOverrideReason });
    await pushGit(repoPath, true, { reason: forceOverrideReason });
    notificationStore.success('Force committed & pushed', { message: `Override: ${forceOverrideReason}` });
    setShowForceCommitDialog(false);
    setForceOverrideReason('');
    setCheckResults(null);
  } catch (err) {
    notificationStore.error('Force commit & push failed', {
      message: err instanceof Error ? err.message : String(err),
    });
  } finally {
    setForceCommitting(false);
  }
}
```

In the render, replace the Verify & Commit button area (lines 1152–1161):
```tsx
{localCheckResults && !localCheckResults.allPassed && localCheckResults.checksAvailable > 0 ? (
  <Button
    variant="primary"
    size="sm"
    onClick={() => setShowForceCommitDialog(true)}
    testId="workspace-force-commit"
  >
    Force Commit (skip verification)
  </Button>
) : (
  <Button
    variant="primary"
    size="sm"
    disabled={!gitState.commitMessage.trim() || commitPhase === 'running-checks' || commitPhase === 'committing'}
    onClick={() => void handleVerifyAndCommit()}
    testId="workspace-verify-commit"
  >
    {commitPhase === 'running-checks' ? 'Running checks...' : commitPhase === 'committing' ? 'Committing...' : 'Verify & Commit'}
  </Button>
)}
```

Add the force commit dialog near the composer area (after the existing checks result block, around line 1322):
```tsx
{/* Force commit dialog */}
{showForceCommitDialog ? (
  <div className="workspace-git-force-dialog" data-testid="workspace-force-dialog">
    <div className="workspace-git-force-dialog-content">
      <h4 style={{ margin: '0 0 var(--space-sm) 0', color: 'var(--color-accent-500)' }}>
        ⚠ Force Commit — verification checks failed
      </h4>
      {localCheckResults ? (
        <ul style={{ margin: '0 0 var(--space-sm) 0', fontSize: '0.8rem' }}>
          {localCheckResults.results.filter(r => !r.passed).map(r => (
            <li key={r.checkName} style={{ color: 'var(--color-accent-500)' }}>
              ✗ {r.checkName}: {r.error || 'failed'}
            </li>
          ))}
        </ul>
      ) : null}
      <label style={{ display: 'block', marginBottom: 'var(--space-xs)', fontSize: '0.8rem' }}>
        Override reason (required):
      </label>
      <input
        className="form-input-field"
        type="text"
        placeholder="Explain why checks are being skipped..."
        value={forceOverrideReason}
        onChange={(e) => setForceOverrideReason(e.target.value)}
        disabled={forceCommitting}
        data-testid="workspace-force-reason-input"
        style={{ width: '100%', marginBottom: 'var(--space-sm)' }}
      />
      <div style={{ display: 'flex', gap: 'var(--space-sm)', justifyContent: 'flex-end' }}>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => { setShowForceCommitDialog(false); setForceOverrideReason(''); }}
          disabled={forceCommitting}
          testId="workspace-force-cancel"
        >
          Cancel
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={!forceOverrideReason.trim() || forceCommitting}
          onClick={() => void handleForceCommit()}
          testId="workspace-force-commit-confirm"
        >
          {forceCommitting ? 'Processing...' : 'Force Commit'}
        </Button>
        <Button
          variant="primary"
          size="sm"
          disabled={!forceOverrideReason.trim() || forceCommitting}
          onClick={() => void handleForcePush()}
          testId="workspace-force-commit-push"
        >
          {forceCommitting ? 'Processing...' : 'Force Commit & Push'}
        </Button>
      </div>
    </div>
  </div>
) : null}
```

Add a checks failed result block below the checks result area (after line 1322):
```tsx
{checkResults && !checkResults.allPassed && checkResults.checksAvailable > 0 ? (
  <div className="workspace-git-composer-checks workspace-checks-failed" data-testid="workspace-checks-failed">
    <span>✗ Checks failed — {checkResults.checksFailed} of {checkResults.checksRun} failed</span>
    <Button
      variant="ghost"
      size="sm"
      onClick={() => setShowForceCommitDialog(true)}
      testId="workspace-force-commit-from-result"
    >
      Force commit anyway
    </Button>
  </div>
) : null}
```

**Gate:** "Force Commit" button appears when checks fail. Dialog opens with reason input. On confirm, calls `commitGit` with `unsafeOverride`.

---

### Phase 2d — Stash UI (R4) (20 min)

**14. Add stash state and UI to `WorkspaceGitTab.tsx`** (20 min)

Add new state (near line 283):
```typescript
// ─── Stash state ───────────────────────────────────────────────────────────
const [stashes, setStashes] = useState<GitStashEntry[]>([]);
const [stashesLoading, setStashesLoading] = useState(false);
const [showStashList, setShowStashList] = useState(false);
const [stashMessage, setStashMessage] = useState('');
const [stashActionLoading, setStashActionLoading] = useState<string | null>(null);
```

Import stash functions in the import block:
```typescript
import {
  ...
  listStashes,
  createStash,
  applyStash,
  popStash,
  dropStash,
} from '../../lib/api/git';
```

Add stash loading effect:
```typescript
// ─── Load stashes on mount ────────────────────────────────────────────────────
useEffect(() => {
  if (!repoPath) return;
  let cancelled = false;
  async function load() {
    setStashesLoading(true);
    try {
      const result = await listStashes(repoPath);
      if (!cancelled) setStashes(result.stashes);
    } catch {
      // stash list is informational
    } finally {
      if (!cancelled) setStashesLoading(false);
    }
  }
  void load();
  return () => { cancelled = true; };
}, [repoPath]);
```

Add stash action handlers:
```typescript
async function handleStashChanges() {
  if (!repoPath) return;
  setStashActionLoading('stash');
  try {
    const result = await createStash(repoPath, stashMessage || undefined);
    if (result.stashed) {
      notificationStore.success('Changes stashed', { message: stashMessage || 'Work in progress stashed' });
      setStashMessage('');
      // Refresh stashes and worktree status
      const updated = await listStashes(repoPath);
      setStashes(updated.stashes);
      loadWorktrees();
    }
  } catch (err) {
    notificationStore.error('Stash failed', { message: err instanceof Error ? err.message : String(err) });
  } finally {
    setStashActionLoading(null);
  }
}

async function handleApplyStash(index?: number) {
  if (!repoPath) return;
  setStashActionLoading('apply');
  try {
    const result = await applyStash(repoPath, index);
    if (result.applied) {
      notificationStore.success('Stash applied');
      const updated = await listStashes(repoPath);
      setStashes(updated.stashes);
      loadWorktrees();
    }
  } catch (err) {
    notificationStore.error('Apply stash failed', { message: err instanceof Error ? err.message : String(err) });
  } finally {
    setStashActionLoading(null);
  }
}

async function handlePopStash(index?: number) {
  if (!repoPath) return;
  setStashActionLoading('pop');
  try {
    const result = await popStash(repoPath, index);
    if (result.popped) {
      notificationStore.success('Stash popped');
      const updated = await listStashes(repoPath);
      setStashes(updated.stashes);
      loadWorktrees();
    }
  } catch (err) {
    notificationStore.error('Pop stash failed', { message: err instanceof Error ? err.message : String(err) });
  } finally {
    setStashActionLoading(null);
  }
}

async function handleDropStash(index: number) {
  if (!repoPath) return;
  setStashActionLoading(`drop-${index}`);
  try {
    const result = await dropStash(repoPath, index);
    if (result.dropped) {
      notificationStore.success('Stash dropped');
      const updated = await listStashes(repoPath);
      setStashes(updated.stashes);
    }
  } catch (err) {
    notificationStore.error('Drop stash failed', { message: err instanceof Error ? err.message : String(err) });
  } finally {
    setStashActionLoading(null);
  }
}
```

Add stash UI area in the render — place it inside the composer section (before the commit input line, around line 1150):
```tsx
{/* Stash area */}
<div className="workspace-git-stash-area" data-testid="workspace-git-stash-area">
  <div className="workspace-git-stash-header">
    <span className="workspace-git-stash-count">Stashes ({stashes.length})</span>
    <button
      type="button"
      className="workspace-git-stash-toggle"
      onClick={() => setShowStashList(!showStashList)}
      data-testid="workspace-stash-toggle"
    >
      {showStashList ? '▲' : '▼'}
    </button>
  </div>
  <div className="workspace-git-stash-controls">
    <input
      className="form-input-field workspace-git-stash-input"
      type="text"
      placeholder="Stash message (optional)..."
      value={stashMessage}
      onChange={(e) => setStashMessage(e.target.value)}
      disabled={stashActionLoading !== null}
      data-testid="workspace-stash-input"
    />
    <Button
      variant="secondary"
      size="sm"
      disabled={stashActionLoading !== null}
      onClick={() => void handleStashChanges()}
      testId="workspace-stash-button"
    >
      {stashActionLoading === 'stash' ? 'Stashing...' : 'Stash changes'}
    </Button>
  </div>
  {showStashList && stashes.length > 0 ? (
    <div className="workspace-git-stash-list" data-testid="workspace-stash-list">
      {stashes.map((s) => (
        <div key={s.index} className="workspace-git-stash-item" data-testid={`workspace-stash-item-${s.index}`}>
          <span className="workspace-git-stash-message" title={s.message}>
            stash@{s.index}: {s.message}
          </span>
          <div className="workspace-git-stash-actions">
            <Button
              variant="ghost"
              size="sm"
              disabled={stashActionLoading !== null}
              onClick={() => void handleApplyStash(s.index)}
              testId={`workspace-stash-apply-${s.index}`}
            >
              {stashActionLoading === 'apply' ? '...' : 'Apply'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={stashActionLoading !== null}
              onClick={() => void handlePopStash(s.index)}
              testId={`workspace-stash-pop-${s.index}`}
            >
              {stashActionLoading === 'pop' ? '...' : 'Pop'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={stashActionLoading !== null}
              onClick={() => void handleDropStash(s.index)}
              testId={`workspace-stash-drop-${s.index}`}
            >
              {stashActionLoading === `drop-${s.index}` ? '...' : 'Drop'}
            </Button>
          </div>
        </div>
      ))}
    </div>
  ) : showStashList ? (
    <div className="workspace-git-stash-empty" data-testid="workspace-stash-empty">No stashes.</div>
  ) : null}
</div>
```

Add minimal CSS classes for the stash area. Check `app.css` for existing `--space-*` and `--color-*` tokens. Add to the existing styles (or a new style block in the component):
```css
.workspace-git-stash-area {
  margin-bottom: var(--space-sm);
  padding: var(--space-xs);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm, 4px);
}
.workspace-git-stash-header {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  margin-bottom: var(--space-xs);
}
.workspace-git-stash-count {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--color-ink-500);
}
.workspace-git-stash-toggle {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 0.7rem;
  color: var(--color-ink-400);
}
.workspace-git-stash-controls {
  display: flex;
  gap: var(--space-xs);
  align-items: center;
}
.workspace-git-stash-input {
  flex: 1;
  min-width: 120px;
}
.workspace-git-stash-list {
  margin-top: var(--space-xs);
  max-height: 200px;
  overflow-y: auto;
}
.workspace-git-stash-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-xs);
  padding: 2px 0;
  border-bottom: 1px solid var(--color-border);
  font-size: 0.75rem;
}
.workspace-git-stash-message {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-ink-400);
}
.workspace-git-stash-actions {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}
.workspace-git-stash-empty {
  font-size: 0.75rem;
  color: var(--color-ink-400);
  padding: var(--space-xs);
}
.workspace-git-force-dialog {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.workspace-git-force-dialog-content {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md, 8px);
  padding: var(--space-md);
  max-width: 480px;
  width: 90%;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
}
```

**Gate:** Stash area renders in composer. Stash count badge shows. Stash/create/apply/pop/drop work. After any stash operation, worktree list refreshes.

---

### Phase 2e — Fix Verify & Commit (R2) (15 min)

Note: This phase is already mostly handled by Phase 2c step 13, which replaces the old `handleVerifyAndCommit` and its `useEffect` synchronization chain with a direct async flow. The remaining work is to update the test.

**15. Update Test 8 to match new flow** (10 min)
- In `workspace-git-tab-redesign.vitest.tsx`, update the mock imports at lines 5–12 to add `runGitChecks`, `commitGit`, `pushGit`:
  ```typescript
  vi.mock('../ui/src/lib/api/git', () => ({
    getMergeCandidates: vi.fn(),
    mergeDryRun: vi.fn(),
    mergeLocal: vi.fn(),
    pullGit: vi.fn(),
    checkoutGitBranch: vi.fn(),
    discoverGitChecks: vi.fn(),
    runGitChecks: vi.fn(),
    commitGit: vi.fn(),
    pushGit: vi.fn(),
  }));
  ```
- In the `beforeEach` block, add default mock implementations:
  ```typescript
  vi.mocked(gitApi.runGitChecks).mockResolvedValue({
    repoRoot: '/test/repo',
    checkedAt: new Date().toISOString(),
    checksAvailable: 2,
    checksRun: 2,
    checksPassed: 2,
    checksFailed: 0,
    allPassed: true,
    results: [
      { checkName: 'lint', passed: true, output: 'ok' },
      { checkName: 'test', passed: true, output: 'ok' },
    ],
    message: 'All 2 checks passed.',
  });
  vi.mocked(gitApi.commitGit).mockResolvedValue({ committed: true });
  vi.mocked(gitApi.pushGit).mockResolvedValue({ pushed: true });
  ```
- Update Test 8 (lines 484–523): The test should now expect `runGitChecks` to be called (not `onRunChecks`), and after checks pass, `commitGit` to be called. The button text should transition from "Verify & Commit" through "Running checks..." to "Committing..." (handled by `commitPhase` state changes).
- Test 9 (Push disabled) at lines 527–544: This test checks `verificationState !== 'verified'` which still works with the existing props-based flow. No change needed unless the push button logic changes. The current `pushDisabled` computation at line 606 still references `verificationState !== 'verified'` — keep this prop-based check unless the spec says otherwise. The spec R2 only changes the Verify & Commit flow, not the push gate.

**16. Update type imports and add checksVerified state in WorkspaceGitTab.tsx** (5 min)
- Add `commitGit`, `pushGit`, `runGitChecks`, `listStashes`, `createStash`, `applyStash`, `popStash`, `dropStash` to the import from `../../lib/api/git`
- Add `GitStashEntry` to the TypeScript import types block
- Add local checksVerified state:
  ```typescript
  const [checksVerified, setChecksVerified] = useState(false);
  ```
- After `runGitChecks` succeeds (allPassed or checksAvailable===0), set `setChecksVerified(true)`:
  ```typescript
  // Inside handleVerifyAndCommit, after successful checks:
  setChecksVerified(true);
  ```
- Update pushDisabled to also check local state:
  ```typescript
  const pushDisabled = (verificationState !== 'verified' && !checksVerified) || changeCount === 0 || gitState.syncing;
  ```
- Reset `checksVerified` to false when a new check run starts or `repoPath` changes:
  ```typescript
  // In the repoPath effect or at start of handleVerifyAndCommit:
  setChecksVerified(false);
  ```

**17. Run existing tests to confirm Test 8 still passes** (2 min)
- `npx vitest run copilot-ui/tests/workspace-git-tab-redesign.vitest.tsx`
- If Test 8 fails, adjust mock expectations to match the new async flow

**Gate:** All 10 tests pass after updating mocks. Verify & Commit now calls `runGitChecks` directly, then `commitGit` on success.

---

### Phase 3a — Worktree Row State Upgrade (R5) (25 min)

**18. Add `computeWorktreeState` pure function** (10 min)

Add to `WorkspaceGitTab.tsx` before the component (near the helper functions at the top, after `toDisplay`):

```typescript
// ─── Worktree state computation (R5) ──────────────────────────────────────────

type WorktreeComputedState =
  // Component-derived (highest priority)
  | 'checking'       // checks running for this worktree
  | 'checked'        // checks passed
  | 'check-failed'   // checks failed
  | 'mergeable'      // checks passed + dry-run clean
  | 'merged'         // merge successful
  | 'conflict'       // merge dry-run or actual resulted in conflicts
  // Record-derived (medium priority)
  | 'missing'        // path does not exist
  | 'blocked'        // launch blocked
  | 'assigned'       // active session/assignment
  | 'reusable'       // status: reusable
  | 'interrupted'     // status: interrupted
  | 'probe-error'    // git probe error
  // Simple (lower priority)
  | 'dirty'          // uncommitted changes
  | 'clean'          // no changes
  | 'current'        // on the repo's current branch
  // Fallback
  | 'unknown';

interface WorktreeStateInput {
  record: ExecutorWorktreeRecord;
  display: WorktreeDisplay;
  currentBranch: string | null;
  checkResults: { passed: boolean } | null;
  mergeResults: { merged: boolean; conflicts?: boolean } | null;
  isChecking: boolean;
}

function computeWorktreeState(input: WorktreeStateInput): WorktreeComputedState {
  const { record, display, currentBranch, checkResults, mergeResults, isChecking } = input;

  // 1. Component-derived states (highest priority)
  if (isChecking) return 'checking';
  if (mergeResults?.merged) return 'merged';
  if (mergeResults?.conflicts) return 'conflict';
  if (checkResults && !checkResults.passed) return 'check-failed';
  if (checkResults && checkResults.passed) return 'checked';

  // 2. Record-derived states
  if (display.isMissing) return 'missing';
  if (display.isLaunchBlocked) return 'blocked';
  if (display.hasAssignment) return 'assigned';
  if (display.isReusable) return 'reusable';
  if (display.isInterrupted) return 'interrupted';
  if (display.probeError) return 'probe-error';

  // 3. Simple states
  if (display.dirty && display.dirtyCount > 0) return 'dirty';
  if (record.branch && currentBranch && record.branch === currentBranch) return 'current';
  if (!display.dirty) return 'clean';

  // 4. Fallback
  return 'unknown';
}

const WORKTREE_STATE_LABELS: Record<WorktreeComputedState, string> = {
  'checking': 'Checking...',
  'checked': '✓ Checked',
  'check-failed': '✗ Check failed',
  'mergeable': '✓ Mergeable',
  'merged': '✓ Merged',
  'conflict': '⚠ Conflict',
  'missing': '✗ Missing',
  'blocked': '⛔ Blocked',
  'assigned': '📋 Assigned',
  'reusable': '↻ Reusable',
  'interrupted': '⏸ Interrupted',
  'probe-error': '✗ Probe error',
  'dirty': '⚠ Dirty',
  'clean': '✓ Clean',
  'current': '← Current',
  'unknown': '?',
};
```

**19. Replace Status column rendering** (10 min)

In the render, find the Status column cell (around line 1018):
```tsx
<td className="workspace-git-table-cell" data-testid={`workspace-worktree-status-${entry.key}`}>
  {entry.statusLabel}
</td>
```

Replace with computed state:
```tsx
<td className="workspace-git-table-cell" data-testid={`workspace-worktree-status-${entry.key}`}>
  <span className={`workspace-git-worktree-state workspace-git-worktree-state--${computedState}`}
        title={`Computed: ${computedState} | Raw: ${entry.statusLabel}`}>
    {WORKTREE_STATE_LABELS[computedState]}
  </span>
</td>
```

Add state computation in the worktree display loop (around line 527–541), after each entry is built:
```typescript
const worktreeDisplay = sortForDisplay(worktreeRecords, sortOrder).slice(0, MAX_ROWS).map(record => {
  const entry = toDisplay(record);
  // Merge enriched data (existing code) ...
  
  // Compute state (new)
  const computedState = computeWorktreeState({
    record,
    display: entry,
    currentBranch: branch,
    checkResults: worktreeCheckResults[record.path || ''] || null,
    mergeResults: worktreeMergeResults[record.path || ''] || null,
    isChecking: worktreeChecksRunning[record.path || ''] || false,
  });
  
  return { ...entry, computedState };
});
```

Add new state variables:
```typescript
const [worktreeCheckResults, setWorktreeCheckResults] = useState<Record<string, GitCheckResults>>({});
const [worktreeChecksRunning, setWorktreeChecksRunning] = useState<Record<string, boolean>>({});
```

**Gate:** Status column shows computed state chip instead of raw status label. All 16 states are renderable.

---

### Phase 3b — Per-Row Worktree Actions (R5) (35 min)

**20. Add worktree check/dry-run/merge actions** (25 min)

Add handlers for worktree-level checks (after `handleMergeWorktree` at line 574):

```typescript
async function handleWorktreeRunChecks(worktreePath: string, worktreeBranch: string) {
  if (!worktreePath) return;
  setWorktreeChecksRunning(prev => ({ ...prev, [worktreePath]: true }));
  try {
    // Use worktreePath as repoPath for checks (the worktree's own filesystem path)
    const results = await runGitChecks(worktreePath);
    setWorktreeCheckResults(prev => ({ ...prev, [worktreePath]: results }));

    // If checks pass, auto-run dry-run
    if (results.allPassed && repoPath && summary?.branch) {
      const dryRunResult = await mergeDryRun(repoPath, worktreeBranch, summary.branch);
      setWorktreeMergeResults(prev => ({
        ...prev,
        [worktreePath]: {
          merged: false,
          conflicts: dryRunResult.conflicts && dryRunResult.conflicts.length > 0,
          conflictFiles: dryRunResult.conflicts || [],
          diagnostics: dryRunResult.diagnostics,
          sourceRef: worktreeBranch,
          targetRef: summary.branch || '',
        },
      }));
    }
  } catch (err) {
    notificationStore.error('Checks failed', {
      message: err instanceof Error ? err.message : String(err),
    });
  } finally {
    setWorktreeChecksRunning(prev => ({ ...prev, [worktreePath]: false }));
  }
}
```

Modify the existing `handleMergeWorktree` to also record check/merge state:
```typescript
async function handleMergeWorktree(worktreePath: string, worktreeBranch: string) {
  if (!summary?.branch) return;
  const targetBranch = summary.branch;
  setMergingWorktree(worktreePath);
  try {
    const result = await mergeWorktree(repoPath, worktreePath, worktreeBranch, targetBranch);
    setWorktreeMergeResults(prev => ({ ...prev, [worktreePath]: result }));
    if (result.merged) {
      notificationStore.success('Merge complete', { message: `Merged ${worktreeBranch} into ${targetBranch}` });
      loadWorktrees();
      // Offer remove worktree flow
    } else if (result.conflicts) {
      notificationStore.error('Merge conflicts', {
        message: `${result.conflictFiles?.length || 0} file(s) have conflicts`,
      });
    }
  } catch (err) {
    setWorktreeMergeResults(prev => ({
      ...prev,
      [worktreePath]: {
        merged: false,
        conflicts: true,
        conflictFiles: [],
        diagnostics: err instanceof Error ? err.message : String(err),
        sourceRef: worktreeBranch,
        targetRef: targetBranch,
      },
    }));
    notificationStore.error('Merge failed', { message: err instanceof Error ? err.message : String(err) });
  } finally {
    setMergingWorktree(null);
  }
}
```

In the render Flags column (around line 1024, before the expand diagnostics button), add new action buttons:
```tsx
{/* Worktree check/merge actions */}
{!entry.isMissing ? (
  <div className="workspace-git-worktree-actions">
    {worktreeCheckResults[entry.path] && !worktreeMergeResults[entry.path] ? (
      // Show check result status
      worktreeCheckResults[entry.path].allPassed ? (
        worktreeMergeResults[entry.path]?.conflicts ? (
          <span className="workspace-git-merge-conflicts-label"
                title={worktreeMergeResults[entry.path].conflictFiles?.join(', ')}>
            ✗ {worktreeMergeResults[entry.path].conflictFiles?.length || 0} conflict(s)
          </span>
        ) : worktreeMergeResults[entry.path]?.merged ? (
          <span className="workspace-git-merge-clean-label">✓ Merged</span>
        ) : (
          <Button
            variant="primary"
            size="sm"
            disabled={mergingWorktree === entry.path || worktreeMergeResults[entry.path]?.merged}
            onClick={() => void handleMergeWorktree(entry.path, entry.branchLabel)}
            testId={`workspace-worktree-merge-${entry.key}`}
          >
            {mergingWorktree === entry.path ? 'Merging...' : 'Merge'}
          </Button>
        )
      ) : (
        <span className="workspace-git-merge-error" title={worktreeCheckResults[entry.path].message}>
          ✗ {worktreeCheckResults[entry.path].checksFailed} failed
        </span>
      )
    ) : (
      <Button
        variant="ghost"
        size="sm"
        disabled={worktreeChecksRunning[entry.path]}
        onClick={() => void handleWorktreeRunChecks(entry.path, entry.branchLabel)}
        testId={`workspace-worktree-run-checks-${entry.key}`}
      >
        {worktreeChecksRunning[entry.path] ? 'Checking...' : 'Run checks'}
      </Button>
    )}
  </div>
) : null}
```

Previously, worktree merge was only available for worktrees with active sessions. Now all worktrees support check+merge actions, regardless of session state, because the check runner operates on any worktree path. The old "Verify & Merge for worktrees with sessions" block (lines 1112–1137) is replaced by the new general-purpose action buttons above.

**21. Add `mergeWorktree` result render in Cleanup column** (5 min)
- After merge success, in the Cleanup column area (around line 1082), when `worktreeMergeResults[entry.path]?.merged` is true, show a "Remove worktree + delete branch" button that calls `handleRemoveWorktree` (already exists).

**22. Update the `WorktreeDisplay` interface** (5 min)
Add `computedState: WorktreeComputedState` to the `WorktreeDisplay` interface.

**Gate:** "Run checks" button appears per row. On check pass, auto dry-run runs. Merge button appears when dry-run is clean. Conflict state blocks merge.

---

### Phase 4 — Worktree Merge Flow (R6) (15 min)

This phase is mostly already covered by Phase 3b. Remaining items:

**23. Ensure `runGitChecks` is called with `worktreePath`** (3 min)
- Already done in Phase 3b step 20: `const results = await runGitChecks(worktreePath)` uses the worktree's filesystem path.

**24. Ensure conflict state blocks merge** (3 min)
- Already done: `worktreeMergeResults` with `conflicts: true` condition prevents merge button from rendering in the actions area.

**25. Refresh worktrees after merge success** (2 min)
- Already done: `handleMergeWorktree` calls `loadWorktrees()` after successful merge.

**26. Wire "Remove" offer after merge** (7 min)
- After a successful merge, show a compact "Remove worktree" button in the Flags column (next to the "Merged" label) that calls `handleRemoveWorktree(entry.path, entry.branchLabel)`.
```tsx
{worktreeMergeResults[entry.path]?.merged ? (
  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)', marginTop: '2px' }}>
    <span className="workspace-git-merge-clean-label">✓ Merged</span>
    <Button
      variant="ghost"
      size="sm"
      disabled={removing === entry.path}
      onClick={() => void handleRemoveWorktree(entry.path, entry.branchLabel)}
      testId={`workspace-worktree-remove-after-merge-${entry.key}`}
    >
      {removing === entry.path ? '...' : 'Remove worktree'}
    </Button>
  </div>
) : null}
```

**Gate:** Merge flow works end-to-end: run checks → auto dry-run → enable merge → merge → show "Remove worktree" button → remove with branch cleanup.

---

### Phase 5 — Integration & Docs (30 min)

**27. Run all existing Vitest tests** (3 min)
- `npx vitest run copilot-ui/tests/workspace-git-tab-redesign.vitest.tsx`
- Fix any regressions from the removed `useEffect` sync chain or updated mock expectations

**28. Add new Vitest tests** (15 min)
Add tests to `workspace-git-tab-redesign.vitest.tsx` for these new acceptance checks:

- Test 11: "Force Commit dialog appears when checks fail"
  - Mock `runGitChecks` to return `{ allPassed: false, checksFailed: 1, results: [{ passed: false, checkName: 'lint', error: 'failed' }] }`
  - Click "Verify & Commit"
  - Assert force commit dialog appears with "Force Commit (skip verification)" text
  - Assert the failed check name is shown

- Test 12: "Force Commit calls commitGit with override reason"
  - Same mock as Test 11
  - Wait for dialog, type reason, click "Force Commit"
  - Assert `commitGit` called with `{ reason: 'override reason' }`

- Test 13: "Stash area renders and create stash works"
  - Mock `listStashes` to return empty array initially
  - Assert stash area renders with "Stashes (0)"
  - Type message, click "Stash changes"
  - Assert `createStash` called with the message

- Test 14: "Worktree computed state renders in Status column"
  - Mock worktree data with a reusable, dirty worktree
  - Assert Status column shows "↻ Reusable" (the computed state, not raw "reusable")

- Test 15: "Worktree Run checks triggers check + dry-run"
  - Create a worktree record, wait for table render
  - Click "Run checks" button
  - Assert `runGitChecks` called with worktree path
  - Mock `runGitChecks` to return allPassed=true
  - Assert `mergeDryRun` is called

**29. Run typecheck** (2 min)
- `cd copilot-ui/ui && npx tsc --noEmit`
- Fix any type errors in the new stash interfaces, computed state, or state variable types

**30. Update `docs/system/copilot-ui-guide.md`** (5 min)
- Add section "Git Tab — Stash Management": document stash area in composer, how to stash/apply/pop/drop
- Add section "Git Tab — Force Commit/Push": document the force commit dialog when checks fail, override reason requirement
- Add section "Git Tab — Worktree States": document the 16 computed states and their visual representation
- Add section "Git Tab — Worktree Merge Flow": document the Run checks → dry-run → merge → remove flow

**31. Run spec validation** (3 min)
- `node scripts/validate-specs.js --strict specs/workspace-git-enhancement/spec.md`
- Fix any spec-level issues reported
- `node scripts/generate-spec-index.js` to keep the index current

**32. Run ci:local** (2 min)
- `npm run ci:local` (or the narrowest equivalent that covers changed areas)

**Gate:** All tests pass. Typecheck passes. Docs updated. Spec index regenerated.

---

### Phase 6 — Record in elegy-planning (15 min)

**33. Create elegy-planning goal** (5 min)
- Goal ID: `GOAL-COPILOT-GIT-WORKTREE-VALIDATION-20260603`
- Title: "Workspace Git Tab Enhancement"
- Tags: `repo:instruction-engine`, `repo:elegy`, `source:codex`, `theme:git-ui`, `phase:1`
- Link to `specs/workspace-git-enhancement/spec.md`

**34. Create roadmap with work points** (5 min)
- Create a roadmap for this goal with 6 work points, one per phase:
  - WP-0: Verification
  - WP-1: Commit-check contract (R1)
  - WP-2: Stash API + Force actions (R4, R3)
  - WP-3: Worktree row state upgrade (R5)
  - WP-4: Worktree merge flow (R6)
  - WP-5: Integration & docs
  - WP-6 (optional): elegy-planning recording

**35. Record initial state** (5 min)
- Run `node scripts/validate-specs.js --strict specs/workspace-git-enhancement/spec.md` and capture output
- Note current test pass/fail counts as baselines
- Record any open questions or known risks

**Gate:** Goal and roadmap created in elegy-planning. Initial state recorded.

---

## Dependencies Between Phases

```
Phase 0: Verification
  ├── Phase 1 (R1) — must have baseline tests passing
  │     ├── Phase 3a (R5) — commit-check contract needed for worktree checks
  │     │     └── Phase 3b (R5) — depends on computed state + checks runner
  │     │           └── Phase 4 (R6) — depends on worktree actions
  │     │
  │     └── Phase 2a (R4) — independent of Phase 1
  │           ├── Phase 2b (R4) — must have stash routes
  │           │     ├── Phase 2c (R3) — must have client API
  │           │     └── Phase 2d (R4) — must have client API
  │           │
  │           └── Phase 2e (R2) — depends on runGitChecks from Phase 1
  │
  └── Phase 5 — depends on all previous phases being complete
        └── Phase 6 — final recording
```

## Risk Points

| Risk | Mitigation |
|------|-----------|
| Removing the `useEffect` synchronization chain (lines 487–518) breaks the commit flow | The new direct async flow replaces it: `handleVerifyAndCommit` calls `runGitChecks` → checks result → either commits or shows force dialog. Test 8 must be updated to match. |
| Existing test 8 mocks `onRunChecks` (a callback prop) but new flow calls `runGitChecks` directly | Add `runGitChecks` to the vitest mock and update test assertions to expect the API function call, not the callback. |
| Stash operations are destructive (pop/drop cannot be undone) | UI shows confirmation for pop and drop (via the explicit buttons); user must intentionally click. Document this risk. |
| `git stash` commands may fail if repo has merge conflicts | Handle errors gracefully with user-facing notifications. |
| Worktree check state is ephemeral (component state only) | Documented in Non-Goals; refreshing the page loses check/merge state by design. |
| New stash API routes may conflict with existing git route patterns | Follow the exact pattern from existing `git.js` handlers; register routes alongside existing ones. |
| `computeWorktreeState` may produce unexpected state chips for edge cases | The state priority is: component-derived > record-derived > simple > fallback. Edge cases fall into `unknown`. |
| Phase 3b removes the old "Verify & Merge for worktrees with sessions" block | The old block only appeared when `entry.hasActiveSessions` was true. The new actions appear for all worktree rows. Verify this doesn't regress the session-based merge flow. |
| `pullDisabled` uses `verificationState !== 'verified'` prop which is now less meaningful | The push disabled check still works because `verificationState` is still passed as a prop from the parent. The new Verify & Commit flow doesn't change the parent's `verificationState` — the parent still controls that. If needed, add a local `pushDisabled` check based on `checkResults` as well. |

## Spec Coverage Map

| Spec Requirement | Implemented In |
|------------------|---------------|
| R1.1 — Resolve canonical commit-check config | `copilot-ui/lib/gitCheckRunner.js` — `resolveCommitCheckConfig()` |
| R1.2 — Prefer canonical runner when config exists | `copilot-ui/lib/gitCheckRunner.js` — modified `discoverChecks()` and `runAllChecks()` |
| R1.3 — Fallback to legacy discovery | `copilot-ui/lib/gitCheckRunner.js` — unchanged legacy code path |
| R1.4 — Transform script output to API shape | `copilot-ui/lib/gitCheckRunner.js` — output transformer in `runAllChecks()` |
| R1.5 — `source` and `checkedAt` in response | `copilot-ui/routes/checks.js` — modified handlers; `copilot-ui/lib/gitCheckRunner.js` — in `runAllChecks()` |
| R2.1 — Verify & Commit runs checks inline | `copilot-ui/ui/src/views/Workspace/WorkspaceGitTab.tsx` — new `handleVerifyAndCommit()` |
| R2.2 — All-passed commits directly | Same — calls `commitGit()` immediately after checks pass |
| R2.3 — No checks configured shows info | Same — checks `checksAvailable === 0` and commits directly |
| R2.4 — Failed checks blocks commit, shows force dialog | Same — sets `showForceCommitDialog`, renders failure details |
| R4.1 — Stash list API | `copilot-ui/routes/git.js` — `handleListStashes` |
| R4.2 — Stash create API | `copilot-ui/routes/git.js` — `handleCreateStash` |
| R4.3 — Stash apply API | `copilot-ui/routes/git.js` — `handleApplyStash` |
| R4.4 — Stash pop API | `copilot-ui/routes/git.js` — `handlePopStash` |
| R4.5 — Stash drop API | `copilot-ui/routes/git.js` — `handleDropStash` |
| R4.6 — Stash API interfaces | `copilot-ui/ui/src/lib/api/git.ts` — `GitStashEntry`, `GitStashListResponse`, `GitStashOperationResponse` |
| R4.7 — Stash UI in composer | `copilot-ui/ui/src/views/Workspace/WorkspaceGitTab.tsx` — stash area with count badge, input, Apply/Pop/Drop buttons |
| R3.1 — Force commit button | `copilot-ui/ui/src/views/Workspace/WorkspaceGitTab.tsx` — `showForceCommitDialog` + handlers |
| R3.2 — Force commit and push | Same — `handleForcePush()` |
| R3.3 — Override reason requirement | Same — `forceOverrideReason` state, dialog input, validation |
| R5.1 — `computeWorktreeState` pure function | `copilot-ui/ui/src/views/Workspace/WorkspaceGitTab.tsx` — new function with 16 states |
| R5.2 — State priority order | Same — component-derived > record-derived > simple > fallback |
| R5.3 — Computed state in Status column | Same — replaces `entry.statusLabel` with computed chip |
| R5.4 — Per-row Run checks button | Same — `handleWorktreeRunChecks()` |
| R5.5 — Auto dry-run after checks pass | Same — `mergeDryRun` called after `runGitChecks` returns allPassed |
| R5.6 — Enable Merge if dry-run clean | Same — merge button appears when no conflicts |
| R5.7 — Conflict indicator with filenames | Same — `worktreeMergeResults` conflict display |
| R6.1 — `runGitChecks` with worktree path | Same — `const results = await runGitChecks(worktreePath)` |
| R6.2 — Conflict state blocks merge | Same — conditional render prevents merge button |
| R6.3 — Refresh worktrees after merge | Same — `loadWorktrees()` called after merge success |

## Files Changed (Summary)

| File | Change Type | Phase |
|------|-------------|-------|
| `copilot-ui/lib/gitCheckRunner.js` | Modified | 1 |
| `copilot-ui/routes/checks.js` | Modified | 1 |
| `copilot-ui/tests/git-check-runner.test.ts` | **NEW** | 1 |
| `copilot-ui/routes/git.js` | Modified | 2a |
| `copilot-ui/routes/git.test.js` | Modified | 2a |
| `copilot-ui/ui/src/lib/api/git.ts` | Modified | 2b |
| `copilot-ui/ui/src/views/Workspace/WorkspaceGitTab.tsx` | Modified | 2c, 2d, 2e, 3a, 3b, 4 |
| `copilot-ui/tests/workspace-git-tab-redesign.vitest.tsx` | Modified | 2e, 5 |
| `docs/system/copilot-ui-guide.md` | Modified | 5 |
| `specs/index.md` | Regenerated | 5 |
