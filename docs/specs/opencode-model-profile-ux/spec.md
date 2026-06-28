---
spec_id: opencode-model-profile-ux
title: OpenCode Model & Profile Switching UX
status: implemented
type: feature
updated: 2026-06-08
---

# OpenCode Model & Profile Switching UX

## Intent

The OpenCode settings UI in Elegy Copilot offers profile switching (opencode-go vs deepseek-direct) and per-role model overrides (small/big/review), but the current implementation is broken in five ways: (0) switching profiles or running codex-install contaminates Codex config by hardcoding `model_provider = "opencode-go"` as a root-level key outside the managed block, breaking Codex when `OPENCODE_API_KEY` is not set; (1) activating a profile only writes to a state file without applying model changes to agent files, so the active profile badge is disconnected from actual agent configuration; (2) model selection uses free-text inputs instead of a discoverable selector drawer showing real available model names with provider context; (3) the Permissions tab crashes with React error #31 when OpenCode's config contains object-valued permission entries; and (4) a missing `saving` prop leaves save buttons permanently enabled during save operations. This spec defines the hardening requirements to close these gaps.

## Context Evidence

- `scripts/codex-config-patch.mjs` — `DEFAULT_PROVIDER_ID` hardcoded. `buildRootKeyLines()` writes the provider as a root-level key in the config preamble, OUTSIDE the managed block markers. This means the root-level provider survives `stripManagedBlock()` independently.
- `scripts/codex-install.mjs` — Imports and calls `patchConfigFile()` during `runInstall()`, writing the hardcoded provider to the Codex config. No CLI argument or OpenCode profile awareness.
- `copilot-ui/lib/codexConfig.js` — `setMode()` already has `stripIeManagedRootKeys` logic for the DeepSeek bridge case. The config patch script does not follow this same managed-block pattern for root keys.
- `scripts/opencode-profile-switch.mjs` — This script is INNOCENT — zero references to Codex, the provider, or the Codex config. It only edits agent files and the OpenCode config. The contamination is purely from the config patch and install scripts.
- `copilot-ui/routes/opencode.js` — Imports `codexConfig` lib but only calls read-only `getPlanningSkillStatus()`. No write operations on Codex config.
- `copilot-ui/ui/src/tabs/OpenCode/OpenCodeView.tsx` — ProfilesSection: profile cards render but "Activate" only writes to the state file without running the CLI profile switch script. The `saving` prop is destructured but not wired via `SectionProps`.
- `copilot-ui/ui/src/tabs/OpenCode/OpenCodeView.tsx` — `reviewModel` hardcoded as a useState string, ignoring the actual review model from the active profile.
- `copilot-ui/ui/src/tabs/OpenCode/OpenCodeView.tsx` — Model Selection panel uses plain text inputs with no autocomplete or selector drawer.
- `copilot-ui/ui/src/tabs/OpenCode/OpenCodeView.tsx` — PermissionsSection: Badge component receives raw config values. OpenCode config allows permission values as nested objects, causing React error #31.
- `copilot-ui/routes/opencode.js` — `sanitizePermission()` validates as strings only, but GET endpoint returns raw config without sanitization.
- `copilot-ui/routes/opencode.js` — POST config handler: profile changes call state-only update. Model changes call `setAgentModels()`. No integration with the profile switch script.
- `copilot-ui/lib/opencodeConfig.js` — `getActiveProfileRoute()` reads from state file, defaults to `opencode-go`. No cross-check against actual agent frontmatter files.
- `opencode-assets/profiles.json` — Two profiles with model strings and `agentRoles` mapping. This is the canonical source for available models and their provider prefixes.

## Requirements

### Allowed Behavior

- Codex config protected from OpenCode profile changes (absolute separation)
- Object-valued permissions normalized to strings so permissions tab renders without crash
- Profile activation applying models to agent frontmatter files via `opencode-profile-switch.mjs`
- Per-role model selection dropdowns derived from `profiles.json` as canonical source
- Save/Activate button correctly disabled during save operations via `saving` prop
- Active profile badge reflecting actual agent frontmatter state
- Profile mismatch detection with warning banner when state file and agent files diverge
- `codex-config-patch.mjs` accepting `--provider-id` argument for controlled fallback

### Forbidden Behavior

