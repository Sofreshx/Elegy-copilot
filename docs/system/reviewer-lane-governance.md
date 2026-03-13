---
created: 2026-03-13
updated: 2026-03-13
category: system
status: current
doc_kind: node
id: reviewer-lane-governance
summary: Canonical responsibility and routing contract for reviewer lanes, including coexistence with existing reviewers.
tags: [review, governance, routing]
related: [search-execute-workflow, project-conventions-governance, follow-up-discovery-governance]
---

# Reviewer Lane Governance

## Purpose

Define the canonical review-lane split for new reviewer families without replacing the repo's
existing reviewers prematurely.

## Context

The approved rollout keeps the current review system additive:

- `code-reviewer` remains the default broad review lane
- `impl-reviewer` remains the implementation-vs-spec gate
- `final-reviewer` remains the requested-vs-delivered summary gate
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
| Code reviewer | broad high-signal bugs, security, and code quality review | governance authoring, final post-mortem | stays the default generic lane |
| Impl reviewer | match against request/spec and approved plan | deep runtime validation, broad post-mortem | remains the spec-fit gate |
| Final reviewer | what was requested, delivered, validated, and what remains | file-level code correctness review | remains the closing summary |

## Routing

Use deterministic routing when the user intent is clear:

- "review logic only", "check correctness", "look for regressions" -> logic reviewer
- "review conventions/style/naming/docs alignment" -> consistency reviewer
- "does this actually work?", "assess validation evidence", "run allowed checks and judge confidence" -> working reviewer
- "review this diff broadly" -> `code-reviewer`
- "did the implementation match the approved plan?" -> `impl-reviewer`
- "summarize what shipped and what remains" -> `final-reviewer`

If the user does not specify a narrow lane, use the broad default review path first.

## Coexistence Rules

1. Specialist reviewer lanes do not deprecate existing reviewers in V1.
2. `code-reviewer` remains the broad default when no sharper route is obvious.
3. `impl-reviewer` remains the gate for request/spec compliance even when specialist reviews run.
4. `verification-guide` tells the user how to verify; it does not decide whether the change works.
5. Cross-model reviewers remain optional overlays, not the canonical primary lane definitions.

## Working Reviewer Operating Contract

The working reviewer should:

1. inspect existing validation evidence first
2. determine whether the evidence is sufficient for the requested confidence level
3. orchestrate additional checks only when the calling workflow allows execution
4. report confidence, gaps, and recommended next checks

It should not silently assume permission to run tests or mutate the repo.

## Output Contracts

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

## References

- `docs/system/search-execute-workflow.md`
- `docs/system/project-conventions-governance.md`
- `docs/system/follow-up-discovery-governance.md`
- `engine-assets/agents/code-reviewer.agent.md`
- `engine-assets/agents/impl-reviewer.agent.md`
- `engine-assets/agents/final-reviewer.agent.md`
- `engine-assets/agents/verification-guide.agent.md`
