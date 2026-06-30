---
created: 2026-02-23
updated: 2026-06-29
category: system
status: current
doc_kind: node
id: instruction-changelog
summary: Changelog for notable instruction/agent guidance updates.
tags: [changelog]
---

# Instruction Changelog

## 2026-06-29 - Current-state-only durable docs rule

- Added a `## Current-State Only` section to `docs/system/documentation-authoring-governance.md` so current canonical docs describe present state while change narrative routes to changelogs, release notes, migration guides, or explicitly historical docs.
- Tightened `docs/system/documentation-structure-governance.md` pruning guidance to rewrite owning sections instead of preserving "previously X, now Y", "updated to...", or "now supports..." commentary.
- Extended `docs/system/reviewer-lane-governance.md` so temporal change framing in current canonical docs is reviewed as `rule_drift`.
- Added matching concise-writing and review reminders in `docs/system/concise-instruction-governance.md` and `catalog-assets/instructions/agent-session-defaults.md`.

## 2026-06-22 - Collaboration profile with Constructive Coworker preset

- Added `## Collaboration Contract` section to the shared baseline (`catalog-assets/instructions/agent-session-defaults.md`) defining universal anti-sycophancy and critical-coworker behavior.
- Added a "Constructive Coworker" preset (`catalog-assets/presets/constructive-coworker.md`) providing attention-friendly communication preferences.
- Added collaboration profile persistence to `~/.elegy/config.json` with enabled/presetId/customInstructions fields. Defaults to enabled with the Constructive Coworker preset when no config key is present.
- Extended the composition pipeline: instruction precedence is now `shared baseline → collaboration profile (preset + custom) → harness appendix → repo-local instructions → explicit task instructions`.
- Added `GET /api/config/collaboration-profile` and `PUT /api/config/collaboration-profile` endpoints with per-harness apply results.
- Added "Collaboration Style" panel to App Settings with enable/disable, preset selector, custom instructions textarea, and save-and-apply workflow.
- Created `docs/specs/collaboration-style-profile/spec.md` and `docs/system/collaboration-profile-adr.md`.
- Updated `docs/system/concise-instruction-governance.md`, `docs/system/harness-asset-flow.md`, and the docs index for the new profile layer.

## 2026-06-18 - Skill authoring skills + guidelines.md deprecation

