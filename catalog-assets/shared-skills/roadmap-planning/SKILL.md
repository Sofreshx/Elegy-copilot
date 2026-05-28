---
name: roadmap-planning
description: "Persisted repository roadmap workflow. A Roadmap is the durable multi-session planning artifact above active implementation. For the current Planning app/API compatibility surface in this repo, store repo-visible roadmaps in docs/roadmaps/<roadmap-slug>.md. Use when raw mixed instructions need ordering into a coherent roadmap, or when taking the next slice from a roadmap for concrete implementation."
---

# Roadmap Planning

## Purpose

Use a roadmap when work must survive multiple implementation sessions. A **Roadmap** is the durable
repo-visible planning artifact above active implementation: it captures goals, main targets,
sequencing, and explicit `RM-*` slice state. It is not an active task list; the current session
should plan and implement one coherent roadmap slice.

## Core Rules

- Work one slice at a time; avoid broad "continue the roadmap" execution.
- Do not execute multiple slices unless the user explicitly selects them.
- Do not mark a slice `done` without evidence.
- Keep roadmap updates factual and small.

## Location

- Store repo-visible roadmaps where the current Planning app/API reads them: `docs/roadmaps/<roadmap-slug>.md`.
- Use the current single-file roadmap format so `copilot-ui` can list, read, and project workflow state onto roadmap items.
- Keep roadmap updates factual and minimal.
- Do not put transient scratch tasks into a roadmap.
- If you find older folder-model roadmap docs under `docs/planning/<roadmap-slug>/`, treat them as compatibility or migration inputs, not the default place for new roadmap work in this repo right now.

## Create From Mixed Input

When the user dumps raw or unrelated work:

1. Group by product area, dependency, and risk.
2. Separate current truth, future goals, bugs, cleanup, research, and open questions.
3. Order by dependency: unblockers, contracts/data, runtime, UI/UX, validation/docs, polish.
4. Split unrelated goals into separate roadmap documents when they do not belong in one phased outcome list.
5. Assign each executable slice a stable id: `RM-<roadmap-slug>-001`, `RM-<roadmap-slug>-002`, and so on.
6. Convert vague items into concrete outcomes and acceptance checks.
7. Put unclear items under questions or `reevaluation-log.md`; do not invent requirements.
8. Leave all new executable slices as `pending` unless there is existing evidence.

## Roadmap Shape

Single file:

```text
docs/roadmaps/<roadmap-slug>.md
```

```markdown
---
doc_kind: roadmap
roadmap_slug: <roadmap-slug>
title: <Roadmap Title>
version: 1
---

# <Roadmap Title>

## Overview
<durable goal and current scope>

## Roadmap Items

### RM-<roadmap-slug>-001 - <Slice Name>
- Phase: <phase>
- Status: planned
- Summary: <specific outcome and current scope>
- Backlog IDs: RB-001
- Plan Refs: none
- Satisfied By Plan Ref: none
- Superseded By Plan Ref: none
- Abandoned By Plan Ref: none
```

Rules:
- Keep item summaries factual and concise.
- Use explicit `RB-*` links in `Backlog IDs`.
- Use `Plan Refs` and the terminal plan-ref fields only when real execution evidence exists.
- Keep the file compatible with the current Planning parser; do not invent new headings or replace the item list with freeform sections.

Statuses: `pending`, `ready`, `in-progress`, `blocked`, `done`, `dropped`. Use `ready` only when dependencies are satisfied. Use `done` only when acceptance is met or the remaining gap is recorded.

## Execute A Slice

1. Read `docs/roadmaps/<roadmap-slug>.md` and nearest repo instructions.
2. Confirm the selected `RM-*` slice and dependencies. If the user did not select a slice, propose the next dependency-ready slice instead of starting broad work.
3. Make a normal plan for that slice only.
4. Implement and validate the slice.
5. Lightly update only the relevant roadmap item fields in `docs/roadmaps/<roadmap-slug>.md`.
6. Keep roadmap edits factual. Do not rewrite unrelated future slices unless the implementation invalidated them.
7. If the slice introduces a key architectural, trust-boundary, workflow-authority, or long-lived contract decision, capture it in the owning canonical node or ADR instead of burying it only in roadmap prose.

Recommended prompt:

```text
Work on RM-<roadmap-slug>-00N only from docs/roadmaps/<roadmap-slug>.md.
First verify dependencies and current status.
Plan only this slice, implement it, validate it, then update only that RM item and its explicit evidence fields.
```

## Review Rules

- Use `rubberduck-plan-review` before implementing a risky roadmap slice.
- Use `implementation-review` before marking roadmap work done.
- A roadmap item is done only when its acceptance check is satisfied or the remaining gap is explicitly recorded.
- If the session loses track, stop broad execution and re-anchor on `index.md`, the selected section file, and the selected `RM-*` slice.
