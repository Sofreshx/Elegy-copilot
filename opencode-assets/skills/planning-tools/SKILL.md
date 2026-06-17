---
name: planning-tools
description: Native OpenCode tools for elegy-planning. Use when the project lane needs to create, inspect, update, or validate durable planning state through structured tool calls instead of raw CLI invocations.
triggers:
  - planning tools
  - planning plugin
  - native planning
  - elegy-planning tools
---

# Planning Tools

Native OpenCode tools wrapping the `elegy-planning` CLI. Each tool validates inputs via Zod schemas and returns structured JSON output.

**Announce at start:** "I'm using the planning-tools skill (31 tools) to manage planning state."

## Available Tools

31 tools organized by function. All tools invoke the `elegy-planning` CLI in machine mode (`--json --non-interactive --correlation-id`).

### Read Tools (11)

#### planning_health

Check database health, schema version, FTS5 index state, and lease status. No parameters.

```
planning_health()
```

#### planning_goal_list

List goals in the active scope.

**Parameters:**
- `limit` (optional): Maximum number of goals to return

```
planning_goal_list()
planning_goal_list(limit: "10")
```

#### planning_goal_show

Show a goal's details including linked roadmaps and validation status.

**Parameters:**
- `goalId` (required): Goal ID to inspect

```
planning_goal_show(goalId: "auth-migration-v1")
```

#### planning_roadmap_list

List roadmaps in the active scope. No parameters.

```
planning_roadmap_list()
```

#### planning_roadmap_show

Show a roadmap with its sections and work points.

**Parameters:**
- `roadmapId` (required): Roadmap ID to inspect

```
planning_roadmap_show(roadmapId: "auth-roadmap")
```

#### planning_plan_list

List plans in the active scope. No parameters.

```
planning_plan_list()
```

#### planning_plan_show

Show a plan's details including todos and evidence.

**Parameters:**
- `planId` (required): Plan ID to inspect

```
planning_plan_show(planId: "implement-oauth")
```

#### planning_work_point_next_runnable

List runnable work points ordered by effort and readiness. Use to find the next work point to plan.

**Parameters:**
- `limit` (optional): Maximum number of work points to return
- `includeBlocked` (optional): If true, include work points with unvalidated upstream dependencies

```
planning_work_point_next_runnable()
planning_work_point_next_runnable(limit: "5", includeBlocked: false)
```

#### planning_scope_list

List all known scopes.

**Parameters:**
- `limit` (optional): Maximum number of scopes to return

```
planning_scope_list()
planning_scope_list(limit: "10")
```

#### planning_tags_list

List all indexed tags across entities. No required arguments.

```
planning_tags_list()
```

#### planning_search_extended

Title/tag/status/FTS search across entities.

**Parameters:**
- `query` (required): Search query string
- `entityType` (optional): Restrict search to a specific entity type
- `limit` (optional): Maximum number of results to return

```
planning_search_extended(query: "oauth auth")
planning_search_extended(query: "oauth", entityType: "plan", limit: "10")
```

### Write Tools (15)

#### planning_goal_create

Create a durable goal with acceptance and rejection criteria.

**Parameters:**
- `id` (required): Goal slug ID (e.g. `auth-migration-v1`)
- `title` (required): Goal title
- `description` (optional): Goal description
- `status` (optional): Initial status (default: `draft`)
- `acceptance` (optional): Array of acceptance criteria strings
- `rejection` (optional): Array of rejection criteria strings
- `tag` (optional): Array of tags

```
planning_goal_create(
  id: "auth-migration-v1",
  title: "Migrate authentication to OAuth2",
  description: "Replace legacy auth with OAuth2 flows",
  acceptance: ["All login flows use OAuth2", "Session tokens are JWT"],
  rejection: ["Any endpoint still accepts password auth"],
  tag: ["auth", "security"]
)
```

#### planning_roadmap_create

Create a roadmap under a goal.

