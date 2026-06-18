---
name: planning-tools
description: Router for elegy-planning native OpenCode tools. Use when an agent needs to create, inspect, update, or validate durable planning state through structured tool calls. Loads the right leaf skill for the current workflow phase.
triggers:
  - planning tools
  - planning plugin
  - native planning
  - elegy-planning tools
---

# Planning Tools (Router)

Three leaf skills split by workflow phase. Load only the leaf you need.

| Leaf | Use when | Phase | Side effect |
|---|---|---|---|
| `planning-tools-read` | Inspecting state, finding next work point, searching, context bundles | Session start, all phases | read_only |
| `planning-tools-write` | Authoring goals, roadmaps, plans, todos, insights | Phase 0, 1 | disk_write |
| `planning-tools-run` | Claiming work-point leases, recording evidence, review gates, issues, validation | Phase 2, 3 | disk_write + lease |

## Loading Pattern

The project lane agent loads the router plus the leaves needed for the session:

```
Load `planning-tools-read` at session start
Load `planning-tools-write` at session start (Phase 0, 1)
Load `planning-tools-run` at session start (Phase 2, 3)
```

This respects the 3-skill cap: 1 primary (`-read` for the whole session) + 2 supporting (`-write`, `-run`).

## Tool Reference

All 31 native tools are registered globally by the planning plugin (`opencode-assets/plugins/planning.js`). The split is documentation-only — the plugin exposes all tools to all agents. Each leaf skill documents the subset relevant to its phase.

For cross-harness CLI usage (Codex, Claude Code, Antigravity), load `elegy-planning` instead.

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

## Common Mistakes

### Using CLI calls instead of native tools
- **Problem:** Raw `elegy-planning` CLI calls bypass Zod validation and error handling
- **Fix:** Always use the native planning tools. They handle `--json --non-interactive --correlation-id` automatically.

### Loading all 31 tool docs when only a subset is needed
- **Problem:** Loading `planning-tools` (the old monolith) pulled all 31 tool docs into context
- **Fix:** Load the leaf that matches the current phase. The router dispatches based on workflow phase.

### Forgetting to validate before marking complete
- **Problem:** Stale references or orphaned entities not caught
- **Fix:** Run `planning_validate()` (in `planning-tools-run`) before marking a plan as completed.

### Running validation too frequently
- **Problem:** `planning_validate()` is expensive on large databases
- **Fix:** Run at session boundaries (start, before complete), not on every step.
