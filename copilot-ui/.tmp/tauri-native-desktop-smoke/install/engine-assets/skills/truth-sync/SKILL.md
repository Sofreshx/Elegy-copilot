---
name: truth-sync
description: "Resolves material contradictions between canonical docs, implementation evidence, and legacy sources using the repo's docs-first contract. Triggers on: doc conflict, source of truth, stale docs, truth hierarchy, code vs docs."
---

# Truth Sync

## Purpose

Resolves material contradictions between canonical docs, implementation evidence, and legacy sources without inventing a competing source-of-truth hierarchy. When multiple sources disagree about system behavior or intent, this skill uses the repo's docs-first contract to decide whether the mismatch is drift, evidence, or a user-escalation point.

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

## Resolution Contract

Start from the smallest relevant canonical docs entrypoint for the task, then expand only as the current step needs more detail.

Use these authority rules:

- the current user instruction controls task-local overrides
- `docs/system/**` is canonical intent for behavior, workflow policy, precedence, and documentation-backed features
- other maintained docs in `docs/**` and approved repo operating docs are important context, not peer authority with `docs/system/**`
- implementation, tests, and repeated repo patterns are evidence of current behavior, not automatic permission to override canonical docs
- legacy instructions, prompt text, and chat/session memory are context only until promoted into canonical docs

`truth hierarchy` remains a compatibility trigger phrase for this skill, not a separate governing model.

## Decision Tree

When sources disagree:

1. **Load the smallest relevant canonical docs truth first** — start from `docs/system/index.md`, a relevant MOC, or the owning canonical node for the affected lane.
2. **Classify the mismatch** — decide whether it is minor wording drift or a material contradiction.
3. **Minor wording drift** → note it and continue when the mismatch does not change behavior, precedence, workflow ownership, or documentation-backed feature semantics.
4. **Material contradiction** → cite the conflicting sources and ask the user for direction before any write-capable work continues.
5. **After direction** → reconcile code, docs, prompts, or skill text to the resolved canonical source and record the decision in the completion summary.

## Escalation Protocol

Escalate when the contradiction is material and affects behavior, intent, workflow policy, precedence, or documentation-backed feature semantics.

- name the canonical doc or maintained source that conflicts with the intended work
- summarize the specific disagreement, not just "docs vs code"
- use `vscode/askQuestions` to ask the user for direction before implementation or other write-capable work continues
- record the decision in the completion summary so future agents have context

## Governance Integration

When a conflict affects canonical docs, prompts, or workflow policy, anchor the resolution in the owning canonical docs lane rather than a separate truth hierarchy. Record which source won and why. Prefer explicit resolution language such as `Reject`, `Reconcile`, or `Override`, and pair it with an enforcement stance such as `Strict` or `Warn` so the decision is easy to audit in repo artifacts and completion summaries.
