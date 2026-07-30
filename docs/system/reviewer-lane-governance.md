---
created: 2026-03-13
updated: 2026-07-30
category: system
status: current
doc_kind: node
id: reviewer-lane-governance
summary: Canonical responsibility and routing contract for bounded review, strong independent review, and orchestrator judgment.
tags: [review, governance, routing]
related: [search-execute-workflow, project-conventions-governance, follow-up-discovery-governance, goal-contract-governance, testing-quality-governance, validation-governance]
---

# Reviewer Lane Governance

## Purpose

Define the canonical review posture for the lean workflow: bounded implementation
review, strong independent review when judgment is consequential, and final
decision ownership in the orchestrator.

## Context

The approved reviewer model is intentionally small:

- `@code-reviewer` is the single shipped reviewer leaf for broad correctness, regression,
  convention, and request/spec-fit review
- Codex uses `reviewer` on Luna for bounded implementation slices and
  `reviewer_strong` on Sol for complex plans or consequential cross-cutting review
- other harnesses use their host-native planning review affordance
- final closure, remaining-work judgment, and follow-up discovery are orchestrator responsibilities,
  not separate reviewer lanes

Independence determines whether review should be delegated. Complexity and
consequence determine the reviewer model. A reviewer finding is advisory until
the orchestrator verifies and accepts it.

## Canonical Lane Split

| Lane | Primary responsibility | Not responsible for | Default relationship |
| --- | --- | --- | --- |
| `@code-reviewer` | high-signal defects, regressions, convention drift, and implementation-vs-request/plan fit | final requested-vs-delivered summary, backlog persistence, roadmap selection | default review lane for execution and bounded review tasks |
| Codex `reviewer` | bounded implementation diffs, regressions, conventions, request fit, and missing tests | complex architecture or consequential risk judgment | Luna review leaf |
| Codex `reviewer_strong` | complex plans, architecture, security, privacy, migrations, data-loss risk, cross-cutting changes, and disputed findings | final approval or closure | read-only Sol review leaf |
| Orchestrator | reconciliation, final validation, approval, closure, and the answer | independent first-pass review when a bounded leaf adds value | final decision owner |

## Normalized Finding Categories

Each accepted reviewer finding should reduce to exactly one category:

- `defect`: a confirmed or strongly supported correctness, security, runtime, or high-signal quality problem
- `rule_drift`: code, docs, naming, structure, or required-citation drift against a canonical rule or stable repo convention; this includes current canonical docs that use temporal change narrative such as "now supports", "previously X, now Y", or "as of v2.0" instead of present-state description
- `authority_gap`: a missing, contradictory, or hard-to-discover canonical rule or entrypoint
- `research_thread`: a real concern or opportunity that needs comparative analysis before implementation can be planned responsibly
- `improvement`: a non-blocking maintainability or quality suggestion

If one observation spans multiple categories, split it into multiple findings rather than multi-labeling
a single item.

## Routing

Use deterministic routing when intent is clear:

- "review this diff", "check correctness", "look for regressions", "did this implementation match the request?" -> `@code-reviewer`
- "review conventions/style/naming/docs alignment" -> `@code-reviewer`
- Codex bounded implementation review -> `reviewer`
- Codex complex-plan, architecture, security, privacy, migration, data-loss, cross-cutting, or disputed review -> `reviewer_strong`
- "challenge this plan before execution" -> use the host-native strong review affordance

Classify complexity and consequence before applying a default. In Codex, use
`reviewer` for bounded review and `reviewer_strong` for consequential review.
In a harness that exposes only the shared reviewer leaf, use `@code-reviewer`.

## Coexistence Rules

1. `@code-reviewer` is both the broad default reviewer and the implementation-vs-spec/request fit reviewer.
2. Reviewer lanes stay read-only.
3. Bounded reviewers escalate rather than resolve architecture or consequential-risk judgment.
4. Reviewers do not own final validation, approval, closure, or the answer.
5. Missing authority-path or conventions-surface issues route through canonical conventions docs and skills, not dedicated governance agents.

## Adversarial Review Posture

Reviewer falsification posture and depth limits inherit from [calibrated-questioning-and-depth-governance.md](calibrated-questioning-and-depth-governance.md); this doc keeps reviewer responsibilities, routing, and output contracts.

- try to falsify the current success claim with evidence-backed challenge before accepting it
- keep depth inside reviewer responsibilities and the shared hard no-activate limits
- treat deeper review as an explicit overlay, not as permission to invent speculative defects, add a new reviewer lane, or take over closure

## Canonical Guidance Compliance Detection

Reviewer lanes should apply that shared questioning/depth policy and reuse the docs-first bootstrap and contradiction rules from
`docs/system/search-execute-workflow.md` instead of inventing a separate enforcement hierarchy.

- `@code-reviewer` is the primary review surface for skipped convention guidance, stale or missing canonical references, docs/code alignment drift, and high-confidence bugs or regressions caused by ignored canonical guidance
- missing authority-path or entrypoint problems should route to `docs/system/project-conventions-governance.md` and `docs/system/documentation-structure-governance.md` when the governance surface itself needs to change
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
