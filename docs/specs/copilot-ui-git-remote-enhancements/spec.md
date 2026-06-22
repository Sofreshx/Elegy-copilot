---
spec_id: copilot-ui-git-remote-enhancements
title: Copilot UI Git + Remote performance, gating, PR UX, and toggle enhancements
status: draft
type: feature
updated: 2026-06-22
---

# Copilot UI Git + Remote enhancements

Self-contained implementation plan. Execute phases in order: **A → C → E → B → D**.
A weaker agent can implement each phase independently. Each phase lists exact files, line anchors, current vs. target behavior, signatures to call, and the tests to add/update.

## Global rules (read first)

- Repo: monorepo. All UI/backend work is under `copilot-ui/`. Paths below are relative to `copilot-ui/` unless prefixed `docs/`.
- Route modules export `register(context) -> [{ method, path, handler }]`. Registered in `routes/index.js` via `registry.registerModule(require('./<name>'), context)`. A route's context is the server's merged context (see `server.js` ~line 5089; includes `elegyHome`, `engineRoot`, `kimakiRuntimeService`, `kimakiCli`).
- Request context `ctx` has: `req`, `res`, `u` (URL — **no `ctx.query`**; use `ctx.u.searchParams.get(key)`), `pathname`, `elegyHome`, `engineRoot`. See `routes/_helpers.js`.
- Helpers in `routes/_helpers.js`: `sendJson(res, code, obj)`, `readJsonBody(req)`, `getQueryParam(ctx, key, fallback)`, `sendError(res, code, msg, codeStr)`.
- `runGit(childProcessImpl, args, cwd, timeoutMs=10000)` and `runCommand(childProcessImpl, command, args, cwd, timeoutMs=10000)` are defined at top of `routes/git.js` (~lines 13–32). Git subprocess timeout default 10s.
- Config for remote toggle **already exists**: `lib/copilotConfig.js` `getRemoteSessions(elegyHome)` (default `false`), `setRemoteSessions(elegyHome, bool)`. Routes `GET/PUT /api/config/remote-sessions` exist in `routes/config.js` (`handleGetRemoteSessions` line 501, `handleSetRemoteSessions` line 520). **The gap:** the desktop runtime ignores this setting and the UI has no toggle.
- Test style: see `routes/git.test.js` (custom `test()`, `createResponse()`, `createSendJson()`, `findRoute()`, `invoke()`) and `routes/kimaki.test.js` (`node:test` + `createContext()`). Mirror the style of the file you're editing.
- After each phase run: `npm --prefix copilot-ui run test:vitest` and the `node --test` commands listed in that phase. Run `npm run ci:local` before declaring a phase done.
- Keep changes minimal and idiomatic. Do not restyle unrelated surfaces.

---

## Phase A — Performance (highest leverage)

### Problem
Each git status refresh in `ui/src/stores/gitStore.ts` `loadRepoState` (line ~91) fires **5 parallel** API calls: `getGitStatus`, `getGitLog`, `getGitBranches`, `getGitSummary`, `getGitPullRequest`. `resolveGitSummary` (`routes/git.js` line 220) spawns ~7 git subprocesses; `resolvePullRequest` (line 117) makes 2 slow `gh` network calls. Both `getGitSummary` **and** `getGitPullRequest` call `resolvePullRequest`, so `gh auth status` + `gh pr view` run **twice per load**.

### A1. PR/auth resolution cache — NEW file `lib/gitPrCache.js`
Create a module-scoped cache shared by the summary and pull-request routes.

```js
// lib/gitPrCache.js
'use strict';
const AUTH_TTL_MS = 120_000;   // gh auth status changes rarely
const PR_TTL_MS = 15_000;      // PR state changes on create/merge/push

const authCache = new Map();   // repoPath -> { authenticated, available, error, ts }
const prCache = new Map();     // repoPath -> { result, ts }

function now() { return Date.now(); }

function readAuth(repoPath) {
  const e = authCache.get(repoPath);
  if (!e) return null;
  if (now() - e.ts > AUTH_TTL_MS) { authCache.delete(repoPath); return null; }
  return e;
}
function writeAuth(repoPath, v) { authCache.set(repoPath, { ...v, ts: now() }); }

function readPr(repoPath) {
  const e = prCache.get(repoPath);
  if (!e) return null;
  if (now() - e.ts > PR_TTL_MS) { prCache.delete(repoPath); return null; }
  return e.result;
}
function writePr(repoPath, result) { prCache.set(repoPath, { result, ts: now() }); }

function bust(repoPath) {           // call after create-PR / commit / push
  if (repoPath) { authCache.delete(repoPath); prCache.delete(repoPath); return; }
  authCache.clear(); prCache.clear();
}

module.exports = { readAuth, writeAuth, readPr, writePr, bust, AUTH_TTL_MS, PR_TTL_MS };
```

