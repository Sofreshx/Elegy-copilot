---
created: 2026-03-09
updated: 2026-05-20
category: system
status: current
doc_kind: node
id: catalog-control-plane
summary: Current catalog authority model for installs, status, and external sources.
tags: [catalog, control-plane, copilot-ui, external-sources]
related: [copilot-ui-guide, repo-skill-sync-governance, domain-authorities-freeze]
---

# Catalog Control Plane

## Purpose

`copilot-ui` is the local control plane for installs, repo registration, search, and external-source management. It builds a projection over file-backed state. It is not a second source of truth.

## Current Authorities

- Copilot global assets come from `engine-assets/` and install to `~/.elegy`.
- Codex global assets come from `codex-assets/` and install to `~/.codex`.
- OpenCode global assets come from `opencode-assets/` and install to `~/.config/opencode`.
- Antigravity global assets come from `antigravity-assets/` and install to the current Gemini-compatible `~/.gemini` layout.
- Repo-local skills are canonical in `<repo>/.github/skills/**`.
- Generated repo-local mirrors live in `<repo>/.agents/skills/**`, `<repo>/.opencode/skills/**`, and `<repo>/.gemini/skills/**`.
- External-source state lives under `~/.elegy/catalog/external-sources/`.
- Global shipped assets are still split by harness. There is no single universal global skill root yet.

## Status UI

- `Catalog > Status` is the primary status page.
- It shows supported install targets, external sources, installed inventory, and recent runtime-used skills.
- Older overlapping status blocks were removed from `Assets`.

## External Sources

- Sources can be listed, added, refreshed, removed, reinstalled, and activated or deactivated per target.
- Public GitHub sources are ingested by reading repo contents only.
- Discovery currently supports `SKILL.md` skills and `server.json` MCP servers.
- Upstream installer scripts are never executed.
- Activation is global per target, not repo-scoped.
- Current skill targets: `codex`, `opencode`, `antigravity`.
- Current MCP targets: `codex`, `opencode`, `antigravity-cli` (legacy alias: `gemini-cli`).
- The older `providers` subsystem still exists, but it is separate from external sources.

## Useful APIs

- `GET /api/catalog/summary`
- `GET /api/catalog/repos`
- `POST /api/catalog/repos/refresh`
- `GET /api/catalog/sources`
- `GET /api/catalog/sources/:id`
- `POST /api/catalog/sources/add`
- `POST /api/catalog/sources/refresh`
- `POST /api/catalog/sources/activate`
- `POST /api/catalog/sources/deactivate`
- `GET /api/assets/install-surfaces`

## Boundaries

- The catalog is a management and projection layer over files.
- Repo-local skill authority is centralized.
- Global shipped assets remain harness-specific.
