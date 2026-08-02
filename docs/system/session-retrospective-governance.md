---
created: 2026-08-01
updated: 2026-08-01
category: system
status: current
doc_kind: node
id: session-retrospective-governance
summary: Codex-native evidence, customization inventory, and proposal boundaries for task and session retrospectives.
tags: [session, retrospective, codex, output, governance]
related: [structured-output-contracts, session-state-artifacts, follow-up-discovery-governance, workflow-planning-contract, codex-workflow-improvement-governance]
---

# Session Retrospective Governance

## Purpose

Define the v2 contract for an explicitly requested Codex task-workflow
retrospective. The evaluator inventories the effective Codex setup before it
recommends a change. This node governs the `evaluate-task-workflow` skill's
output; it does not create a new session, planning, memory, or UI authority.

## Canonical contract

The normative TypeScript contract is `contracts/src/sessionRetrospective.ts`,
exported by `contracts/src/index.ts`. New output uses
`session-retrospective-v2` with `schemaVersion: "2"`; parsing remains backward
compatible with existing v1 responses. The Codex skill is registered as
`codex-evaluate-task-workflow-skill` and emits the
[`SESSION_RETROSPECTIVE`](structured-output-contracts.md#session_retrospective-contract)
block.

The response contains a human-readable block followed by fenced JSON under a
`Structured State` label. The JSON is the machine-readable contract and must
include:

- `kind`: `session.retrospective.single` or `session.retrospective.aggregate`
- `source`: `{ harness: "codex", taskIds, repoIds, completeness }`, where
  `completeness` is `complete`, `partial`, or `unavailable`
- `recap`: `summary`, `delivered`, and `requested`
- `strengths` and `frictions` assessments, each with a stable signal key,
  summary, perspective, confidence, and bounded `evidenceRefs`
- `customizationInventory`, recording the supported surface, observed status,
  scope, owner, bounded evidence, and limitations
- `improvementCandidates`, keyed only by the stable signal keys
  `planning_overhead`, `authority_duplication`, `context_loss`,
  `tool_friction`, `handoff_friction`, `validation_friction`,
  `coordination_friction`, `scope_drift`, `feedback_gap`, or `other`
- `uncertainty` (`biggestMissing` and `leastConfident`) and
  `requiresUserDecision`

Each improvement candidate is a proposal with `status: proposed`. Its target
names the surface, scope, owner, action, automation posture, and feasibility.
It also explains why that surface fits, rejected alternatives, expected
impact, risks, validation, confidence, and bounded evidence references.

Aggregate results additionally carry `children` and `repeatedSignals`. Counts
must derive from the referenced child reports and stable signal keys, not from
similarity in prose.

## Invocation and persistence boundary

The first release is manual-only and on-demand. It must not be implicitly invoked by
ordinary task completion, review, planning, or session close. The skill is
response-only: the skill returns content and does not write `plan.md`,
`proposition.md`, `execution-state.json`, backlog/roadmap records, or a UI
artifact. It also does not mutate `elegy-planning` or promote an improvement
candidate. If a user later requests persistence or promotion, the orchestrator
must route that request through the owning markdown-writing or planning
materialization lane and obtain the authority-specific approval required there.

## Source and identity bounds

- Callers must supply an exact task/thread selector: one task/session for a single result,
  or an explicit same-repository list (at least two) for an aggregate. Source
  evidence is limited to user-supplied or explicitly authorized structured
  artifacts and excerpts; raw conversation text, secrets, environment dumps,
  and unrelated files are out of scope. The skill must report
  `completeness=partial` or `unavailable` when context is missing; it must not
  invent transcript, tool, validation, or delivery evidence.
- `taskIds` and `repoIds` are opaque references supplied by the host/runtime or
  explicitly present in the selected context. They are evidence references,
  not authorization grants.
- When sources disagree, precedence is explicitly supplied artifact/excerpt,
  trusted structured runtime/host state, then a derived summary/fingerprint;
  conflicts downgrade confidence and remain visible in `uncertainty`.
- Reads are bounded to the current user/session and same-repository context.
  A client-supplied identity or repository identifier must not broaden the
  read scope, and cross-repository or unrelated-session evidence is denied or
  omitted rather than merged.
- The `perspective` field distinguishes self-reported reflection from
  host-observed evidence; neither is a substitute for authenticated actor
  identity. Do not infer personal identity, sensitive attributes, or ownership
  from prose.
- The deterministic collector uses only stable app-server methods:
  `thread/read`, `thread/goal/get`, `config/read`, `configRequirements/read`,
  `skills/list`, `hooks/list`, and `mcpServerStatus/list`. It does not use
  experimental plugin APIs, SQLite, rollout files, or unstable transcript
  parsing. Filesystem discovery is limited to the active `AGENTS.md` chain and
  applicable custom-agent TOML roots.
- Collector output is allowlisted, redacted, deterministic, and capped at 512
  KiB. It distinguishes configured, discovered, enabled, callable, and
  policy-blocked state.

## Authority boundaries

The retrospective is a diagnostic summary only:

1. Session runtime state remains the live authority; session artifacts remain
   persistence/projection surfaces under
   [Session State Artifacts](session-state-artifacts.md).
2. Active goal completion and unresolved-goal carryover remain governed by
   `goal-contract-governance` and `follow-up-discovery-governance`.
3. Durable roadmap/work-point planning remains owned by
   `elegy-planning` under `workflow-planning-contract` and the planning/backlog
   authority docs.
4. Retrospective findings may be offered as follow-up suggestions, but only a
   separately approved workflow may normalize, persist, or promote them.

No retrospective output can override these authorities, close a goal, mark
validation as passed, or authorize a write, merge, push, or promotion.

## Customization routing

Route recommendations to the narrowest supported owner:

- session preferences stay in prompt/thread context;
- repeated personal behavior may target global `AGENTS.md`, while repository
  policy targets the nearest repo or nested `AGENTS.md`;
- reusable procedures target skills; independent specialized work targets an
  existing agent unless no role can own it;
- deterministic lifecycle behavior targets documented Codex hooks;
- model, sandbox, permissions, concurrency, features, MCP, and hook settings
  target effective config only after resolved layers and requirements are
  inspected;
- external live systems target MCP/apps; recurring execution targets a
  scheduled task only after the manual evaluator and trust gates pass;
- mechanically enforceable repository rules target tests, CI, linters, or
  pre-commit checks;
- product-owned unavailable behavior is escalated as product feedback;
- generated memory is never policy authority, and deprecated custom prompts
  are never recommended.

Prefer modifying a compatible existing instruction, skill, agent, or hook over
creating a duplicate. Plugin packaging and dashboard projection are later
distribution/view layers, not foundations for local Codex history access.

## Failure and validation posture

Malformed or incomplete source context fails soft into an explicit
`partial`/`unavailable` result with uncertainty recorded. It must not fabricate
empty success evidence. Contract consumers should validate the schema version,
enum values, stable signal keys, and child references before using an
aggregate.

Focused checks are the Codex receipt validator and the contracts tests for
`sessionRetrospective`; broader session/UI/planning checks remain owned by
their canonical nodes and are not implied by this response-only contract.
