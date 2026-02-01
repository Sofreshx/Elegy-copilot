# AWB UX Overhaul — PLAN Artefact

**Goal:** Transform the Agentic Workbench (AWB) into a fully-functional workflow execution environment with a robust layout, workflow selection and execution UX, context management modes, low-level tool framework, and real-time status/traceability.

---

## ✅ Success Criteria (high-level)
- Layout: Main workbench area shows a scrollable workflow list; right side displays context and tools.
- Chat: Free-speech input works and chat can be minimized.
- AI Status: Visible loading/working animation when AI/server is busy.
- Workflow Controls: Users can select workflows and use basic controls (run / pause) and view status.
- Spotlight Mode: Selected workflow becomes the chat context for voice commands.
- Context Modes: Switch between Full, Workflow-specific, and Clean context.
- Low-Level Tools: Foundation for agents to invoke backend tools (API clients, stubs).
- Auth Fix: `GET /offers` no longer throws an `IAuthenticationService` error.
- Traceability: Tool executions show reasoning, failures, and results in the UI.

---

## 🗂 Project Scope & Phases

### Phase 1 — Backend Auth Fix (Critical)
- **task-000355 (AWB-AUTH-001):** Fix `IAuthenticationService` error on `GET /offers` (target: `Api/AccountManager.Api/Features/Offers/OfferEndpoints.cs`).

### Phase 2 — Layout Refactor
- **task-000356 (AWB-LAYOUT-001):** Refactor Workbench layout — main area: workflows; sidebar: context/tools.
- **task-000357 (AWB-WORKFLOW-001):** Create `Workflow List Panel` component (depends on `000356`).
- **task-000358 (AWB-WORKFLOW-002):** Create `Workflow Control Widget` (depends on `000357`).

### Phase 3 — Chat & Context Management
- **task-000359 (AWB-CHAT-001):** Enable free-speech input & chat minimize (depends on `000356`).
- **task-000360 (AWB-CONTEXT-001):** Create `Context Mode Selector` (depends on `000359`).

### Phase 4 — Workflow Selection & Spotlight
- **task-000361 (AWB-SPOTLIGHT-001):** Implement `Workflow Spotlight Mode` (depends on `000357`, `000360`).
- **task-000365 (AWB-SIGNALR-001):** Wire workflow status updates via SignalR (depends on `000357`).

### Phase 5 — AI / Server Status Indicators
- **task-000362 (AWB-STATUS-001):** Create AI Status Indicator with animation (standalone, parallel).

### Phase 6 — Low-Level Tool Framework
- **task-000363 (AWB-TOOLS-001):** Create API Client Generator tool (standalone, parallel).

### Phase 7 — Tool Execution Traceability
- **task-000364 (AWB-TRACE-001):** Add Tool Execution Traceability UI (depends on `000356`).

---

## 🔗 Dependency Graph
```
000355 (auth fix) ─── standalone, critical

000356 (layout) ──┬── 000357 (workflow list) ──┬── 000358 (control widget)
                  │                            └── 000361 (spotlight)
                  │                            └── 000365 (signalr)
                  ├── 000359 (chat/minimize) ──── 000360 (context modes) ── 000361
                  └── 000364 (traceability)

000362 (status indicator) ─── standalone, parallel
000363 (api client tool) ─── standalone, parallel
```

---

## 📁 Context Loaded (Key files)
- `Frontend/SAASClient/src/Features/AgenticWorkbench/` — main workbench UI & components
- `Api/AccountManager.Api/Features/Offers/OfferEndpoints.cs` — auth fix target
- `Api/Tools.Api/Features/AgenticSession/` — session/SignalR
- `Libraries/Workflow/Tools/` — low-level tool implementations

> When a task touches other modules, list exact files in that task's implementation notes.

---

## 🧭 Decisions & Rationale
- Layout-first: Improving layout (`000356`) unlocks most UI tasks and reduces rework.
- Backward-compatible defaults: Default to **Full** context to avoid breaking sessions when adding context modes.
- Start small for API client gen: Implement a stub generator first and iterate to avoid large upfront complexity.
- Keep SignalR wiring minimal at first: rely on existing hub events if present; raise backend changes only if necessary.

