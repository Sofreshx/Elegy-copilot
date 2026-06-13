---
created: 2026-06-07
updated: 2026-06-07
category: system
status: current
doc_kind: node
id: architecture-overview
summary: One-page architecture overview of the Instruction Engine / Elegy Copilot system layers.
tags: [architecture, overview, layers, desktop, copilot-ui]
related: [copilot-ui-guide, catalog-control-plane, index]
---

# Architecture Overview

## Layer Diagram

```
┌─────────────────────────────────────────────────────────┐
│  Desktop Shell (Tauri + WebView)                        │
│  src-tauri/   ← Rust shell, window chrome, updater      │
│  ui/src/      ← React frontend (Vite-built SPA)         │
└──────────────────────┬──────────────────────────────────┘
                       │ HTTP (127.0.0.1)
┌──────────────────────▼──────────────────────────────────┐
│  Node.js HTTP Server (server.js)                        │
│  routes/       ← Route handlers (catalog, sessions, ...) │
│  lib/          ← Service layer (planning, git, obsidian) │
│  contracts/    ← Shared runtime contracts               │
└──────────────────────┬──────────────────────────────────┘
                       │ SQLite / Filesystem
┌──────────────────────▼──────────────────────────────────┐
│  State & Persistence (~/.elegy/)                      │
│  catalog/       ← Asset projections, search telemetry   │
│  session-state/ ← Session artifacts (plan.md, etc.)     │
│  repo-state/    ← Per-repo task store                   │
│  planning-db    ← elegy-planning SQLite database         │
└─────────────────────────────────────────────────────────┘
```

## Key Layers

### 1. Desktop Shell (`copilot-ui/src-tauri/` + `copilot-ui/ui/`)
- **Tauri frame:** Window management, native menus, desktop updater (Rust).
- **React UI:** Vite-built SPA loaded in a Tauri WebView. Sidebar navigation, workspace tabs, settings views, catalog surfaces.
- **Bridge:** `window.instructionEngineDesktop` provides updater state and window controls to the UI.

### 2. HTTP Server (`copilot-ui/server.js`)
- Single Node.js process serving both the API and (in dev mode) the UI.
- **Routes** (`copilot-ui/routes/`): catalog, sessions, planning, git, sandboxes, tooling, etc.
- **Services** (`copilot-ui/lib/`): planning persistence, obsidian sync, repo inventory, executor, workflow layer.

### 3. Persistence (`~/.elegy/`)
- **Catalog projections:** `projections/global.json`, `projections/repo-<id>.json` — built from `engine-assets/` + installed assets.
- **Session artifacts:** Per-session `plan.md`, `proposition.md`, task boards.
- **Planning database:** SQLite (`~/.elegy/planning.db`) for roadmaps, goals, plans, todos.
- **Repo state:** Per-repo task store and overlay registries.

### 4. Asset Pipeline

```
engine-assets/   ──install──►  ~/.elegy/agents/
(agents, skills, prompts)      ~/.elegy/skills/
                               ~/.elegy/skills-vault/
                               ~/.elegy/copilot-instructions.md

codex-assets/    ──install──►  ~/.codex/
opencode-assets/ ──install──►  ~/.config/opencode/
antigravity-assets/ ─install─► ~/.gemini/antigravity/
```

### 5. External Surfaces

| Surface | Integration |
|---------|------------|
| Obsidian | Read/write via `obsidianCli.js` — vault mirror for planning notes |
| Discord Gateway | `local-tracker/` — bot commands for remote session control |
| Native Runtime | Optional Rust sidecar for health/version/policy routes |
| Elegy Planning CLI | Managed binary under `~/.elegy/managed-cli/planning/` |

## State Diagram (Startup → Running)

```
1. Desktop shell launches → Tauri boots WebView
2. WebView loads Vite-built SPA → React mounts App.tsx
3. React calls /api/health to verify backend
4. Sidebar renders: Repositories | Lexicon | Settings
5. User opens a repo → WorkspaceView with local tabs
6. Planning tab → fetches /api/planning/live/roadmap → renders graph
7. Catalog → /api/catalog/refresh → projection built from assets
```

## Key Source Files

| What | Where |
|------|-------|
| Sidebar navigation | `copilot-ui/ui/src/stores/navigation.ts` |
| Main app shell | `copilot-ui/ui/src/App.tsx` |
| Settings routing | `copilot-ui/ui/src/views/Settings/SettingsView.tsx` |
| API client (UI) | `copilot-ui/ui/src/lib/api/core.ts` |
| HTTP server | `copilot-ui/server.js` |
| Route registry | `copilot-ui/routes/index.js` |
| Planning persistence | `copilot-ui/lib/planningPersistence.js` |
| Catalog service | `copilot-ui/lib/catalogProjectionService.js` |
