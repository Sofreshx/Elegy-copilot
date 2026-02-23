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

## Example Progress Tracker (Minimal)

```markdown
# Plan-Pack Progress Tracker

<!-- IE_PROGRESS_TRACKER_VERSION: 1 -->

> **Session ID**: `abc123`
> **Session Status**: `active`
> **Last Updated**: `2026-02-23T10:30:00Z`

## Work Unit Groups Overview

| Group | Title | Status | WUs Done | WUs Total | Depends On |
|-------|-------|--------|----------|-----------|------------|
| G-01 | Foundation | in-progress | 1 | 3 | — |
| G-02 | UI Components | not-started | 0 | 2 | G-01 |

## Work Unit Status Table

| Group | Work Unit ID | Status | Next Unit | Notes |
|-------|--------------|--------|-----------|-------|
| G-01 | WU-001 | done | WU-002 | Created docs artifact |
| G-01 | WU-002 | in-progress | WU-003 | Migrating elegy-planner |
| G-01 | WU-003 | not-started | — | Waiting on WU-002 |
| G-02 | WU-004 | not-started | WU-005 | Blocked on G-01 |
| G-02 | WU-005 | not-started | — | Blocked on G-01 |

## Next Unit

**WU-002** — Must complete elegy-planner migration before orchestrator changes

## Checkpoints

| Group | Checkpoint | Trigger | Notes |
|-------|-----------|---------|-------|
| G-01 | manual-review | After G-01 | status: pending |
| G-02 | unit-tests | After G-02 | status: pending |

## Execution Log

2026-02-23T10:15:00Z — WU-001 started
2026-02-23T10:22:00Z — WU-001 completed (validation: manual review passed)
2026-02-23T10:30:00Z — WU-002 started
```

## Code Entrypoints

### Dashboard Server
- `copilot-ui/server.js:listPlanArtifacts()` — Lists available plan artifacts for a session
- `copilot-ui/server.js:readPlanArtifact()` — Reads plan content (supports revisions)
- `copilot-ui/server.js:looksLikePlanText()` — Heuristic to detect Plan Pack structure

### Permission Setup
- `copilot-ui/server.js:POST /api/copilot/authorize` — Patches `~/.copilot/permissions-config.json`
- `scripts/vscode-settings-patch.mjs:patchCopilotPermissionsConfig()` — Patches `~/.copilot/permissions-config.json` when running the VS Code settings patcher

### Agent Responsibilities

#### Planner (`@elegy-planner`)
- Write initial `plan.md` with Plan Pack + Progress Tracker
- Write initial `proposition.md` with `direction` and `after-planning` entries
- Ensure Progress Tracker includes format version marker
- Initialize all work units with `status: not-started`
- Set `Next Unit` to the first executable WU

#### Orchestrator (`@elegy-orchestrator`)
- Read `plan.md` at session start
- Update Progress Tracker after each work unit:
  - Change WU status to `in-progress` → `done` (or `blocked`/`skipped`)
  - Update group `WUs Done` count and `Status`
  - Update `Next Unit` pointer
- Record checkpoint results in the Checkpoints table `Notes` column
- Append execution events to `Execution Log`
- Write final `after-execution` entry to `proposition.md` after all work completes

#### Work Unit Runner (`@work-unit-runner`)
- Read work unit spec from `plan.md`
- Report status back to orchestrator (does not update `plan.md` directly)

## Legacy Session Migration

**Legacy `.instructions/sessions/` is deprecated.**

Old sessions remain where they are by default. If you want a legacy session visible to copilot-ui:

1. Locate the session folder under `.instructions/sessions/<SESSION_ID>/`
2. Copy it to `~/.copilot/session-state/<SESSION_ID>/`
3. Restart the dashboard

The dashboard will now show the migrated session.

## Validation

### Manual Validation
1. Create or locate a session directory: `~/.copilot/session-state/<SESSION_ID>/`
2. Verify `plan.md` exists and contains both Plan Pack and Progress Tracker sections
3. Start dashboard: `node copilot-ui/server.js`
4. Select the session and confirm the plan renders correctly

### Automated Validation (Future)
A test script under `scripts/` can:
- Write a sample `plan.md` with a valid Progress Tracker
- Call the dashboard API to verify structured parsing
- Validate checkpoint state encoding

## Related Documentation
- `docs/elegy-model-audit.md` — Elegy planning model best practices
- `README.md` — Session state location and dashboard usage
- `engine-assets/agents/o-planner.agent.md` — Plan Pack output format specification
- `engine-assets/agents/elegy-planner.agent.md` — Elegy planning workflow
- `engine-assets/agents/elegy-orchestrator.agent.md` — Execution and Progress Tracker updates
