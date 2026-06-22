---
created: 2026-02-23
updated: 2026-06-18
category: system
status: current
doc_kind: node
id: skills-governance
summary: Rules and practices to keep skills high-signal and prevent drift.
tags: [skills, governance]
---

# Skill Governance and Drift Prevention

## Purpose
Keep skills high-signal and avoid overfitting generic behavior into heavy skills.

## Search/Execute operating model

Use staged capability routing by default:
- `@search` resolves the smallest relevant capability across docs, agents, and skills.
- `@execute` converts that capability into a compact downstream brief.
- The majority of skills stay vault-first and on-demand.
- Transversal meta-skills stay on the primary harness skill path. Shared planning/review/spec skills are shipped across harnesses, but Copilot keeps most of them vault-first so they are loaded only when the current step needs them.

This keeps startup context lean and makes domain loading explicit.

Installed harness surfaces and shared skills must therefore stay thin and consistent:

- durable cross-harness behavior should live in canonical docs or shared installed skills, not in ad hoc harness-only prose
- harness home instructions should point to the same rule families and avoid becoming parallel policy surfaces
- shared skills should narrow active constraints to the minimum authoritative set needed for the step instead of copying whole upstream rule sets
- if a shared skill keeps restating a standing architectural or workflow-authority rule, that rule likely belongs in a canonical node or ADR instead

## Codex operating model

Codex should stay leaner than the legacy Copilot fleet:
- Global Codex install: `AGENTS.md`, one read-only `reviewer` agent, `repo-setup`, `skill-discovery`, `stack-detector`, `rubberduck-plan-review`, `implementation-handoff`, `implementation-review`, `planning-tools`, `spec-dev`, `spec-authoring`, and `spec-review`.
- Codex uses a stricter `implementation-handoff` variant for explicit delegation. It deepens shallow
  plans and requires `rubberduck-plan-review` for complex or incomplete source plans before
  producing a downstream executor brief. Other harnesses retain the shared handoff contract.
- Repo-specific hazards: repo-local `AGENTS.md` overlays and repo-local skills.
- Legacy engine/Copilot orchestration agents are not bulk-installed into Codex.
- Cross-model reviewer agents are not part of the Codex install surface.

## OpenCode operating model

OpenCode should stay native-first rather than mirroring the Copilot fleet:
- Primary OpenCode workflow uses the built-in agents: `Build`, `Plan`, `General`, `Explore`, and `Scout`.
- elegy-copilot adds the lane agent surface (`quick`, `project`) as OpenCode-native primary agents with supporting subagents (`impl`, `reviewer`, `explorer`, `scout`). Lane agents are workflow-enforcing agents, not Copilot fleet duplicates — they use OpenCode's native agent infrastructure and delegate to subagents for execution.
- elegy-copilot adds the missing reusable skill surface: `skill-discovery`, `rubberduck-plan-review`, `planning-tools`, `project-workflow`, `implementation-review`, `implementation-handoff`, `spec-dev`, `spec-authoring`, `spec-review`, `security`, `project-conventions-governance`, and `stack-detector`.
- `code-review` remains a compatibility surface during the transition, but it is not the recommended primary OpenCode routing path.
- Do not bulk-install Copilot orchestration agents, plan-pack/session-state authoring lanes, or other Copilot-only workflow surfaces into OpenCode.
- Do not create a parallel custom OpenCode agent fleet for code exploration or web research when the built-in `Explore` and `Scout` agents already cover that role. (The lane subagents `impl`, `reviewer`, and `explorer` serve specific lane workflow phases and do not constitute a parallel fleet.)
- The current custom `code-explorer` style aliases are transition-only compatibility surfaces and should not grow into a parallel OpenCode agent fleet.

## Spec-driven development skill posture

- `spec-dev`, `spec-authoring`, and `spec-review` ship across target harnesses, but should still be loaded only when the current step needs spec guidance.
- Durable repo specs default to `docs/specs/<spec-slug>/spec.md` with optional `docs/specs/index.md`.
- Repo-local spec scaffolding is opt-in per selected repo through the existing harness installers using the `spec-driven` repo-setup profile.
- Use specs to clarify or anchor requirements before normal planning.
- Keep plan packs, roadmap flows, implementation review, and validation as the execution and evidence lanes.

