---
created: 2026-02-23
updated: 2026-02-25
category: system
status: current
doc_kind: node
id: instruction-changelog
summary: Changelog for notable instruction/agent guidance updates.
tags: [changelog]
---

# Instruction Changelog

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
