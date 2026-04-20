---
name: repo-setup
description: "Bootstrap a repository for Codex using the smallest useful setup. Triggers on: codex repo setup, setup this repo for codex, codex bootstrap, codex onboarding, /setup-repo replacement."
tags: [codex, repo-setup, bootstrap, agents, skills]
---

# Repo Setup

## Purpose

Set up a repository for Codex with the minimum durable surface that repo actually needs. This skill replaces the idea of a custom `/setup-repo` slash command with a reusable Codex-native workflow.

## Default Posture

- keep the baseline light
- prefer native Codex behavior over extra scaffolding
- preserve existing Copilot guidance when it is still useful
- add repo-local Codex files only when repeated repo-specific conventions justify them

## Audit First

Inspect these inputs before proposing changes:

- `README*`
- package/build/test files near the repo root
- existing `AGENTS.md` or `.codex/`
- existing Copilot assets such as `.github/copilot-instructions.md`, `.github/agents/`, `.github/skills/`, or `engine-assets/`
- maintained docs that define repo conventions

## Decision Rules

1. Decide whether the repo needs any repo-local Codex setup at all.
2. For routine install or refresh of the shared Codex agents and skills, use the install script instead of `/init`:
   - Windows: `pwsh -File scripts/codex-install.ps1 --force`
   - macOS/Linux: `bash scripts/codex-install.sh --force`
3. If the repo does need persistent repo-local Codex instructions or bootstrap files, use `/init` in the target repo and then refine the generated `AGENTS.md`.
4. Keep repo-local `AGENTS.md` focused on repo facts only:
   - layout
   - build/test commands
   - local safety constraints
   - done criteria
5. Add `.codex/config.toml` only when repo-specific settings are clearly useful.
6. Suggest repo-local skills only when the repo has a repeated workflow that is too specific for global instructions.
7. Reuse useful Copilot guidance instead of replacing it wholesale. Translate the intent into Codex-native instructions rather than copying Copilot-specific tools or UI flows.

## Coexistence Rules

- do not remove or rewrite existing Copilot assets unless the user explicitly asks
- do not port Copilot-only tool names into Codex files
- if Copilot instructions already contain durable repo facts, reuse those facts in the Codex proposal
- if the repo already works well without repo-local Codex files, say so and stop

## Output Contract

Return this structure:

```text
CODEX_REPO_SETUP
- repo_needs_local_codex_setup: yes|no
- evidence:
  - <file or fact>
- recommended_next_steps:
  - <smallest useful action>
- repo_local_files_to_add:
  - <path or none>
- copilot_assets_to_reuse:
  - <path or none>
- notes:
  - <coexistence or follow-up guidance>
```

If the answer is "no", keep the next steps short and stop at the audit result.
