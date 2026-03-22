---
created: 2026-02-23
updated: 2026-02-27
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
- The majority of skills stay vault-first and on-demand; only transversal meta-skills remain always loaded.

This keeps startup context lean and makes domain loading explicit.

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
- `debug`
- `docs`
- `refactor`
- `design`

`refactor` remains in the catalog as a compatibility surface, but generic cleanup and restructuring requests should be handled directly unless the caller explicitly asks for the skill.

## Current deprecated compatibility surfaces
These remain installed only to preserve older routing and prompt references:
- `auth`: compatibility alias surface; prefer `firebase-auth` for implementation work and `security` for review.
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
- Log target: `docs/issues/implementation-friction-log.md`.
