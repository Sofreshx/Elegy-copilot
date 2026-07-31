# Implementation Plan: Workspace Command Runner

**Spec:** `docs/specs/workspace-command-runner/spec.md`
**Created:** 2026-07-31
**Status:** draft

---

## Overview

This plan implements R1–R6 of the workspace-command-runner spec: deterministic command discovery (README docs + package.json scripts + Makefile targets) with fixed categorization, background dependency setup, a run/stop API with one active run per repo, and a reworked Workspace Execute tab where the commands surface is primary and the orchestrator sessions collapse behind the pilot flag.

Work is ordered into 6 phases. Phase 0 verifies the baseline. Phase 1 (discovery library) must complete before Phase 2 (routes depend on it). Phase 2 must complete before Phase 3 (UI depends on the API client). Phase 4 is docs. Phase 5 is full validation.

**Cross-spec coordination:** Independent spec; no shared implementation files with active specs. The orchestrator ADR constraint (no second tab) is respected — the commands surface lives inside the existing Execute tab.

---

## Implementation Order

```
Phase 0: Baseline verification (10 min)
Phase 1: lib/commandDiscovery.js + tests (R1, R2, R3-setup-detection) (90 min)
Phase 2: lib/executionRunner.js + routes/execution.js + registration + tests (R3, R4, R6) (90 min)
Phase 3: Frontend — api/execution.ts, WorkspaceExecutionTab rework, CSS, vitest (R5) (90 min)
Phase 4: Docs — copilot-ui-guide.md, orchestrator-architecture-adr.md note (30 min)
Phase 5: Full validation — contract snapshot, ui:check, node tests, vitest, links (20 min)
```

---

## Step-by-Step

### Phase 0 — Baseline verification (10 min)

1. Run `npm --prefix copilot-ui test` (node route tests) and confirm baseline green.
2. Run the existing execution-tab vitest: `npm --prefix copilot-ui run test:vitest -- workspace-execution-tab` (verify exact runner invocation from `copilot-ui/package.json`).
3. Confirm dirty worktree files (`codex/simplify-managed-surfaces` branch changes) are untouched by this work.

**Gate:** Baseline passes; unrelated worktree changes remain untouched.

---

### Phase 1 — Discovery library (R1, R2, R3-setup-detection) (90 min)

**2. Create `copilot-ui/lib/commandDiscovery.js`** — pure, deterministic, no IO beyond file reads:

- `DOC_SOURCES` — `README.md`, `README`, `CONTRIBUTING.md`, `GETTING_STARTED.md` (case-insensitive match on basename).
- README extraction:
  - Parse fenced code blocks with shell-ish languages (`bash`, `shell`, `sh`, `console`, `zsh`, `ps`, `powershell`); plus lines starting with `$ `.
  - Strip `$ ` prompt prefix, trailing inline comments (` # ...`), and line-continuation markers.
  - Noise filter: empty, `echo`, `ls`, `cd` (alone), `export` (alone), editor invocations, `exit`, `clear`.
