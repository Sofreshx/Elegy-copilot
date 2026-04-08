---
created: 2026-04-07
updated: 2026-04-07
category: research
status: current
doc_kind: node
id: task-board-orchestration-mvp-design-brief
summary: Concrete MVP design brief for repo-state task board control, app-level parallel sessions, in-session actors, local workflow triggering, and same-repo worktree isolation.
tags: [research, copilot-ui, task-board, sessions, workflows, worktrees]
related: [copilot-ui-mvp-scope-lock, copilot-ui-guide, copilot-ui-information-architecture-freeze, domain-authorities-freeze, session-state-artifacts, planning-backlog-roadmap-contract, copilot-sdk-integration-adr]
---

# Task Board + Multi-Session/Sub-Agent Orchestration MVP Design Brief

## Purpose

Make the MVP execution model concrete enough for later implementation work without reopening scope.

## Context

This brief follows the current canonical constraints:

- `copilot-ui` remains the local desktop control plane and keeps the frozen 4-hub shell.
- Planning owns the visible task board and local workflow controls.
- Runtime remains the live authority for sessions; session artifacts are projections/fallbacks.
- Durable task authority lives under `~/.copilot/repo-state/<repoId>/tasks/`.
- MVP includes app-level parallel sessions, in-session sub-actors, same-repo worktree isolation, and an auto-triggered local workflow layer.
- Orchestration stays local-only; `local-tracker` and messaging-gateway are not orchestration owners.

Implementation seams this brief is anchored to:

- `copilot-ui/routes/sessions.js`
- `copilot-ui/routes/executor.js`
- `copilot-ui/lib/planState.js`
- `copilot-ui/lib/sessionArtifacts.js`
- `copilot-ui/ui/src/tabs/HomeRuntime/HomeRuntimeView.tsx`
- `copilot-ui/ui/src/tabs/Sessions/`
- `copilot-ui/ui/src/tabs/Executor/`
- `copilot-ui/ui/src/tabs/Planning/planningStore.ts`

## Details

### Scope distinctions that are now fixed

| Concern | MVP meaning | Not the same as |
| --- | --- | --- |
| App-level parallel sessions | Separate runtime sessions the desktop app can create, list, attach to, pause/resume, and close concurrently | Sub-actors inside one session |
| Sub-agents / sub-actors | Decomposition inside one parent session for planning/execution responsibility | Separate top-level sessions or separate task-board lanes |
| Same-repo worktree isolation | Separate writable filesystem roots for parallel same-repo sessions | Actor decomposition inside one session |
| Task board | Planning-owned projection/control surface over durable repo-state tasks | Repository Backlog, Roadmap, or session `plan.md` |
| Workflow layer | Local workflow automation that reacts to durable task state and calls local runtime services | Remote orchestration, gateway control, or tracker ownership |

### Core MVP model

1. **Tasks are durable repo-state records.**
   - One task = one durable repo-state record under `~/.copilot/repo-state/<repoId>/tasks/`.
   - The board reads and updates those records.
2. **Sessions are live runtime work containers.**
   - A task may be owned by at most one live parent session at a time.
   - Runtime session state is authoritative; artifacts and board chips are projections.
3. **Actors are runtime-scoped children of a session.**
   - Actors do not become repo-global durable entities in MVP.
   - Actor metadata belongs to the parent session runtime state.
4. **Worktrees isolate same-repo parallel write work.**
   - A second writable session for the same repo must use a dedicated worktree.
   - Sub-actors do not auto-create their own worktrees.
5. **Workflow runs are local automation around tasks.**
   - The task board may auto-trigger local workflows.
   - Workflow runs can create/resume sessions, allocate worktrees, or attach to existing sessions, but they do not replace session authority.

### Lifecycle

#### 1. Session creation

1. Operator selects a repo in Catalog/Planning.
2. Planning creates or selects a durable task.
3. If the task has no live owner, the app creates a parent session.
4. The session is created through the existing Sessions/SDK runtime path, not through the task store.
5. The task record is updated with `ownerSessionId` and `status: in_progress` only after session creation succeeds.

#### 2. Actor decomposition

1. The parent session may create sub-actors such as planner, implementer, reviewer, or researcher.
2. Sub-actors are scoped under the parent `sessionId`.
3. Actor decomposition is a live runtime overlay:
   - full actor metadata is runtime-owned
   - the board may show actor summary chips
   - the task record may keep only an additive `activeActorId` or `activeActorLabel` pointer for operator context
4. If true concurrent write work is needed, the system must split work into separate app-level sessions instead of treating sub-actors as isolated writers.

#### 3. Task assignment