## Planning-critical shared install set

- `rubberduck-plan-review`, `planning-tools`, `project-workflow`, `implementation-handoff`, `implementation-review`, `spec-dev`, `spec-authoring`, `spec-review`, `skill-authoring`, and `agents-md-authoring` ship across Copilot, Codex, OpenCode, and Antigravity.
- Copilot keeps those shared planning/review/spec skills vault-first by default, except where a target harness has no separate vault path.
- Copilot-side `roadmap-authoring` stays always installed because planning and continuation flows depend on it.

## Current always-installed meta-skills

These stay installed by default because they govern cross-cutting workflow safety or repo bootstrap:

- `core-guardrails`
- `skill-discovery`
- `roadmap-authoring`
- `stack-detector`

## Triage model
Classify each skill as one of:
- **Core**: required project-specific patterns and hard constraints.
- **Specialized**: external framework/runtime rules that are easy to misuse.
- **Default-handled**: generic reasoning tasks already well handled by base models.
- **Deprecated**: kept for compatibility, hidden by default.

Routing policy for the last two classes:
- **Default-handled** skills stay available for explicit opt-in or compatibility needs, but normal routing should let the base model handle the work directly.
- **Deprecated** skills are compatibility surfaces only and should load only on explicit request or when older prompts/docs still depend on them.

In `engine-assets/manifest.json`, governance annotations for these classes are descriptive only. They document the approved routing posture, but current runtime/catalog/search consumers do not enforce those manifest labels directly.

## Current default-handled set
No default-handled skill surfaces are currently shipped in the lean first-party engine set. Generic cleanup and restructuring requests should be handled directly unless a target repo provides a narrower skill.

## Current deprecated compatibility surfaces
These remain installed only to preserve older routing and prompt references:
- `code-review`: OpenCode compatibility review surface retained for older routing references; prefer current reviewer/agent pathways.

Setting to show them:
- `skillInstaller.skills.showDefaultHandled = true`

## Recurrence detection for generalized issues
When an issue repeats across sessions, capture:
1. Trigger pattern (symptom)
2. Root cause
3. Deterministic remediation
4. Validation command

Store this either as:
- a focused skill update (if domain-specific), or
- an orchestration rule (if workflow/systemic).

## Skill quality bar
A skill should include:
- explicit when-to-use triggers,
- concrete constraints and anti-patterns,
- deterministic validation steps,
- minimal but realistic examples.

## Skill format
Skills follow the [Agent Skills open standard](https://agentskills.io/specification) — `name`
and `description` frontmatter, optional `license`, `compatibility`, `metadata`, `allowed-tools`,
followed by a Markdown body under 500 lines. This format works in Codex, Claude Code, OpenCode,
Cursor, and 30+ other tools. The `skill-authoring` shared skill packages the full authoring
rules; the `agents-md-authoring` shared skill packages the related per-harness instruction-file
rules.

## Canonical docs policy
For specialized skills, include a `Canonical References` section with official docs links and version notes.
Use references conditionally:
- when runtime behavior differs by version,
- when APIs changed recently,
- when security/compliance details are critical.

## Pruning policy
A skill is a prune/deprecate candidate if:
- it duplicates base-model behavior,
- it has no project-specific constraints,
- it is rarely invoked and yields no quality delta.

Prefer **hide/deprecate** before deletion to preserve backward compatibility.

## Implementation friction capture
Capture recurring delivery pain when codebase structure slows implementation (e.g., shaky patterns, dead code, brittle structure).

Operational rules:
- Keep capture low-overhead: one concise log entry, then continue implementation.
- Prefer recurrence-based logging over one-off annoyance logging.
- Suggestions can be blank when root-cause analysis would derail current work.
- Use a user-requested tracking surface, or `~/.copilot/backlogs/{repo-name}/issues/implementation-friction-log.md` when that backlog family is active.
