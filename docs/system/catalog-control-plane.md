---
created: 2026-03-09
updated: 2026-07-31
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

`copilot-ui` is the local control plane for manifest-driven harness installs, repo registration, search, MCP/CLI integration management, and the Elegy Codex plugin marketplace. It builds a projection over file-backed state. It is not a second source of truth.

## Current Authorities

- Copilot global assets come from `engine-assets/` and install to `~/.elegy`.
- Codex global assets come from `codex-assets/` and install to `~/.codex`.
- OpenCode global assets come from `opencode-assets/` and install to `~/.config/opencode`.
- Antigravity global assets come from `antigravity-assets/` and install to the current Gemini-compatible `~/.gemini` layout.
- Repo-local skills are canonical in `<repo>/.github/skills/**`.
- Generated repo-local mirrors live in `<repo>/.agents/skills/**`, `<repo>/.opencode/skills/**`, and `<repo>/.gemini/skills/**`.
- Harness manifests control the curated global skill sets; third-party skill sources are not installed through the catalog.
- Codex's current Elegy marketplace receipt is read-only in the catalog: `elegy-documentation`,
  `elegy-mcp`, `elegy-checks`, and `elegy-planning`. The planning plugin is the direct Codex
  subagent/workflow integration.
- Global shipped assets are still split by harness. There is no single universal global skill root yet.

## Ownership and Scope

The central Assets & Tools view is a cross-harness projection. Each harness
state carries its own management metadata so one conceptual asset can be
Elegy-managed in one harness and harness- or repository-owned in another.
Metadata includes:

- `owner`: `elegy`, `harness`, `repository`, or `external`;
- `sourceOfTruth`: the authority that owns the content or activation state;
- `scope`: normalized to `global`, `repo`, `user`, or `external`;
- `readOnly` and an optional `readOnlyReason`.

Manifest and installed paths are provenance, not ownership. The UI labels both
owner and scope and never uses color as the only indicator.

Action rules are deliberately asymmetric:

- Elegy-managed assets may be installed, synchronized, or removed when the
  target supports that operation.
- Harness-owned native assets and repository-owned assets are observable but
  read-only. They have no install, sync, or removal controls.
- External-source assets expose activation/deactivation through their source;
  they are not copied into an Elegy-managed manifest lane.

`Needs attention` counts only actionable issues. The overview also groups and
filters by harness, owner, scope, kind, and status. Codex, OpenCode, and Claude
Code each expose a dedicated `Assets` settings tab backed by the same inventory
component; Antigravity remains visible in the central overview only for this
pass. Read-only harness assets use status refresh, while managed targets expose
Elegy synchronization only when permitted.

## Status UI

- `Catalog > Status` is the primary status page.
- It shows supported install targets, configured MCP/CLI integrations, installed inventory, and recent runtime-used skills.
- Older overlapping status blocks were removed from `Assets`.

## External MCP, CLI, and Plugin Integrations

- MCP and CLI integrations can be configured, enabled, disabled, refreshed, or removed per target.
- External MCP configuration and CLI/plugin integrations remain supported; review third-party integrations before enabling them.
- Current MCP targets: `codex`, `opencode`, `antigravity-cli` (legacy alias: `gemini-cli`).
- The older `providers` subsystem remains separate from these integrations.

## UI Capability Sources

- `elegy-ui-craft@elegy` replaces the retired standalone UI skills and vendored Impeccable payload.
- Impeccable remains an attributed research source only; it is not redistributed or maintained here.
- ui.sh/TypeUI resources must not be vendored unless their license changes or written redistribution permission exists.

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
