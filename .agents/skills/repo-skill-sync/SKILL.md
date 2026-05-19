---
name: repo-skill-sync
description: "Use when creating or updating repo-local skills across Copilot, Codex, OpenCode, Gemini CLI, or Antigravity, or when checking deterministic skill mirrors and sync drift. Triggers on: sync repo skills, mirror skills, .github/skills, .agents/skills, .opencode/skills, .gemini/skills, Gemini CLI skills."
---

# Repo Skill Sync

Use this skill when the work is about keeping one repo-local skill present in the compatible folder for each harness without creating multiple peer sources of truth.

## Canonical Source

- Repo-local skill truth starts in `.github/skills/<skill-name>/SKILL.md`.
- Generated mirrors under `.agents/skills`, `.opencode/skills`, and `.gemini/skills` are compatibility projections.
- Do not hand-edit generated mirrors unless canonical docs explicitly allow a target-specific override model.

## Deterministic First

Use the sync script before reaching for AI:

```powershell
node scripts/sync-repo-skills.mjs
```

Useful modes:

```powershell
node scripts/sync-repo-skills.mjs --dry-run
node scripts/sync-repo-skills.mjs --targets codex,opencode,gemini-cli
node scripts/sync-repo-skills.mjs --check
node scripts/validate-repo-skill-sync.js
```

## Current Mirror Map

- Copilot: `.github/skills/<skill-name>/SKILL.md`
- Codex: `.agents/skills/<skill-name>/SKILL.md`
- OpenCode: `.opencode/skills/<skill-name>/SKILL.md`
- Gemini CLI: `.gemini/skills/<skill-name>/SKILL.md`
- Antigravity: `.gemini/skills/<skill-name>/SKILL.md`

Gemini CLI and Antigravity share the same repo-local mirror root.

## When AI Is Useful

Use AI only when the task is about:

- deciding whether a skill should be repo-local vs shared/global
- writing or improving the skill content itself
- deciding whether a harness needs a genuine variant instead of a mirror
- reconciling canonical-doc conflicts before changing the sync rules

## Canonical Reference

- `docs/system/repo-skill-sync-governance.md`
