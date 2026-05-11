---
name: roadmap-planning
description: "Persisted repository roadmap workflow for OpenCode. A Roadmap is the durable multi-session planning artifact above active implementation: a folder under docs/planning with an index, section files, progress or evidence, and a reevaluation log. Use when raw mixed instructions need ordering into a coherent roadmap, or when taking the next slice from a roadmap for concrete implementation."
---

# Roadmap Planning

## Purpose

Use a roadmap when work must survive multiple OpenCode sessions. A **Roadmap** is the durable
repo-visible planning artifact above active implementation: it captures goals, non-goals, main
targets, sequencing, section-level progress, evidence, and reevaluation notes. It is not an active
task list; the current OpenCode session should plan and implement one coherent roadmap slice.

## Core Rules

- Work one slice at a time; avoid broad "continue the roadmap" execution.
- Do not execute multiple slices unless the user explicitly selects them.
- Do not mark a slice `done` without evidence.
- Keep roadmap updates factual and small.

## Location

- Store new persisted roadmaps under `docs/planning/<roadmap-slug>/`.
- Use `index.md` for the roadmap overview and one Markdown file per section for detailed roadmap
  work.
- Use `reevaluation-log.md` for out-of-scope issues, unforeseen findings, blockers, scope changes, and
  roadmap-invalidating discoveries.
- Prefer existing repo planning indexes and naming conventions.
- Do not put transient scratch tasks into a roadmap.
- Legacy single-file roadmaps under `docs/planning/<roadmap-slug>.md` remain readable. Convert only
  the targeted legacy roadmap when it is substantially edited or explicitly migrated.

## Create From Mixed Input

When the user dumps raw or unrelated work:

1. Group by product area, dependency, and risk.
2. Separate current truth, future goals, bugs, cleanup, research, and open questions.
3. Order by dependency: unblockers, contracts/data, runtime, UI/UX, validation/docs, polish.
4. Split unrelated goals into separate roadmap sections or separate roadmap folders.
5. Assign each executable slice a stable id: `RM-<roadmap-slug>-001`, `RM-<roadmap-slug>-002`, and so on.
6. Convert vague items into concrete outcomes and acceptance checks.
7. Put unclear items under questions or `reevaluation-log.md`; do not invent requirements.
8. Leave all new executable slices as `pending` unless there is existing evidence.

## Roadmap Shape

Folder:

```text
docs/planning/<roadmap-slug>/
  index.md
  <section-slug>.md
  reevaluation-log.md
```

`index.md`:

```markdown
# <Roadmap Title>

## Description
<durable goal and current scope>

## Goals
- <goal>

## Non-Goals
- <non-goal or none>

## Operating Rules
- Work one slice at a time.
- Do not mark done without evidence.
- Update only the active slice unless implementation invalidates later work.

## Current Truth
- <implemented fact or constraint>

## Target State
- <desired outcome>

## Main Targets
- <target>

## Current Slice
- Active: none
- Started: none
- Stop condition: none

## Section Index
| Section | Status | Progress | Depends on | Evidence |
|---|---|---:|---|---|
| [Runtime Contracts](runtime-contracts.md) | pending | 0/3 | none | none |

## Reevaluation
- Log: [reevaluation-log.md](reevaluation-log.md)
```

Section file:

```markdown
# <Section Title>

## Section Goal
- <specific section outcome>

## Items

### RM-<roadmap-slug>-001 <Slice Name>
Status: pending
Depends on: none

Goal:
- <specific outcome>

Work:
- <concrete tasks or files/areas>

Acceptance:
- <observable check>

Evidence:
- none

Notes:
- none

## Session Log
- <date>: <RM id> <short factual update>
```

`reevaluation-log.md`:

```markdown
# Reevaluation Log

## Out-of-Scope And Unforeseen Findings

### <date> - <finding>
- Status: open
- Linked IDs: RB-001, RM-<roadmap-slug>-001, or none
- Impact: <why this may require roadmap reevaluation>
- Decision: <follow-up, no action, or pending>
```

Findings that imply future action must link to an existing `RB-*` or `RM-*` item, create the needed
durable item, or explicitly state that no durable action item was created. Do not create a separate ID
family for reevaluation entries.

Statuses: `pending`, `ready`, `in-progress`, `blocked`, `done`, `dropped`. Use `ready` only when dependencies are satisfied. Use `done` only when acceptance is met or the remaining gap is recorded.

## Execute A Slice

1. Read the roadmap `index.md`, the selected section file, `reevaluation-log.md` if relevant, and nearest repo instructions.
2. Confirm the selected `RM-*` slice and dependencies. If the user did not select a slice, propose the next dependency-ready slice instead of starting broad work.
3. Set or verify `Current Slice`.
4. Use OpenCode `Plan` mode for that slice only.
5. Implement and validate the slice.
6. Lightly update the roadmap: `Section Index`, slice status, evidence, short session log entry, and newly discovered blockers.
7. Clear or advance `Current Slice` only when the handoff state is unambiguous.
8. Keep roadmap edits factual. Do not rewrite unrelated future slices unless the implementation invalidated them.

Recommended prompt:

```text
Work on RM-<roadmap-slug>-00N only from docs/planning/<roadmap-slug>/.
First verify dependencies and current status.
Plan only this slice, implement it, validate it, then update only that RM item, section evidence, and session log.
```

## Split Large Roadmaps

When a legacy single-file roadmap becomes hard to scan, convert it to the folder model:

1. Move overview, goals, current slice, and section progress into `docs/planning/<roadmap-slug>/index.md`.
2. Move detailed items into section files such as `runtime-contracts.md` or `ui-workflows.md`.
3. Move open out-of-scope, unforeseen, or roadmap-invalidating findings into `reevaluation-log.md`.
4. Preserve existing `RM-*` IDs and do not renumber items.

For new roadmaps, start with the folder model instead of waiting for the roadmap to grow.

## Review Rules

- Use `rubberduck-plan-review` before implementing a risky roadmap slice.
- Use `implementation-review` before marking roadmap work done.
- A roadmap item is done only when its acceptance check is satisfied or the remaining gap is explicitly recorded.
- If the session loses track, stop broad execution and re-anchor on `index.md`, the selected section file, and the selected `RM-*` slice.