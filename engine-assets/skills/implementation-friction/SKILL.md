---
name: implementation-friction
description: "Capture recurring implementation friction with minimal overhead and append concise findings for future refactor planning. Triggers on: shaky pattern, bad design, dead code, brittle code, hard to work with, architecture drag, recurring workaround, implementation friction."
---

# Implementation Friction

## Purpose
Capture recurring codebase friction that slows delivery, without derailing the active task.

## When to Use (LLM Routing Guide)
- Explicit complaint language appears (e.g., "this pattern is shaky", "this is hard to work with").
- The same friction signal appears at least twice in one task/session.
- Repeated workaround is required because of brittle structure or dead code.

## When NOT to Use
- Normal implementation with no recurring friction signals.
- Dedicated refactor tasks where implementation itself is the requested output.
- Deep architecture investigation that would meaningfully delay user-requested delivery.

## Operating Rules (Low Overhead)
- Primary goal stays delivery; issue capture is secondary.
- Log at most one new entry per task unless a distinct high-severity issue appears.
- Deduplicate obvious repeats (same reason + same context area).
- Suggestions are optional and may be blank.
- Keep each entry concise and actionable.

## Log Destination
- Append to: `docs/issues/implementation-friction-log.md`

## Entry Template
```markdown
### [YYYY-MM-DD HH:mmZ] Short title
- **Reason:** What made implementation hard.
- **Importance:** low | medium | high | critical
- **Context:** File/module/flow impacted.
- **Symptoms:** Observable pain point.
- **Impact on Delivery:** Time/risk/debug burden.
- **Suggestion:** Optional; may be blank.
- **Confidence:** low | medium | high
- **Cluster ID:** _(optional)_ Groups related friction entries.
- **Recurrence Count:** _(optional)_ Times this pattern has been observed.
- **Auto-Remediation Candidate:** _(optional, yes/no)_ Whether amenable to automated fix.
```

## Workflow
1. Detect trigger signal (explicit complaint or recurrence threshold).
2. If not already captured, append one concise log entry.
3. Continue implementation immediately.
4. Mention logged friction briefly in completion summary when relevant.

## Escalation Flag

When friction reaches the escalation threshold, set a flag in your completion summary:

**Trigger condition:** recurrence count ≥ 3 OR importance is `critical`.

**Flag:** `friction_escalation_requested: true`

Include this flag in the completion summary so the orchestrator can detect it and route to the `friction-feedback` on-demand skill. Do NOT load the friction-feedback skill yourself — the orchestrator handles routing.

## Structured Monitoring Output

When emitting structured friction events (via CLI or programmatically), produce JSON conforming to
`monitoring-event.schema.json`:

```json
{
  "eventId": "friction-<guid>",
  "timestamp": "2026-03-07T00:00:00Z",
  "entityKind": "skill",
  "entityId": "implementation-friction",
  "category": "friction",
  "severity": "warning",
  "message": "Short title of friction entry",
  "metadata": {
    "reason": "What made implementation hard",
    "context": "File/module impacted",
    "clusterId": "optional-cluster-id"
  }
}
```

Severity mapping: `low` → `info`, `medium` → `warning`, `high` → `error`, `critical` → `critical`.

Use `node scripts/friction-emit.mjs` to emit structured events from the CLI.
