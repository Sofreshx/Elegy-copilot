# Codex Harness Appendix

## Skills

Load a skill only when its contract changes the work:

| Need | Route |
|---|---|
| Ambiguous capability | `skill-discovery` |
| Instruction layering | `agents-md-authoring` |
| UI implementation or review | `elegy-ui-craft@elegy` |
| Dead-weight removal | `sweeper-cleanup` |
| Durable planning state | `elegy-planning` |
| Spec lifecycle | `spec-dev`, `spec-authoring`, `spec-review`, or `spec-planning-bridge` |
| Implementation review or handoff | `implementation-review` or `implementation-handoff` |

## Sol/Luna Routing

Keep Sol on requirements, architecture, integration, and final judgment. Use
Codex-native `gpt-5.6-luna` workers for bounded exploration, review,
validation, and cleanup. An active plugin may define another governed route.
Default routing is manual.

- Do not delegate unresolved decisions, tiny tasks, or tightly coupled work.
- Give each worker a bounded scope, allowed actions, output contract, and stop condition.
- Use `low` effort for exploration, `medium` for validation or cleanup, and `high` for review.
- Prefer one completed report. Do not poll or send status-only prompts unless the worker reports a
  safety, permission, credential, or missing-authority boundary, or the user changes direction.
- Write-capable children require an allowlisted file scope and may not commit,
  push, publish, change permissions, or edit outside that scope.

## Durable Artifacts

Use plans or specs only when requested, required across sessions, or needed for
verifiable acceptance.
