---
created: 2026-07-10
updated: 2026-07-10
category: research
status: current
doc_kind: node
id: ui-craft-source-review
summary: Provenance and adoption review for the research sources behind elegy-ui-craft.
tags: [ui, ux, research, provenance, impeccable, elegy-ui-craft]
related: [award-winning-uiux-research-foundation, ui-development-governance, catalog-control-plane]
---

# UI Craft Source Review

## Sources

| Source | Provenance | Use |
|---|---|---|
| [Award-Winning UI/UX Research Foundation](award-winning-uiux-research-foundation.md) | User-supplied research, dated 2026-07-09 | Category recipes, design-system practices, evidence gates, and scoring dimensions |
| Impeccable 3.9.1 | `pbakaus/impeccable`, tag `skill-v3.9.1`, commit `44c27a72af98394c32691ba79358811bff86bde6`, Apache-2.0 | Prior-art review for UI critique language and deterministic detector concepts |

## Adoption Decisions

- Adopt inventory-first work, explicit visual direction, evidence-backed critique, scoped deterministic findings, and iterative repair.
- Reimplement useful detector concepts as governed Elegy rules with stable IDs and reasoned suppressions.
- Keep generated images as optional direction probes; they do not define interactions, responsiveness, content, or accessibility.
- Reject project-writing hooks, implicit vendor updates, pin/unpin shortcuts, and vendor-specific runtime state.
- Reject visual-only accessibility claims and one-size-fits-all aesthetic prescriptions.

## Replacement Map

| Retired surface | Replacement |
|---|---|
| UI implementation inventory skill | `elegy-ui-craft@elegy` inspect and guided implementation workflow |
| UI runtime exploration skill | UI Craft target/lane selection and evidence capture |
| UI visual review skill | UI Craft evidence-backed audit and review |
| Vendored Impeccable package | Elegy-owned rules plus this attribution record |

## Distribution Boundary

Research is evidence, not executable policy. The plugin ships concise operational references and
Elegy-owned implementations; it does not redistribute the retired Impeccable package. Managed
cleanup may prune a legacy installed asset only when an Elegy install receipt proves ownership.
Untracked user-local skills must be preserved and reported.

## Implementation Coverage

| Research requirement | Elegy UI Craft output | Verification |
|---|---|---|
| Category-specific visual direction | `ui-brief.schema.json`, category references, `theme generate` | Contract tests cover supported categories and deterministic output |
| Tokenized, coherent visual system | `ui-theme.schema.json`, generated semantic color/type/spacing/motion tokens | `theme generate` output is deterministic for the same brief and seed |
| Evidence-backed review | `ui-scorecard.schema.json`, `audit`, `check` and evidence references | Plugin contract and CLI tests validate report contracts |
| WCAG-aware semantic contrast | `contrast` command and semantic pair report | Contract test verifies ratios and failed thresholds |
| Avoid generic decorative patterns | Stable audit rules for transition-all, outline removal, important, gradient text, repeating stripes, side stripes, and over-rounded surfaces | Audit contract tests assert the rule IDs and suppression compatibility |

The plugin deliberately does not claim screenshot-only accessibility compliance, mutate project files,
install project hooks, or depend on an implicit external vendor update.