Wire into `routes/git.js`:
- `resolvePullRequest(childProcessImpl, repoPath)` (line 117): before `gh auth status`, consult `gitPrCache.readAuth(repoPath)`; if present, skip the auth subprocess but still run `gh pr view`. Before `gh pr view`, consult `gitPrCache.readPr(repoPath)`; if present, return it. After computing the result, `writeAuth` and `writePr`.
- New handler `handlePrRefresh` that calls `gitPrCache.bust(repoPath)` and returns `{ ok: true }`. Register `POST /api/git/pr/refresh`.

### A2. Drop redundant PR fetch in the store
`ui/src/stores/gitStore.ts` `loadRepoState` (line ~96): remove `getGitPullRequest(repoPath)` from the `Promise.all` array and from the destructure/setState. The summary already returns `pullRequest`. **Do not** remove the `getGitPullRequest` export from `lib/api/git.ts` (still used elsewhere). Net: 5 calls → 4.

### A3. Collapse `resolveGitStatus` subprocess fan-out
`routes/git.js` `resolveGitStatus` (line 184) currently runs 5 git spawns. Replace with **2**:

```js
async function resolveGitStatus(childProcessImpl, repoPath) {
  const [porcelainV2, topLevel] = await Promise.all([
    runGit(childProcessImpl, ['status', '--branch', '--porcelain=v2'], repoPath).catch(() => ({ stdout: '', stderr: '' })),
    runGit(childProcessImpl, ['rev-parse', '--show-toplevel'], repoPath).catch(() => ({ stdout: '', stderr: '' })),
  ]);
  // Parse branch, upstream, ahead, behind from porcelain-v2 header lines (# branch.oid / branch.head / branch.upstream / branch.ab).
  // Parse file rows (u/<xy> ... or 1/2 <xy> ...), reuse existing resolveStatusCounts logic for staged/unstaged counts.
  // Keep the SAME return shape: { branch, files, clean, repoRoot, stagedCount, unstagedCount, ahead, behind, upstream, remoteName }.
}
```

**Verify equivalence:** the existing `parseAheadBehind` already matches `branch.ab` (line 54). Add a unit test feeding a captured porcelain-v2 sample and asserting the returned counts match the old 5-spawn path.

### A4. Lazy commit-graph + staggered Git-tab fetches
- `ui/src/views/Workspace/WorkspaceCommitGraph.tsx`: only fetch when expanded. Change the `<details>` in `WorkspaceGitTab.tsx` (line ~1502) to track open state; pass an `enabled` prop to `WorkspaceCommitGraph` that gates its `useEffect`. Do not fetch on mount when collapsed.
- `WorkspaceGitTab.tsx`: stagger the mount useEffects — load worktrees first, then on completion kick enriched-worktrees + merge-candidates + stashes. Add simple in-flight booleans to avoid duplicate concurrent calls on re-render.

### A5. Pause Remote polling when hidden
`ui/src/tabs/Remote/RemoteView.tsx` `useEffect` (line ~43): add a `visibilitychange` listener that clears the poll timer when `document.hidden` and restarts it when visible. Keep the existing dedupe guards in `RemoteStore.ts`.

### Phase A tests
- `routes/git.test.js`: assert that one `loadRepoState` triggers `gh auth status` **at most once** (inject a counting fake `childProcess`). Assert cache hit returns prior result without a new `gh` call. Assert `resolveGitStatus` new parsing matches expected counts.
- `routes/kimaki.test.js`: add the new route `POST /api/git/pr/refresh` to the route inventory if you snapshot it there (check `tests/api-contract.test.js`).
- Run: `node --test copilot-ui/routes/git.test.js` and `npm --prefix copilot-ui run test:vitest`.

---

## Phase C — Gating model: commit ≠ checks; push = checks + force except main/master

### Current
`lib/gitCheckRunner.js` `gateGitAction` (line 422) runs checks for **commit, push, and PR**. `routes/git.js` `handleGitCommit` (line 422) goes through `handleGitActionWithGate`.

### Target
- **Commit:** no checks, ever. Direct `git commit`.
- **Push:** runs checks. Protected branch (main/master, or remote default head — see `isProtectedBranch` at `lib/gitCheckRunner.js` line 706) **hard-blocks** on failure, no override. Non-protected branch: `requiresOverride:true` on failure → force-push with `{ unsafeOverride: { reason } }`.

