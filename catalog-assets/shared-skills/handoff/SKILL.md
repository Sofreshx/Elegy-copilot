---
name: handoff
description: "Compact the current conversation into a handoff document for another agent to pick up. Use before closing a session or when context is full and work needs to continue in a fresh session."
argument-hint: "What will the next session be used for?"
disable-model-invocation: true
license: Apache-2.0
metadata: {"source":"https://github.com/mattpocock/skills","adapted":true,"originalName":"handoff","notes":"artifact refs→Elegy Copilot types, boundaries added"}
---

# Cross-Session Handoff

Compact the current conversation into a handoff document so a fresh agent can continue the work. Save to the temporary directory of the user's OS — not the current workspace.

## Process

1. Summarise the current state of work — what was accomplished, what decisions were made, what's next.
2. Reference existing artifacts by path or URL rather than duplicating their content:
   - Specs: `docs/specs/<spec-slug>/spec.md`
   - ADRs: `docs/system/adr/NNNN-slug.md`
   - Planning state: references to `elegy-planning` entities (goals, roadmaps, plans)
   - Issues, commits, diffs, PRDs
3. Include a **Suggested skills** section listing which skills the next agent should invoke and in what order.
4. Redact any sensitive information: API keys, passwords, personally identifiable information.
5. If the user passed arguments, treat them as a description of what the next session will focus on and tailor the doc accordingly.

## Output

Write to the OS temp directory (`$TMPDIR` or `/tmp` or `%TEMP%`). Use a descriptive filename with a timestamp: `<topic>-handoff-<YYYY-MM-DD>.md`.

Tell the user the absolute path so they can reference it in the next session.

## Boundaries

This is a **lightweight** handoff for quick context preservation across sessions. For a formal, structured executor-ready brief with implementation sequences and repo evidence, use `implementation-handoff` instead. This skill preserves the conversation state; `implementation-handoff` produces a delegation artifact.

This skill is user-invoked only — the agent cannot invoke it autonomously.
