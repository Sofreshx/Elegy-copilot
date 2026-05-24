---
created: 2026-03-11
updated: 2026-05-19
category: system
status: current
doc_kind: node
id: copilot-ui-guide
summary: Short guide to the current copilot-ui runtime, navigation, and persistence boundaries.
tags: [copilot-ui, desktop, api, catalog]
related: [catalog-control-plane, session-state-artifacts, planning-backlog-roadmap-contract]
---

# copilot-ui Guide

## Purpose

`copilot-ui` is the local UI, HTTP API, and desktop shell for Instruction Engine. The packaged desktop app is the normal runtime. Today the shipped runtime is still Node-backed, but the rewrite is moving active route authority into `native/runtime` slice by slice.

## Start

```bash
npm --prefix copilot-ui run desktop:dev
npm --prefix copilot-ui run desktop:check
npm --prefix copilot-ui run desktop:smoke:native
node copilot-ui/server.js
```

- The local backend binds to `127.0.0.1`.
- Raw server mode is for `/api` work and debugging. The normal app UI is launched through the desktop shell.
- The Rust rewrite currently owns the bootstrap native routes in `native/runtime` and is expanding across active read surfaces before Node cutover.
- Set `INSTRUCTION_ENGINE_NATIVE_RUNTIME_URL=http://127.0.0.1:3220` (or pass `nativeRuntimeUrl` to `startServer()`) to hand off `/api/projects*`, `/api/dashboard/summary`, `/api/health`, `/api/version`, and `/api/policy/preflight` routes to the Rust runtime. When unset, these routes return 404 — the JS handlers have been deleted.

## Main UI

Sidebar sections:

- `Runtime`
- `Projects`
- `Catalog`
- `Planning`
- `Maintenance`
- `Settings`

Catalog sections are currently organized through the active shell and do not match older `Catalog > Status` docs exactly. Treat the mounted `App.tsx` shell as the implementation truth during the rewrite.

## Current Responsibilities

- Catalog refresh, repo registration, search, install, and external-source flows.
- Session and project browsing.
- The live planning task-board surface.
- Maintenance, diagnostics, and desktop update UI.
- Local API delivery for the desktop app.

## Planning Boundary

- The live planning surface is the repo task board plus workflow-artifact sync into `elegy-planning`.
- Old repo-file planning routes are retired from active use.

## State

- `~/.copilot/catalog/`
- `~/.copilot/repo-state/<repoId>/`
- `~/.copilot/session-state/<SESSION_ID>/`
- `~/.copilot/planning-db` in packaged mode

The public route inventory is snapshotted by `copilot-ui/tests/api-contract.test.js`.
