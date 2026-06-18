---
created: 2026-02-27
updated: 2026-06-15
category: system
status: resolved
doc_kind: node
id: implementation-friction-log
summary: Append-only log of recurring implementation friction discovered during normal delivery work.
tags: [friction, refactor-input, delivery]
---

# Implementation Friction Log

## Usage
- Append-only log for recurring codebase pain points.
- Keep entries concise; do not derail active implementation.
- `Suggestion` can be blank when analysis would be too expensive in current scope.

## Entry Template

### [YYYY-MM-DD HH:mmZ] Short title
- **Reason:**
- **Importance:** low | medium | high | critical
- **Context:**
- **Symptoms:**
- **Impact on Delivery:**
- **Suggestion:**
- **Confidence:** low | medium | high
- **Cluster ID:** _(optional)_
- **Recurrence Count:** _(optional)_
- **Auto-Remediation Candidate:** _(optional, yes/no)_

## Entries

### [2026-06-15 16:35Z] npm install: infinite @elegy-copilot/root nesting on Windows
- **Reason:** `copilot-ui/package.json` declares `"@elegy-copilot/root": "file:.."` which causes npm to install the entire monorepo root as a dep inside `copilot-ui/node_modules/@elegy-copilot/root`. Because the root package has its own `node_modules/` (with workspace deps) and is itself a `file:` dep of its own descendant, npm materializes deeply nested copies that exceed Windows MAX_PATH (260 chars).
- **Importance:** medium
- **Context:** Reproducible on every `npm install` inside `copilot-ui/`. Triggers thousands of "Filename too long" warnings from any tool that recursively traverses `node_modules/` (git, ripgrep, npm itself, file watchers).
- **Symptoms:** `git status` and `git ls-files` flood with "could not open directory ... Filename too long" warnings; some tools fail outright or hang; package install can take very long.
- **Impact on Delivery:** Slows every filesystem-wide operation in `copilot-ui/` on Windows. Hurts dev loop. Also makes the `.gitignore` look like it might be failing when in fact it is not — the warnings come from `node_modules/`, which is already ignored.
- **Suggestion:** Replace the self-referential `"@elegy-copilot/root": "file:.."` dep with a workspace-relative path or move the assets the desktop app actually needs (engine-assets, contracts types) into a smaller dedicated package. Alternatively, add a `file:..` postinstall that flattens/symlinks the nested copy. Track under a spec before changing — affects cross-workspace asset loading.
- **Confidence:** high
- **Cluster ID:** windows-fs-limits
- **Recurrence Count:** 1 (observed 2026-06-15)
- **Auto-Remediation Candidate:** no
- **Resolution (2026-06-15):** Removed `"@elegy-copilot/root": "file:.."` from `copilot-ui/package.json`. The dependency was dead — zero source imports anywhere in the monorepo, and all engineRoot resolution uses filesystem paths (`path.resolve(__dirname, '..')`), not npm resolution. Regenerated both root and copilot-ui lockfiles.