### C1. Remove gate from commit
`routes/git.js` `handleGitCommit` (line 422): stop calling `handleGitActionWithGate`. Implement directly:

```js
function handleGitCommit(ctx, deps) {
  const { req, res } = ctx;
  const { sendJson, readJsonBody } = deps;
  return readJsonBody(req)
    .then(async (body) => {
      const repoPath = isNonEmptyString(body.repoPath) ? body.repoPath.trim() : '';
      const message = isNonEmptyString(body.message) ? body.message.trim() : '';
      if (!repoPath) throw Object.assign(new Error('repoPath is required'), { statusCode: 400 });
      if (!message) throw Object.assign(new Error('message is required'), { statusCode: 400 });
      const result = await runGit(deps.childProcess, ['commit', '-m', message], repoPath);
      return { committed: true, output: result.stdout.trim() };
    })
    .then((r) => sendJson(res, 200, r))
    .catch((error) => {
      const statusCode = typeof error.statusCode === 'number' ? error.statusCode : 500;
      sendJson(res, statusCode, { error: String(error.message || error) });
    });
}
```

### C2. Push gate (already mostly correct — verify only)
Confirm `handleGitPush` (line 515) still uses `handleGitActionWithGate(..., 'push', ...)`. Confirm `gateGitAction` enforces: protected push → no override (line 442); non-protected push on failure → `requiresOverride:true` (line 665). No backend change needed unless tests reveal otherwise.

### C3. Rework Git-tab composer UI
`ui/src/views/Workspace/WorkspaceGitTab.tsx`:
- Rename the primary action "Verify & Commit" → **Commit**. Its handler (`handleVerifyAndCommit`, line ~630) becomes a plain commit: drop the `runGitChecks` call; call `onCommit()` directly (still guarded by non-empty message). Remove `commitPhase`/`checksVerified`/`failedCheckResults` commit-side state, **except** keep `failedCheckResults` to drive the *push* override UI.
- Move override UI from commit to **push**: rename "Force Commit" block (line ~1525) to **Force Push**. New `handleForcePush` → `pushGit(repoPath, false, { reason: forceOverrideReason.trim() })`. Shown only after a push attempt returned a gate failure (`requiresOverride`).
- Keep "Commit & Push (skip verify)" (line ~1778) as the fast path. Its handler commits directly then pushes; if the push is gated, surface the gate result and offer Force Push when the branch is **not** protected (the backend already rejects force on protected).
- `pushDisabled` (line ~909): remove the `verificationState !== 'verified' && !checksVerified` clause. Push stays enabled whenever `changeCount > 0 && !gitState.syncing`. Remove the "Push disabled — run Verify & Commit first" hint (line ~1832).
- The push handler (`gitStore.push`, `ui/src/stores/gitStore.ts` line 236) already sets `checkFailed`/`showOverrideInput` when `response.requiresOverride`. Wire the Force Push UI to read those and call `push()` again with the override reason set via `setUnsafeOverrideReason`.

### C4. "Run checks" stays optional
No change to `runGitChecks` or the Checks tab. They remain explicit actions that inform the user but never block commit.

### Phase C tests
- `routes/git.test.js`: commit with a failing-check repo still returns `{ committed: true }` and does **not** invoke the gate. Push to a protected branch with failing checks returns 422 and `overrideBlocked:true`; push to a feature branch with failing checks returns 422 `requiresOverride:true`; push with `unsafeOverride.reason` on a feature branch succeeds.
- `lib/gitCheckRunner.test.js`: update any commit-gate expectations.
- UI: `WorkspaceGitTab` smoke — Commit button commits without running checks; Force Push appears only after a gated push failure on a non-protected branch.

---

## Phase E — Remote/Kimaki on/off toggle, persisted, default OFF

### Current
`lib/copilotConfig.js` `getRemoteSessions` (line 100, default `false`) and `setRemoteSessions` (line 110) exist. REST `GET/PUT /api/config/remote-sessions` exist (`routes/config.js`). **Gap:** `lib/desktop-shell/desktopRuntime/runtimeService.js` line ~227 calls `kimakiRuntimeService.start(...)` **unconditionally**. `RemoteView.tsx` has only Restart.

### E1. Honor the setting at boot
`lib/desktop-shell/desktopRuntime/runtimeService.js` (~line 227, the `if (kimakiRuntimeService) { kimakiRuntimeService.start(...) }` block):
- Require `copilotConfig`: `const copilotConfig = require('../../../lib/copilotConfig');` (adjust path — the compiled file is at `lib/desktop-shell/desktopRuntime/`, so `require('../../../lib/copilotConfig')` reaches `copilot-ui/lib/copilotConfig.js`).
- Read `const remoteEnabled = copilotConfig.getRemoteSessions(options.paths.elegyHome);`
- Only `start(...)` when `remoteEnabled === true`. Log `bootLog('Kimaki disabled by config (remoteSessions=false)')` otherwise.
- **Also update the TS source** `src/desktopRuntime/runtimeService.ts` (the `.js` is compiled from it). Keep both in sync.

