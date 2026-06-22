---
created: 2026-06-21
updated: 2026-06-21
category: system
status: current
doc_kind: node
id: ui-development-governance
summary: Governed stack-neutral UI workflow: spec → inventory → implement → evidence → visual review → patch → regression proof.
tags: [ui, governance, workflow, skills]
related: [skills-governance, copilot-ui-guide, reviewer-lane-governance, spec-driven-development]
---

# UI Development Governance

## Purpose

Define a stack-neutral, evidence-gated UI workflow that works across browser, desktop, and
component-only surfaces. The workflow anchors on repo-owned design systems and validation
commands — never on a mandated framework, library, or external registry.

## Workflow

```
brief → structured UI spec → local inventory → implementation
      → runtime evidence → visual review → patch → regression proof
```

| Phase | Responsible skill | Output |
|-------|------------------|--------|
| Spec | `ui-design-spec` | Structured spec: target, viewports, states, task, inventory, acceptance criteria |
| Inventory | `ui-system` | Existing component, token, icon, and layout-pattern citations |
| Implementation | `ui-system` + implementation lane | Code changes with evidence references |
| Evidence | Runtime lane (browser, desktop, or component) | Screenshots, console output, network logs |
| Visual review | `ui-visual-review` | Defect report: hierarchy, layout, component, UX, a11y, aesthetic |
| Regression proof | Repo-owned validation commands | Pass/fail on declared validation lane |

## Required Evidence Per Change

Every UI change must declare a **validation lane** and produce **runtime evidence**:

| Lane | Evidence | Gap |
|------|----------|-----|
| `browser` | Screenshots, console output, network log | Does not prove desktop behavior |
| `desktop` | Native WebView/Tauri screenshot, platform logs | Requires platform tooling |
| `component` | Unit/render test output | Does not prove visual correctness |
| `unavailable` | Explicit gap statement | Must be stated in handoff |

Evidence is review material, not a committed regression baseline (unless the project opts into
visual snapshot testing).

## Required States Per Surface

When a target route/surface is declared, the following states must be addressed:

- Loading state
- Empty state (no data)
- Error state
- Disabled state (where applicable)
- Focus state (keyboard navigation)
- Responsive state (declared viewports)

If a state is not applicable, the spec must state why.

## Validation Commands

Validation commands are **repo-owned** and declared in `.elegy/ui-check.json` (schema v1). The
contract covers:

- Command execution per target route
- Console error detection
- Network failure detection
- Missing-evidence detection

The contract never claims accessibility compliance from a DOM snapshot alone.

## Skill Split

| Skill | Role | Load mode |
|-------|------|-----------|
| `ui-system` | Inventory-first implementation: reuse, tokens, icons, patterns | on-demand |
| `ui-design-spec` | Convert prompts/screenshots/Figma context into structured repo-grounded spec | on-demand |
| `ui-visual-review` | Review rendered evidence; report defects without editing code | on-demand |

`ui-design-spec` and `ui-visual-review` are separate from `ui-system` to keep spec-authoring and
visual judgment out of the implementation lane.

## Authority

| Priority | Source |
|----------|--------|
| 1 | This governance doc |
| 2 | Repo-local `.elegy/ui-check.json` and design tokens |
| 3 | `ui-system` skill |
| 4 | `ui-design-spec` and `ui-visual-review` skills |
| 5 | Figma/Storybook/shadcn MCP (context only, never authority) |

## Adoption

See [[ui-check-adoption]] [docs/system/ui-check-adoption.md](docs/system/ui-check-adoption.md) for the per-repo setup recipe.

## Related

- [[ui-check-adoption]] [docs/system/ui-check-adoption.md](docs/system/ui-check-adoption.md)
- [[skills-governance]] [docs/system/skills-governance.md](docs/system/skills-governance.md)
- [[copilot-ui-guide]] [docs/system/copilot-ui-guide.md](docs/system/copilot-ui-guide.md)
- [[spec-driven-development]] [docs/system/spec-driven-development.md](docs/system/spec-driven-development.md)
