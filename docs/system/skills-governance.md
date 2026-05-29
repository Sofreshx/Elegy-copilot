---
created: 2026-02-23
updated: 2026-05-26
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
- Transversal meta-skills and the planning-critical shared lane are always installed on the primary harness skill path, but should still be loaded into active context only when the current step needs them.

This keeps startup context lean and makes domain loading explicit.

Installed harness surfaces and shared skills must therefore stay thin and consistent:

- durable cross-harness behavior should live in canonical docs or shared installed skills, not in ad hoc harness-only prose
- harness home instructions should point to the same rule families and avoid becoming parallel policy surfaces
- shared skills should narrow active constraints to the minimum authoritative set needed for the step instead of copying whole upstream rule sets
- if a shared skill keeps restating a standing architectural or workflow-authority rule, that rule likely belongs in a canonical node or ADR instead

## Codex operating model

Codex should stay leaner than the legacy Copilot fleet:
- Global Codex install: `AGENTS.md`, one read-only `reviewer` agent, `repo-setup`, `skill-discovery`, `stack-detector`, `rubberduck-plan-review`, `implementation-handoff`, `implementation-review`, `roadmap-planning`, `spec-dev`, `spec-authoring`, and `spec-review`.
- Repo-specific hazards: repo-local `AGENTS.md` overlays and repo-local skills.
- Legacy engine/Copilot orchestration agents are not bulk-installed into Codex.
- Cross-model reviewer agents are not part of the Codex install surface.

## OpenCode operating model

OpenCode should stay native-first rather than mirroring the Copilot fleet:
- Primary OpenCode workflow uses the built-in agents: `Build`, `Plan`, `General`, `Explore`, and `Scout`.
- Instruction-engine adds only the missing reusable skill surface: `skill-discovery`, `rubberduck-plan-review`, `roadmap-planning`, `implementation-review`, `implementation-handoff`, `spec-dev`, `spec-authoring`, `spec-review`, `security`, `project-conventions-governance`, and `stack-detector`.
- `code-review` and `refactor` remain compatibility surfaces during the transition, but they are not the recommended primary OpenCode routing path.
- Do not bulk-install Copilot orchestration agents, plan-pack/session-state authoring lanes, or other Copilot-only workflow surfaces into OpenCode.
- Do not create a parallel custom OpenCode agent fleet for code exploration or web research when the built-in `Explore` and `Scout` agents already cover that role.
- The current custom `code-explorer` and `web-searcher` subagents are transition-only compatibility aliases and should be pruned once managed stale-asset cleanup is available in the OpenCode installer.

## Spec-driven development skill posture

- `spec-dev`, `spec-authoring`, and `spec-review` install as always-available shared skills across shipped harnesses, but should still be loaded only when the current step needs spec guidance.
- Durable repo specs default to `specs/<spec-slug>/spec.md` with optional `specs/index.md`.
- Repo-local spec scaffolding is opt-in per selected repo through the existing harness installers using the `spec-driven` repo-setup profile.
- Use specs to clarify or anchor requirements before normal planning.
- Keep plan packs, roadmap flows, implementation review, and validation as the execution and evidence lanes.

## Planning-critical shared install set

- `rubberduck-plan-review`, `roadmap-planning`, `implementation-handoff`, `implementation-review`, `spec-dev`, `spec-authoring`, and `spec-review` install across Copilot, Codex, OpenCode, and Antigravity as always-available shared skills.
- Copilot-side engine planning authoring skills `planning-feature`, `planpack-authoring`, and `roadmap-authoring` also stay always installed because the planning runtime and continuation flows depend on them.

## Current always-installed meta-skills

These stay installed by default because they govern cross-cutting workflow safety or repo bootstrap:

- `core-guardrails`
- `skill-discovery`
- `implementation-friction`
- `stack-detector`
- `project-guidelines`

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
These are hidden in extension skill discovery by default:
- `refactor`

`refactor` remains in the catalog as a compatibility surface, but generic cleanup and restructuring requests should be handled directly unless the caller explicitly asks for the skill.

## Current deprecated compatibility surfaces
These remain installed only to preserve older routing and prompt references:
- `auth`: compatibility alias surface; prefer `firebase-auth` for implementation work and `security` for review.
- `code-review`: compatibility review surface retained for older routing references; prefer current reviewer/agent pathways.
- `system-cleanup`: compatibility surface for legacy task/backlog cleanup flows.

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
Use `implementation-friction` when delivery is slowed by recurring codebase pain points (e.g., shaky patterns, dead code, brittle structure).

Operational rules:
- Keep capture low-overhead: one concise log entry, then continue implementation.
- Prefer recurrence-based logging over one-off annoyance logging.
- Suggestions can be blank when root-cause analysis would derail current work.
- Log target: `~/.copilot/backlogs/{repo-name}/issues/implementation-friction-log.md`.