**Parameters:**
- `id` (required): Roadmap slug ID
- `goalId` (required): Parent goal ID
- `title` (required): Roadmap title
- `summary` (optional): Roadmap summary
- `status` (optional): Initial status (default: `draft`)
- `tag` (optional): Array of tags

```
planning_roadmap_create(
  id: "auth-roadmap",
  goalId: "auth-migration-v1",
  title: "OAuth2 Migration Roadmap",
  summary: "Step-by-step migration from legacy auth"
)
```

#### planning_roadmap_add_work_point

Attach a work point to a roadmap with file scopes and effort tier.

**Parameters:**
- `roadmapId` (required): Parent roadmap ID
- `id` (required): Work point slug ID
- `title` (required): Work point title
- `summary` (optional): Work point summary
- `status` (optional): Initial status (default: `draft`)
- `ordering` (optional): Ordering hint (e.g. `1`, `2`)
- `effortTier` (optional): `fast`, `balanced`, or `deep`
- `validation` (optional): Array of validation expectations
- `tag` (optional): Array of tags

```
planning_roadmap_add_work_point(
  roadmapId: "auth-roadmap",
  id: "oauth-provider-integration",
  title: "Integrate OAuth2 provider",
  effortTier: "balanced",
  validation: ["npm run test -- --grep oauth"],
  tag: ["auth", "integration"]
)
```

#### planning_plan_create

Create a plan under a roadmap for a specific work point.

**Parameters:**
- `id` (required): Plan slug ID
- `roadmapId` (required): Parent roadmap ID
- `title` (required): Plan title
- `effortTier` (optional): `fast`, `balanced`, or `deep`
- `routingHint` (optional): Routing hint for the plan

```
planning_plan_create(
  id: "oauth-provider-plan",
  roadmapId: "auth-roadmap",
  title: "Plan for OAuth2 provider integration",
  effortTier: "balanced"
)
```

#### planning_plan_update_status

Transition a plan to a new lifecycle state.

**Parameters:**
- `planId` (required): Plan ID to update
- `status` (required): New status value (e.g. `active`, `completed`, `blocked`)

```
planning_plan_update_status(planId: "oauth-provider-plan", status: "completed")
```

#### planning_roadmap_add_section

Add a section to a roadmap.

**Parameters:**
- `roadmapId` (required): Parent roadmap ID
- `id` (required): Section slug ID
- `title` (required): Section title
- `summary` (optional): Section summary
- `ordering` (optional): Ordering hint (e.g. `1`, `2`)

```
planning_roadmap_add_section(roadmapId: "auth-roadmap", id: "phase-1", title: "Phase 1: Provider Integration", ordering: "1")
```

#### planning_todo_create

Create a todo under a plan.

**Parameters:**
- `planId` (required): Parent plan ID
- `title` (required): Todo title
- `description` (optional): Todo description
- `status` (optional): Initial status (default: `pending`)
- `effortTier` (optional): `fast`, `balanced`, or `deep`
- `tag` (optional): Array of tags

```
planning_todo_create(
  planId: "oauth-provider-plan",
  title: "Implement token refresh logic",
  description: "Add refresh token rotation with retry",
  effortTier: "balanced",
  tag: ["auth", "tokens"]
)
```

#### planning_todo_list

List todos in the active scope.

**Parameters:**
- `planId` (optional): Filter by plan ID
- `limit` (optional): Maximum number of todos to return

```
planning_todo_list()
planning_todo_list(planId: "oauth-provider-plan", limit: "20")
```

#### planning_insight_record

Record a reasoning insight attached to any planning entity.

**Parameters:**
- `insightType` (required): Type of insight (e.g. `design-decision`, `constraint`, `risk`)
- `entityType` (optional): Entity type the insight is about
- `entityId` (optional): Entity ID the insight is about
- `content` (optional): Insight content/description
- `tag` (optional): Array of tags

```
planning_insight_record(
  insightType: "design-decision",
  entityType: "plan",
  entityId: "oauth-provider-plan",
  content: "Chose PKCE flow for mobile clients",
  tag: ["auth", "design"]
)
```

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

