---
name: docs-practice
description: "Documentation and spec structure standards. Use to audit, fix, or create READMEs, canonical docs, specs, and ADRs. Triggers on: fix README, audit docs, documentation structure, spec format, ADR format, docs practice, readme structure."
metadata: {"tags":["documentation","readme","specs","adr","governance"]}
---

# Documentation Practice

## Artifact Roles

| Artifact | Mode | Describes | Answers |
|----------|------|-----------|---------|
| README | Entrypoint | What this is and how to start | "Where do I begin?" |
| Docs | State | How the system currently works | "How does it work?" |
| Spec | Intent | What the system should do | "What should it do?" |
| ADR | Decision | What was chosen and why | "Why this way?" |

## README Rules

Purpose: orient a new reader in < 2 minutes.

Structure: intro → install → quick start → links.

- One-liner describing what this is
- Install/getting started section
- Links to canonical docs, contributing, license
- No architecture deep-dive (link to it)
- No ops runbook (link to it)
- No policy duplication (link to it)
- ~100-150 lines for most repos

## Docs Rules

Purpose: describe current system state.

- Enter through index → MOC → smallest canonical node
- Each doc answers one question
- Frontmatter: created, updated, category, status, doc_kind, id, summary, tags, related
- Concise, map-like, scoped to stated purpose
- Link to canonical sources instead of duplicating policy
- Keep updated date current

## Spec Rules

Purpose: describe intent (requirements contract).

- Spec = intent, not state
- Use the spec template for the artifact type
- Context Evidence justifies intent, doesn't describe state
- Lifecycle: draft → approved → implemented → superseded/abandoned
- See `spec-authoring` skill for detailed guidance

## ADR Rules

Purpose: record architectural decisions.

- Only for key architectural, trust-boundary, workflow-authority decisions
- Required: Context, Decision, Consequences
- Durable and rarely changed
- Not for routine implementation choices

## Anti-Patterns

- README as catch-all policy doc
- Specs describing current state instead of intent
- Docs describing intent instead of state
- ADRs for routine implementation choices
- Duplicating canonical policy in multiple places
- Missing frontmatter or stale updated dates

## References

- Diátaxis: https://diataxis.fr/
- Google style guide: https://developers.google.com/style
- Microsoft style guide: https://learn.microsoft.com/en-us/style-guide/
