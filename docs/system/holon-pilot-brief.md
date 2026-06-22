---
created: 2026-06-21
updated: 2026-06-21
category: system
status: current
doc_kind: node
id: holon-pilot-brief
summary: Implementation brief for the Holon pilot of the governed UI workflow.
tags: [ui, holon, pilot, adoption]
related: [ui-development-governance, ui-check-adoption]
---

> **⚠️ Template**: Paths and commands below must be verified against the actual Holon repository structure. Items marked `<!-- VERIFY -->` are unconfirmed and must be checked before execution.

# Holon Pilot Implementation Brief

## Goal

Configure the governed UI workflow in Holon to validate it against a desktop+Tauri
codebase with existing Playwright lanes.

## Pre-existing Holon Assets

- Components: `Frontend/HolonClient/src/Common/UI/`, `SurfaceShell`
- Tokens: semantic Tailwind tokens (check tailwind.config or CSS variables)
- Icons: Lucide (via existing imports)
- Pattern docs: existing clean-UI and visual-modernization specs
- Validation: Playwright lane for browser checks, Playwright/WebView2 lane for real-desktop

## Steps

### 1. Create `.elegy/ui-check.json`

```json
{
  "schemaVersion": 1,
  "inventory": {
    "componentRoots": [
      { "path": "Frontend/HolonClient/src/Common/UI", "description": "Shared UI components" },
      { "path": "Frontend/HolonClient/src/SurfaceShell", "description": "Desktop surface shell components" }
    ],
```

<!-- VERIFY: SurfaceShell may be a component, not a directory. Confirm the correct component directory path. -->
<!-- VERIFY: Confirm the actual Tailwind config filename and path in Holon. -->

```json
    "tokenFiles": [
      { "path": "tailwind.config.ts", "format": "tailwind" }
    ],
    "iconRoots": [
      { "path": "node_modules/lucide-react", "library": "lucide" }
    ],
    "patternDocs": [
```

<!-- VERIFY: Confirm these spec files exist at these paths in Holon. -->

```json
      { "path": "docs/specs/clean-ui/spec.md", "description": "Clean UI modernization spec" },
      { "path": "docs/specs/visual-modernization/spec.md", "description": "Visual modernization spec" }
    ]
  },
  "targets": {
    "holon-browser": {
      "lane": "browser",
      "workingDirectory": "./Frontend/HolonClient",
      "validationCommands": [
```

<!-- VERIFY: Confirm the correct working directory for npm commands in Holon. -->
<!-- VERIFY: Confirm the actual Playwright project names. Common values: chromium, firefox, webkit, webview2. -->

```json
        { "id": "build", "command": "npm run build" },
        { "id": "playwright-browser", "command": "npx playwright test --project=chromium" }
      ],
      "routes": [
        {
          "id": "shell-default",
          "path": "/",
          "viewports": ["desktop"],
          "states": ["default", "loading", "error"]
        }
      ],
      "evidenceRoot": "./evidence/ui/browser"
    },
    "holon-desktop": {
      "lane": "desktop",
      "workingDirectory": "./Frontend/HolonClient",
      "validationCommands": [
        { "id": "build", "command": "npm run build" },
        { "id": "playwright-desktop", "command": "npx playwright test --project=webview2" }
      ],
      "routes": [
        {
          "id": "shell-desktop",
          "path": "/",
          "viewports": ["desktop"],
          "states": ["default"]
        }
      ],
      "evidenceRoot": "./evidence/ui/desktop"
    }
  }
}
```

Adjust paths and command names to match the actual Holon repo structure.

### 2. Add to `Frontend/HolonClient/AGENTS.md`

```markdown
| UI governance | `.elegy/ui-check.json` | Stack-neutral UI workflow. `npm run ui:check --target holon-browser` for browser evidence, `--target holon-desktop` for native desktop. |
```

### 3. Validate

```bash
# Validate config against schema (if validate-agentic-schemas.js is available in this repo)
node -e "const c = require('./.elegy/ui-check.json'); console.log(Object.keys(c.targets))"

# Run existing tests to confirm nothing is broken
npm run test
```

### 4. Run Pilot

> ⚠️ The `ui:check` runner is deferred. Run validation commands manually for the pilot:

1. Collect screenshots, console logs, network logs
2. Run `ui-visual-review` against the evidence
3. Record findings

## Authority Notes

- Holon's clean-UI and visual-modernization specs are the pattern authority.
  Do NOT replace them with generic archetypes.
- Tailwind tokens are authoritative for styling; do not add a separate token file.
- Lucide is the icon authority; do not add inline SVGs.
- Desktop targets must use the real-desktop Playwright/WebView2 lane, not browser emulation.
