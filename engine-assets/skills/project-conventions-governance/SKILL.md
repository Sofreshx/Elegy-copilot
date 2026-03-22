---
name: project-conventions-governance
description: "Governance rules for identifying, auditing, and proposing project conventions with canonical-vs-inferred separation. Triggers on: project conventions, repo conventions, convention audit, convention drift, convention governance, propose conventions."
---

# Project Conventions Governance

## Purpose

Apply the canonical project-conventions governance contract from
`docs/system/project-conventions-governance.md` so convention work stays deterministic,
audit/propose-first, and grounded in canonical evidence instead of habit or prompt drift.

## When to Use

Use this skill when the request is primarily about:
- defining or revising repository conventions
- auditing whether conventions are documented clearly
- identifying convention drift across docs, code, and review habits
- proposing a canonical conventions entrypoint for future agents
- deciding whether an observed pattern is canonical, inferred, or just a one-off habit

## When NOT to Use

Do not use this skill when the request is primarily:
- logic or correctness review - use the reviewer lane contract
- documentation information architecture or repo-structure governance - use the docs/structure lane
- runtime validation, test orchestration, or "does this work?" review
- broad code review unrelated to convention governance
- final requested-vs-delivered summaries

## Canonical Sources and Precedence

Resolve convention authority in this order:

1. explicit user instruction for the current task
2. canonical system docs in `docs/system/**`
3. approved repo-level operating docs such as `README.md`
4. stable implementation patterns with repeated evidence in the repo
5. research notes or speculative drafts

Agent prompts, historical behavior, and chat memory are inputs only. They are not canonical until
promoted into an approved source of truth.

## Convention Classification Rules

### Confirmed canonical conventions

Treat a convention as confirmed when it is explicitly stated in:
- the current user instruction
- a canonical doc in `docs/system/**`
- an approved repo-level operating doc that does not conflict with higher-precedence sources

### Inferred conventions

Treat a convention as inferred when it is supported by repeated repo evidence but is not yet stated
in canonical docs. Inferred conventions:
- must be labeled as needing promotion or confirmation
- should cite the repeated pattern that suggests them
- must not be enforced as hard policy without explicit approval

### Reject as non-convention noise

Do not elevate a pattern when it is only:
- a one-off local implementation choice
- a temporary workaround
- an instruction embedded only in an agent prompt
- a speculative note or draft without canonical adoption

## Operating Rules

- Default to **audit/propose-first**. Stop at audit/proposal unless direct edits are explicitly
  requested or an approved execution workflow authorizes them.
- Collect the **smallest relevant** canonical source set before forming conclusions.
- Always separate **confirmed canonical** conventions from **inferred** conventions.
- Prefer **minimal updates** that clarify or promote existing behavior over broad rewrites.
- Surface drift, ambiguity, and missing entrypoints before suggesting new policy.
- When sources conflict, cite the higher-precedence source and treat lower-precedence material as
  drift until resolved.

## Workflow

1. Identify the scope of the convention question.
2. Gather the smallest relevant canonical sources for that scope.
3. Extract candidate conventions and classify each as confirmed or inferred.
4. Record drift, conflicts, and missing canonical entrypoints.
5. Propose the minimal updates needed to clarify, promote, or de-duplicate conventions.
6. Route downstream review or follow-up work to the correct lane instead of absorbing it here.
7. Edit convention artifacts only when explicit approval is present.

## Minimal-Update Heuristics

Prefer proposals that do one of the following:
- clarify an existing canonical rule rather than creating a parallel rule
- promote a repeated inferred convention into the smallest appropriate source-of-truth doc
- remove ambiguity between two nearby conventions
- add a compact entrypoint for future human or agent discovery

Avoid proposals that:
- rewrite large unrelated sections
- mix convention governance with logic review or validation work
- promote weak evidence into hard policy
- create duplicate convention entrypoints without a clear ownership reason

## Output Contract

Use this exact structure for audit, proposal, and approved-update work:

```text
CONVENTIONS_GOVERNANCE
- scope:
- canonical_sources:
  - <path>
- confirmed_conventions:
  - <rule>
- inferred_conventions:
  - <rule needing promotion or confirmation>
- drift_or_conflicts:
  - <issue>
- proposed_updates:
  - <doc/policy change>
- routing_notes:
  - <which downstream lane should act next>
```

If a section has no items, write `- none` rather than omitting the section.

## Routing Notes

Route downstream work as follows:
- logic or correctness questions -> reviewer lane governance / specialist reviewer
- documentation IA or repo-structure entrypoint work -> documentation-structure governance
- implementation-vs-spec checks -> `impl-reviewer`
- backlog items, research threads, or newly discovered follow-ups -> follow-up discovery governance
- runtime or verification confidence requests -> verification or working-review lane, not this skill

## Canonical References

- `docs/system/project-conventions-governance.md`
- `docs/system/search-execute-workflow.md`
- `docs/system/skills-governance.md`
