---
spec_id: collaboration-style-profile
title: Collaboration Style and Personal Instructions
status: draft
type: feature
updated: 2026-06-30
---

# Collaboration Style and Personal Instructions

## Intent

Add a configurable user-level collaboration profile to Elegy Copilot. The shared baseline keeps universal anti-sycophancy and critical-coworker behavior. A default "Constructive Coworker" preset adds attention-friendly communication preferences and can be edited or disabled in Settings. The profile layer is composed between the shared baseline and the harness appendix.

Instruction precedence:

```text
shared baseline
→ user collaboration profile
→ harness appendix
→ repo-local instructions
→ explicit task instructions
```

V1 applies to installed Copilot, Codex, OpenCode, Claude Code, and Antigravity surfaces.

## Context Evidence

- `catalog-assets/instructions/agent-session-defaults.md` — Shared baseline composed with harness-specific appendix at install time. Contains universal instruction contracts (Concise Instruction, Clarification, Planning, etc.) but no collaboration-style or communication-preference layer.
- `scripts/instruction-compose-utils.mjs` — Authority composition function: `composeInstructions(baselinePath, appendixPath)`. Returns `baseline + "\n\n---\n\n" + appendix`. This is the insertion point for the profile layer.
- `copilot-ui/lib/copilotConfig.js` — Authoritative `~/.elegy/config.json` reader/writer. Currently manages only `remoteSessions`. Extend to persist `collaborationProfile`.
- `docs/system/harness-asset-flow.md` — Two-tier deployment model (home-level install + per-repo discovery). Instruction precedence not yet documented with a profile layer.
- `copilot-ui/routes/config.js` — 14 config API routes. No collaboration profile endpoints exist.
- `copilot-ui/ui/src/views/Settings/SettingsView.tsx` — Settings section router with 11 sections. No collaboration style panel exists.
- `copilot-ui/ui/src/components/` — Panel, ToggleField, Button, FormInput, Badge, Toolbar components available for UI reuse.

## Requirements

### Allowed Behavior

- User can enable/disable a collaboration profile via Settings UI.
- Default preset is "Constructive Coworker" with pre-authored content.
- User can write custom instructions (up to 8,000 characters) that append after the preset content.
- Profile is persisted atomically in `~/.elegy/config.json` under a `collaborationProfile` key.
- Profile is composed between the shared baseline and the harness appendix at install time.
- Save applies the composed content to all currently installed harness targets.
- Per-harness apply results are reported individually; one target failure does not block others.
- When disabled, neither preset nor custom content is included in composition.
- Antigravity GEMINI.md managed block preserves user-owned content outside the Elegy-managed block.
- Future installer runs automatically apply the saved profile.

### Forbidden Behavior

- Writing personal preferences into repository files or repo-local instruction files.
- Copying profile content into harness appendix files or the shared baseline.
- Installing harnesses that are not currently present on the system.
- Running complete harness installers from the API apply path.
- Overwriting user-owned content outside the managed block in Antigravity GEMINI.md.
- Accepting unknown preset IDs, NUL characters, or text exceeding 8,000 characters.
- Allowing custom instructions to override harness-operational constraints (appendix always comes after profile).
- Broading this into multiple named profiles, cloud synchronization, per-repo profiles, or structured challenge-level controls.

## Non-Goals

- Multiple named profiles beyond the single "Constructive Coworker" default.
- Cloud synchronization of profile settings.
- Per-repository collaboration profiles.
- Structured challenge-level or behavior-modulation controls.
- Secret storage or credential management.
- Profile injection into repo-local instruction files.
- Adding new Settings navigation sections — collaboration style sits under existing App Settings.

## Acceptance Checks

- Default profile composes correctly when config.json is absent.
  → verify: `node scripts/validate-instruction-wiring.mjs` with no `collaborationProfile` in config → baseline + appendix only, no profile layer.
- Unknown config keys survive profile writes.
  → verify: Manual: Add `{"customKey": "value"}` to `~/.elegy/config.json` alongside `collaborationProfile`. Save profile via API. Verify `customKey` persists.
- Disabled profile omits preset and custom content from composed output.
  → verify: API set `enabled: false`. Run installer. Composed instruction file contains baseline + appendix only, no preset or custom text.
- Composition order is baseline → preset → custom → appendix.
  → verify: Enable profile with preset and custom text. Run installer. Verify custom text appears after preset but before harness appendix separator.
- Unknown presets, oversized text, and NUL characters return 400.
  → verify: PUT with `presetId: "nonexistent"` → 400. PUT with 8001-char customInstructions → 400. PUT with `customInstructions: "has\0nul"` → 400.
- Installer reruns produce identical output and report unchanged state.
  → verify: Run installer twice with same profile. Second run reports all targets as `unchanged`.
- Codex, OpenCode, Claude, and Copilot regenerate managed files on save.
  → verify: Save profile via UI. Check each harness instruction file contains the profile content.
- Antigravity preserves content outside its managed block.
  → verify: Add user text before and after `<!-- elegy-copilot:begin antigravity -->` block. Save profile. Verify user text is preserved and only managed block content changes.
- Missing harness files report `not-installed`.
  → verify: Delete `~/.claude/CLAUDE.md`. Save profile. Claude result is `not-installed`.
- One failed target does not block other targets or lose the saved profile.
  → verify: Make a harness file read-only. Save profile. Saved profile persists. Other targets applied. Failed target reports error.
- Settings UI loads, edits, resets, disables, saves correctly with loading/error/success states.
  → verify: Manual UI walkthrough with all states.
- No personal content written into repo-local files.
  → verify: Search repo-local instruction files for profile content after save → empty.

## Implementation Links

- `docs/specs/collaboration-style-profile/spec.md` (this file)
- `docs/system/collaboration-profile-adr.md` — Architecture decision record
- `catalog-assets/instructions/agent-session-defaults.md` — Shared baseline (add Collaboration Contract section)
- `catalog-assets/presets/constructive-coworker.md` — Default preset content
- `scripts/instruction-compose-utils.mjs` — Composition core (extend for profile layer)
- `copilot-ui/lib/copilotConfig.js` — Config persistence (extend for collaborationProfile)
- `copilot-ui/lib/compose-instructions.cjs` — CJS wrapper for server-side composition
- `copilot-ui/routes/config.js` — API endpoints (add GET/PUT)
- `copilot-ui/ui/src/views/Settings/CollaborationStyleSettingsView.tsx` — Settings UI
- `copilot-ui/ui/src/lib/api/config.ts` — API client
- scripts/*-install.mjs — All 5 harness installers (update composition call sites)

## Validation Evidence

- pending

## Drift Notes

- none
