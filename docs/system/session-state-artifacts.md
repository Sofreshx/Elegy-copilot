---
created: 2026-02-23
updated: 2026-02-23
category: system
status: current
doc_kind: node
id: session-state-artifacts
summary: Canonical contract for Elegy session-state artifacts (plan.md + proposition.md) and progress tracker structure.
tags: [session-state, elegy]
---

# Session State Artifacts

This document defines the canonical contract for Elegy session state artifacts, ensuring agents and UI tools agree on what to write and read.

## Canonical Session Root

All session state lives under:

```
~/.copilot/session-state/<SESSION_ID>/
```

On Windows:
```
%USERPROFILE%\.copilot\session-state\<SESSION_ID>\
```

## Artifact Layout

A typical session directory contains:

```
~/.copilot/session-state/<SESSION_ID>/
  plan.md              # Plan Pack + Progress Tracker (canonical)
  proposition.md       # Append-only guidance artifact
  plans/               # Plan revisions
    index.json         # Revision metadata
    rev-0001.md        # First revision
    rev-0002.md        # Second revision, etc.
```

### Plan Artifact (`plan.md`)

The plan artifact contains **two top-level documents in one markdown file**:

1. **Plan Pack** — High-level plan structure, work unit specifications, dependencies, risks
2. **Plan-Pack Progress Tracker** — Live execution state (status tables, checkpoints, next unit)

This dual-document approach matches the output of `@o-planner` and `@elegy-planner`.

### Proposition Artifact (`proposition.md`)

An append-only file that accumulates guidance at key milestones:
- **direction** — Initial direction from `@elegy-direction`
- **after-planning** — Suggestions after plan approval
- **after-execution** — Retrospective notes after execution completes

Each entry uses an H2 heading:
```markdown
## 2026-02-23T14:30:00Z — after-planning — elegy-planner

### Summary
- Plan approved with 3 work unit groups
- Key risk: external API dependency needs stub
- Recommended: start with G-01 (foundation work)

### Details
The plan prioritizes foundational changes before UI work to minimize rework...
```

## Progress Tracker Structure (v1)

The Progress Tracker section must contain these subsections for structured parsing:

### Required Sections

#### 1. Work Unit Groups Overview
Markdown table with columns:
- `Group` — Group ID (e.g., `G-01`)
- `Title` — Human-readable group name
- `Status` — One of: `not-started`, `in-progress`, `done`, `blocked`, `skipped`
- `WUs Done` — Count of completed work units
- `WUs Total` — Total work units in group
- `Depends On` — Dependency list (e.g., `G-02,G-03`) or `—`

#### 2. Work Unit Status Table
Markdown table with columns:
- `Group` — Group ID
- `Work Unit ID` — WU identifier (e.g., `WU-003`)
- `Status` — One of: `not-started`, `in-progress`, `done`, `blocked`, `skipped`
- `Next Unit` — ID of next WU in sequence, or `—`
- `Notes` — Brief context or checkpoint results

#### 3. Next Unit
Single line identifying the next work unit to execute:
```markdown
**WU-003** — Foundation work must complete before UI changes
```
Or, if complete:
```markdown
NONE — all work units complete
```

#### 4. Checkpoints
Markdown table with columns:
- `Group` — Group ID
- `Checkpoint` — Checkpoint name (e.g., `unit-tests`, `manual-review`, `doc-update`)
- `Trigger` — When to run (e.g., `After G-01`, `Before finalization`)
- `Notes` — Checkpoint state + results

#### 5. Execution Log
Append-only text capturing key execution events:
```markdown
## Execution Log

2026-02-23T10:15:00Z — WU-001 started
2026-02-23T10:22:00Z — WU-001 completed (validation: pass)
2026-02-23T10:30:00Z — Checkpoint: unit-tests (status: passed; duration=18s)
```

### Checkpoint Result Encoding

To avoid schema changes, encode checkpoint state in the `Notes` cell using:
- `status: passed` — Checkpoint completed successfully
- `status: failed` — Checkpoint failed; see execution log
- `status: pending` — Checkpoint not yet run
- `status: skipped` — Checkpoint skipped (user declined or not applicable)

Example checkpoint notes:
```
status: passed; unit-test-runner; duration=42s
status: failed; integration-tests; see: execution log 2026-02-23T14:45
status: skipped; user declined doc update
```

### Format Version Marker

Add this HTML comment at the top of the Progress Tracker section to make parsing/versioning explicit:

```html
<!-- IE_PROGRESS_TRACKER_VERSION: 1 -->
```

Parser behavior:
- **Marker missing**: Parse as best-effort "v0" (legacy format)
- **Marker present but unknown version**: Return structured response with warnings

## Legacy Session Migration

**Legacy `.instructions/sessions/` is deprecated.**

Old sessions remain where they are by default. If you want a legacy session visible to copilot-ui:

1. Locate the session folder under `.instructions/sessions/<SESSION_ID>/`
2. Copy it to `~/.copilot/session-state/<SESSION_ID>/`
3. Restart the dashboard

The dashboard will now show the migrated session.
