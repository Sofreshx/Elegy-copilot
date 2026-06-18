---
name: planning-tools-write
description: Write OpenCode tools for authoring elegy-planning state. Use when the project lane needs to create or update goals, roadmaps, sections, work points, plans, todos, or record insights. Side-effect class: disk_write against SQLite. Phase 0 (setup) and Phase 1 (plan).
triggers:
  - planning create
  - planning update
  - planning author
  - planning write
  - planning todo
  - planning insight
  - create goal
  - create plan
  - add work point
---

# Planning Tools — Write

Write native OpenCode tools that author elegy-planning state. All writes are `disk_write` against SQLite. All tools invoke the `elegy-planning` CLI in machine mode (`--json --non-interactive --correlation-id`) and return the `planning-result/v1` envelope.

## Scope

This skill contains the 8 authoring tools from the planning plugin. For read-only inspection, load `planning-tools-read`. For project-run leases, review gates, issues, and validation, load `planning-tools-run`.

## Tools

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

## Phase 0/1 Pattern

The project lane's authoring workflow:

```
Phase 0 (Setup):
  1. planning_goal_create(...)     — define the goal
  2. planning_roadmap_create(...)  — define the roadmap
  3. planning_roadmap_add_section(...)  — group work points
  4. planning_roadmap_add_work_point(...)  — add work points

Phase 1 (Plan):
  1. planning_plan_create(...)     — create plan for the work point
  2. planning_todo_create(...)     — break plan into todos
  3. planning_insight_record(...)  — capture design decisions
```

## Safety

- All write tools are `side-effect: disk_write` against SQLite
- Multi-value flags (`--tag`, `--acceptance`, `--rejection`) are repeated per value, never comma-joined
- Always pass `scope` explicitly to avoid cross-scope pollution
- File-scope selector grammar: `<type>:<intent>:<selector>` where `type ∈ {exact, glob}` and `intent ∈ {primary, review, affected}`
- Record design decisions via `planning_insight_record` before transitioning plan status — incomplete evidence prevents plan completion
