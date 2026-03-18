---
created: 2026-03-13
updated: 2026-03-18
category: system
status: current
doc_kind: node
id: project-conventions-governance
summary: Canonical contract for how Instruction Engine defines, audits, and routes project-conventions governance work.
tags: [governance, conventions, routing]
related: [search-execute-workflow, documentation-structure-governance, reviewer-lane-governance, skills-governance]
---

# Project Conventions Governance

## Purpose

Define the canonical governance contract for creating, auditing, and updating project conventions in
the Instruction Engine ecosystem.

## Context

This rollout is **instruction-engine first**. The conventions governance lane is therefore defined
first against this repo's own canonical docs, repo layout, and operating workflows, then reused
later as a pattern for downstream repos.

The default posture is **audit/propose first**:

- identify current conventions from canonical sources
- surface gaps, conflicts, and drift
- propose updates before mutating any source of truth
- edit convention artifacts only when the user or an approved execution workflow explicitly asks

## Entrypoint Workflow

Use this node as the canonical policy entrypoint for repository conventions.

For humans:

1. start at `docs/system/index.md`
2. open `docs/system/mocs/conventions-and-governance.md`
3. read this node when the question is primarily "what are the rules, conventions, or governance expectations?"

For AI or structured workflows:

1. load this node first for convention policy, precedence, and output shape
2. add `docs/system/documentation-structure-governance.md` only when discoverability, entrypoints, or
   information architecture are part of the task
3. add `docs/system/follow-up-discovery-governance.md` only when confirmed convention gaps need
   planning-ready follow-up or backlog routing

This keeps the route compact while preserving a consistent source-of-truth path for both humans and
agents.

## Responsibilities

This lane is responsible for:

- identifying the current convention set from canonical repo sources
- distinguishing hard conventions from local habits or one-off patterns
- proposing convention additions, removals, or clarifications
- keeping convention entrypoints understandable for both humans and downstream agent workflows
- routing convention-fit review questions to the right reviewer lane

This lane is not responsible for:

- generic file-level code review
- final requested-vs-delivered summaries
- runtime validation or test orchestration
- broad documentation graph authoring outside convention governance scope

## Canonical Evidence and Precedence

When convention sources conflict, resolve them in this order:

1. explicit user instruction for the current task
2. canonical system docs in `docs/system/**`
3. approved repo-level operating docs such as `README.md`
4. stable implementation patterns with repeated evidence in the repo
5. research notes or speculative drafts

Agent prompts and historical behavior are inputs, not the source of truth, until promoted into
canonical docs.

## Default Operating Contract

The conventions governance lane should work in this sequence:

1. collect the smallest relevant canonical sources
2. separate already-canonical conventions from inferred conventions
3. report drift, ambiguity, and missing entrypoints
4. propose the minimal doc or policy updates needed
5. hand off actual edits only when explicitly approved

If a request is purely evaluative, the output should stop at audit/proposal.

## Discoverability and Consistency Contract

Convention guidance should be easy to locate without requiring hidden prompt context.

- human-facing entrypoints should route through the system index and the governance MOC before opening
  atomic rules
- AI-facing entrypoints should rely on the same canonical nodes instead of carrying separate rule
  copies in prompt text
- convention docs should prefer minimal routing updates over duplicate policy summaries spread across
  many files
- local flexibility is allowed only when it does not conflict with explicit canonical rules or create
  ambiguous outcomes

## Routing

Route requests here when the user asks to:

- define or revise repository conventions
- audit whether conventions are documented clearly
- identify convention drift across docs, code, and review habits
- propose a canonical conventions entrypoint for future agents

Do not route here when the request is primarily:

- logic/correctness review -> use the reviewer lane contract in `docs/system/reviewer-lane-governance.md`
- documentation graph or repo-structure governance -> use `docs/system/documentation-structure-governance.md`
- broad default code review -> use existing reviewer assets

When the intent is explicit, this is a deterministic route and should not require broad capability
search first.

## Follow-Up Boundary

This lane may identify missing standards, unclear rules, or convention drift that should become later
planning or backlog inputs. It should not directly expand into broad planning execution on its own.

When convention work produces validated next steps:

1. keep the convention decision in canonical governance docs
2. route concrete remaining-work or backlog-worthy items through
   `docs/system/follow-up-discovery-governance.md`
3. let approved planning artifacts consume that follow-up output later through the normal planning
   contract rather than embedding planning state in this governance node

## Output Contract

Use this structure for convention-governance audits or proposals:

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

## Relationship to Other Governance Lanes

- Use `docs/system/documentation-structure-governance.md` when the main problem is documentation
  information architecture or project-entrypoint quality.
- Use `docs/system/reviewer-lane-governance.md` when the user is asking for review rather than
  governance authoring.
- Use `docs/system/follow-up-discovery-governance.md` when convention gaps become backlog items,
  research questions, or next-step proposals.

## References

- `docs/system/search-execute-workflow.md`
- `docs/system/skills-governance.md`
- `docs/system/documentation-structure-governance.md`
- `docs/system/reviewer-lane-governance.md`
- `docs/system/follow-up-discovery-governance.md`