### E2. Enable/disable routes + richer status
`routes/kimaki.js`:
- `require('../lib/copilotConfig')` at top.
- Add `handleEnable(ctx, deps)`: read `ctx.elegyHome`; `copilotConfig.setRemoteSessions(elegyHome, true)`; if `deps.kimakiRuntimeService`, `await deps.kimakiRuntimeService.start({ callbackUrl: <same as boot> })` (callback URL optional — `start({})` is fine if unknown). Respond `{ ok:true, enabled:true, state }`.
- Add `handleDisable(ctx, deps)`: `copilotConfig.setRemoteSessions(elegyHome, false)`; if `deps.kimakiRuntimeService`, `await deps.kimakiRuntimeService.stop()`. Respond `{ ok:true, enabled:false, state:'idle' }`.
- Extend `handleStatus` (line 50): include `enabled: copilotConfig.getRemoteSessions(ctx.elegyHome)`. Extend the service with `getPid()`/`getStartedAt()`:
  - `lib/desktop-shell/desktopRuntime/kimakiRuntimeService.js` (+ `src/desktop-runtime/kimakiRuntimeService.ts`): store `child?.pid` and a `startedAt` timestamp (set in `start`, cleared in `stop`/`exit`). Expose `getPid()` and `getStartedAt()`.
  - `handleStatus` adds `pid: service?.getPid?.() ?? null` and `uptimeMs: service?.getStartedAt?.() ? Date.now()-service.getStartedAt() : null`.
- Register: `{ method:'POST', path:'/api/remote/enable', handler: handleEnable }` and `{ method:'POST', path:'/api/remote/disable', handler: handleDisable }`.

### E3. RemoteView toggle + state-at-a-glance
`ui/src/tabs/Remote/RemoteView.tsx`:
- Load enabled state: add `enabled` to `RemoteStore` state; fetch from `GET /api/config/remote-sessions` on mount (reuse `lib/api/remote.ts` — add `getRemoteSessionsConfig()`/`setRemoteSessionsEnabled(bool)` if absent).
- Add a prominent **Enable/Disable** toggle button in the toolbar (near `remote-restart`). Enable → POST `/api/remote/enable`; Disable → POST `/api/remote/disable`. After either, `loadStatus()`.
- When `enabled === false`: show a clear disabled panel (no Kimaki spawned) with a single CTA "Enable remote sessions" and a short note. Hide the projects/sessions/send panels until enabled.
- When enabled: add a compact state strip showing — status badge (existing), `ready`, guild count, `appId`, **pid**, **uptime** (format `uptimeMs`), last error, data dir. Use existing `status` fields plus the new `pid`/`uptimeMs`.

### Phase E tests
- `lib/desktop-shell/desktopRuntime/runtimeService.test.js`: when `getRemoteSessions` returns `false`, `kimakiRuntimeService.start` is **not** called; when `true`, it is. Inject a fake `copilotConfig` via deps if the runtime service accepts it, else inject via the existing test harness pattern.
- `routes/kimaki.test.js`: update the registered route list to include the two new routes; add a test that `handleEnable` writes config true and calls `start`, `handleDisable` writes false and calls `stop`, and `handleStatus` includes `enabled`.
- Run: `node --test copilot-ui/routes/kimaki.test.js copilot-ui/lib/desktop-shell/desktopRuntime/runtimeService.test.js`.

---

## Phase B — Commit-message generation reliability

### Problem
`routes/git.js` `handleGenerateCommitMessage` (line 1536) runs `opencode run --model X --agent plan --format json` (a tool-using agent), 60s/model, chained across profile-derived models. `parseOpenCodeCommitMessage` (line 1511) uses last-content-wins and can grab reasoning/tool/system text.

### B1. Non-agent invocation
- Replace `--agent plan` with a minimal/no-tool role. Check `opencode-assets/profiles.json` role list for a plain chat role; if none, use opencode's raw prompt mode (omit `--agent` if the CLI permits a bare prompt, else use the lightest role). Keep `--format json`.
- Lower per-model `timeout` (line ~1634) from `60000` to `30000`.

