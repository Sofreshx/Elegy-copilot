---
created: 2026-05-19
updated: 2026-05-19
category: system
status: current
doc_kind: node
id: repo-skill-sync-governance
summary: Canonical rule for repo-local skill authority and generated mirrors.
tags: [skills, governance, codex, opencode, gemini, antigravity, sync]
related: [catalog-control-plane, project-conventions-governance, skills-governance]
---

# Repo Skill Sync Governance

## Rule

For repo-local skills in this repository, the only editable source is:

```text
<repo>/.github/skills/<skill-name>/SKILL.md
```

## Mirrors

- Copilot uses `.github/skills/<skill-name>/SKILL.md` directly.
- Codex mirrors to `.agents/skills/<skill-name>/SKILL.md`.
- OpenCode mirrors to `.opencode/skills/<skill-name>/SKILL.md`.
- Gemini CLI and Antigravity mirror to `.gemini/skills/<skill-name>/SKILL.md`.
- Generated mirrors are compatibility surfaces, not peer authority.

## Sync

```powershell
node scripts/sync-repo-skills.mjs
node scripts/sync-repo-skills.mjs --check
node scripts/sync-repo-skills.mjs --targets codex,opencode,gemini-cli
node scripts/validate-repo-skill-sync.js
```

## Rules

- Do not hand-edit generated mirrors.
- If a mirror drifts, regenerate it from `.github/skills/**`.
- This policy applies only to repo-local skills.
- Shared global assets still live in `engine-assets/`, `codex-assets/`, `opencode-assets/`, and `antigravity-assets`.