1. Durable ownership is by parent session.
2. Fine-grained actor assignment is runtime-only.
3. A task cannot be durably owned by two sessions at once.
4. Reassignment clears the prior owner first, then assigns the new owner.

#### 4. Workflow triggering

Workflow trigger sources are:

- **auto** when a task enters `ready` and automation is enabled
- **manual** from the board
- **resume** when a paused task already has a resumable session/worktree

Trigger rules:

1. The trigger evaluates local repo context, task state, existing owner session, and worktree availability.
2. If a matching live session already exists, the workflow attaches/resumes instead of creating a duplicate session.
3. If no live session exists, the workflow creates a session through the local runtime/executor layer.
4. Workflow-run state is tracked separately from task status.
5. Packaged n8n is the favored local runner, but the board/executor contract stays runner-agnostic.
6. The first bounded implementation slice captures executor/session lifecycle events into a local
   workflow-trigger envelope that preserves repo, worktree, task, and session identity before any
   future packaged runner-specific branching occurs.
7. The desktop-managed workflow sidecar stays loopback-only, bearer-protected, and kill-switchable so
   future packaged n8n wiring does not become a new remote control plane or a competing task/session
   authority.

#### 5. Worktree selection

1. If the repo has no other active writable session, the first writable session may use the primary repo checkout.
2. If the repo already has an active writable session, the next writable session must get a dedicated worktree.
3. Read-only inspection/attach flows do not require a dedicated worktree.
4. Sub-actors inherit the parent session worktree; they do not allocate independent worktrees in MVP.

#### 6. Pause / resume

- **Pause** keeps the task durable, retains `ownerSessionId`, and marks the task `paused` when execution is intentionally suspended.
- **Resume** reattaches the same session when possible, reloads runtime context plus session artifacts, and reuses the same worktree unless the operator explicitly rehomes the task.
- Session artifacts parsed by `copilot-ui/lib/planState.js` and `copilot-ui/lib/sessionArtifacts.js` remain resume inputs, but runtime is still the live authority when present.

#### 7. Attach

- Attach is a UI/runtime action, not a new authority lane.
- The app can attach any window/tab to:
  - an active parent session
  - a paused resumable session
  - an overlay/executor surface already associated with that session
- Attach never creates a second durable task owner.

#### 8. Close / archive

- **Close session**
  - ends live runtime ownership
  - clears `ownerSessionId` from unfinished tasks and returns them to `ready`, `blocked`, or `paused`
  - leaves session artifacts available for inspection
- **Mark done**
  - sets durable task status to `done`
  - may leave the session visible until explicitly closed
- **Archive**
  - session moves to `sessions-archive/`
  - task moves from `tasks/` to `tasks.archive/` only after explicit archive/cleanup

### Authority and state ownership

| Domain | Live authority | Durable/projected location | Notes |
| --- | --- | --- | --- |
| Session metadata | Runtime session services surfaced through `routes/sessions.js` and SDK/session flows | `~/.copilot/session-state/<SESSION_ID>/` as projection/fallback | Runtime wins when both exist |
| Actor metadata | Parent session runtime state | Optional additive projection in session overlays/artifacts only | No repo-global actor registry in MVP |
| Durable task records | Repo-state task store | `~/.copilot/repo-state/<repoId>/tasks/` and `tasks.archive/` | Canonical task identity/status/ownership |
| Task-board projection state | Planning UI/store | In-memory board projection plus refreshed task queries | Projection only |
| Workflow-run state | Local executor/workflow runtime surfaced through `routes/executor.js` | Executor/workflow service persistence; task stores only references such as `latestRunId` | Separate from task status |
| Worktree metadata | Local app/runtime worktree manager | `~/.copilot/repo-state/<repoId>/worktrees/<worktreeId>.json` | Filesystem isolation metadata, not session authority |

### Durable task records vs runtime overlays vs board-only UI state

| Layer | Owns | Examples |
| --- | --- | --- |
| Durable repo-state task record | Canonical task identity and control state | `taskId`, title, repoId, status, priority, `ownerSessionId`, workflow policy, linked roadmap/backlog refs, worktree reference |
| Live runtime overlay | Current execution truth while the app is running | active actor tree, live session status, streaming progress, transient workflow step, live blockers, attachability |
| Ephemeral board-only UI state | Pure presentation state | selected card, filters, sort mode, collapsed swimlanes, transient drag target, unsaved column search |

Rule: if a field affects cross-reload task ownership or automation decisions, it belongs in the durable task record, not only in the board.

### Task board shape

The board is a Planning surface with these default columns:

