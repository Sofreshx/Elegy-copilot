---
name: project-guidelines
description: "Always-loaded guidance for locating and following repository or project guidelines.md files before write-capable work."
---

# Project Guidelines

## Purpose

Provide one always-loaded rule for where agents should look for `guidelines.md` files and how those
files relate to canonical repo docs.

## When to Apply

Apply this skill before write-capable work whenever the repo may have repository-level or project-level
guidance outside `docs/system/**`.

## Rules

1. Check for the nearest applicable `guidelines.md` that covers the files or project you are changing.
2. Use this precedence:
   - explicit user instruction
   - canonical docs in `docs/system/**`
   - nearest applicable `guidelines.md`
   - other maintained docs
   - repeated implementation patterns
3. If `guidelines.md` conflicts with canonical docs, follow canonical docs and surface the conflict.
4. Do not invent missing guidelines. If a missing or stale guideline materially affects delivery, ask
   the user whether to create or update it.
5. Use `guidelines-authoring` when you need to create or edit `guidelines.md` content.

## askQuestions requirement

Use `vscode/askQuestions` before:

- creating the first `guidelines.md` for a repo or project
- changing the intended scope of an existing `guidelines.md`
- promoting an inferred convention into `guidelines.md` when the user has not already approved that move
