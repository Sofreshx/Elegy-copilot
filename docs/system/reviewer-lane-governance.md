---
created: 2026-03-13
updated: 2026-06-22
category: system
status: current
doc_kind: node
id: reviewer-lane-governance
summary: Canonical responsibility and routing contract for reviewer lanes, including coexistence with existing reviewers.
tags: [review, governance, routing]
related: [search-execute-workflow, project-conventions-governance, follow-up-discovery-governance, goal-contract-governance, testing-quality-governance, validation-governance]
---

# Reviewer Lane Governance

## Purpose

Define the canonical review-lane split for new reviewer families without replacing the repo's
existing reviewers prematurely.

## Context

The approved rollout keeps the current review system additive:

- `code-reviewer` remains the default broad review lane
- `impl-reviewer` remains the implementation-vs-spec gate
- `@goal-reviewer` is the high-level goal completion assessor
- `@final-reviewer` remains the requested-vs-delivered summary gate
- new specialist lanes sharpen routing and reduce role overlap

The **working reviewer** uses a **hybrid** posture:

- default to reviewing existing validation evidence
- allow active validation orchestration only when the invoking workflow explicitly permits it

## Canonical Lane Split

| Lane | Primary responsibility | Not responsible for | Default relationship |
| --- | --- | --- | --- |
| Logic reviewer | correctness, invariants, edge cases, behavior regressions | style, naming, final summary | narrower and deeper than `code-reviewer` |
| Consistency reviewer | conventions, naming, structural consistency, docs/code alignment | runtime validation, final summary | complements conventions governance and `code-reviewer` |
| Working reviewer | confidence that the change works in practice using evidence-first review and allowed active checks | pure docs governance, requested-vs-delivered summary | coordinates with validation runners and `verification-guide` |
| Goal reviewer | high-level goal completion assessment (`complete`, `partial`, `not-complete`) and read-only unresolved-goal sync instructions | file-level implementation correctness review, direct doc mutation, final requested-vs-delivered narrative | additive end-of-execution lane; coexists with `@final-reviewer` |
| Code reviewer | broad high-signal bugs, security, and code quality review | governance authoring, final post-mortem | stays the default generic lane |
| Impl reviewer | match against request/spec and approved plan | deep runtime validation, broad post-mortem | remains the spec-fit gate |
| Final reviewer | what was requested, delivered, validated, and what remains | file-level code correctness review | remains the closing summary |

## Project-Audit / Static-Analysis Family

The instruction-engine first pass treats project audit / static analysis as a **composed family**
that reuses existing specialist lanes instead of adding a replacement reviewer.

| Lane | Project-audit role | Primary normalized categories |
| --- | --- | --- |
| `stack-auditor` | framework/runtime pattern audit | `defect`, `improvement` |
| `security-auditor` | attack-surface, security-risk audit, and remediation | `defect`, `research_thread` |
| `logic-reviewer` | correctness and invariant overlay for suspicious or high-risk areas | `defect` |
| `consistency-reviewer` | convention drift, docs/code alignment, and missing required canonical references | `rule_drift`, `authority_gap` |
| `code-reviewer` | broad high-signal fallback for defects or cross-cutting quality risks | `defect`, `rule_drift` |
| `convention-governor` | explicit-rule, authority-path, and convention-drift audit when the problem is the governance surface itself | `authority_gap`, `rule_drift`, `research_thread` |

This family is adjacent to, but does not replace:

- `impl-reviewer` for request/spec fit and required canonical-bootstrap checks on docs-backed
  write-capable work
- `working-reviewer` for validation sufficiency and confidence-in-practice
- `goal-reviewer` and `final-reviewer` for closure and requested-vs-delivered reporting

## Normalized Finding Categories

When a lane participates in the project-audit/static-analysis family, each finding should reduce to
exactly one normalized category:

- `defect`: a confirmed or strongly supported correctness, security, runtime, or other
  implementation-quality problem that should become concrete implementation or validation follow-up
- `rule_drift`: code, docs, naming, structure, or required-citation drift against an existing
  canonical rule or stable repo convention
- `authority_gap`: a missing, contradictory, or hard-to-discover canonical rule, entrypoint, or
  governance surface that prevents reliable enforcement
- `research_thread`: a real concern or opportunity that needs comparative analysis, outside
  evidence, or adoption framing before implementation work can be planned responsibly