1. **Inbox** — accepted task record exists, but no execution owner yet
2. **Ready** — eligible for manual or auto trigger
3. **In Progress** — durably owned by a live session
4. **Blocked** — cannot advance without another dependency or decision
5. **Paused** — execution intentionally suspended with resumable context
6. **Done** — finished but not yet archived

Secondary view:

- **Archived** is not a default active column; it is a filtered archive view backed by `tasks.archive/`.

Status rules:

- Workflow badges such as `queued`, `running`, `retrying`, `failed`, or `succeeded` are **workflow overlays**, not board columns.
- Actor labels such as `planner` or `reviewer` are **runtime overlays**, not durable board states.
- Repository Backlog and Roadmap docs remain separate planning authorities and are linked references, not replaced by this board.

### Minimal durable task shape for MVP

The MVP task record should be deterministic and machine-writable. Minimum fields:

```json
{
  "taskId": "TASK-20260407-001",
  "repoId": "instruction-engine",
  "title": "Example task",
  "status": "ready",
  "ownerSessionId": null,
  "activeActorId": null,
  "workflow": {
    "mode": "auto",
    "workflowKind": "task-execution",
    "latestRunId": null
  },
  "worktree": {
    "mode": "shared",
    "worktreeId": null
  },
  "linkedPlanning": {
    "backlogIds": [],
    "roadmapIds": []
  },
  "createdAt": "2026-04-07T00:00:00Z",
  "updatedAt": "2026-04-07T00:00:00Z"
}
```

Interpretation:

- `ownerSessionId` is durable because it affects attach/resume and duplicate-run prevention.
- `activeActorId` is optional and summary-only; the full actor graph remains runtime-owned.
- `workflow.latestRunId` is a reference, not a second workflow authority.
- `worktree.mode` is `shared` or `dedicated`; same-repo parallel writable sessions force `dedicated`.

### Workflow model

The workflow layer is a local automation/control plane above task records:

1. Planning changes a task to `ready`.
2. Auto mode requests a local workflow run.
3. The workflow run checks:
   - repo selection exists
   - task is not already owned by another live session
   - SDK/CLI/executor runtime is available
   - a required worktree can be resolved
4. The workflow run then either:
   - attaches to an existing matching session, or
   - creates a new session and claims the task
5. Executor/run history is shown in `Home / Runtime -> Executor`.
6. Board cards show only summarized workflow state.
7. The current delivery uses a contract-only local sidecar ingress for trigger capture/health while the
   favored packaged n8n runtime remains a follow-on validation step behind the same bounded contract.

This keeps:

- task durability in repo-state
- live execution in runtime/executor
- board state in Planning

### Compatibility with current implementation surfaces

| Surface | MVP role after this brief |
| --- | --- |
| `copilot-ui/routes/sessions.js` | Remains the live session inventory/detail/archive surface and gains task/session attach-resume hooks rather than task authority |
| `copilot-ui/routes/executor.js` | Remains the job/run control plane; workflow runs and auto-trigger actions layer here |
| `copilot-ui/lib/planState.js` | Continues parsing session `plan.md`; does not become task-board state authority |
| `copilot-ui/lib/sessionArtifacts.js` | Continues parsing handoff/proposition/verification artifacts for resume and summary projections |
| `HomeRuntimeView.tsx` | Continues as the runtime shell; shows summaries and jump points, not a new task authority |
| `ui/src/tabs/Sessions/` | Owns session listing, session inspection, attach/resume, and SDK session engagement |
| `ui/src/tabs/Executor/` | Owns workflow runs, queued work, executor jobs, overlay session CRUD, and worktree/workflow diagnostics |
| `ui/src/tabs/Planning/planningStore.ts` | Owns task-board projection state, repo-context handoff, and board-side control actions without owning live runtime state |

### Non-goals for MVP

- no remote/gateway orchestration ownership
- no `local-tracker` ownership of tasks, sessions, workflow runs, or worktrees
- no separate top-level Sessions/Task Board/Workflow hub outside the frozen shell
- no repo-global durable actor registry
- no treating workflow-run state as the task source of truth
- no using sub-actors as a substitute for same-repo worktree isolation

## References

- [copilot-ui Guide](../system/copilot-ui-guide.md)
- [copilot-ui Information Architecture Freeze](../system/copilot-ui-information-architecture-freeze.md)
- [Domain Authorities Freeze](../system/domain-authorities-freeze.md)
- [Session State Artifacts](../system/session-state-artifacts.md)
- [Planning Bullets + Backlog + Roadmap Contract](../system/planning-backlog-roadmap-contract.md)
- [Copilot SDK Integration ADR](../system/copilot-sdk-integration-adr.md)
- [copilot-ui MVP Scope Lock](copilot-ui-mvp-scope-lock.md)