### B2. Strict parser
Rewrite `parseOpenCodeCommitMessage` (line 1511): parse NDJSON; keep only events whose `type` indicates a **final assistant text part**. Exclude `tool_*`, `reasoning`, `thinking`, `system`. Join those text parts. Keep the existing fence/quote stripping. Fall back to the current heuristic only if no assistant part is found, and add a `warnings` note when fallback is used.

### B3. Surface failure codes in UI
- `ui/src/stores/gitStore.ts` `generateCommitMessage` (line 319): on `response.ok === false`, store `response.code` and `response.lastError` on state (add `generateError` / `generateErrorCode` fields to `GitState`).
- `WorkspaceGitTab.tsx` Generate area (line ~1568): on failure, toast the specific code (`OPENCODE_NOT_FOUND`, `MODEL_CHAIN_FAILED`, `NO_CHANGES`). On `MODEL_CHAIN_FAILED`, add a "Try next model" button that re-invokes `generateCommitMessage` (the backend already iterates models; this is a retry).

### Phase B tests
- `routes/git.test.js`: feed captured NDJSON fixtures (include tool/reasoning/assistant events) and assert the parser extracts assistant text only. Assert invocation no longer passes `--agent plan` (inject a fake `childProcess` capturing args).

---

## Phase D — PR UX: create / observe / validate / act (owner-aware)

### D1. Rich PR resolver
`routes/git.js` `resolvePullRequest` (line 117): change the `gh pr view --json` fields to include `number,url,state,baseRefName,headRefName,isDraft,statusCheckRollup,reviewDecision,mergeable,mergeStateStatus`. Compute a checks summary (`{ passed, failed, pending }`) from `statusCheckRollup`. Honor the A1 cache. Extend the `GitPullRequestResponse` type in `ui/src/lib/api/git.ts` and `gitStore` accordingly.

### D2. PR panel in Git tab (feature-branch aware)
`WorkspaceGitTab.tsx` (replace the small "Collapsible PR create" at line ~1715 with a richer panel):
- **Create:** shown when on a non-protected branch (`branch !== 'main' && branch !== 'master'`) with a remote and no open PR. Loosen gate: allow create when `checksAvailable === 0` **or** user is repo owner. Owner detection: add `gh repo view --json owner` + `gh api user --jq .login` (cache 5 min). If owner detection fails, fall back to strict (non-owner). Hard-block only on CI-gap.
- **Observe:** when a PR exists, show — PR # + state, `base ← head`, checks rollup chips (✓n / ✗n / ⏳n from summary), `reviewDecision` (APPROVED / REVIEW_REQUIRED / …), `mergeable` + `mergeStateStatus` (CLEAN / CONFLICT / BLOCKED).
- **Act:** "Open on GitHub" (existing), "Merge" → `POST /api/git/pr/merge` enabled only when `mergeable && mergeStateStatus !== 'BLOCKED'` and user is owner. Offer method (merge/squash).

### D3. New routes
`routes/git.js`:
- `GET /api/git/pr/detail?repoPath=` → returns the rich PR object (uses cached resolver; if no PR, `{ pullRequest: null }`).
- `POST /api/git/pr/merge` → body `{ repoPath, number, method }`; runs `gh pr merge <number> --<method>` (method ∈ merge/squash/rebase, default squash). Gate through `handleGitActionWithGate(..., 'pull-request', ...)` only if you want CI-gap enforcement; otherwise run directly and return `gh` output. Bust the PR cache after merge.

### Phase D tests
- `routes/git.test.js`: PR detail returns the extended shape; merge calls `gh pr merge` with the chosen method; cache is busted after merge.
- UI smoke: PR card renders create vs observe vs act states correctly from mock data.

---

## Cross-phase acceptance

- `npm --prefix copilot-ui run test:vitest` passes.
- `node --test copilot-ui/routes/git.test.js copilot-ui/routes/kimaki.test.js copilot-ui/lib/gitCheckRunner.test.js copilot-ui/lib/desktop-shell/desktopRuntime/runtimeService.test.js` passes.
- `npm run ci:local` passes.
- Manual: open the Git tab — status loads with visibly fewer `gh` calls (check server logs); Commit works without running checks; a gated push on a feature branch offers Force Push; on main/master it hard-blocks; Generate returns a clean message; Remote tab can disable Kimaki (no child process) and re-enable it; PR panel shows checks/review/mergeable.

## Docs to update (last)
- `docs/system/copilot-ui-guide.md`: replace the "Enhanced Git Tab (2026-06-08)" section's gating description with the new commit/push model; add a "Remote toggle" subsection; note the PR panel.

## Non-goals
- No cosmetic restyle of unrelated surfaces (Phase F deferred).
- No change to protected-branch hard-block on main/master.
- Owner detection failures fall back to strict (non-owner) behavior.
