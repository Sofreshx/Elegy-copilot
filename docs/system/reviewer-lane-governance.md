---
created: 2026-03-13
updated: 2026-06-22
category: system
status: current
doc_kind: node
id: reviewer-lane-governance
summary: Canonical responsibility and routing contract for the single shipped reviewer leaf and workflow-specific planning reviewers.
tags: [review, governance, routing]
related: [search-execute-workflow, project-conventions-governance, follow-up-discovery-governance, goal-contract-governance, testing-quality-governance, validation-governance]
---

# Reviewer Lane Governance

## Purpose

Define the canonical review posture for the lean orchestrator-centric workflow: one shipped reviewer
leaf for implementation review, plus workflow-specific planning reviewers where the orchestrator
explicitly requires them.

## Context

The approved reviewer model is intentionally small:

- `@code-reviewer` is the single shipped reviewer leaf for broad correctness, regression, convention,
  and request/spec-fit review
- `@reviewer-opus-4-6` and `@reviewer-gpt-5-4` remain planning-review overlays for non-CLI
  orchestrators only
- final closure, remaining-work judgment, and follow-up discovery are orchestrator responsibilities,
  not separate reviewer lanes

## Canonical Lane Split

| Lane | Primary responsibility | Not responsible for | Default relationship |
| --- | --- | --- | --- |
| `@code-reviewer` | high-signal defects, regressions, convention drift, and implementation-vs-request/plan fit | final requested-vs-delivered summary, backlog persistence, roadmap selection | default review lane for execution and bounded review tasks |
| `@reviewer-opus-4-6` | cross-model plan review in non-CLI orchestrator workflows | generic code review, implementation mutation, end-of-run closure | paired with `@reviewer-gpt-5-4` for non-CLI planning gates |
| `@reviewer-gpt-5-4` | second cross-model plan review in non-CLI orchestrator workflows | generic code review, implementation mutation, end-of-run closure | paired with `@reviewer-opus-4-6` for non-CLI planning gates |
| orchestrator | final closure, remaining-work judgment, follow-up discovery, and persistence routing | file-level defect review | consumes reviewer output rather than delegating closure authority away |

## Normalized Finding Categories

Each accepted reviewer finding should reduce to exactly one category:

- `defect`: a confirmed or strongly supported correctness, security, runtime, or high-signal quality problem
- `rule_drift`: code, docs, naming, structure, or required-citation drift against a canonical rule or stable repo convention
- `authority_gap`: a missing, contradictory, or hard-to-discover canonical rule or entrypoint
- `research_thread`: a real concern or opportunity that needs comparative analysis before implementation can be planned responsibly
- `improvement`: a non-blocking maintainability or quality suggestion

If one observation spans multiple categories, split it into multiple findings rather than multi-labeling
a single item.

## Routing

Use deterministic routing when intent is clear:

- "review this diff", "check correctness", "look for regressions", "did this implementation match the request?" -> `@code-reviewer`
- "review conventions/style/naming/docs alignment" -> `@code-reviewer`
- "challenge this plan before execution" -> `@reviewer-opus-4-6` + `@reviewer-gpt-5-4` in non-CLI workflows
- "summarize what shipped and what remains" -> orchestrator closure, not a reviewer lane

If the user does not specify a narrow lane, use `@code-reviewer`.

## Coexistence Rules

1. `@code-reviewer` is both the broad default reviewer and the implementation-vs-spec/request fit reviewer.
2. Cross-model reviewers are workflow-specific planning reviewers. They are not generic replacements for `@code-reviewer`.
3. `@orchestrator-cli` uses Rubber Duck for plan challenge instead of explicitly invoking the reviewer pair.
4. Reviewer lanes stay read-only. Persistence to `~/.copilot/backlogs/{repo-name}/**` should route through the orchestrator plus explicit writing lanes such as `@doc-writer`.
5. Missing authority-path or conventions-surface issues route through canonical conventions docs and skills, not dedicated governance agents.

## Adversarial Review Posture

Reviewer lanes should apply an adversarial-but-evidence-bound posture:

- try to falsify the current success claim before accepting it
- challenge hidden failure modes and missing evidence first
- stay inside the lane's native responsibility instead of expanding into unrelated critique
- distinguish `missing evidence` from `confirmed defect`
- avoid low-signal polish comments and duplicate findings

## Canonical Guidance Compliance Detection

Reviewer lanes should reuse the docs-first bootstrap and contradiction rules from
`docs/system/search-execute-workflow.md` instead of inventing a separate enforcement hierarchy.

- `@code-reviewer` is the primary review surface for skipped convention guidance, stale or missing canonical references, docs/code alignment drift, and high-confidence bugs or regressions caused by ignored canonical guidance
- missing authority-path or entrypoint problems should route to `docs/system/project-conventions-governance.md`, the always-loaded `project-guidelines` skill, and `guidelines-authoring` when the governance surface itself needs to change
- missing rationale or smart comments may still be review findings when they materially affect future maintainability, but they are not contradiction-style hard stops on their own

## Output Contract

Native lane outputs stay unchanged. When reviewer output is consumed by follow-up discovery, findings
should be reducible to the normalized categories above.

Use this compact structure when a structured block is helpful:

```text
CODE_REVIEW
- status: APPROVED|NEEDS_REVISION|FAILED
- canonical_references:
  - <doc path or NONE>
- matches_request:
  - <bullet>
- findings:
  - <category> | <file:line or NONE> | <issue>
- next_actions:
  - <concrete action or NONE>
```

## References

- `docs/system/search-execute-workflow.md`
- `docs/system/project-conventions-governance.md`
- `docs/system/follow-up-discovery-governance.md`
- `docs/system/testing-quality-governance.md`
- `engine-assets/agents/code-reviewer.agent.md`
