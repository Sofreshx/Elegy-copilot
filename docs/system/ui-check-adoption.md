---
created: 2026-06-21
updated: 2026-06-21
category: system
status: current
doc_kind: node
id: ui-check-adoption
summary: Per-repo recipe to adopt the governed UI workflow: create .elegy/ui-check.json, validate against schema, add an instruction pointer.
tags: [ui, adoption, setup, governance]
related: [ui-development-governance, skills-governance]
---

# UI Check Adoption Recipe

## Purpose

Recipe for any repo to adopt the governed UI workflow. Three steps + validation.

## Prerequisites

- Repo has UI components, tokens, and at least one validation lane (browser or desktop).
- The three UI skills are installed: `ui-system`, `ui-design-spec`, `ui-visual-review`.

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

The config file itself is the integration surface. The runner (`npm run ui:check`)
is a future addition. For now:

- **If the repo has `node scripts/validate-agentic-schemas.js`**: the script
  validates the minimal fixture defined in `contracts/session-state/contract-manifest.json`
  against `ui-check.schema.json`. Run it to confirm schema conformance.

- **If the repo does not have the schema validator**: validate manually using
  `node -e` with a JSON Schema library (e.g. Ajv), or copy the pilot config
  from `contracts/session-state/fixtures/` as a starting template.

The goal is a valid `.elegy/ui-check.json` — the runner will consume it later.

### 3. Add Instruction Pointer

Add one line to the repo's instruction entrypoint (AGENTS.md, CLAUDE.md, etc.):

```markdown
| UI governance | `.elegy/ui-check.json`, `docs/system/ui-development-governance.md` | Stack-neutral UI workflow with component inventory, validation lanes, and evidence gates |
```

### 4. Validate

```bash
# Validate the minimal fixture against the schema
node scripts/validate-agentic-schemas.js

# Manual validation — ensure .elegy/ui-check.json parses and paths resolve
node -e "const c = require('./.elegy/ui-check.json'); console.log('parsed ok, targets:', Object.keys(c.targets));"
```

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

Mark inapplicable states as `"N/A"` in the route config, or omit them from the
`states` array. The schema supports `"N/A"` as a sentinel for explicitly
noting that a state does not apply to a given surface.
