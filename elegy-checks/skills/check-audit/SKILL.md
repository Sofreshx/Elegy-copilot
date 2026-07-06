---
name: check-audit
description: "Audit local repository check coverage through the elegy-checks CLI. Use when asked to evaluate what checks exist, what is missing, or whether local CI parity is covered."
tags: [checks, validation, ci, audit]
---

# Check Audit

Use `elegy-checks` as the authority.

## Workflow

1. Confirm the target repo root.
2. Run `elegy-checks validate --repo <root> --json`.
3. Run `elegy-checks discover --repo <root> --json`.
4. Run `elegy-checks ci-map --repo <root> --scope pr --json`.
5. Run `elegy-checks ci-map --repo <root> --scope main-push --json`.
6. Report found checks, CI gaps, disabled checks, and missing local proof.

## Rules

- Do not call GitHub Actions for v1 audit.
- Do not treat advisory checks as merge blockers.
- Prefer adding local deterministic proof before recommending remote CI changes.