---

## 🧩 Task Graph (short form)
- 000355 — independent, run unit + API tests (critical)
- 000356 → 000357, 000359, 000364
- 000357 → 000358, 000361, 000365
- 000359 → 000360 → 000361
- 000362 — parallel
- 000363 — parallel

---

## ⚠️ Risks & Mitigations
1. Auth fix breaks other endpoints
   - Mitigation: Run `AccountManager.Api` tests and verify `GET /offers` permutations; prefer explicit `Results.Unauthorized()` handling when middleware missing.
2. Context mode changes break sessions
   - Mitigation: Add a backward-compatible default mode `Full` and migration notes.
3. Workflow list perf issues
   - Mitigation: Add virtualization/pagination early; measure with large fake datasets.
4. API client gen complexity
   - Mitigation: Start with a minimal stub that covers 80% of use-cases and iterate.
5. SignalR contract mismatch
   - Mitigation: Confirm hub events exist; add integration tests or developer smoke tests using the browser DevTools network tab.

---

## 🔬 Validation & Tests
- Unit / Integration:
  - Run `dotnet test` on `AccountManager.Api.Tests` and `Tools.Api.Tests` (and impacted test projects).
  - Add focused unit tests for `OfferEndpoints` to reproduce and confirm fix for `IAuthenticationService` error.
- Manual:
  - Run the app locally and validate `Frontend/AgenticWorkbench` UI: layout, chat minimize, context selector, spotlight.
  - Verify SignalR events reach browser (`Network` tab) and update UI.
  - Verify tool execution traceability displays steps, errors, and results.
- End-to-end:
  - Manual voice/keyboard command flows with Spotlight mode.

---

## 🔧 Execution Notes (for subagents and contributors)
- Create feature branches per task: `awb/{taskId}-{short-title}` (e.g., `awb/task-000356-layout-refactor`).
- Keep PRs small and focused; link to task IDs and this PLAN artefact.
- For UI tasks: include visual snapshots or short screen recordings in the PR description.
- For backend changes: add tests that fail before the fix and pass after.
- Use feature flags where a change may alter production behavior.

---

## ⏱ Milestones / Rough Estimates (T-shirt sizing)
- 000355 — Critical hotfix — 1-2 days (investigate + tests)
- 000356 — Layout refactor — M (3-7 days)
- 000357 — Workflow list panel — S-M (2-5 days)
- 000358 — Control widget — S (1-3 days)
- 000359 / 000360 — Chat + Context — M (3-6 days)
- 000361 — Spotlight mode — M (3-5 days)
- 000365 — SignalR wiring — S-M (2-4 days)
- 000362 / 000363 / 000364 — Parallel smaller tasks — S (1-3 days each)

---

## ✅ Acceptance Criteria (mapped)
- (A1) Layout: Workflow list scrollable + right-side context/tools — verifies `000356`, `000357`.
- (A2) Chat: Free-speech input + minimize — verifies `000359`.
- (A3) AI Status: Loading animation visible — verifies `000362`.
- (A4) Workflow Selection: Select + run/pause + status — verifies `000357`, `000358`, `000365`.
- (A5) Spotlight: Selected workflow becomes chat context — verifies `000361`.
- (A6) Context Modes: Full / Workflow-specific / Clean — verifies `000360`.
- (A7) Low-Level Tools: Agents can invoke backend tools — verifies `000363`.
- (A8) Auth Fix: `GET /offers` no longer throws `IAuthenticationService` — verifies `000355`.
- (A9) Traceability: UI shows execution trace, reasoning, failures — verifies `000364`.

---

## 📌 Next Steps
1. Triage and create individual task issues for `task-000355` through `task-000365` in the tracker (link to this artefact).
2. Start with **task-000355** (auth hotfix) as it is blocking and critical.
3. Kick off `000356` (layout refactor) concurrently with `000362` & `000363` where possible.

---

**Artefact owner:** (assign a PM/Tech lead)

**Last updated:** 2026-01-30

---

> Notes: Keep this artefact as the single source of truth for high-level decisions — tasks remain the source of truth for implementation details and progress tracking.
