---
created: 2026-06-21
updated: 2026-06-30
category: system
status: current
doc_kind: node
id: ui-check-adoption
summary: "Per-repo recipe to adopt the governed UI workflow: create .elegy/ui-check.json, validate against schema, add an instruction pointer."
tags: [ui, adoption, setup, governance]
related: [ui-development-governance, skills-governance]
---

# UI Check Adoption Recipe

## Purpose

Recipe for any repo to adopt the governed UI workflow. Three steps + validation.

## Prerequisites

- Repo has UI components, tokens, and at least one validation lane (browser or desktop).
- The implementation and review lanes are available: `ui-system`, `ui-visual-review`, and the appropriate runtime lane for the repo (`ui-runtime-exploration` when browser/Tauri routing matters).

## Steps

### 1. Create `.elegy/ui-check.json`

Create the configuration file at the repo root. Schema version 1.

**Required fields:**
- `schemaVersion`: `1`
- `inventory.componentRoots`: array of `{ path, description? }` — component directories
- `inventory.tokenFiles`: array of `{ path, format? }` — design token files
- `inventory.iconRoots`: array of `{ path, library? }` — icon library entrypoints
- `inventory.patternDocs`: array of `{ path, description? }` — UI pattern docs
- `targets.<id>.lane`: `"browser"` or `"desktop"`
- `targets.<id>.workingDirectory`: working dir for validation commands
- `targets.<id>.routes`: array with `{ id, path, viewports, states }`

Full schema: `contracts/session-state/ui-check.schema.json`.

### 2. Validate Config Against Schema

The runner validates configuration automatically. To check config only (no commands):

```bash
node scripts/ui-check.mjs --validate-only
```

This validates the `.elegy/ui-check.json` against the canonical schema,
checks all inventory paths exist, and verifies working directories.

### 3. Add Instruction Pointer

Add one line to the repo's instruction entrypoint (AGENTS.md, CLAUDE.md, etc.):

```markdown
| UI governance | `.elegy/ui-check.json`, `docs/system/ui-development-governance.md` | Stack-neutral UI workflow with component inventory, validation lanes, and evidence gates |
```

### 4. Validate

```bash
# Validate config and paths only (no command execution)
node scripts/ui-check.mjs --validate-only

# Run a specific target (e.g., settings)
node scripts/ui-check.mjs --target settings

# Run all declared targets
node scripts/ui-check.mjs
```

Exit code 0 = all targets passed. Non-zero = see the generated report for details.

## Browser vs Desktop

| Lane | Evidence | Gap |
|------|----------|-----|
| `browser` | Playwright/headless screenshots, console, network | Does not prove desktop behavior |
| `desktop` | Tauri/WebView2 native screenshots | Requires platform tooling |

If both lanes are available, declare separate targets. Browser evidence
does not substitute for desktop evidence.

## States Checklist

Per the governance doc, every declared route must address:
- [ ] Default state
- [ ] Loading state
- [ ] Empty state
- [ ] Error state
- [ ] Disabled state (where applicable)
- [ ] Focus state (keyboard navigation)

States that do not apply to a route are declared in the route's `excludedStates`
array with a `reason` field explaining why. For example:

```json
"excludedStates": [
  { "state": "empty", "reason": "Settings surface is a static form with no data collection." }
]
```

The runner validates that every excluded state carries a `reason` and that
non-excluded states have matching evidence in the runtime report.
