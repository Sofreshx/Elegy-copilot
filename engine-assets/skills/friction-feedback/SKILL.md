---
name: friction-feedback
description: "Reviews accumulated friction entries, clusters patterns, and produces prioritized remediation recommendations. Triggers on: friction review, friction analysis, friction cluster, refactor priority, friction feedback."
---

# Friction Feedback

## Purpose

Reviews accumulated implementation friction entries from `docs/issues/implementation-friction-log.md`, identifies clusters and patterns, ranks by severity, and produces actionable remediation recommendations.

## When to Use

Trigger signals:
- Orchestrator detects `friction_escalation_requested: true` in a completion summary
- User explicitly asks to review or analyze friction entries
- Periodic friction review is scheduled

## When NOT to Use

- **Logging new friction** — use the `implementation-friction` skill.
- **Direct code refactoring** — this skill produces recommendations, not code changes.
- **Single isolated friction entry** — this skill analyzes patterns across multiple entries.

## Review Protocol

1. **Read the log** — open `docs/issues/implementation-friction-log.md` and parse all entries.
2. **Cluster by ID** — group entries sharing the same Cluster ID. Entries without Cluster ID are treated as standalone.
3. **Rank clusters** — score = recurrence count × importance weight (critical=4, high=3, medium=2, low=1).
4. **Produce top-3 recommendations** — for the 3 highest-scoring clusters, produce a remediation recommendation.

## Output Format

```markdown
## Friction Feedback Report

### Cluster: {cluster_id}
- **Score:** {recurrence} × {importance_weight} = {total}
- **Pattern:** Brief description of the recurring friction.
- **Affected Areas:** Files/modules/flows impacted.
- **Recommendation:** Concrete remediation action.
- **Effort Estimate:** small | medium | large

### Cluster: {cluster_id}
...
```

## Depth-1 Compliance

This skill is loaded by the orchestrator when it detects the escalation flag. It does NOT load other skills or delegate to subagents. It reads the friction log, analyzes it, and returns a structured report to the orchestrator.

## Structured Monitoring Integration

Friction feedback reports can emit structured monitoring events using
`monitoring-event.schema.json` with `category: "friction"` and severity derived from importance
weights. Use `node scripts/friction-emit.mjs` to produce individual structured events.
