---
name: spec-planning-bridge
description: "Combines spec-dev, spec-authoring, spec-review, and elegy-planning without merging their authority. Use after spec review to hand an approved spec to a planning lane. Triggers on: spec handoff, spec to planning, bridge spec to plan, link spec to roadmap, spec planning bridge."
metadata: {"tags":["specs","planning","handoff","bridge","elegy-planning"]}
---

# Spec-Planning Bridge

## Purpose

Hand an approved durable spec to the execution planning system without merging the two authority domains.

- **Specs** (`docs/specs/<slug>/spec.md`) are the durable requirements contract (spec lane owns them).
- **elegy-planning** (roadmap → plan → work points) is the durable execution authority (project lane owns it).
- This skill bridges the handoff.

## Workflow

1. Load the approved spec from `docs/specs/<spec-slug>/spec.md`.
2. Confirm the spec has passed `spec-review` and the validator (`node scripts/validate-specs.js --strict`).
3. Create or locate the target planning entity (roadmap, plan, or work point) with the `exact:primary:docs/specs/<spec-slug>/spec.md` file-scope selector.
4. Record a `planning_insight_record` with `insightType: 'spec-link'` and `entityType: 'plan'` linking the plan to the spec.
5. Validate the handoff: the plan must reference the spec path, and the spec's `Implementation Links` must reference the plan.

## Harness-Specific Routing

| Harness | Planning tools | Usage |
|---|---|---|
| OpenCode | `planning-tools` skill (native tool wrappers) | Use `planning_plan_create`, `planning_work_point_next_runnable`, `planning_insight_record` |
| Codex | `elegy-planning` CLI | Use `elegy-planning plan create`, `elegy-planning insight record` with `insightType: 'spec-link'` |
| Engine / CLI | `elegy-planning` CLI | Same as Codex route |

### OpenCode Path

```
1. planning_context(entityType: 'plan', entityId: '<plan-id>')
2. planning_insight_record(insightType: 'spec-link', entityType: 'plan', entityId: '<plan-id>', content: 'Handoff from spec docs/specs/<slug>/spec.md')
3. Confirm file-scope: the plan's work points must include `exact:primary:docs/specs/<spec-slug>/spec.md` in their fileScope arrays.
```

### Codex / CLI Path

```
# Set file-scope at work-point creation time:
elegy-planning --scope repo:<repo-key> --json --non-interactive \
  --correlation-id $(uuidgen) \
  roadmap add-work-point \
  --roadmap-id <roadmap-id> --work-point-id <wp-id> \
  --title "..." --effort-tier balanced \
  --file-scope exact:primary:docs/specs/<slug>/spec.md

# Or link via plan revise:
elegy-planning --scope repo:<repo-key> --json --non-interactive \
  --correlation-id $(uuidgen) \
  plan revise \
  --plan-id <plan-id> \
  --file-scope exact:primary:docs/specs/<slug>/spec.md

# Record the semantic handoff link (always pair with file-scope):
elegy-planning --scope repo:<repo-key> --json --non-interactive \
  --correlation-id $(uuidgen) \
  insight record \
  --insight-type spec-link \
  --entity-type plan \
  --entity-id <plan-id> \
  --content "Handoff from spec docs/specs/<slug>/spec.md"
```

## File-Scope Selector Contract

Use the standard `elegy-planning` file-scope grammar to link specs:

Format: `exact:primary:docs/specs/<spec-slug>/spec.md`

Where `<spec-slug>` matches the `spec_id` frontmatter key. The grammar is `<type>:<intent>:<selector>`:
- Type: `exact` (literal path match) or `glob` (pattern match)
- Intent: `primary` (main artifact), `review`, or `affected`

This selector is used in:
- `planning_roadmap_add_work_point` `fileScope` arrays at creation time
- `planning_plan_create` or `plan revise` `fileScope` arrays
- `Implementation Links` in the spec itself

For semantic linkage (audit trail), always pair the file-scope with:
- `planning_insight_record` with `insightType: 'spec-link'`

## Output Contract

```text
SPEC_PLANNING_BRIDGE_RESULT
- spec_id: <spec-slug>
- spec_path: docs/specs/<spec-slug>/spec.md
- planning_entity: <plan-id or roadmap-id>
- handoff_status: linked | pending | blocked
- file_scope: exact:primary:docs/specs/<spec-slug>/spec.md
- insight_recorded: true | false
- issues:
  - <issue or none>
```
