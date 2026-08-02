# Codex Harness Appendix

## Skills

Load only matching skills: `agents-md-authoring`;
`repo-setup`/`repo-quality-setup`; `sweeper-cleanup`;
`repo-backed-obsidian-docs`; `tdd` for explicit test-first work; and
`goal-session-workflow` for root-owned long-goal preparation/checkpoints; and
`evaluate-task-workflow` for an explicit, bounded task retrospective.

## Sol/Luna Routing

Keep Sol/Luna Max on requirements, architecture, integration, and judgment.

- Direct work: do not delegate unless the user asks.
- Planned work: in `/plan` or approved execution, delegate only explicitly
  marked tasks; keep them local when unsafe or not useful.
- Favor independent exploration, isolated implementation, noisy validation,
  long checks, and review.
- Give workers scope, result, validation, and a stop condition.
- Use `explorer` for read-only discovery, `worker` for bounded writes,
  `test-runner` for command-only validation, `reviewer` for bounded review, and
  `reviewer_strong` for consequential plans or architecture.
- Workers never commit, push, publish, change permissions, spawn children, or
  edit outside their assigned scope. Reviewers are read-only and advisory.
- The main agent checks results against the goal/AC, reconciles conflicts, and
  owns validation and delivery.

## Plan execution

When `/plan` is active, use a concise Markdown plan as the default durable
artifact. A ready plan has `Goal`, observable `Acceptance Criteria`, a `Work`
graph of `T-NNN` tasks, and `Delivery` expectations. Each task states its
dependencies, mode, parallel safety, scope, done condition, and validation.
Mark `Can delegate` only for a task that is safe to hand off; an optional
`elegy-planning` backend may track durable graph execution, but it never
replaces the approved Markdown intent or broadens scope.

## Durable Artifacts

Use plans/specs only when requested or needed across sessions or for acceptance.