- `improvement`: a non-blocking maintainability or quality suggestion that is not yet a `defect`,
  `rule_drift`, or `authority_gap`

If one observation spans multiple categories, split it into multiple findings rather than
multi-labeling a single item.

`deferred issue` is not a scanner/reviewer category in this first pass. Deferral is a later routing
decision owned by follow-up discovery once the finding has been normalized.

## Routing

Use deterministic routing when the user intent is clear:

- "review logic only", "check correctness", "look for regressions" -> logic reviewer
- "review conventions/style/naming/docs alignment" -> consistency reviewer
- "does this actually work?", "assess validation evidence", "run allowed checks and judge confidence" -> working reviewer
- "were high-level goals actually completed?", "which goals are partial/not-complete?" -> `@goal-reviewer`
- "review this diff broadly" -> `code-reviewer`
- "did the implementation match the approved plan?" -> `impl-reviewer`
- "summarize what shipped and what remains" -> `@final-reviewer`

If the user does not specify a narrow lane, use the broad default review path first.

## Coexistence Rules

1. Specialist reviewer lanes do not deprecate existing reviewers in V1.
2. `code-reviewer` remains the broad default when no sharper route is obvious.
3. `impl-reviewer` remains the gate for request/spec compliance even when specialist reviews run.
4. `verification-guide` tells the user how to verify; it does not decide whether the change works.
5. Cross-model reviewers are workflow-specific planning reviewers. They are not generic replacements for the core reviewer lanes outside workflows that explicitly require them.
6. `@goal-reviewer` does not replace `@final-reviewer`; the lanes are intentionally complementary.
7. `@goal-reviewer` remains read-only. Persisting or removing entries in `~/.copilot/backlogs/{repo-name}/issues/unresolved-goals.md` should be routed through `@doc-writer` or another explicit docs lane, and Repository Backlog carryover under `~/.copilot/backlogs/{repo-name}/backlogs/*.md` should be routed through a backlog-writing lane such as `@backlog-planner`.
8. The project-audit/static-analysis family is an orchestration and normalization overlay, not a new
   replacement reviewer. Native lane responsibilities stay intact.
9. Native lane output blocks stay intact in V1. The normalized finding categories above are an
   additive downstream-routing contract for shared audit/follow-up flows.

## Planning-Phase Use

During orchestrator Phase 2 planning review:

- `@reviewer-opus-4-6` and `@reviewer-gpt-5-4` are the default plan-approval pair for `@orchestrator` in VS Code / non-CLI environments.
- `impl-reviewer` is a targeted overlay when the main planning risk is whether the plan matches the request, scope, and approved constraints.
- `logic-reviewer` may be added when the main planning risk is sequencing, invariants, rollback, or edge-case coverage.
- `consistency-reviewer` may be added when convention fit, naming, structural alignment, or docs/code alignment is the main planning risk.
- `code-reviewer` stays the broad fallback when no sharper planning-review lane fits.
- `@orchestrator-cli` uses Rubber Duck for the cross-model planning challenge instead of explicitly invoking the reviewer pair.
- These cross-model reviewers remain primary for non-CLI orchestrator planning review, but they do not replace the canonical responsibilities of the specialist and end-of-execution reviewers elsewhere.

## Adversarial Review Posture

When reviewer lanes are orchestrator-managed, they should apply an adversarial-but-evidence-bound
posture:

- try to falsify the current success claim before accepting it
- challenge the strongest assumptions, hidden failure modes, and missing evidence first
- stay inside the lane's native responsibility instead of expanding into unrelated critique
- distinguish `missing evidence` from `confirmed defect`
- surface improvement opportunities only when they materially improve correctness, confidence, safety,
  or future reviewability
- avoid speculative bug-hunting, low-signal polish, and duplicate findings across lanes

This posture applies both to Phase 2 planning review and to review of already-implemented changes in
Phase 4 verification. It sharpens the existing reviewer split; it does not create a new reviewer lane
or authorize reviewer lanes to mutate the repo.

## Working Reviewer Operating Contract

The working reviewer should:

1. inspect existing validation evidence first
2. determine whether the evidence is sufficient for the requested confidence level
3. orchestrate additional checks only when the calling workflow allows execution
4. report confidence, gaps, and recommended next checks