- Runability: first token + args must pass the workspace.js-style validation (reject shell metacharacters `;&|`$(){}!<>#*?[]`; reject args escaping the repo root). Non-runnable candidates counted in `meta.skipped` with reason.
- Classification (`classifyCommand(name)` exported):
  - Script-name vocabulary → category: `test`→Test; `dev`/`start`/`serve`/`watch`/`preview`/`storybook`→Start/Dev; `lint`/`typecheck`/`check`/`format`/`coverage`→Lint/Check; `build`→Build; `docs`/`doc`/`docs:dev`/`docs:build`/`storybook`→Docs; `install`/`setup`/`bootstrap`→Setup; else Other.
  - Tool lookup: `npm`/`yarn`/`pnpm`/`bun` run `<script>` → classify by script name (also `npx <tool>` with known tool map: storybook, vitest, jest, eslint, tsc, prettier); `cargo test/build/check/run/doc`; `make <target>` by target name; `docker compose up|run`; `python -m pytest/flask/uvicorn`, `mkdocs serve|build`, `streamlit run`; `rails s|test`, `bundle exec`, `rake <target>`; `go test/build/run`.
  - `longRunning: true` for Start/Dev and Docs-server classes (`dev`, `start`, `serve`, `watch`, `preview`, `docs:dev`, `storybook`).
- package.json: scripts → commands with `command: 'npm'`, `args: ['run', name]` (keep npm as canonical wrapper for pnpm/yarn repos only when lockfile matches — v1 keeps npm, note in drift if needed). Max 20 scripts.
- Makefile: parse `^([a-zA-Z0-9_.-]+):` targets, skip `.PHONY`/help/special targets, classify by name.
- Dedupe: normalize `(command, args)`; package.json wins; Makefile before README; README-only commands carry `source: { docPath, line }`.
- Ordering: fixed group order `Setup, Start/Dev, Test, Lint/Check, Build, Docs, Other`; within group by source priority (package.json > Makefile > README) then stable name.
- Setup: pick exactly one install command (install verbs above); if multiple, prefer the package-manager one matching the lockfile, else the first by source priority.
- `discover(repoRoot)` returns `{ schemaVersion: 1, detectedAt, sources: [{path, mtime}], setup, categories: [{id, label, commands: []}], meta: {skipped, total} }`.

**3. Tests — `copilot-ui/lib/commandDiscovery.test.js`** (node:test):
- Fixture repo in tmp dir: README with quickstart/test/docs/install blocks; package.json with scripts; Makefile.
- Assert: group order fixed; package.json wins dedupe; README-only keeps source; metachar line skipped; setup single entry; `longRunning` flags; Makefile targets classified; empty repo → no commands, no setup.

**Gate:** All discovery tests pass; output shape matches the API contract in R4.

---

### Phase 2 — Runner + routes (R3, R4, R6) (90 min)

**4. Create `copilot-ui/lib/executionRunner.js`**:

- In-memory `Map<repoPath, RunRecord>`; RunRecord: `{ runId, kind: 'command'|'setup', command, args, cwd, child, status: 'running'|'done'|'failed'|'stopped', exitCode, stdout[], stderr[], startedAt, finishedAt }`.
- `start({ repoPath, command, args, cwd, kind })` — rejects 409-shape error when a run is active for that repo; spawns `shell: false` with `detached: true`; ring-buffer output capped at ~50k chars.
- `stop(runId)` — tree-kill (win32: `taskkill /pid <pid> /T /F`; posix: `process.kill(-pid)`).
- Persistence helpers `readRunOutcomes(repoId)` / `writeRunOutcome(repoId, commandId, { lastRunAt, lastExitCode })` under `~/.elegy/repo-state/<repoId>/execution/runs.json` (atomic tmp+rename).
- Kill active children on process exit (`process.on('exit')` best-effort).

**5. Create `copilot-ui/routes/execution.js`** (pattern from `routes/workspace.js`):

- `GET /api/execution/overview?repoPath=` — repoPath required; missing repo → 404; returns cached-or-fresh discovery (`~/.elegy/repo-state/<repoId>/execution/discovery.json`, stale if any source mtime changed), `setup: { status, lastRunAt, lastExitCode }`, `activeRun` (from runner), `lastRuns` map.
- `POST /api/execution/refresh` — re-run discovery, persist, return result.
- `POST /api/execution/run` — `{ repoPath, commandId }`; resolve from discovery; validate command/cwd via workspace rules; start; return `{ runId }`; 403 validation, 404 unknown command, 409 concurrent.
- `POST /api/execution/setup` — `{ repoPath }`; 404 when no setup; start kind=setup.
- `GET /api/execution/runs/:runId` — status/exitCode/stdout/stderr/timestamps.
- `POST /api/execution/runs/:runId/stop` — stop, return final record.
- Register in `routes/index.js` (`require('./execution')`).

**6. Tests — `copilot-ui/routes/execution.test.js`** (node:test fake ctx):
- overview (cache hit/miss, mtime invalidation), refresh, run (ok/403/404/409), setup (404/ok), run status, stop.

**Gate:** Route tests pass; `npm --prefix copilot-ui test` green.

---

### Phase 3 — Frontend (R5) (90 min)

**7. Create `copilot-ui/ui/src/lib/api/execution.ts`** — interfaces (`ExecutionOverview`, `ExecutionCommand`, `ExecutionCategory`, `ExecutionSetupState`, `ExecutionRun`) + `getExecutionOverview`, `refreshExecutionCommands`, `runExecutionCommand`, `startExecutionSetup`, `getExecutionRun`, `stopExecutionRun` via `apiRequest`.

**8. Rework `copilot-ui/ui/src/views/Workspace/WorkspaceExecutionTab.tsx`**:
- Keep existing orchestrator panels; wrap them in a collapsed section (`<details>` or conditional render) shown only when `health.pilot.enabled`; keep existing testIDs.
- New top content:
  - Toolbar: repo label, last-scan time, Refresh (calls refresh endpoint), error surface.
  - Setup card: detected command string, status chip (not-started/running/done/failed), Run Setup / Re-run / Stop buttons.
  - Category sections: rows with label, description, source badge (package.json / Makefile / README.md:line), Run button (disabled while a run is active), Stop for longRunning while running, last-exit chip, expandable output `<pre>` with live tail (poll `getExecutionRun` every 1s while running).
  - Empty state message when `commands.length === 0`.

**9. CSS** — extend the `workspace-execution-*` block in `copilot-ui/ui/src/app.css`.

**10. Vitest** — extend `copilot-ui/tests/workspace-execution-tab.vitest.tsx` (orchestrator still renders with pilot on; collapsed when off) and add `copilot-ui/tests/workspace-execution-commands.vitest.tsx` (setup card statuses, grouped rows, run → poll → completed exit code, stop action, empty state).

**Gate:** New vitest pass; typecheck clean.

---

### Phase 4 — Docs (30 min)

11. Update `docs/system/copilot-ui-guide.md`: Execute tab section — commands surface, setup, run/stop, orchestrator pilot-gated collapse.
12. Update `docs/system/orchestrator-architecture-adr.md:27`: replace the stale placeholder description with the current state (commands surface + pilot-gated sessions); keep the no-second-tab rule intact.

**Gate:** Docs reflect the shipped behavior.

---

### Phase 5 — Full validation (20 min)

13. `UPDATE_API_SNAPSHOT=1 node copilot-ui/tests/api-contract.test.js` — confirm the snapshot diff contains only the new execution routes; run once without the env to confirm it passes against the new snapshot.
14. `npm run ui:check`
15. `npm --prefix copilot-ui test` (node tests incl. new discovery/route tests)
16. `npm --prefix copilot-ui run test:vitest` (all UI tests)
17. `npm run docs:check:links`
18. `node scripts/validate-specs.js --strict docs/specs/workspace-command-runner/spec.md` and regenerate the spec index if the repo inventory requires it.

**Gate:** All checks pass; git diff scoped to this feature plus the intentional snapshot update.

---

## Risks

- README parsing breadth: mitigated by conservative whitelist of shell-ish languages and prompt prefixes; noise filter; everything is deduped against package.json and ordered deterministically.
- Long-running dev servers on Windows: `taskkill /T /F` tree-kill; output ring buffer prevents unbounded memory.
- Orchestrator pilot UI regression: sessions section unchanged when pilot on; testIDs preserved.
