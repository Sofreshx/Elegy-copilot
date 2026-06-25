---
created: 2026-06-09
updated: 2026-06-18
category: meta
status: current
doc_kind: node
id: skill-cleanup-followups
summary: "Remaining work from the June 9 2026 skill audit. Items that need dedicated investigation or implementation in a future session."
tags: [planning, skills, audit, follow-up]
---

# Skill Cleanup Follow-Ups

## Completed 2026-06-18 (added in this update)

| Surface | Action |
|---------|--------|
| guidelines.md | Deleted (per-repo entrypoint surface fully retired) |
| engine-assets/skills/guidelines-authoring/ | Deleted (governed deprecated surface) |
| engine-assets/skills/project-guidelines/ | Deleted (governed deprecated surface) |
| `catalog-assets/shared-skills/skill-authoring/` | New shared skill (agentskills.io spec) |
| `catalog-assets/shared-skills/agents-md-authoring/` | New shared skill (AGENTS.md open standard) |
| `catalog-assets/instructions/agent-session-defaults.md` | Added `## Code Quality Posture` section |
| `scripts/validate-guidelines-wiring.mjs` | Replaced by `scripts/validate-instruction-wiring.mjs` (old script is a deprecation shim) |

All 5 harness manifests and per-harness appendices updated. `docs/system/skills-governance.md` updated to add the new skills to the planning-critical install set and reference the agentskills.io spec as the canonical format. See `docs/specs/skill-authoring-and-guidelines-deprecation/spec.md` for the full change set.

## Completed This Session (2026-06-09 audit)

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

- Creates .github/copilot-instructions.md, .github/agents/, .github/skills/ if missing
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
- The vault (~/.elegy/skills-vault/) has stale duplicates (e.g., discovery/ is a copy of skill-discovery/). Cleanup?
- What happens when the `elegy-skills` CLI binary is not installed?

### 5. `skill-metadata-index.json` staleness

Several skills have metadata in SKILL.md frontmatter that is not propagated to the index. The scripts/generate-skill-metadata-index.mjs script exists but the index is stale. Need a CI step or pre-commit hook to keep it in sync.

### 6. Cross-harness `.github/` directory story

`.github/agents/` is Copilot-only (no mirroring). `.github/skills/` is Copilot-native but mirrors to other harnesses via scripts/install-repo-skill-mirrors.mjs. Need to decide:

- Is .github/agents/ worth maintaining if only Copilot reads it?
- Should the mirror scripts also handle agent mirrors?
- Document for users which paths to use for each harness.

### 7. `elegy-obsidian` skill — missing from copilot-instructions.md

`elegy-obsidian` is listed in opencode and codex home instructions but not in copilot-instructions.md. Should be added for completeness.

### 8. Installed skills cleanup

After removing `stack-detector` and `roadmap-planning` from source, the installer auto-pruned them from ~/.config/opencode/skills/. But ~/.elegy/skills-vault/ may still have stale copies:

- stack-detector/ (should be removed)
- roadmap-planning/ (should be removed)
- discovery/ (stale duplicate of skill-discovery/)
- Various always-loaded skills have vault copies unnecessarily (core-guardrails, project-guidelines, roadmap-authoring)

### 9. Stale referenced detection — scripts and tests

A comprehensive grep after removal found stale references in production scripts, tests, and docs:

**P0 — breaks tests:** 8 test files assert removed skills exist:
- scripts/opencode-install.test.js, scripts/codex-install.test.js, scripts/antigravity-install.test.js, scripts/cli-install.test.js
- scripts/skill-search.test.js, scripts/generate-skill-metadata-index.test.js
- copilot-ui/routes/planning.test.js, copilot-ui/routes/sessions.test.js

**P0 — script breaks:** `scripts/validate-manifest.js` expects stack-detector in all manifests.
`scripts/validate-first-party-exact-name-reference-audit.js` references the deleted SKILL.md path.
`local-tracker/scripts/spike-cli-auth-entrypoint.sh` has stack-detector in its ALWAYS_LOADED_SKILLS.

**P1 — UI routes reference removed skill:** `copilot-ui/routes/planning.js` includes `roadmap-planning` in `skillsRequired` array. `copilot-ui/routes/sessions.js` conditionally adds it. These will produce broken continuation packages.

**P2 — docs/references still mention removed skills:** docs/system/opencode-guide.md, docs/system/skills-governance.md, docs/system/search-execute-workflow.md, docs/system/system-upgrade-direction-2026.md, docs/lexicon/project-specific.md, docs/specs/asset-sync-truthfulness/spec.md, docs/research/shipped-skill-quality-audit.md, docs/system/instruction-changelog.md.

All non-code stale references (P2-P3) should be cleaned up when the code references are fixed.

### 10. `roadmap-planning-lane` naming ambiguity

The lane definition in catalog-assets/shippedAssets.mjs (id: `roadmap-planning-lane`) bundles `skill-roadmap-authoring` and describes "Repository Backlog & Roadmap Skills." This lane may serve a valid purpose, but its name is misleading now that the `roadmap-planning` skill is gone. Consider renaming to `roadmap-authoring-lane`.
