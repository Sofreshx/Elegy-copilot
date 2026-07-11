# Spec Review Checks

1. Verify the spec conforms to the normative spec contract at `docs/specs/spec-driven-development-contract/spec.md` — all required frontmatter, headings, and structural rules.
2. Check whether `Intent` matches the actual problem.
3. Check whether `Context Evidence` is strong enough to justify the requirements.
4. Look for ambiguous, untestable, or conflicting requirements.
5. Look for missing `Non-Goals` where scope creep is likely.
6. Check whether each `Acceptance Check` has a concrete verification method (`→ verify:` line with a test command, script, or manual step) and whether vague language (e.g., "good", "proper", "robust") is absent. See normative spec R4.
7. Prefer deterministic proof when it is feasible. If an important check stays manual, confirm the limitation is explicit rather than silently treated as equivalent to a runnable proof.
8. If the spec uses optional `→ check:` metadata, verify the `determinism`, `phase`, and `gate` values match the actual intended use. See normative spec R4.5-R4.9.
9. Check whether `Implementation Links`, `Validation Evidence`, and `Drift Notes` match the current status.
10. Check whether the spec hides a key architectural or workflow-authority decision that should be promoted to an ADR. See normative spec R13.
11. Confirm the spec complements normal planning rather than replacing plan-pack, roadmap, or implementation review flows.
12. **Artifact liveness check:** Verify that each file path in `Context Evidence` and `Implementation Links` resolves to an existing repo file. Run `node scripts/validate-specs-artifact-liveness.js` (dormant — spec validation is not enforced) or `node scripts/validate-specs.js --strict` (dormant research tool — not enforced) for the automated check.
13. **Cross-spec relationships:** Check whether the spec declares its relationship to any other spec (via `supersedes`, `superseded_by`, or `Drift Notes`). If the spec supersedes an existing spec, confirm the older spec's status is being updated and the chain is acyclic. See normative spec R7.
14. **Sibling plan.md:** If the spec has 5+ requirements or 2+ phases, confirm a sibling `plan.md` exists alongside `spec.md`. The spec validator (`validate-specs.js --strict`) (dormant research tool — not enforced) produces an advisory warning (not a hard error) when this condition is not met. If planning is intentionally deferred, require `Drift Notes` to name the later phase or owner. See normative spec R8.
15. **ADR cross-reference:** If the spec governs a trust boundary, authority model, or architecture-level tradeoff, confirm an ADR exists in `docs/system/` and is referenced in `Context Evidence`. See normative spec R13.
16. **Pre-commit hook (removed June 2026):** The spec pre-commit hook was removed as part of the June 2026 spec validation rollback. If cleaning up, `node scripts/install-spec-hooks.mjs` can remove any remaining hook files.
17. **Allowed/Forbidden Behavior:** Confirm the spec has concrete `### Allowed Behavior` and `### Forbidden Behavior` subsections under `## Requirements`, and they cover the spec's boundary conditions and error states. See normative spec R5.
18. **Spec-to-planning handoff:** If the spec is `approved`, confirm it links to an active plan or work point (via `Implementation Links`, file-scope selector per normative spec R10, or a planning insight). Draft specs may defer this; approved specs must have it.
