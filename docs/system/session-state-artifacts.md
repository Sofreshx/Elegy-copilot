---
created: 2026-02-23
updated: 2026-02-25
category: system
status: current
doc_kind: node
id: session-state-artifacts
summary: Canonical contract for Elegy session-state artifacts (plan.md, proposition.md, verification-guide.md) and progress tracker structure.
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
  verification-guide.md  # Structured verification guide (optional)
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

### Verification Guide Artifact (`verification-guide.md`)

A structured guide for verifying changes made during a session's execution phase.

| Property | Value |
|---|---|
| **Write semantics** | Overwrite (full replace on each write) |
| **Lifecycle** | Written by `@elegy-orchestrator` at finalization, after `@final-reviewer` completes |
| **Optional** | Yes — not created if `@verification-guide` agent fails or is skipped |

#### Format

The file is Markdown with these top-level sections:

1. **Summary** — One-paragraph overview of what was changed and why
2. **Changed Files** — List of files modified/created/deleted during execution
3. **Where to Verify** — Pointers to the areas the reviewer should inspect (type-prefixed: UI, Terminal, Browser, File, API, Config)
4. **Verification Steps** — Ordered checklist of manual or automated steps to confirm correctness
5. **Expected Outcomes** — What the reviewer should observe when verification succeeds

#### API Access

The copilot-ui dashboard exposes this artifact via:

```
GET /api/sessions/:id/verification-guide
```

Returns `{ id, source, content }` with the raw Markdown content, or `404` if the artifact was not generated for the session.

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

#### 5. Stream Evidence
Markdown table with columns:
- `Group` — Required stream ID (`G-01`, `G-02`, `G-03`, `G-04`)
- `Predicate` — Predicate contract used for this stream (`execution-log and/or stream-marker`)
- `Evidence` — Optional pointer to artifact/log line/checkpoint entry
- `Status` — `pending`, `passed`, or `failed`
- `Notes` — Free-form details; if used for machine-readable marker, include `status: passed|failed|pending`

Required rows:
- `G-01`
- `G-02`
- `G-03`
- `G-04`

#### 6. Final Gate Controls
Markdown table with columns:
- `Control`
- `Status`
- `Waiver Scope`
- `Waiver Release`
- `Waiver Audit`

Required control rows:
- `evidencePredicates`
- `finalGateWaiverPrecedence`
- `trustedEvidenceBindingRetention`

#### 7. Trusted Evidence Binding
Markdown table with columns:
- `Commit SHA`
- `Release Tag`
- `Channel`
- `Producer Identity`
- `Attestation Status`
- `Evidence Timestamp`
- `Evidence` (optional but recommended)

When `trustedEvidenceBindingRetention` has `Status=passed`, validator requires all fields above except `Evidence` to be non-empty.

#### 8. Evidence Retention
Markdown table with columns:
- `Policy`
- `Retention Days`
- `Retained`
- `Release Tag`
- `Evidence`

Required policy rows:
- `opsLogs`
- `perReleaseEvidence`

#### 9. Execution Log
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

### Required Stream Predicate Contract (G-01..G-04)

For planpacks with `<!-- IE_PLAN_PACK_VERSION: N -->`, `scripts/validate-planpack.js` enforces evidence predicates for these streams:
- `G-01`
- `G-02`
- `G-03`
- `G-04`

A stream is considered satisfied if **either** condition is met:
1. `## Execution Log` contains an entry that references the stream ID and a completion token (`completed`, `done`, or `status: passed`), **or**
2. `## Stream Evidence` contains a row for that stream with `Status = passed` (or `Notes` containing `status: passed`).

If any required stream lacks both forms of evidence, validation fails deterministically with a non-zero exit code.

Examples:

```markdown
## Stream Evidence
| Group | Predicate | Evidence | Status | Notes |
| --- | --- | --- | --- | --- |
| G-01 | execution-log and/or stream-marker | execution-log:2026-02-25T14:55Z | passed | status: passed |
| G-02 | execution-log and/or stream-marker | checkpoint:cp-g02-tests | passed | status: passed |
| G-03 | execution-log and/or stream-marker | execution-log:2026-02-25T15:21Z | passed | status: passed |
| G-04 | execution-log and/or stream-marker | execution-log:2026-02-25T16:49Z | passed | status: passed |

## Execution Log
2026-02-25T14:55:11Z — G-01 completed (status: passed)
2026-02-25T15:21:29Z — G-03 completed (status: passed)
```

Compatibility behavior:
- If `IE_PLAN_PACK_VERSION` marker is missing, validator remains in legacy best-effort mode and skips enforcement.
- Versioned planpacks enforce stream evidence predicates.

### Trusted Evidence Binding + Retention Contract (G-05-WU-06)

For versioned planpacks where `trustedEvidenceBindingRetention` is marked `passed`, `scripts/validate-planpack.js` enforces trusted evidence and retention checks before final gate success:

1. `## Trusted Evidence Binding` must include a parseable row with:
  - Commit SHA
  - Release Tag
  - Channel
  - Producer Identity
  - Attestation Status (`true/yes/passed/attested` only)
  - Evidence Timestamp (ISO-8601)
2. Missing fields, attestation=false, or malformed timestamp fail deterministically.
3. Replay/staleness protection:
  - evidence is stale when age exceeds `--max-evidence-age-hours` (default `168h`).
4. Deterministic CI binding checks can pass expected values via:
  - `--expected-commit <SHA>`
  - `--expected-release <TAG>`
  - `--expected-channel <CHANNEL>`
  - optional deterministic time pinning with `--now <ISO_TIMESTAMP>`
5. `## Evidence Retention` must include parseable rows for:
  - `opsLogs`: `Retention Days >= 30`, `Retained=true`, and non-empty `Evidence`
  - `perReleaseEvidence`: `Retained=true`, non-empty `Release Tag`, and non-empty `Evidence`
6. Any missing/mismatch/stale/retention failure yields:
  - `final gate control failed: trustedEvidenceBindingRetention (...)`
  - non-zero validator exit code.

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
