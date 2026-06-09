---
created: 2026-06-09
updated: 2026-06-09
category: planning
status: current
doc_kind: note
id: skill-cleanup-followups
summary: "Remaining work from the June 9 2026 skill audit. Items that need dedicated investigation or implementation in a future session."
tags: [planning, skills, audit, follow-up]
---

# Skill Cleanup Follow-Ups

## Completed This Session

| Skill | Action |
|-------|--------|
| `stack-detector` | Removed entirely (engine + opencode copies, all manifests, routing, metadata index, home instructions) |
| `roadmap-planning` | Removed entirely (catalog copy, all manifests, routing, metadata index, home instructions). `elegy-planning` is the sole planning skill. |
| `security` (opencode copy) | Removed from `opencode-assets/`. Engine copy redesigned with targeted high-impact LLM-miss checks. Load mode changed to `on-demand`. |
| `project-conventions-governance` (opencode copy) | Removed from `opencode-assets/`. Manifest now points to `engine-assets/` canonical source. Load mode changed to `on-demand`. |
| `commit-check-setup` | Added to all home instruction skill lists (opencode, codex, claude) for discoverability. |

## Remaining Items

### 1. Elegy-Reciprocal: Review `code-review` skill routing

The `code-review` skill is a purely descriptive compatibility wrapper. It routes via documentation only (no executable logic). In OpenCode, routing is hardcoded in lane agent instructions (task tool → reviewer subagent). In Copilot, routing is via @mentions.

**Decision needed:** Can this skill be deprecated in favor of the built-in reviewer agent routing, or does it serve a real compatibility function?

### 2. `elegy-repo-setup` executable skill — GAP

There is no executable Elegy-labeled repo setup skill. The engine's `repo-setup-governance` is read-only (audit/propose only). Need a new skill that:

- Creates `.github/copilot-instructions.md`, `.github/agents/`, `.github/skills/` if missing
- Runs `commit-check-setup` as a sub-step
- Sets up canonical doc entrypoint (`docs/system/index.md`)
- Reports what was created/updated

### 3. `security` skill — needs depth expansion

The current redesign focuses on 6 targeted categories (secrets, auth bypass, dependency confusion, path traversal, cookie security, injection). Should eventually add:

- OWASP Top 10 mappings per finding
- Language-specific vulnerability patterns (Python SQLi vs Java SQLi vs Rust SQLi)
- Tool recommendations (trufflehog, gitleaks, npm audit, trivy, snyk)
- CVSS scoring integration

### 4. `elegy-skills-discovery` — vault vs CLI coherence

The system has three skill discovery mechanisms that overlap:

- `skill-discovery` (engine-assets): vault-first filesystem resolver. Always-loaded.
- `elegy-skills-discovery` (catalog-assets): CLI-governed registry via `elegy-skills` binary. On-demand.
- `elegy-skills` (installed bridge): Non-authoritative surface bridge pointing to canonical body.

**Questions to resolve:**
- Should `elegy-skills-discovery` replace `skill-discovery` entirely when the CLI is available?
- The vault (`~/.copilot/skills-vault/`) has stale duplicates (e.g., `discovery/` is a copy of `skill-discovery/`). Cleanup?
- What happens when the `elegy-skills` CLI binary is not installed?

### 5. `skill-metadata-index.json` staleness

Several skills have metadata in SKILL.md frontmatter that is not propagated to the index. The `generate-skill-metadata-index.mjs` script exists but the index is stale. Need a CI step or pre-commit hook to keep it in sync.

### 6. Cross-harness `.github/` directory story

`.github/agents/` is Copilot-only (no mirroring). `.github/skills/` is Copilot-native but mirrors to other harnesses via `install-repo-skill-mirrors.mjs`. Need to decide:

- Is `.github/agents/` worth maintaining if only Copilot reads it?
- Should the mirror scripts also handle agent mirrors?
- Document for users which paths to use for each harness.

### 7. `elegy-obsidian` skill — missing from copilot-instructions.md

`elegy-obsidian` is listed in opencode and codex home instructions but not in copilot-instructions.md. Should be added for completeness.

### 8. Installed skills cleanup

After removing `stack-detector` and `roadmap-planning` from source, the installer auto-pruned them from `~/.config/opencode/skills/`. But `~/.copilot/skills-vault/` may still have stale copies:

- `stack-detector/` (should be removed)
- `roadmap-planning/` (should be removed)
- `discovery/` (stale duplicate of `skill-discovery/`)
- Various `always`-loaded skills have vault copies unnecessarily (`core-guardrails`, `project-guidelines`, `roadmap-authoring`)