- Writing OpenCode profile changes to `~/.codex/config.toml` under any circumstances
- Hardcoded default provider ID as root-level key in Codex config assuming `OPENCODE_API_KEY`
- Codex Provider Panel being bypassed by OpenCode profile switching
- Permissions tab crashing with object-valued permission entries
- Free-text model inputs without selector or autocomplete (must use `<select>` dropdowns)
- `reviewModel` hardcoded instead of reading from active profile
- `ProfilesSection` using undefined `saving` prop (must be wired via `SectionProps`)
- Active profile badge based only on state file without cross-checking agent files
- Adding new profiles beyond existing `opencode-go` and `deepseek-direct`

### R0 — Codex Config Must Be Isolated from OpenCode Profile Changes

- `scripts/codex-config-patch.mjs` must NOT hardcode a default provider ID at the root level that assumes `OPENCODE_API_KEY` is available. The `DEFAULT_PROVIDER_ID` fallback is scoped to managed block profiles only (written inside `[profiles.X]` tables, not as a root-level `model_provider` key). When no OpenCode API key is configured, Codex falls back to its native provider.
- `scripts/codex-install.mjs` accepts a `--provider-id` argument so the caller can control which provider is written for the managed block. The root-level `model_provider` key is not written when using managed block profiles.
- The OpenCode profile switching UI (`POST /api/opencode/config`) does NOT write to Codex config under any circumstances. The separation is absolute.
- The Codex Provider Panel remains the sole UI path for configuring Codex providers.

### R1 — Fix Permissions Tab Crash

- The GET `/api/opencode/permissions` endpoint must normalize all permission values to strings before returning them to the UI. Object-valued permissions (e.g., `{ "allow": true }`) must be flattened to their equivalent string form (`"allow"`).
- The UI `OpenCodePermissions` type must remain `{ [key: string]: string }` after normalization, ensuring `<Badge>{value}</Badge>` always receives a string.
- The user's existing OpenCode config with object-valued permissions must load without crashing.

### R2 — Profile Activation Must Apply Models to Agent Files

- When a user clicks "Activate" on a profile card, the backend (`POST /api/opencode/config` handler) must invoke `scripts/opencode-profile-switch.mjs` via `child_process` to apply the profile change. The server's dependency injection already provides `childProcess` at `opencode.js:926`.
- The invoked script must receive the target profile ID as an argument. The script must:
  1. Read the target profile's model assignments from `opencode-assets/profiles.json`
  2. Update agent frontmatter files in `~/.config/opencode/agents/` with the correct model per agent role
  3. Sync `opencode.jsonc` agent model entries
  4. The API handler then updates the state file with the new active profile (already implemented via `updateStateProfileRoute()`).
- The UI must show accurate "Active" badges based on which profile is actually applied (not just which one was last clicked in the state file).
- If the CLI switch script cannot run (e.g., missing `node`, missing `profiles.json`, ESM import failures), the API must return a structured error that the UI surfaces as a clear user-facing message.
- **Guard:** This operation must NOT touch `~/.codex/config.toml` or any Codex configuration files.

### R3 — Model Selection with Per-Role Controls

- Replace the free-text model inputs with per-role `<select>` dropdowns showing available model options. (Design note: drawer/popover was deferred; inline `<select>` inputs with `opencode-model-select` styling are the current UX.)
- The model list is derived from `opencode-assets/profiles.json` as the canonical source. The server exposes models through `buildProfiles()` with both the provider-prefixed identifier (e.g., `deepseek/deepseek-v4-flash`) and a human-readable display name (e.g., `DeepSeek V4 Flash`).
- Each model option displays the model's display name and provider name (e.g., "DeepSeek V4 Flash (deepseek)").
- All five role model selections (planning, implementation, exploration, review, research) are independently overridable within the Model Selection panel.
- The review model field reflects the actual review model from the active profile, not a hardcoded string. The profile's review model is editable through the same selector mechanism.

### R4 — Fix Component Props Wiring

- `SectionProps` (line 456) must include `saving: boolean` so that `ProfilesSection` receives `saving` state from the store.
- The "Save models" button must be disabled (`disabled={!modelsDirty || saving}`) during save operations.
- The "Activate" button must be disabled during save operations.
- All `as unknown as` type casts for section components must be removed; each section must have a type-safe props interface that matches what the component actually destructures.

### R5 — Profile State Accuracy

- The `activeProfileId` in the UI status response must reflect the actual applied profile (verified against agent frontmatter files), not just the state file value.
- When the state file's `activeProfileRoute` diverges from the actual agent frontmatter models, the UI must surface a warning: a yellow banner below the profile cards reading "Profile mismatch detected: active profile is [X] but agent files use [Y] models. Click Activate to re-apply."
- The mismatch detection must compare the state file active profile against at least one agent file's frontmatter model field to determine if the correct profile is applied.

