---
created: 2026-07-08
updated: 2026-07-08
category: system
status: current
doc_kind: node
id: obsidian-lanes
summary: Routing node mapping Obsidian integration needs to the correct lane, contract, and skill.
tags: [obsidian, routing, skill, vault, planning, documentation]
related: [obsidian-synced-notes-contract, repo-backed-obsidian-docs]
---

# Obsidian Lanes — Routing Node

This document routes Obsidian-related needs to the correct integration
lane. Three lanes exist; they serve different authority domains and
must not be confused.

## Lane Map

| Need | Lane | Contract | Config | Authority |
|---|---|---|---|---|
| **Agent read/search/append vault notes** | `elegy-obsidian` skill (official CLI) | `elegy-obsidian/SKILL.md` in Elegy repo (canonical) or `catalog-assets/shared-skills/elegy-obsidian/` (consumer mirror) | `~/.elegy/obsidian-vault.json` | Non-authoritative; vault is a convenience mirror |
| **copilot-ui Notes tab CRUD** | `vaultBackend.js` (direct fs) | `docs/specs/obsidian-vault-notes/spec.md` | `~/.elegy/obsidian-vault.json` | Primary storage (replaces SQLite notes) |
| **Planning mirrors (bullets/roadmaps)** | `obsidianSyncService.js` + `planning-obsidian.js` | `docs/system/obsidian-synced-notes-contract.md` | `~/.elegy/obsidian-planning.json` | Non-canonical mirror of canonical repo planning docs |
| **Repo docs as Obsidian vault** | `repo-backed-obsidian-docs` scripts | `docs/system/repo-backed-obsidian-docs.md` | `.obsidian/` in repo | Canonical (Git is authority) |

## Lane details

### 1. Agent skill (`elegy-obsidian`)

- **What**: agents (opencode, claude, codex) read, search, create,
  append, and manage vault notes via the official `obsidian` CLI.
- **Binary**: official Obsidian Desktop CLI v1.12.7+. On WSL, the
  skill resolves the binary via `cmd.exe /c "where obsidian"` fallback.
- **Vault context**: reads `~/.elegy/obsidian-vault.json` to derive
  vault name; always passes `vault=<name>` explicitly.
- **Orient-once**: version → vault list → read Index.md.
- **Canonical source**: Elegy repo
  `skills/elegy-obsidian/SKILL.md`.
- **Consumer mirror**: this repo
  `catalog-assets/shared-skills/elegy-obsidian/`.
- **Governed fixtures**: `contracts/elegy/fixtures/skill-definition-v2.elegy-obsidian.json` + `skill-discovery-index.elegy-obsidian.json`.
- **Active install**: `~/.config/opencode/skills/elegy-obsidian/`
  (synced from catalog-assets; not managed by the copilot-ui install
  lifecycle). When the canonical source changes, re-sync by copying
  `SKILL.md` and `references/` from
  `catalog-assets/shared-skills/elegy-obsidian/` to the install path.
- **Codex**: the codex-assets install is intentionally minimal
  (see `codex-assets/manifest.json`: "Do not bulk-install
  Copilot/engine assets into Codex"). To use this skill in a codex
  session, manually copy `SKILL.md` and `references/` from
  `catalog-assets/shared-skills/elegy-obsidian/` to
  `~/.codex/skills/elegy-obsidian/`.

### 2. copilot-ui Notes tab

- **What**: the desktop UI's Notes tab reads and writes `.md` files
  directly from the vault root using `vaultBackend.js` (fs CRUD, no
  CLI). Includes git versioning and Google Drive sync via rclone.
- **Config**: `~/.elegy/obsidian-vault.json` (`vaultPath`, `git`,
  `gdrive`, `excludeDirs`).
- **Spec**: `docs/specs/obsidian-vault-notes/spec.md`.
- **Authority**: vault is primary storage for notes (replaced SQLite).
  Git tracks changes; rclone syncs to Google Drive for mobile access.

### 3. Planning mirrors

- **What**: copilot-ui surfaces non-canonical planning notes
  (bullets, roadmap mirrors) generated from canonical repo planning
  docs. Includes remote sync from a pull-only feed.
- **Config**: `~/.elegy/obsidian-planning.json` (`vaultPath`,
  `notesPathTemplate`, `cliPath`, `cliCommands`, `remoteSync*`).
  **Not currently configured on this machine.**
- **Contract**: `docs/system/obsidian-synced-notes-contract.md`.
- **Authority**: non-canonical. Generated from
  `~/.elegy/backlogs/{repo}/planning/bullets.md` and roadmap indexes.
  Mirror notes live under `_elegy-copilot/planning-mirrors/`.
- **Third-party CLI**: uses a separate `obsidian-cli.exe` (not the
  official Obsidian Desktop CLI), configured via `cliPath` and
  `cliCommands` in the planning config.

### 4. Repo-backed docs vault

- **What**: opening a repo folder directly as an Obsidian vault for
  viewing/editing canonical docs. Git is authority.
- **Contract**: `docs/system/repo-backed-obsidian-docs.md`.
- **Scripts**: `scripts/obsidian-docs-preflight.js`,
  `scripts/obsidian-docs-init.js`, `scripts/obsidian-docs-validate.js`.
- **Authority**: repo (Git). Obsidian is a viewer/editor only.

## Cross-references

- `elegy-obsidian` skill is additive — it does not replace the
  planning-mirror lane or the repo-backed-docs lane.
- The planning-mirror lane's `obsidian-cli.exe` is a separate binary
  from the official `obsidian` CLI used by the skill. They coexist.
- `vaultConfig.js` (Notes tab) and the `elegy-obsidian` skill both
  read `~/.elegy/obsidian-vault.json` for vault path resolution.
