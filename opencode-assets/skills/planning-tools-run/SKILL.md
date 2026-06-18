---
name: planning-tools-run
description: OpenCode tools for project-run lease lifecycle, review gates, issue tracking, and referential integrity validation. Use when the project lane needs to claim/activate/release work-point leases, record evidence, capture review verdicts, log issues, or run integrity validation. Phase 2 (execute) and Phase 3 (complete).
triggers:
  - planning run
  - planning lease
  - project run
  - planning claim
  - planning release
  - planning evidence
  - planning review
  - planning issue
  - planning validate
  - run lease
  - work point lease
  - review verdict
---

# Planning Tools — Run

Native OpenCode tools for project-run lease lifecycle, review gates, issue tracking, and referential integrity validation. All tools invoke the `elegy-planning` CLI in machine mode (`--json --non-interactive --correlation-id`) and return the `planning-result/v1` envelope.

## Scope

This skill contains the 11 run/validate tools from the planning plugin. For read-only inspection, load `planning-tools-read`. For authoring goals/roadmaps/plans/todos/insights, load `planning-tools-write`.

## Tools

### Project-Run Lease Lifecycle

Project runs are durable leases with their own lifecycle: `claim → activate → add_evidence → release`. Once claimed, a work point is in-flight until released.

#### planning_project_run_claim

Claim a durable execution lease on a work point. Creates a lease record tracking the execution context.

**Parameters:**
- `goalId` (required): Goal ID
- `roadmapId` (required): Roadmap ID
- `workPointId` (required): Work point ID to claim
- `repo` (required): Repository identifier
- `branch` (required): Branch name for the work
- `worktree` (required): Worktree path
- `session` (required): Session identifier
- `profile` (required): Provider profile identifier
- `tag` (optional): Array of tags

```
planning_project_run_claim(
  goalId: "auth-migration-v1",
  roadmapId: "auth-roadmap",
  workPointId: "oauth-provider-integration",
  repo: "my-org/my-repo",
  branch: "feature/oauth-provider",
  worktree: "/tmp/worktrees/oauth-worktree",
  session: "sess-abc123",
  profile: "opencode-go-balanced"
)
```

#### planning_project_run_activate

Activate a claimed project run. Marks the run as active when implementation starts in the worktree.

**Parameters:**
- `runId` (required): Project run ID
- `worktreePath` (optional): Worktree path for activation

```
planning_project_run_activate(runId: "run-xyz-789")
planning_project_run_activate(runId: "run-xyz-789", worktreePath: "/tmp/worktrees/oauth-worktree")
```

#### planning_project_run_add_evidence

Append immutable evidence to a project run.

**Parameters:**
- `runId` (required): Project run ID
- `evidenceType` (required): Type of evidence (`validation`, `review`, `commit`)
- `content` (optional): Evidence content or description
- `tag` (optional): Array of tags

```
planning_project_run_add_evidence(
  runId: "run-xyz-789",
  evidenceType: "validation",
  content: "All oauth tests pass (npm run test -- --grep oauth)",
  tag: ["validation", "oauth"]
)
```

#### planning_project_run_release

Release a project run lease. Frees the execution context.

**Parameters:**
- `runId` (required): Project run ID
- `status` (optional): Final status (e.g. `completed`, `failed`, `interrupted`)

```
planning_project_run_release(runId: "run-xyz-789", status: "completed")
```

#### planning_project_run_list

List active project runs.

**Parameters:**
- `planId` (optional): Filter by plan ID
- `limit` (optional): Maximum number of runs to return

```
planning_project_run_list()
planning_project_run_list(planId: "oauth-provider-plan", limit: "10")
```

#### planning_project_run_show

Show one project run with full evidence trail.

**Parameters:**
- `runId` (required): Project run ID

```
planning_project_run_show(runId: "run-xyz-789")
```

#### planning_project_run_summary

Generate a closure summary for a project run. Aggregates evidence by type, review points, and issues from the run. Useful for session-end validation summaries.

**Parameters:**
- `runId` (required): Project run ID

```
planning_project_run_summary(runId: "run-xyz-789")
```

### Review Gates and Issue Tracking

#### planning_review_point_record

Record a review point on a planning entity (e.g. review verdict from a gate).

**Parameters:**
- `entityType` (required): Entity type being reviewed
- `entityId` (required): Entity ID being reviewed
- `decision` (required): Review decision (e.g. `approved`, `blocked`, `needs-changes`)
- `rationale` (optional): Rationale for the decision
- `tag` (optional): Array of tags

```
planning_review_point_record(
  entityType: "plan",
  entityId: "oauth-provider-plan",
  decision: "approved",
  rationale: "Plan covers all edge cases and has clear validation criteria",
  tag: ["review", "gate"]
)
```

#### planning_issue_record

Record an issue tied to a planning entity.

**Parameters:**
- `entityType` (required): Entity type the issue is about
- `entityId` (required): Entity ID the issue is about
- `title` (required): Issue title
- `description` (optional): Issue description
- `tag` (optional): Array of tags

```
planning_issue_record(
  entityType: "plan",
  entityId: "oauth-provider-plan",
  title: "Token refresh logic has race condition",
  description: "Concurrent requests can cause duplicate refresh calls",
  tag: ["bug", "auth"]
)
```

### Validation

#### planning_validate

Run a full referential integrity and freshness validation pass. Surfaces orphaned entities, dangling references, and stale records. No parameters.

```
planning_validate()
```

## Phase 2/3 Pattern

The project lane's execution and completion workflow:

```
Phase 2 (Execute):
  1. planning_project_run_claim(...)    — claim lease
  2. planning_project_run_activate(...)  — mark active when impl starts
  3. planning_review_point_record(...)  — plan review verdict
  4. planning_issue_record(...)         — log issues found
  5. planning_project_run_add_evidence(...)  — validation/review/commit refs
  6. planning_review_point_record(...)  — implementation review verdict

Phase 3 (Complete):
  1. planning_project_run_release(...)  — release lease
  2. planning_validate()                — full integrity pass
  3. planning_project_run_summary(...)  — closure summary
```

## Safety

- Project-run tools are `side-effect: disk_write + cross-host lease visibility` and require explicit user awareness — a claimed work point blocks other sessions
- `planning_validate()` is expensive on large databases; run at session boundaries (start, before complete), not per-keystroke
- `planning_review_point_record` is mandatory at every review gate (plan, implementation, evidence) before plan completion
- Incomplete evidence chain prevents plan completion — record review points, issues, and validation summaries before releasing the lease
