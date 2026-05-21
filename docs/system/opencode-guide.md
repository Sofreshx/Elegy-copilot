---
created: 2026-05-11
updated: 2026-05-21
category: system
status: current
doc_kind: node
id: opencode-guide
summary: Current native-first operating model for OpenCode.
tags: [opencode, agents, skills]
related: [catalog-control-plane, skills-governance, search-execute-workflow]
---

# OpenCode Guide

## Purpose

Instruction Engine keeps OpenCode native-first and skill-heavy. Use OpenCode's built-in agents first and add only a small shared global layer.

## Install Or Refresh

```powershell
pwsh -File scripts/opencode-install.ps1
bash scripts/opencode-install.sh
```

- Add `--force` to overwrite managed files.
- Add `--dry-run` to preview writes.
- The installer writes `~/.config/opencode/AGENTS.md`, curated skills under `~/.config/opencode/skills/`, and compatibility alias agents under `~/.config/opencode/agents/`.
- The installer does not edit `opencode.json`.
- The installer can also bootstrap a selected repo for opt-in spec-driven setup with `--repo-root <path> --setup-profile spec-driven`.

## Operating Model

- Built-in agents stay primary: `Build`, `Plan`, `Explore`, `Scout`, `General`.
- Primary skills: `rubberduck-plan-review`, `roadmap-planning`, `implementation-review`, `implementation-handoff`, `spec-dev`, `spec-authoring`, `spec-review`, `security`, `project-conventions-governance`, `stack-detector`.
- Durable repo specs default to `specs/<spec-slug>/spec.md` with optional `specs/index.md`.
- Compatibility-only surfaces: `code-review`, `refactor`, `code-explorer`, `web-searcher`.
- Prefer model overrides in `opencode.json` over adding more custom agents.
- Keep repo-specific guidance in repo `AGENTS.md`.
- Use OpenCode `/init` only when repo-local guidance actually needs to be created or refreshed.
- Prefer the installer-based `spec-driven` profile for repeatable repo-local spec scaffolding instead of inventing a separate OpenCode-specific bootstrap path.

## Catalog And External Sources

- `Catalog > Status` can activate external-source skills for OpenCode under `~/.config/opencode/skills/`.
- External-source MCP servers for OpenCode are materialized through `~/.config/opencode/opencode.json`.
- Source activation is global, not repo-scoped.

## Quick Checks

- Re-run `scripts/opencode-install.* --force` if shared skills or compatibility aliases are missing.
- Check `opencode.json` if built-in model overrides are not applying.
- Restart OpenCode after changing `opencode.json`.
