---
name: truth-sync
description: "Resolves conflicts between code, docs, and legacy sources using a ranked truth hierarchy. Triggers on: doc conflict, source of truth, stale docs, truth hierarchy, code vs docs."
---

# Truth Sync

## Purpose

Resolves conflicts between code, docs, and legacy sources using a ranked hierarchy. When multiple sources disagree about system behavior or intent, this skill provides a deterministic resolution path.

## When to Use

Trigger signals:
- Conflicting documentation discovered
- "Which source is correct?"
- Stale docs found during implementation
- Code disagrees with docs
- Legacy instructions (`.instructions/`) contradict current behavior

## When NOT to Use

- **Writing new docs from scratch** — this skill resolves conflicts, not authoring gaps.
- **General refactoring** — use standard coding workflows.
- **Code that has no documentation conflict** — no conflict means no need for truth resolution.

## Truth Hierarchy

6-tier ranked list with separate behavior and intent tracks:

| Rank | Track | Source | Rationale |
|------|-------|--------|-----------|
| 1 | Behavior | **Running code** | Actual runtime behavior is the ultimate truth for what the system *does*. |
| 1 | Intent | **`docs/system/**`** | Canonical docs are the ultimate truth for what the system *should* do. |
| 2 | Both | **Tests** | Verified expectations, executable spec. |
| 3 | Both | **Inline code comments** | Local context, may be stale. |
| 4 | Both | **Legacy instructions (`.instructions/`)** | Historical context, may be outdated. |
| 5 | Both | **Tribal knowledge** | Verbal conventions, chat history, session memory. |
| 6 | Both | **AI-generated content** | Must be verified against higher ranks. |

## Decision Tree

When code and docs conflict:

1. **Check if code behavior is intentional** — do tests pass? Is it covered by test cases?
2. **If yes** → update docs to match code (code behavior is intentional, docs are stale).
3. **If no** → flag as bug, fix code to match docs (docs represent intended behavior).
4. **If unclear** → escalate via `vscode/askQuestions` to ask the user for clarification.

## Escalation Protocol

When the hierarchy cannot resolve the conflict:

- Use `vscode/askQuestions` to ask the user which source is authoritative.
- Record the decision in the completion summary so future agents have context.

## Future Elegy Alignment

`TODO(elegy-contracts)`: Truth hierarchy ranks will eventually map to Elegy governance tiers. Canonical authority resolution will align with `CanonicalAuthority` enum from Elegy Formalization Core.
