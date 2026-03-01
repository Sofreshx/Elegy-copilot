---
created: 2026-02-23
updated: 2026-03-01
category: system
status: current
doc_kind: node
id: instruction-changelog
summary: Changelog for notable instruction/agent guidance updates.
tags: [changelog]
---

# Instruction Changelog

## 2026-03-01 - WS2 WU-04/05 deterministic skill metadata + discovery telemetry

- Added deterministic generator `scripts/generate-skill-metadata-index.mjs` that builds `engine-assets/skills/skill-metadata-index.json` from skill frontmatter + trigger phrases + manifest metadata.
- Added `scripts/package.json` command `generate:skill-metadata-index` and deterministic generator test coverage.
- Updated `engine-assets/skills/skill-discovery/SKILL.md` metadata resolver step to consume the generated index first.
- Added command-router discovery miss telemetry (`keyword_miss`, `ambiguity`, `stale_map`, `no_route`) with bounded sampling and summary counters.
- Extended gateway status contract to surface discovery telemetry in `runtime.discoveryTelemetry`, including contract version, counters by reason, and sampled buffer metadata.
- Added canonical node `docs/system/skill-discovery-telemetry.md` and linked it from system docs index + skills governance MOC.

## 2026-03-01 - WS2 skill discovery determinism and parity validation

- Updated `engine-assets/skills/skill-discovery/SKILL.md` with an explicit deterministic resolver chain:
	- stack detection -> keyword map -> skill metadata search -> semantic fallback
- Added multi-skill orchestration policy guidance to `skill-discovery`:
	- primary skill selection, supporting skill cap, and context budget rules
- Extended keyword mapping coverage in `skill-discovery` to include missing on-demand skills:
	- `critic`
	- `system-cleanup`
- Expanded `engine-assets/skills/stack-detector/SKILL.md` detection signatures for uncovered domains:
	- `microsoft-agent-framework` (.NET `Microsoft.Agents*`, Node package patterns)
	- broader `openai-compatible` detection (`Azure.AI.OpenAI`, `OpenAI`, Node/Python/Go package signals)
- Added map parity validator and smoke test:
	- `scripts/validate-skill-discovery-map.js`
	- `scripts/validate-skill-discovery-map.test.js`
- Wired validator into automation:
	- `scripts/package.json` script `validate:skill-discovery-map`
	- `.vscode/tasks.json` task `validate: skill discovery map`
	- `.github/workflows/extension-ci.yml` PR path triggers and WS6-E1 validation command pack

## 2026-03-01 — WS1 documentation discovery and routing hardening

- Added a `Documentation Discovery Protocol` section to both canonical instruction mirrors:
	- `engine-assets/copilot-instructions.md`
	- `.github/copilot-instructions.md`
- The protocol now routes discovery through `docs/system/index.md` -> MOCs -> canonical nodes.
- Added explicit precedence guidance: `docs/system/**` is canonical and overrides conflicting `docs/research/**` inputs.
- Enriched key MOCs with routing sections (`When to read`, `Start here`, `See also`, `Depends on`) to improve progressive disclosure.
- Added canonical node `docs/system/research-promotion-checklist.md` with promotion criteria, practical checklist, and required evidence fields.
- Linked the checklist from `docs/system/index.md` and from MOCs for skills governance and orchestration.
- Added `Related docs` blocks to high-impact skills:
	- `engine-assets/skills/skill-discovery/SKILL.md`
	- `engine-assets/skills/security/SKILL.md`
	- `engine-assets/skills/testing-dotnet-unit/SKILL.md`
	- `engine-assets/skills/testing-frontend-unit/SKILL.md`

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
- Mirrored in both `engine-assets/copilot-instructions.md` (canonical) and `.github/copilot-instructions.md` (mirror).
- Added sanctioned temp roots to `.gitignore`.

## 2026-02-22
- Standardized browser E2E on `agent-browser` (via `@e2e-validator` → `@e2e-browser`) and added a canonical E2E setup guide.
- Fixed broken E2E doc links and clarified Playwright usage as suite-based (CLI) rather than MCP.

## 2026-02-07
- Updated testing-executive: E2E decision tree, expanded subagent usage, MCP readiness checks, and richer output guidance.
- Updated E2E guidance: preserve scripted suites, apply `.instructions/e2e.config.md` overrides, and respect integrated browser/screenshot policies.
