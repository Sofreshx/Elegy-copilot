---
name: guidelines-authoring
description: "How to create or update guidelines.md files with clear authority, minimal scope, and askQuestions-driven approval for new convention surfaces."
---

# Guidelines Authoring

## Purpose

Create or update `guidelines.md` files without turning them into duplicate policy dumps or hidden
prompt-only rules.

## When to Use

Use this skill when a repo or project needs a new `guidelines.md`, or when an existing one should be
edited to reflect approved conventions.

## Authoring rules

1. Keep the file concise and scoped to the repo or project it governs.
2. State authority and precedence explicitly; `guidelines.md` must not outrank canonical docs in
   `docs/system/**`.
3. Prefer summaries and links over copying large canonical policy blocks.
4. Capture only stable guidance that future humans and agents need repeatedly.
5. Do not create or expand a `guidelines.md` surface without user confirmation through
   `vscode/askQuestions`.

## Recommended structure

1. Purpose
2. Authority / precedence
3. Scope (which files/projects it applies to)
4. Required workflows or conventions
5. Links to canonical docs

## askQuestions triggers

Ask the user before:

- creating a new `guidelines.md`
- broadening an existing file from project scope to repo scope
- adding a new rule that is not already supported by canonical docs or explicit user direction
