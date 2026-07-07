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
3. Run `elegy-checks audit --repo <root> --json`.
4. Run `elegy-checks discover --repo <root> --json`.
5. Run `elegy-checks ci-map --repo <root> --scope pr --json`.
6. Run `elegy-checks ci-map --repo <root> --scope main-push --json`.
7. Report found checks, CI gaps, disabled checks, missing local proof, and advisory findings.

## Rules

- Do not call GitHub Actions for v1 audit.
- Do not treat advisory checks as merge blockers.
- Prefer adding local deterministic proof before recommending remote CI changes.
- Use `elegy-checks packs list --json` when explaining which built-in check-pack produced a recommendation.
