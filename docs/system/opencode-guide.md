---
created: 2026-05-11
updated: 2026-05-28
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
- The installer writes `~/.config/opencode/AGENTS.md` and curated skills under `~/.config/opencode/skills/`.
- The installer does not edit `opencode.json`.
- The installer can also bootstrap a selected repo for opt-in spec-driven setup with `--repo-root <path> --setup-profile spec-driven --elegy-cli <path>`.
- `INSTRUCTION_ENGINE_ELEGY_CLI_PATH` is still accepted as a fallback when rerunning the same local setup.

## Operating Model

- Built-in agents stay primary: `Build`, `Plan`, `Explore`, `Scout`, `General`.
- Primary skills: `skill-discovery`, `rubberduck-plan-review`, `roadmap-planning`, `implementation-review`, `implementation-handoff`, `spec-dev`, `spec-authoring`, `spec-review`, `security`, `project-conventions-governance`, `stack-detector`.
- Planning, review, and spec skills are installed by default under `~/.config/opencode/skills/`; load them with the skill tool only when they materially improve the current step.
- Durable repo specs default to `specs/<spec-slug>/spec.md` with optional `specs/index.md`.
- Shared installed planning and review behavior now narrows constraints to the minimum active set and treats ADRs as key-decision records rather than default documentation for every non-trivial change.
- Compatibility-only surfaces: `code-review`, `refactor`.
- Prefer model overrides in `opencode.json` over adding more custom agents.
- Keep repo-specific guidance in repo `AGENTS.md`.
- Use OpenCode `/init` only when repo-local guidance actually needs to be created or refreshed.
- Prefer the installer-based `spec-driven` profile for repeatable repo-local spec scaffolding instead of inventing a separate OpenCode-specific bootstrap path.

## Catalog And External Sources

- `Catalog > Status` can activate external-source skills for OpenCode under `~/.config/opencode/skills/`.
- External-source MCP servers for OpenCode are materialized through `~/.config/opencode/opencode.json`.
- Source activation is global, not repo-scoped.

## Quick Checks

- Re-run `scripts/opencode-install.* --force` if shared skills are missing.
- Check `opencode.json` if built-in model overrides are not applying.
- Restart OpenCode after changing `opencode.json`.
