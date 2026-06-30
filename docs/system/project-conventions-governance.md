---
created: 2026-02-23
updated: 2026-06-29
category: system
status: current
doc_kind: node
id: project-conventions-governance
summary: Canonical contract for how Elegy Copilot defines, audits, and routes project-conventions governance work.
tags: [governance, conventions, routing]
related: [search-execute-workflow, documentation-structure-governance, self-documenting-code-and-rationale-placement, reviewer-lane-governance, skills-governance]
---

# Project Conventions Governance

## Purpose

Define the canonical governance contract for creating, auditing, and updating project conventions in
the Elegy Copilot ecosystem.

## Context

This rollout is **elegy-copilot first**. The conventions governance lane is therefore defined
first against this repo's own canonical docs, repo layout, operating workflows, and the
per-harness instruction file pattern, then reused later as a pattern for downstream repos.

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

1. for feature or modification work, load the smallest relevant canonical docs entrypoint before
  implementation; when intended design, behavior, or workflow policy changes, make the relevant
  canonical docs update part of the first execution slice before or alongside code or asset changes;
  use this node first when the task is mainly convention policy, precedence, or output shape
2. expand only as needed, adding `docs/system/documentation-structure-governance.md` only when
  discoverability, entrypoints, or
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
3. the nearest applicable per-harness instruction file (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`,
   or .github/copilot-instructions.md) for the repo or project being changed
4. other maintained docs in `docs/**` and approved repo-level operating docs such as `README.md`,
   treated as important design and operating context but not peer authority with `docs/system/**`
5. stable implementation patterns with repeated evidence in the repo
6. research notes or speculative drafts

Agent prompts and historical behavior are inputs, not the source of truth, until promoted into
canonical docs.

If intended work materially contradicts the current documentation, surface the contradiction and ask
the user for direction before proceeding with write-capable work.

When approved feature or modification work changes intended design, behavior, or workflow policy
captured by canonical docs, the first execution slice should update the relevant canonical docs
before or alongside code or asset changes.

## Repo Rules Authority and Bootstrap Model

For the elegy-copilot first pass, repository rules are authoritative when they are captured in
canonical docs under `docs/system/**`, with per-harness instruction files (`AGENTS.md`, `CLAUDE.md`,
`GEMINI.md`, .github/copilot-instructions.md) acting as lighter-weight repo/project entrypoints
that cannot outrank those canonical docs.

- `docs/system/index.md` and `docs/system/mocs/conventions-and-governance.md` are the canonical
  discovery entrypoints for repo-rule loading
- the relevant atomic node under `docs/system/**` is the authority for the active rule family once
  identified
- the nearest applicable per-harness instruction file may summarize how that authority applies to a
  specific repo or project, but it cannot replace or override the canonical node
- write-capable planning and implementation work must load the smallest relevant canonical entrypoint
  plus the nearest applicable per-harness instruction file before editing, and write-capable leaves
  must perform that bootstrap independently instead of relying only on orchestrator briefs, plan
  packs, prompts, or summaries
- repo-local overlays such as .github/copilot-instructions.md, `.github/agents/**`, and
  `.github/skills/**` may improve discovery or routing, but they are not peer authority with
  `docs/system/**` unless a canonical doc explicitly promotes them
- agent prompts, chat history, and repeated implementation patterns are secondary evidence only; they
  may justify an inferred convention audit, but they do not become canonical repo rules until
  promoted into `docs/system/**`
- if no relevant canonical entrypoint can be identified for intended write-capable work, stop and
  surface the missing authority path or route the gap through conventions or documentation governance
  instead of silently treating prompt text or local habits as authoritative

## Thin Secondary Entrypoints

Secondary instruction surfaces should help readers reach the right canonical rule, not recreate it.

| Surface | Keep | Avoid |
|---|---|---|
| `AGENTS.md` / `CLAUDE.md` / `GEMINI.md` / .github/copilot-instructions.md | repo-local notes, precedence reminder, canonical breadcrumb | restating full governance policy |
| `README.md` | install/use overview, canonical-doc breadcrumb | becoming the repo-rules authority |
| tool instruction entrypoints (`AGENTS.md`, Copilot instructions) | workflow routing, local command hints, canonical references | duplicated convention policy that can drift |

When a rule already exists in `docs/system/**`, these surfaces should summarize in 1 sentence at
most and point back to the owning canonical node.

## Observable Rule Reliance

The repo-rules authority model is only effective when other lanes can see which canonical rules were
actually used.

- when canonical bootstrap was required, planning, execution, and review outputs should name the
  canonical doc paths they relied on
- when a per-harness instruction file informed the work, outputs should name that file separately
  from the canonical doc path
- citing only prompts, summaries, or repeated repo patterns does not satisfy repo-rule bootstrap when
  a canonical `docs/system/**` source was required
- if required write-capable work cannot identify a relevant canonical node, fail closed for that step
  and route the gap through conventions or documentation governance instead of treating local habit as
  authority
- missing rationale or smart-comment coverage may still be reported during review, but those gaps are
  findings rather than authority blockers when the canonical rule itself is already present

## Why Documentation and Smart-Comment Policy

Rationale should live at the highest-authority surface that needs to stay durable and discoverable.

Use [[self-documenting-code-and-rationale-placement]]
[self-documenting-code-and-rationale-placement.md](self-documenting-code-and-rationale-placement.md)
as the operational matrix for choosing between self-documenting code, smart comments, doc comments,
research design notes, canonical docs, ADRs, and thin instruction surfaces.

- enduring workflow policy, architectural intent, design constraints, and repo-wide or subsystem-wide
  "why" belong in canonical docs under `docs/system/**`
- planning-worthy decisions, deferred tradeoffs, unresolved questions, and findings that may drive
  later work belong in the appropriate `~/.copilot/backlogs/{repo-name}/issues/*` log or other canonical follow-up surface
- code comments are for selective local rationale that must stay next to the code to prevent
  accidental simplification, cleanup, or boundary erosion
- API and doc comments are for consumer-facing contract details at the point of use, not for
  durable policy
- comments remain subordinate to canonical docs; if a comment and `docs/system/**` disagree, the
  canonical doc wins
- missing rationale or smart comments should still be raised as review findings when future drift
  risk is high, but they are not contradiction-style hard stops and do not replace canonical
  bootstrap requirements

## Documentation Lightness

Keep documentation concise and scannable. Prefer structured formats over narrative prose.

| Pattern | Use Instead Of |
|---------|---------------|
| Table | Multi-sentence list comparing items |
| Diagram (ASCII/Mermaid) | Multi-paragraph system description |
| Code example | Abstract explanation of behavior |
| 1-sentence summary + link | Inline repetition of policy from another doc |
| Checklist | Paragraph enumerating requirements |

Rules:
- Start every section with a 1-sentence summary before expanding
- If rationale exceeds 3 sentences inline, promote to `docs/system/**` and link
- Thought-process prose (deliberation, alternatives considered) belongs in `docs/research/**`, not product docs
- Progressive disclosure: index → MOC → node, depth ≤ 2

## Default Operating Contract

The conventions governance lane should work in this sequence:

1. load the smallest relevant canonical docs entrypoint first
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
- secondary entrypoints should point downward into the canonical route instead of acting as a second
  source of truth
- progressive disclosure is a standing requirement for convention docs and entrypoints: start from
  the smallest canonical node and expand only when the current step needs more detail
- convention docs should prefer minimal routing updates over duplicate policy summaries spread across
  many files
- local flexibility is allowed only when it does not conflict with explicit canonical rules or create
  ambiguous outcomes

## Routing

Route requests here when the user asks to:

- define or revise repository conventions
- create or revise a repo/project per-harness instruction file
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

Use this structure for conventions or per-harness instruction file audits/proposals:

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