It should not silently assume permission to run tests or mutate the repo.

When test changes are part of the evidence, reviewer lanes should use
`docs/system/testing-quality-governance.md` as the canonical basis for flagging:

- weakened tests whose main effect is making failures disappear
- lost hard-case, failure-path, or edge-case coverage
- shallow green-only coverage that does not prove the real behavior
- assertion relaxations without replacement coverage that preserves confidence

## Canonical Guidance Compliance Detection

Reviewer lanes should reuse the docs-first bootstrap and contradiction rules from
`docs/system/search-execute-workflow.md` instead of inventing a separate enforcement hierarchy.

- `impl-reviewer` is the primary execution gate for checking whether docs-backed write-capable work
  reported the required canonical bootstrap and named the canonical sources it relied on
- `consistency-reviewer` is the primary review surface for skipped convention guidance, stale or
  missing canonical references, and docs/code alignment drift
- `code-reviewer` remains the broad fallback when ignored canonical guidance produced a
  high-confidence bug, security issue, or quality regression
- `convention-governor` and `doc-structure-governor` handle missing authority-path or entrypoint
  problems when the issue is the governance surface itself rather than a single change
- missing rationale or smart comments should be reported as review findings when they matter for
  future maintainability, but they are not contradiction-style hard stops on their own

## Output Contracts

Native lane outputs stay unchanged. When a lane is participating in project audit / static
analysis, its findings should also be reducible to exactly one normalized category from the taxonomy
above before follow-up routing.

Use these compact structures:

```text
LOGIC_REVIEW
- status: APPROVED|NEEDS_REVISION|FAILED
- findings:
  - <correctness issue or NONE>
- evidence:
  - <why this matters>
- next_actions:
  - <fix or re-check>
```

```text
CONSISTENCY_REVIEW
- status: APPROVED|NEEDS_REVISION
- findings:
  - <convention or alignment issue>
- canonical_references:
  - <doc path>
- next_actions:
  - <fix or governance follow-up>
```

```text
IMPL_REVIEW
- status: APPROVED|NEEDS_REVISION|FAILED
- canonical_bootstrap:
  - required-and-satisfied|not-required|missing|contradiction
- canonical_references:
  - <doc path or NONE>
- matches_request:
  - <bullet>
- gaps:
  - <bullet>
- risks:
  - <bullet>
- next_actions:
  - <concrete, ordered actions>
```

```text
WORKING_REVIEW
- status: APPROVED|NEEDS_REVISION|BLOCKED
- evidence_reviewed:
  - <test/check/artifact>
- confidence:
  - <low|medium|high>
- missing_validation:
  - <gap or NONE>
- next_actions:
  - <additional checks or user verification>
```

```text
GOAL_REVIEW
- status: APPROVED|NEEDS_REVISION|BLOCKED
- goals:
  - <goal text> | <complete|partial|not-complete> | <evidence or gap>
- unresolved_goals_path:
  - ~/.copilot/backlogs/{repo-name}/issues/unresolved-goals.md | NONE
- session_backlog_path:
  - ~/.copilot/backlogs/{repo-name}/backlogs/<session-slug>.md | NONE
- carryover_goals:
  - <goal text> | <partial|not-complete> | <why unresolved> | <carryover intent> | <source artifact path> | <owner>
  - NONE
- resolved_goals_to_remove:
  - <goal text> | <why it can be removed now>
  - NONE
- next_actions:
  - <revision, carryover, or unblock action>
  - NONE
```

## References

- `docs/system/search-execute-workflow.md`
- `docs/system/project-conventions-governance.md`
- `docs/system/follow-up-discovery-governance.md`
- `docs/system/goal-contract-governance.md`
- `docs/system/testing-quality-governance.md`
- `engine-assets/agents/code-reviewer.agent.md`
- `engine-assets/agents/consistency-reviewer.agent.md`
- `engine-assets/agents/impl-reviewer.agent.md`
- `engine-assets/agents/logic-reviewer.agent.md`
- `engine-assets/agents/security-auditor.agent.md`
- `engine-assets/agents/stack-auditor.agent.md`
- `engine-assets/agents/convention-governor.agent.md`
- `engine-assets/agents/final-reviewer.agent.md`
- `engine-assets/agents/verification-guide.agent.md`