- Added two cross-harness shared skills in `catalog-assets/shared-skills/`:
  - `skill-authoring` — packages the [agentskills.io](https://agentskills.io/specification) format and best practices for creating portable `SKILL.md` files.
  - `agents-md-authoring` — packages the [OpenAI AGENTS.md guide](https://developers.openai.com/codex/guides/agents-md) for creating and layering per-harness instruction files.
- Both skills wired to all 5 harnesses (Copilot, Codex, OpenCode, Antigravity, Claude Code) via `manifest.json` and per-harness appendices.
- Added a `## Code Quality Posture` section to the shared baseline (`catalog-assets/instructions/agent-session-defaults.md`) with hard rules (always remove dead code, max 4 nesting levels, no >3-file diffs without refactor, no commented-out code) and heuristics (simplest solution, focused functions, justified complexity).
- The new `## Review Rule` flag list includes dead code, unnecessary nesting, and clever abstractions.
- Aggressively deprecated the `guidelines.md` per-repo surface and the two skills that governed it (`engine-assets/skills/guidelines-authoring/`, `engine-assets/skills/project-guidelines/`) — no compatibility shims.
- Removed `guidelines.md` references from all 5 per-harness authority chains, all canonical docs, all agent files, the validator, and the `copilot-ui` discovery patterns.
- Replaced `scripts/validate-guidelines-wiring.mjs` with `scripts/validate-instruction-wiring.mjs`; the old script is now a deprecation shim that forwards to the new one.
- See `docs/specs/skill-authoring-and-guidelines-deprecation/spec.md` for the full requirements.

## 2026-06-01 - elegy-copilot harness meta-cleanup

Retired features that no longer fit the meta-harness model:

- **Hook rules system** removed entirely: `hookRulesService`, routes/hooks.js, `hookRulesStore`, data/hook-rules.json, `scripts/enable-agent-hooks.{ps1,sh}`, `scripts/hooks/**`, `.github/templates/hooks.*.json`. The hook rules API (`/api/hooks/rules`) is gone. `docs/system/agent-hooks.md` retired.
- **Admin mode** removed from sidebar and settings. `navigation.adminMode` and `toggleAdmin` gone from navigation store.
- **New session creation** removed everywhere: sidebar "New Session" button, Dashboard "New Session" button + QuickStart grid + empty-state CTA, SessionWizard + steps + sessionWizardStore, `Ctrl+N` keyboard shortcut. The Dashboard now shows harness sessions inventory only.
- **SDK bridge** removed: @github/copilot-sdk dependency, `copilot-bridge/` ESM bridge package, all `/api/sdk/*` routes, `sdkHealthStore`, `SdkMessageList`, `sdkSessionsStore`. `docs/system/copilot-sdk-integration-adr.md` retired.
- **Managed CLI** removed: `cliManager.mjs`, `resources/copilot-cli/`, managed-CLI channel tracking in the desktop updater.
- **StatusBar** simplified: SDK and CLI indicators removed; only the Update slot remains. The desktop updater 404 case now degrades to "up to date" (neutral dot) instead of a red error.
- **Executor POST routes** removed: `POST /api/executor/jobs`, `POST /api/executor/jobs/:id/trigger`, `POST /api/executor/jobs/:id/cancel`, `POST /api/executor/worktrees/resolve`. The executor is now read-only.
- **Harness catalog** updated to use a flat peer-harness schema (`home` instead of `homeKey` indirection).

The `copilot` harness is now a peer alongside `codex`, `opencode`, `antigravity`, and `gemini-cli` — no special SDK/CLI treatment.

## 2026-05-25 - Progressive constraint narrowing and ADR governance across installed harnesses

- Added canonical nodes `docs/system/progressive-constraint-narrowing.md` and `docs/system/adr-governance.md`.
- Updated planning, conventions, and documentation governance docs so canonical routing now distinguishes hard constraints, shaping context, open questions, and ADR-worthy durable decisions.
- Tightened shared installed skills and harness home instructions so Codex, OpenCode, Antigravity, and Copilot all encourage the same constraint-narrowing and ADR posture after install.
- Added ADR structure validation for `docs/system/*-adr.md` and normalized the current ADR examples to the new required sections.

## 2026-05-20 - Antigravity 2 / Antigravity CLI compatibility refresh

- Added `antigravity-cli` as a supported compatibility alias for external-source MCP activation and repo-local skill mirror targeting while keeping existing `gemini-cli` state valid.
- Updated Catalog and repo docs to present the shared CLI surface as Antigravity CLI while preserving the current Gemini-compatible `.gemini` / `GEMINI.md` layout.
- Refreshed shipped Antigravity-facing guidance so installed docs refer to Antigravity 2 / Antigravity CLI without assuming a new upstream on-disk root.

## 2026-05-19 - Repo-local skill sync governance and deterministic mirror tooling

- Added canonical node `docs/system/repo-skill-sync-governance.md` defining `.github/skills/**` as the canonical repo-local skill source and .agents/skills, .opencode/skills, and .gemini/skills as deterministic mirrors.
- Replaced the temporary repo maintainer sync skills with deterministic mirror scripts so repo-local skill maintenance no longer depends on agent routing skills.
- Added explicit mirror actions `scripts/check-repo-skill-mirrors.mjs`, `scripts/install-repo-skill-mirrors.mjs`, and `scripts/update-repo-skill-mirrors.mjs` with shared target-map config `scripts/repo-skill-sync.targets.json`.
- Added prune support so full mirror reconciliation removes orphaned generated directories as well as stale content.
- Added Gemini CLI to the repo-local mirror scope alongside Antigravity using the shared `.gemini/skills/` mirror root.

## 2026-03-01 - WS2 WU-04/05 deterministic skill metadata + discovery telemetry

- Added deterministic generator `scripts/generate-skill-metadata-index.mjs` that builds `engine-assets/skills/skill-metadata-index.json` from skill frontmatter + trigger phrases + manifest metadata.
- Added `scripts/package.json` command `generate:skill-metadata-index` and deterministic generator test coverage.
- Updated `engine-assets/skills/skill-discovery/SKILL.md` metadata resolver step to consume the generated index first.
- Added command-router discovery miss telemetry (`keyword_miss`, `ambiguity`, `stale_map`, `no_route`) with bounded sampling and summary counters.
- Historical: the retired gateway status contract previously surfaced discovery telemetry.
- Added canonical node `docs/system/skill-discovery-telemetry.md` and linked it from system docs index + skills governance MOC.

## 2026-03-01 - WS2 skill discovery determinism and parity validation

- Updated `engine-assets/skills/skill-discovery/SKILL.md` with an explicit deterministic resolver chain:
	- stack detection -> keyword map -> skill metadata search -> semantic fallback
- Added multi-skill orchestration policy guidance to `skill-discovery`:
	- primary skill selection, supporting skill cap, and context budget rules
- Extended keyword mapping coverage in `skill-discovery` to include missing on-demand skills:
	- `critic`
	- `system-cleanup`
- Expanded engine-assets/skills/stack-detector/SKILL.md detection signatures for uncovered domains:
	- microsoft-agent-framework (.NET Microsoft.Agents*, Node package patterns)
	- broader openai-compatible detection (Azure.AI.OpenAI, OpenAI, Node/Python/Go package signals)
- Added map parity validator and smoke test:
	- `scripts/validate-skill-discovery-map.js`
	- `scripts/validate-skill-discovery-map.test.js`
- Wired validator into automation:
	- `scripts/package.json` script `validate:skill-discovery-map`
	- `.vscode/tasks.json` task `validate: skill discovery map`
	- .github/workflows/extension-ci.yml PR path triggers and WS6-E1 validation command pack

## 2026-03-01 — WS1 documentation discovery and routing hardening

- Added a `Documentation Discovery Protocol` section to both canonical instruction mirrors:
	- `engine-assets/copilot-instructions.md`
	- .github/copilot-instructions.md
- The protocol now routes discovery through `docs/system/index.md` -> MOCs -> canonical nodes.
- Added explicit precedence guidance: `docs/system/**` is canonical and overrides conflicting `docs/research/**` inputs.
- Enriched key MOCs with routing sections (`When to read`, `Start here`, `See also`, `Depends on`) to improve progressive disclosure.
- Added canonical node `docs/system/research-promotion-checklist.md` with promotion criteria, practical checklist, and required evidence fields.
- Linked the checklist from `docs/system/index.md` and from MOCs for skills governance and orchestration.
- Added `Related docs` blocks to high-impact skills:
	- `engine-assets/skills/skill-discovery/SKILL.md`
	- `engine-assets/skills/security/SKILL.md`
	- engine-assets/skills/testing-dotnet-unit/SKILL.md
	- engine-assets/skills/testing-frontend-unit/SKILL.md

## 2026-03-01 — System upgrade direction published and wired into docs graph

- Added canonical strategy node `docs/system/system-upgrade-direction-2026.md`.
- Captured deep, phased modernization direction across documentation discovery, skill discovery, orchestration contracts, and file-first memory evolution.
- Added architecture diagrams and validation/rollout guidance for the upgrade program.
- Refined the strategy to be implementation-first, adding concrete work-unit backlogs per theme with file-level targets and acceptance checks.
- Added explicit implementation sequencing/dependency rules and theme-level acceptance gates to prevent docs-only execution.
- Updated graph navigation links in:
	- `docs/system/index.md`
	- `docs/system/mocs/orchestration-and-agents.md`
	- `docs/system/mocs/skills-governance.md`
	- `docs/system/mocs/session-state.md`
	- `docs/system/mocs/software-design-concepts.md`

## 2026-02-27 — Core guardrails made mandatory in asset pipeline

- Added `engine-assets/skills/core-guardrails/SKILL.md` to hold non-negotiable execution safety rules.
- Added `core-guardrails` to shipped allowlist and canonical manifest assets.
- Updated `scripts/generate-cli-manifest.mjs` to force-include mandatory allowlist items (currently `core-guardrails`).
- Updated `scripts/validate-manifest.js` to fail if required assets (`copilot-instructions`, `skill-core-guardrails`) are missing.
- Updated `scripts/validate-doc-graph.js` to enforce mirrored token/parity checks for the critical `run_in_terminal` background-safety section.

## 2026-02-25 — G-05-WU-05 final gate + waiver precedence enforced

- Added deterministic `Final Gate Controls` validation to `scripts/validate-planpack.js`.
- Final required controls now enforced per-control: `evidencePredicates`, `finalGateWaiverPrecedence`, `trustedEvidenceBindingRetention`.
- Waivers now apply only to explicitly scoped controls; scope mismatch is a hard failure.
- Waived controls now require release-linked audit trail fields (`Waiver Release`, `Waiver Audit`) for traceability.
- Documented the table contract and algorithm in `docs/system/planpack-spec.md`.

## 2026-02-25 — Temp File Safety Controls added

- Added `## Temp File Safety Controls` section with anchor `temp-file-safety-controls-v1`.
- Control tokens: TMP-CTRL-001 through TMP-CTRL-006 covering sanctioned dirs, null-device prohibition, .gitignore coverage, cleanup, secrets prohibition, and audit trail preference.
- Mirrored in both `engine-assets/copilot-instructions.md` (canonical) and .github/copilot-instructions.md (mirror).
- Added sanctioned temp roots to `.gitignore`.

## 2026-02-22
- Standardized browser E2E on `agent-browser` (via `@e2e-validator` → `@e2e-browser`) and added a canonical E2E setup guide.
- Fixed broken E2E doc links and clarified Playwright usage as suite-based (CLI) rather than MCP.

## 2026-02-07
- Updated testing-executive: E2E decision tree, expanded subagent usage, MCP readiness checks, and richer output guidance.
- Updated E2E guidance: preserve scripted suites, apply .instructions/e2e.config.md overrides, and respect integrated browser/screenshot policies.
