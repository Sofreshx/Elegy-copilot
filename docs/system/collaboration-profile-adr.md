---
created: 2026-06-22
updated: 2026-06-30
category: system
status: current
doc_kind: node
id: collaboration-profile-adr
summary: Store user collaboration preferences in ~/.elegy/config.json, compose between shared baseline and harness appendix, never copy into repo files.
tags: [adr, collaboration, instruction-composition, config]
related: [harness-asset-flow, concise-instruction-governance, copilot-ui-guide]
---

# Collaboration Profile ADR

## Context

Elegy Copilot composes instruction files for five harnesses (Copilot, Codex, OpenCode, Claude Code, Antigravity) from a shared baseline (`agent-session-defaults.md`) and harness-specific appendices. Users have no mechanism to add personal communication preferences — all instructions are either universal (baseline) or harness-specific (appendix).

Users want to inject personal preferences (e.g., attention-friendly communication style, conciseness preferences) without modifying repo-owned files. The preferences must survive reinstalls and not leak into repositories.

## Decision

1. **Store preferences in `~/.elegy/config.json`** under a `collaborationProfile` key. This is the same config file used for `remoteSessions` and follows the existing atomic read-modify-write pattern in `copilot-ui/lib/copilotConfig.js`.

2. **Compose the profile between the shared baseline and harness appendix.** The composition order is:

   ```
   shared baseline
   → collaboration profile (preset + custom)
   → harness appendix
   → repo-local instructions
   → explicit task instructions
   ```

   This ensures personal preferences can refine but not override harness-operational constraints (appendix always follows profile).

3. **Never copy personal preferences into repository files.** The profile is read at install time from `~/.elegy/config.json` and injected into the composed output. It is never written to `catalog-assets/`, harness appendix files, or repo-local instruction files.

4. **Keep repo and task instructions higher authority.** The profile layer sits below the harness appendix in precedence, and both repo-local and explicit task instructions override all composed layers.

## Consequences

### Positive

- Users gain a durable, portable way to shape AI communication style across all harnesses.
- Single source of truth for personal preferences — no duplication across harness files.
- Survives reinstalls and upgrades without user intervention.
- Installed harnesses update immediately on profile save (no full reinstall needed).
- Non-intrusive: when disabled, composition behaves exactly as before.

### Tradeoffs

- Composition pipeline gains a third input (baseline, profile, appendix instead of baseline, appendix). All composition call sites across 5 installers and the API apply path must be updated.
- Managed inventory hashing changes: hashes now include profile content, so first post-change installer run will rewrite all instruction files even if baseline and appendix are unchanged. This is a one-time event.
- The `copilot-ui/lib/assets.js` duplicate composer must be reconciled with the canonical `scripts/instruction-compose-utils.mjs`.
- Antigravity's managed-block approach requires the profile to be pre-composed before the managed block is rendered, adding one extra composition step for the Antigravity path.

### Follow-up

- Consider adding a profile preview endpoint that shows composed output without applying.
- Consider per-harness profile overrides in a future version (v1 applies uniformly).
