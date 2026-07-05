---
name: planning-tools-read
description: Read-only OpenCode tools for inspecting elegy-planning state. Use when the project lane needs to check DB health, list or show goals/roadmaps/plans/todos, find the next runnable work point, search entities, or load a context bundle. Side-effect class: read_only. No disk writes.
triggers:
  - planning read
  - planning list
  - planning show
  - planning search
  - planning context
  - planning health
  - next runnable work point
  - inspect planning state
---

# Planning Tools — Read

Read-only native OpenCode tools that inspect elegy-planning state. No disk writes. All tools invoke the `elegy-planning` CLI in machine mode (`--json --non-interactive --correlation-id`) and return the `planning-result/v1` envelope.

## Scope

This skill contains the 11 read tools from the planning plugin. For mutations, load `planning-tools-write`. For project-run leases, review gates, issues, and validation, load `planning-tools-run`.

## Tools

#### planning_health

Check database health, schema version, FTS5 index state, and lease status. No parameters.

```
planning_health()
```

#### planning_scope_list

List all known scopes.

**Parameters:**
- `limit` (optional): Maximum number of scopes to return

```
planning_scope_list()
planning_scope_list(limit: "10")
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
- `roadmapId` (required): Roadmap whose runnable work points should be listed

```
planning_work_point_next_runnable(roadmapId: "auth-roadmap")
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

#### planning_context

Get a progressive disclosure context bundle for a planning entity, including linked insights and token estimates.

**Parameters:**
- `entityType` (required): `goal`, `roadmap`, `plan`, `work-point`, `todo`, `issue`
- `entityId` (required): Entity ID to inspect

```
planning_context(entityType: "goal", entityId: "auth-migration-v1")
```

## Session Start Pattern

The project lane agent's standard session-start sequence is all read-only:

```
1. planning_health()              — confirm DB is initialized
2. planning_scope_list()          — confirm/resolve active scope
3. planning_goal_list()           — find active goals
4. planning_roadmap_show(...)     — inspect roadmap structure
5. planning_work_point_next_runnable()  — find next work point
```

## Safety

- All read tools have `side-effect: read_only` per the elegy-planning contract
- Always pass `scope` explicitly to avoid cross-scope pollution
- `planning_context` returns progressive disclosure bundles with token estimates — use before deep work on a specific entity
