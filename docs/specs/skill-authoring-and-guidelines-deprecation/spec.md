---
spec_id: skill-authoring-and-guidelines-deprecation
title: Skill Authoring Skills + guidelines.md Deprecation
status: draft
type: feature
updated: 2026-06-18
liveness_skip_paths:
  - engine-assets/skills/guidelines-authoring/**
  - engine-assets/skills/project-guidelines/**
---

# Skill Authoring Skills + guidelines.md Deprecation

## Intent

Add two cross-harness shared skills (`skill-authoring`, `agents-md-authoring`) that package the official OpenAI/agentskills.io guidance for creating skills and AGENTS.md files in any repo. Add code quality posture rules to the shared portable baseline so every harness inherits them. Aggressively retire the legacy `guidelines.md` surface and the two skills that govern it (`guidelines-authoring`, `project-guidelines`); do not keep compatibility shims.

## Context Evidence

- `catalog-assets/instructions/agent-session-defaults.md` is the shared portable baseline installed to all 5 harnesses; it already carries the Concise Instruction / Clarification / Planning / Review / Validation contracts but has no code quality section
- `scripts/validate-guidelines-wiring.mjs` lists `guidelines.md` as a banned term in the shared baseline — design intent is to phase the term out of installed surfaces
- `docs/system/harness-asset-flow.md` says `guidelines.md` is "standalone reference copy of the instruction writing contract (not synced to harness homes)"
- `guidelines.md` is referenced from 48+ files across the repo: AGENTS.md, all 4 per-harness appendices, multiple canonical docs, agent definitions, and 2 governing skills
- `docs/system/commit-validation-governance.md` explicitly defers "code quality beyond lint/format" to a separate governance surface that does not yet exist
- `docs/system/skills-governance.md` defines a skill quality bar that does not reference the agentskills.io open standard
- Official sources verified:
  - `https://developers.openai.com/codex/guides/agents-md` — official AGENTS.md layering/discovery/override rules
  - `https://developers.openai.com/codex/skills` — official Codex skill format/locations
  - `https://agentskills.io/specification` — open skill standard adopted by 30+ tools
  - `https://agentskills.io/skill-creation/best-practices` — best-practice authoring patterns
  - `https://github.com/openai/skills` — official 22.5k-star reference catalog
  - `https://agents.md` — official AGENTS.md website

## Requirements

### Allowed Behavior

- New `skill-authoring` shared skill packaging official agentskills.io guidance for creating skills
- New `agents-md-authoring` shared skill for creating AGENTS.md / CLAUDE.md / GEMINI.md files
- Code quality posture rules added to the shared portable baseline (`agent-session-defaults.md`)
- Both new skills wired to all 5 harness manifests and appendices with `loadMode: on-demand`
- Deleting `guidelines.md` at repo root and its two governing skills entirely (no compatibility shims)
- Removing `guidelines.md` from all shipped instructions, agent files, and canonical docs
- Updated validator checking banned-term absence, code quality section presence, and new skill existence
- Doc freshness sync with bumped `updated` frontmatter and changelog entries

### Forbidden Behavior

- Keeping compatibility shims for the deprecated `guidelines.md` surface
- Migrating the existing `code-review` deprecated compatibility surface (separate follow-up)
- Building a new orchestrator fleet or lane for skill creation (skills themselves are the deliverable)
- Converting existing skills to new format (already comply with agentskills.io frontmatter)
- Adding a custom OpenCode agent for skill creation (use `Build` agent + new `skill-authoring` skill)
- Creating a Codex-style system skill for skill creation
- Touching `docs/specs/code-quality-control-plane-research/spec.md` (separate workstream)

### R1: New `skill-authoring` shared skill

- Source: `catalog-assets/shared-skills/skill-authoring/SKILL.md`
- Format: agentskills.io spec frontmatter (`name`, `description`, optional `license`/`compatibility`/`metadata`/`allowed-tools`)
- Must cover:
  - When to create a skill vs put content in an instruction file
  - SKILL.md format and frontmatter rules (name regex, description ≤ 1024 chars, parent-dir match)
  - Description optimization (front-load triggers, scope/boundary keywords)
  - Progressive disclosure (SKILL.md <500 lines, references/ for detail, scripts/ for deterministic logic)
  - Reusable patterns: gotchas, output templates, validation loops, plan-validate-execute
  - When to bundle scripts vs instructions
  - Distribution via plugins vs direct folder install
- Must be loadable across all 5 harnesses (Copilot, Codex, OpenCode, Antigravity, Claude)

### R2: New `agents-md-authoring` shared skill

- Source: `catalog-assets/shared-skills/agents-md-authoring/SKILL.md`
- Format: agentskills.io spec frontmatter
- Must cover:
  - When to create AGENTS.md / CLAUDE.md / GEMINI.md / copilot-instructions.md
  - Discovery precedence: global → repo → directory override
  - `AGENTS.override.md` and equivalent per-harness override pattern
  - Layered scope: keep files small, push specifics to nested directories
  - Distinction from canonical docs (in `docs/system/**`) and from deprecated `guidelines.md`
  - Fallback filenames (`project_doc_fallback_filenames`)
  - Verification with `codex --ask-for-approval never "Summarize the current instructions."`
- Must reference official sources by URL

### R3: Code Quality Posture in shared baseline

- File: `catalog-assets/instructions/agent-session-defaults.md`
- Add new section `## Code Quality Posture` between `## Architecture Decisions` and `## Review Rule`
- Hard rules:
  - Always remove dead code before merging
  - Max 4 levels of nesting; use early returns / guard clauses
  - If a change requires understanding >3 files in the same diff, refactor first
  - Delete code, don't comment it out
- Heuristics:
  - Prefer the simplest solution that works
  - Keep functions focused; split when a function does more than one job
  - Add complexity only when justified by stated or measured requirements
- Add code quality flags to `## Review Rule`:
  - dead code left in place
  - unnecessary nesting / complexity
  - clever abstractions without a stated need

### R4: Wire new skills to all 5 harnesses

- Update manifests: `engine-assets/manifest.json`, `codex-assets/manifest.json`, `opencode-assets/manifest.json`, `claude-assets/manifest.json`, `antigravity-assets/manifest.json`
- Add entries for both new skills, `loadMode: on-demand`
- Update per-harness appendices to list the new skills in the skills inventory:
  - `codex-assets/home/AGENTS-appendix.md`
  - `opencode-assets/home/AGENTS-appendix.md`
  - `claude-assets/home/CLAUDE-appendix.md`
  - `antigravity-assets/home/GEMINI-appendix.md`
  - `engine-assets/copilot-instructions-appendix.md`
- Update `docs/system/skills-governance.md`:
  - Add both new skills to the planning-critical shared install set
  - Add `agentskills.io` as the canonical format reference in the quality bar section

### R5: Aggressive deprecation of `guidelines.md` (no compatibility shims)

- Delete `guidelines.md` at repo root
- Delete `engine-assets/skills/guidelines-authoring/` (whole directory)
- Delete `engine-assets/skills/project-guidelines/` (whole directory)
- Remove `guidelines.md` from all 5 per-harness authority chains (in `AGENTS.md`, all 4 per-harness appendices, `engine-assets/copilot-instructions-appendix.md`)
- Update `docs/system/harness-asset-flow.md` to drop the `guidelines.md` reference
- Update `docs/system/concise-instruction-governance.md` precedence: drop the `guidelines.md` priority level
- Update `docs/system/project-conventions-governance.md` to remove all `guidelines.md` references
- Update `docs/system/progressive-constraint-narrowing.md` to remove the `guidelines.md` reference
- Update `docs/system/documentation-structure-governance.md` to remove the `guidelines.md` reference
- Update `docs/specs/docs-specs-knowledge-system/spec.md` and `plan.md` to remove `guidelines.md` references
- Update `engine-assets/agents/code-reviewer.agent.md` and `impl.agent.md` to drop the `guidelines.md` authority level
- Update `docs/planning/skill-cleanup-followups.md` to mark this work complete

### R6: Updated validator

- File: `scripts/validate-instruction-wiring.mjs`
- Keep the `guidelines.md` banned-term check (now validates the term never appears anywhere in shipped surfaces)
- Add validation: shared baseline contains the new `## Code Quality Posture` section
- Add validation: new skills exist with agentskills.io-compliant frontmatter at the expected paths
- Update the script's purpose description to reflect the new scope (no longer about `guidelines.md` wiring; now about the shared baseline + authoring skills)

### R7: Doc freshness sync

- Bump `updated` frontmatter in all modified canonical docs per the doc freshness sync rule
- Add entries to `docs/system/instruction-changelog.md` describing the deprecation + new skills

## Non-Goals

- Migrating the existing `code-review` deprecated compatibility surface (separate follow-up)
- Building a new orchestrator fleet or lane for skill creation (the skills themselves are the deliverable)
- Converting any existing skill to a new format (existing skills already comply with agentskills.io frontmatter)
- Adding a custom OpenCode agent for skill creation (use the OpenCode-native `Build` agent + the new `skill-authoring` skill)
- Creating a Codex/Codex-style `$skill-creator` system skill (system skills are Codex-internal; the new shared skill is the installable user-facing equivalent)
- Removing `codex-assets/skills/repo-setup/SKILL.md` (it is harness-native, not a `guidelines.md` surface)
- Touching `docs/specs/code-quality-control-plane-research/spec.md` (separate workstream for the larger code quality control plane)

## Acceptance Checks

- New `skill-authoring` shared skill exists with valid agentskills.io frontmatter
  → verify: confirm the file exists and has valid frontmatter
- New `agents-md-authoring` shared skill exists with valid agentskills.io frontmatter
  → verify: confirm the file exists and has valid frontmatter
- Shared baseline has a new code quality section added
  → verify: confirm the file contains the heading
- All 5 manifests contain entries for both new skills
  → verify: grep all 5 manifest.json files for the skill names
- All 5 per-harness appendices list the new skills in their skills inventory
  → verify: read each appendix, confirm both skills are listed
- No `guidelines.md` references remain in any shipped instruction, agent, or canonical doc
  → verify: search for the term across the relevant surfaces

## Implementation Links

- `catalog-assets/instructions/agent-session-defaults.md` — add Code Quality Posture section
- `catalog-assets/shared-skills/skill-authoring/SKILL.md` — new file
- `catalog-assets/shared-skills/agents-md-authoring/SKILL.md` — new file
- 5 manifest.json files — add 2 skill entries each
- 5 per-harness appendix files — add 2 skills to inventories
- `guidelines.md` — delete
- `engine-assets/skills/guidelines-authoring/` — deleted per deprecation
- `engine-assets/skills/project-guidelines/` — deleted per deprecation
- `AGENTS.md` — drop guidelines.md authority level
- `docs/system/harness-asset-flow.md` — drop guidelines.md reference
- `docs/system/concise-instruction-governance.md` — drop guidelines.md level
- `docs/system/project-conventions-governance.md` — remove all guidelines.md references
- `docs/system/progressive-constraint-narrowing.md` — remove guidelines.md reference
- `docs/system/documentation-structure-governance.md` — remove guidelines.md reference
- `docs/system/skills-governance.md` — add new skills to install set, reference agentskills.io
- `docs/specs/docs-specs-knowledge-system/spec.md` + `plan.md` — remove guidelines.md references
- `engine-assets/agents/code-reviewer.agent.md` — drop guidelines.md reference
- `engine-assets/agents/impl.agent.md` — drop guidelines.md reference
- `docs/planning/skill-cleanup-followups.md` — mark this work complete
- `scripts/validate-instruction-wiring.mjs` — update validator

## Validation Evidence

- pending implementation

## Drift Notes

- none yet
