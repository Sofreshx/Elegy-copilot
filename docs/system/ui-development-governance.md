---
created: 2026-06-21
updated: 2026-07-10
category: system
status: current
doc_kind: node
id: ui-development-governance
summary: "Governed stack-neutral UI workflow: spec → inventory → implement → evidence → visual review → patch → regression proof."
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
| Brief/spec | `elegy-ui-craft@elegy` (`ui-design-spec` is a non-Codex fallback) | Target, viewports, states, task, inventory, acceptance criteria |
| Inventory and implementation | `elegy-ui-craft@elegy` + implementation lane | Existing components/tokens/patterns and code changes |
| Evidence and review | `elegy-ui-craft@elegy` | Screenshots, runtime diagnostics, prioritized findings |
| Regression proof | UI Craft check plus repo-owned validation commands | Pass/fail on declared validation lane |

## Required Evidence Per Change

Every UI change must declare a **validation lane** per target and produce **runtime evidence**:

| Lane | Evidence | Gap |
|------|----------|-----|
| `browser` | Screenshots, console output, network log | Does not prove desktop behavior |
| `desktop` | Native WebView/Tauri screenshot, platform logs | Requires platform tooling |
| `component` | Unit/render test output | Does not prove visual correctness |
| `unavailable` | Explicit gap statement | Must be stated in handoff |

Each target declares one lane. A UI change may require **multiple targets**
when claims span browser and desktop behavior (e.g., one browser target and one
desktop target, each with independent evidence).

## Required States Per Surface

When a target route/surface is declared, the following states must be addressed:

- Loading state
- Empty state (no data)
- Error state
- Disabled state (where applicable)
- Focus state (keyboard navigation)
- Responsive state (declared viewports)

If a state is not applicable to a route, declare it in the route's `excludedStates`
array with a `reason` explaining why. The runner validates that every declared state
has evidence and every excluded state carries a justification.

## Validation Commands

Validation commands are **repo-owned** and declared in `.elegy/ui-check.json` (schema v1).
The runner (`node scripts/ui-check.mjs`) executes per-target commands, validates the
runtime report against the evidence contract, and generates pass/fail reports.

The runner, not the schema alone:
- Executes commands and detects failures and timeouts.
- Collects and validates runtime reports.
- Verifies that every declared route × viewport × state has evidence.
- Flags console errors and failed network requests.
- Validates that excluded states carry a `reason` instead of requiring evidence.

The contract never claims accessibility compliance from a DOM snapshot alone.

## Capability Route

`elegy-ui-craft@elegy` is the primary Codex capability for UI briefing, local inventory,
implementation guidance, browser/desktop/component evidence routing, deterministic audit, and
visual review. The former `ui-system`, `ui-runtime-exploration`, `ui-visual-review`, and vendored
Impeccable surfaces are retired and must not be reintroduced as compatibility duplicates.

`ui-design-spec` remains available to non-Codex harnesses as a narrow fallback until those
harnesses consume the plugin projection. It does not replace UI Craft's evidence and audit flow.

## Authority

| Priority | Source |
|----------|--------|
| 1 | Explicit user instruction |
| 2 | Downstream canonical UI specs and docs |
| 3 | Repo-local `.elegy/ui-check.json`, config, tokens, and code |
| 4 | Central governance doc (this doc) and UI skills |
| 5 | Figma/Storybook/shadcn MCP (context only, never authority) |

## Adoption

See [[ui-check-adoption]] [ui-check-adoption.md](ui-check-adoption.md) for the per-repo setup recipe. [ui-check-adoption](docs/system/ui-check-adoption.md)
Use `node scripts/ui-check.mjs --validate-only` to validate configuration,
and `node scripts/ui-check.mjs --target <id>` to run a specific target.

## Related

- [[ui-check-adoption]] [ui-check-adoption.md](ui-check-adoption.md) [ui-check-adoption](docs/system/ui-check-adoption.md)
- [[skills-governance]] [skills-governance.md](skills-governance.md) [skills-governance](docs/system/skills-governance.md)
- [[copilot-ui-guide]] [copilot-ui-guide.md](copilot-ui-guide.md) [copilot-ui-guide](docs/system/copilot-ui-guide.md)
- [[spec-driven-development]] [spec-driven-development.md](spec-driven-development.md) [spec-driven-development](docs/system/spec-driven-development.md)