### Utility Tools (4)

#### planning_validate

Run a full referential integrity and freshness validation pass. Surfaces orphaned entities, dangling references, and stale records. No parameters.

```
planning_validate()
```

#### planning_context

Get a progressive disclosure context bundle for a planning entity, including linked insights and token estimates.

**Parameters:**
- `entityType` (required): `goal`, `roadmap`, `plan`, `work-point`, `todo`, `issue`
- `entityId` (required): Entity ID to inspect

```
planning_context(entityType: "goal", entityId: "auth-migration-v1")
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

## Workflow

### Session Start

1. `planning_health()` — confirm DB is initialized
2. `planning_scope_list()` — confirm/resolve active scope
3. `planning_goal_list()` — find active goals
4. `planning_roadmap_show(roadmapId: "<id>")` — inspect roadmap structure

### Plan Phase

1. `planning_work_point_next_runnable()` — find next work point
2. `planning_plan_create(...)` — create plan for the work point
3. Create worktree via `worktree_create` tool

### Execute Phase

1. **Claim lease:** Claim a project-run lease on the work point before starting work:
   `planning_project_run_claim(goalId, roadmapId, workPointId, repo, branch, worktree, session, profile)`
2. Create worktree via `worktree_create` tool
3. Implement in worktree (delegate to `impl` subagent)
4. **Activate run:** When implementation starts in the worktree:
   `planning_project_run_activate(runId: "<id>", worktreePath: "<path>")`
5. `planning_issue_record(...)` — log issues found
6. **Record run evidence:** During validation/review, append evidence:
   `planning_project_run_add_evidence(runId: "<id>", evidenceType: "validation|review|commit", content: "...")`
7. `planning_review_point_record(...)` — log review outcomes

### Complete Phase

1. `planning_plan_update_status(planId: "<id>", status: "completed")` — mark done
2. `planning_project_run_release(runId: "<id>")` — release the project-run lease
3. `planning_validate()` — full validation pass
4. `planning_roadmap_show(roadmapId: "<id>")` — find remaining work points

### Lease Management

- `planning_project_run_claim(...)` creates a durable execution lease tracking the context (goal, roadmap, work point, repo, branch, worktree, session, profile)
- `planning_project_run_activate(...)` marks a claimed run as actively executing
- `planning_project_run_add_evidence(...)` appends immutable evidence entries (validation results, review verdicts, commit refs)
- `planning_project_run_release(...)` frees the lease, accepting an optional final status

## Output Format

All tools return the `planning-result/v1` JSON envelope:

```json
{
  "status": "ok",
  "data": { ... },
  "correlationId": "<uuid>"
}
```

- `status`: `ok`, `partial`, or `error`
- `data`: entity payload or array of payloads
- `correlationId`: echoes the request ID for lineage tracking

## Safety

- All write operations require `--correlation-id` (generated automatically by the plugin)
- Multi-value flags (`--tag`, `--acceptance`, `--rejection`) are repeated per value, never comma-joined
- The plugin resolves the `elegy-planning` binary via env var fallback chain, then PATH
- All tools accept an optional `scope` parameter for explicit scope selection
- Read tools have no side-effect class; write tools are `disk_write` against SQLite
- Validation is expensive on large databases; run at session boundaries, not per-keystroke

## Common Mistakes

### Using CLI calls instead of native tools
- **Problem:** Raw `elegy-planning` CLI calls bypass Zod validation and error handling
- **Fix:** Always use the native planning tools. They handle `--json --non-interactive --correlation-id` automatically.

### Forgetting to validate before marking complete
- **Problem:** Stale references or orphaned entities not caught
- **Fix:** Run `planning_validate()` before marking a plan as completed.

### Running validation too frequently
- **Problem:** `planning_validate()` is expensive on large databases
- **Fix:** Run at session boundaries (start, before complete), not on every step.