## Non-Goals

- Adding new profiles beyond the existing `opencode-go` and `deepseek-direct`.
- Changing the profiles.json schema or agentRoles mapping.
- Full runtime model validation (e.g., checking if a model string is valid against the provider API).
- Redesigning the entire OpenCode settings layout — only the Profiles tab content changes.
- Supporting profile switching for non-OpenCode harnesses (Codex, Copilot, Antigravity) from the OpenCode settings tab. Codex has its own Provider Panel for that.
- Implementing a full configuration diff/merge strategy for `~/.codex/config.toml` managed blocks — only the hardcoded default provider bug is in scope.

## Acceptance Checks

- Codex config is not affected by OpenCode profile switching.
  → verify: Manual: Switch OpenCode profile via UI → check Codex config — root key must remain unchanged.
- Permissions tab renders without crashing when OpenCode config contains object-valued permission entries.
  → verify: Manual: Open the OpenCode settings → Permissions tab. Confirm no white screen / crash.
- Activating a profile updates agent frontmatter files with the correct models.
  → verify: Manual: Switch profile in UI → check agent file frontmatter model field changed.
- Model selection panel shows a drawer with model name + provider for each role.
  → verify: Manual: Open Profiles tab → click model selector → drawer shows available models.
- Save button is disabled when no changes are pending and during save operations.
  → verify: Manual: Open Profiles → confirm Save models is disabled. Edit a model → button enables. Click Save → button shows "Saving..." and is disabled.
- Active profile badge matches actual agent configuration with mismatch warning when they diverge.
  → verify: Manual: Open Profiles tab → note which profile shows "Active" badge. If manually edit agent files to mismatch, UI shows yellow banner.

## Implementation Links

- `docs/specs/opencode-model-profile-ux/spec.md` (this file)
- `docs/specs/opencode-model-profile-ux/plan.md` — Phased implementation plan
- `copilot-ui/ui/src/tabs/OpenCode/OpenCodeView.tsx` — ProfilesSection, PermissionsSection, SectionProps, drawer component
- `copilot-ui/routes/opencode.js` — buildProfiles, permissions endpoints, config endpoint, child_process invocation
- `copilot-ui/lib/opencodeConfig.js` — readConfig, state management, profile drift detection
- `opencode-assets/profiles.json` — profile definitions and agentRoles (canonical model source)
- `scripts/opencode-profile-switch.mjs` — CLI profile switch (invoked by backend via child_process)
- `scripts/frontmatter-utils.mjs` — YAML frontmatter parsing (fixed CRLF line ending handling)
- `scripts/codex-config-patch.mjs` — DEFAULT_PROVIDER_ID hardcoding and root-key placement (fix)
- `scripts/codex-install.mjs` — patchConfigFile call site (add --provider-id argument)

## Validation Evidence

- `node scripts/validate-specs.js --strict docs/specs/` — No errors for `opencode-model-profile-ux` spec. All remaining errors are pre-existing in other specs.
- `node scripts/codex-config-patch.test.js` — 12/12 tests pass, including new `--provider-id` test.
- `npm --prefix copilot-ui run test:vitest` — 265/270 tests pass; 5 pre-existing failures unrelated to these changes. `opencode-api.vitest.ts` passes all 17 tests including new child_process mock tests.
- `npx tsc -p copilot-ui/ui/tsconfig.json --noEmit` — 0 new TypeScript errors introduced.
- `node -c copilot-ui/routes/opencode.js` — Syntax OK.
- `node -c scripts/codex-config-patch.mjs` — Syntax OK.
- `node -c scripts/codex-install.mjs` — Syntax OK.
- **Implementation Review**: PASS (verdict: pass, findings: 1 medium pre-existing, 2 low). All 6 requirements (R0–R5) implemented and verified.
- **Manual verification pending**: All 6 acceptance checks require manual validation with running app.

## Drift Notes

- **2026-06-08**: During implementation, discovered that `scripts/frontmatter-utils.mjs` (imported by `opencode-profile-switch.mjs`) failed to parse agent frontmatter on Windows due to CRLF line endings. The `parseFrontmatter` and `replaceFrontmatterField` functions used `/^---\n/` regex patterns that did not match `\r\n`. This caused `updateAgentModel` to always report `oldModel: undefined` and write files back unchanged. Fixed by normalizing `\r\n` → `\n` at the entry point (`updateAgentModel`) before passing content to parsing functions. Without this fix, profile switching updated `opencode.jsonc` correctly but agent `.md` files were never modified.
