---
created: 2026-06-21
updated: 2026-06-22
category: system
status: current
doc_kind: node
id: holon-pilot-brief
summary: Verified implementation brief for the Holon pilot of the governed UI workflow. All paths confirmed.
tags: [ui, holon, pilot, adoption]
related: [ui-development-governance, ui-check-adoption]
---

# Holon Pilot Implementation Brief

## Goal

Configure the governed UI workflow in Holon to validate it against a desktop+Tauri
codebase with existing Playwright lanes.

## Verified Holon Assets

| Asset | Verified Path | Status |
|-------|---------------|--------|
| Components (25) | `Frontend/HolonClient/src/Common/UI/` | ✅ Confirmed |
| SurfaceShell | `Frontend/HolonClient/src/Common/UI/SurfaceShell.tsx` | ✅ 201 lines, cva-based |
| Tailwind config | `Frontend/HolonClient/tailwind.config.ts` | ✅ 123 lines, semantic CSS var tokens |
| CSS tokens | `Frontend/HolonClient/src/index.css` | ✅ 571 lines, 4 palette modes, 15 animations |
| Icons (Lucide) | `Frontend/HolonClient/node_modules/lucide-react` | ✅ Installed |
| Clean UI spec | `docs/specs/holon-client-clean-ui-direction/spec.md` | ✅ Exists |
| Visual modernization spec | `docs/specs/holon-ui-visual-modernization/spec.md` | ✅ Exists |
| Checks guide | `docs/system/guides/checks-and-validation.md` | ✅ Exists |
| Real-desktop guide | `docs/system/guides/holon-desktop-real-desktop-validation.md` | ✅ Exists |
| HolonDesktop | `Frontend/HolonDesktop/` | ✅ Tauri project with src-tauri/ |
| AGENTS.md | `Frontend/HolonClient/AGENTS.md` | ✅ 30 lines, UI governance pointer added |

## Configuration

The `.elegy/ui-check.json` has been created at the SAASTools repo root with:
- **holon-browser** target: Playwright browser lane with build + e2e commands
- **holon-desktop** target: Real-desktop lane with build + real-desktop test + summary adapter

## Playwright Browser Spec

Created at `Frontend/HolonClient/tests/e2e/ui-governance.desktop.spec.ts`:
- Exercises shell, settings, and workspace surfaces
- Captures desktop screenshots for declared states
- Collects console and network failures
- Emits normalized `runtime-report.json`
- Matches existing `*.desktop.spec.ts` project pattern

## Desktop Summary Adapter

Created at `Frontend/HolonDesktop/tests/real-desktop/summarize-ui-check.mjs`:
- Reads evidence-manifest.json from the latest real-desktop artifact directory
- Finds screenshots and diagnostics
- Converts to the runtime-report contract
- Handles provider-blocked state (marks as excluded, not pass)

## Validation Commands

```bash
# instruction-engine repo
node scripts/ui-check.mjs --validate-only
node scripts/ui-check.mjs --target settings
node scripts/ui-check.mjs --target catalog
node scripts/ui-check.mjs --target workspace
node scripts/validate-agentic-schemas.js
node scripts/validate-manifest.js
node scripts/validate-doc-graph.js
npm run ci:local

# Holon repo (SAASTools)
node <path-to-runner>/scripts/ui-check.mjs --repo C:\Users\lolzi\source\repos\SAASTools --validate-only
node <path-to-runner>/scripts/ui-check.mjs --repo C:\Users\lolzi\source\repos\SAASTools --target holon-browser
node <path-to-runner>/scripts/ui-check.mjs --repo C:\Users\lolzi\source\repos\SAASTools --target holon-desktop
npm --prefix ./Frontend/HolonClient run typecheck
npm --prefix ./Frontend/HolonClient run lint
npm --prefix ./Frontend/HolonClient run test -- --run
```

## Authority Notes

- Holon's clean-UI and visual-modernization specs are the pattern authority.
  Do NOT replace them with generic archetypes.
- Tailwind tokens are authoritative for styling; do not add a separate token file.
- Lucide is the icon authority; do not add inline SVGs.
- Desktop targets must use the real-desktop Playwright/WebView2 lane, not browser emulation.
