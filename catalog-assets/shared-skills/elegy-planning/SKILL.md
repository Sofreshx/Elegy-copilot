---
name: elegy-planning
description: "Durable planning authority via Elegy CLI. Use for goals, roadmaps, plans, todos, issues, review points, validation, health checks, and projection rendering backed by SQLite."
metadata: {"aliasKeys":["roadmap-planning","durable-planning"],"stacks":["planning"],"tags":["planning","goal","roadmap","plan","todo","issue","sqlite","elegy"]}
---

# Elegy Planning

## Prerequisite

The `elegy-planning` binary must be available on PATH or passed explicitly. If not installed, fall
back to the repo's markdown planning conventions (e.g., `docs/roadmaps/`).

## Installation

### Automatic Installation (Recommended)
The `elegy-planning` CLI is automatically downloaded and managed by the copilot-ui system.
When first needed, it will be downloaded from GitHub releases at:
`https://github.com/Sofreshx/Elegy/releases`

### Manual Installation
1. Download the latest release from: https://github.com/Sofreshx/Elegy/releases
2. Extract the binary for your platform:
   - Windows: `elegy-planning.exe`
   - macOS/Linux: `elegy-planning`
3. Add to your PATH or place in a directory that's on PATH
4. Verify installation: `elegy-planning --version`

### Environment Variables
- `INSTRUCTION_ENGINE_ELEGY_PLANNING_DB_PATH`: Custom SQLite database path
- Default location: `~/.elegy/planning.db` (or `~/.copilot/elegy-planning.db`)

### First-Time Setup
After installation, initialize the session context:
```bash
elegy-planning session init
```

## Core Commands

```text
elegy-planning goal create/show/list/update-status
elegy-planning roadmap create/show/list/add-work-point/update-status
elegy-planning plan create/show/list/revise/update-status
elegy-planning todo create/list/update-status
elegy-planning issue record/list/update-status
elegy-planning review-point record
elegy-planning scope create/show/list
elegy-planning validate all
elegy-planning health
elegy-planning project render
```

All commands accept `--json` for structured output and `--db <path>` for a custom SQLite path.

## Quick Reference

| Task | Command |
|---|---|
| Create a goal | `elegy-planning goal create --title "..." --description "..." --acceptance "..." --rejection "..."` |
| Create a roadmap | `elegy-planning roadmap create --goal-id <id> --title "..." --summary "..."` |
| Add work to a roadmap | `elegy-planning roadmap add-work-point --roadmap-id <id> --title "..." --summary "..."` |
| Create a plan | `elegy-planning plan create --goal-id <id> --roadmap-id <id> --title "..." --summary "..." --plan-scope "..."` |
| Record an issue | `elegy-planning issue record --title "..." --summary "..." --severity high` |
| Validate everything | `elegy-planning validate all --json` |
| Check health | `elegy-planning health --json` |
| Render a projection | `elegy-planning project render --entity-type goal --entity-id <id> --output <path>` |

## Lifecycle Statuses

| Entity | Allowed statuses |
|---|---|
| Goal | draft, proposed, active, validated, invalidated, superseded, abandoned |
| Roadmap | draft, proposed, active, blocked, completed, cancelled, invalidated |
| Plan | draft, proposed, active, blocked, completed, cancelled, invalidated |
| Todo | pending, in-progress, blocked, completed, cancelled |
| Issue | open, blocked, resolved, reopened |
| Review point | open, resolved, accepted-risk |
| Work point | draft, proposed, active, blocked, completed, cancelled, invalidated |

## Rules

- Always pass `--correlation-id` for mutation commands (create, update-status, revise, record).
- Use `--json` when you need to parse results programmatically.
- Validate before marking work done: `elegy-planning validate all --json`.
- Do not mix markdown planning artifacts with Elegy planning state in the same scope. Pick one.
- When the user asks for a roadmap, check if Elegy is available first. If not, fall back to `roadmap-planning` (markdown convention).

## Authority Chain

Governed definition: `contracts/elegy/fixtures/skill-definition-v2.elegy-planning.json`
Discovery index: `contracts/elegy/fixtures/skill-discovery-index.elegy-planning.json`
CLI source: `rust/crates/elegy-planning`
