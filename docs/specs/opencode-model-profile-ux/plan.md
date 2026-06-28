# Implementation Plan: OpenCode Model & Profile Switching UX

**Spec:** `docs/specs/opencode-model-profile-ux/spec.md`
**Created:** 2026-06-08
**Status:** implemented

---

## Overview

This plan implements R0–R5 of the opencode-model-profile-ux spec. The goal is to fix the broken profile switching UX, isolate Codex config from OpenCode changes, add a discoverable model selector drawer, and harden the Permissions tab against crashes.

The work is ordered into 4 phases. Phase 1 (quick fixes) addresses the crash, the broken props, and the Codex contamination — these are independent and can run in parallel. Phase 2 (backend integration) makes profile activation actually work by invoking the CLI switch script, which depends on Phase 1's props fix for correct save behavior. Phase 3 (UX enhancement) adds the model selector drawer, which depends on Phase 2's model resolution infrastructure. Phase 4 (drift detection) adds the mismatch warning system, which depends on Phase 2's agent file access.

---

## Implementation Order

```
Phase 1: Quick Fixes (R1 + R4 + R0)
    → R1: Normalize permission values in GET /api/opencode/permissions
    → R4: Fix SectionProps to include saving, remove type casts
    → R0: Fix codex-config-patch.mjs default provider + add --provider-id
    → These have zero cross-dependencies — implement in any order
    → Run existing tests after each fix

Phase 2: Backend Integration (R2)
    → R2: POST /api/opencode/config invokes opencode-profile-switch.mjs
      via child_process
    → Add structured error handling for script failures
    → API returns success/failure and the UI surfaces messages
    → Depends on Phase 1 (R4 saving prop fix enables correct save flow)

Phase 3: UX Enhancement (R3)
    → R3: Replace free-text model inputs with selector drawer
    → Server exposes available models from profiles.json with display names
    → Drawer shows ModelName (Provider) for each option
    → Review model becomes editable through drawer
    → Depends on Phase 2 (model resolution infra from profile activation)

Phase 4: Drift Detection (R5)
    → R5: Compare state file active profile against agent frontmatter models
    → Surface mismatch warning banner in UI
    → Depends on Phase 2 (agent file access infrastructure)
```

---

## Step-by-Step with Estimates

### Phase 1 — Quick Fixes (60 min)

**1.1 R1 — Fix Permissions Tab Crash (15 min)**
- In `copilot-ui/routes/opencode.js`, modify the GET `/api/opencode/permissions` handler (lines 1251-1254) to normalize permission values to strings before sending the response.
- Add a `normalizePermissions()` helper that flattens object-valued permissions: `{ "allow": true }` → `"allow"`, `{ "deny": true }` → `"deny"`, `{ "ask": true }` → `"ask"`. Unknown objects → `"allow"` (safe default).
- The POST handler already sanitizes via `sanitizePermission()`; the gap is only in GET.
- Verify: Check that an existing OpenCode config with object-valued permissions no longer crashes the Permissions tab.

**1.2 R4 — Fix Component Props Wiring (20 min)**
- In `copilot-ui/ui/src/tabs/OpenCode/OpenCodeView.tsx`:
  - Update `SectionProps` type (line 456): add `saving: boolean`
  - Update all section component function signatures to accept `saving` (or explicitly ignore it with `_saving`)
  - Remove all `as unknown as React.FC<SectionProps>` casts from `SECTION_COMPONENTS` (lines 825-834)
  - Define per-section prop interfaces (e.g., `OverviewSectionProps`, `SetupSectionProps`)
  - Thread `state.saving` from the store into `<SectionComponent>` at line 882: `<SectionComponent status={state.status} selectedLaneId={state.selectedLaneId} saving={state.saving} />`
- Verify: Save button in Profiles tab disables during save. Activate button disables during save. TypeScript compilation passes.

**1.3 R0 — Fix Codex Config Contamination (35 min)**
- **Strategy:** Make `providerId` an **optional** parameter (default `undefined`). When undefined, skip the root-level `model_provider` key entirely. This avoids breaking the standalone CLI or the 16 call sites in `codex-config-patch.test.js`.
- In `scripts/codex-config-patch.mjs`:
  - Remove the hardcoded `DEFAULT_PROVIDER_ID = 'opencode-go'` on line 11.
  - Change `patchCodexConfig()` and `patchConfigFile()` signatures to accept an optional `{ providerId, modelId, reviewModelId }` object.
  - In `buildRootKeyLines()`, only emit `model_provider = "..."` when `providerId` is a non-empty string.
  - In `parseArgs()` (lines 316-341), add `--provider-id` argument support for standalone CLI invocation.
- In `scripts/codex-install.mjs`:
  - Accept a `--provider-id` CLI argument. Pass it through to `patchConfigFile()`.
  - When `--provider-id` is absent, `providerId` is `undefined` → no root-level `model_provider` key is written.
- In `scripts/codex-config-patch.test.js`:
  - The 16 call sites for `patchConfigFile()`/`patchCodexConfig()` already call without `providerId` → default `undefined` → behavior is preserved (no change needed if `providerId` is optional).
  - Tests that explicitly check for `model_provider = "` in output must be updated: those assertions should only pass when `providerId` IS provided. Add one test case WITH `--provider-id opencode-go` to confirm the key is written.
- Verify: Run `node scripts/codex-config-patch.test.js` passes. Run `node scripts/codex-install.mjs` without `--provider-id` → `~/.codex/config.toml` has NO root-level `model_provider` key. Codex uses its native provider. Run with `--provider-id opencode-go` → root-level key is written. Switching OpenCode profile in UI does NOT rewrite Codex config.

---

### Phase 2 — Backend Integration (45 min)

**2.1 R2 — Invoke Profile Switch Script from API (30 min)**
- In `copilot-ui/routes/opencode.js`, modify the POST `/api/opencode/config` handler (lines 950-983):
  - When `profileRoute` is provided:
    1. Resolve the script path: `const scriptPath = path.resolve(engineRoot, 'scripts/opencode-profile-switch.mjs')`.
    2. **Pre-invocation existence check:** Verify `fs.existsSync(scriptPath)`. If missing, return `{ ok: false, error: 'Profile switch script not found at: <path>' }`.
    3. Invoke `scripts/opencode-profile-switch.mjs` via `child_process.execFile` using `childProcess` from dependency injection (line 926). Pass the target profile as a CLI argument: `node <scriptPath> <profileRoute>`.
    4. Read stdout/stderr. On success (exit code 0): **move the existing `updateStateProfileRoute()` call (lines 960–964) to here** — only update the state file after the script succeeds.
    5. On failure (non-zero exit): do NOT update the state file. Return `{ ok: false, error: 'Profile switch failed: <stderr>' }`.
    6. **Timeout:** 30 seconds. On timeout, kill the child process via `child.kill('SIGTERM')`, return `{ ok: false, error: 'Profile switch timed out after 30s' }`.
- The `scripts/opencode-profile-switch.mjs` script already accepts a positional profile ID argument at line 71 (`const targetProfile = args[0]`). No script changes needed.
- Note: The existing `setAgentModels()` call (lines 966–973) writes to `opencode.jsonc`. The CLI script also syncs `opencode.jsonc` (lines 101–124). After profile activation succeeds, keep the script's sync as authoritative; the server-side `setAgentModels()` call is only needed when model overrides (small/big/review) are passed WITHOUT a profile change.
- Verify: Click "Activate" on deepseek-direct profile in UI → Confirm `~/.config/opencode/agents/quick.md` model field changes. Click "Activate" on opencode-go → Confirm reversal. Confirm state file is NOT updated when script fails.

**2.2 R2 — Error Handling and UI Feedback (15 min)**
- In `copilot-ui/ui/src/stores/opencodeStore.ts`, update `saveConfig()` to handle structured error responses from the API:
  - If `response.ok === false`, surface `response.error` in the error state.
- In `copilot-ui/ui/src/tabs/OpenCode/OpenCodeView.tsx` ProfilesSection:
  - Display `state.error` below the profile cards when a switch fails.
  - Display `state.message` on success.
- Verify: Simulate a failure (e.g., corrupt profiles.json) → UI shows error message. Normal switch → UI shows "Profile switched to deepseek-direct." success message.

---

### Phase 3 — UX Enhancement (60 min)

**3.1 R3 — Server-Side: Expose Available Models (15 min)**
- In `copilot-ui/routes/opencode.js`, update `buildProfiles()` to include an `availableModels` field:
  - Parse `opencode-assets/profiles.json`
  - Extract all unique model identifiers across all profiles
  - Build a lookup of `{ id: "deepseek/deepseek-v4-flash", displayName: "DeepSeek V4 Flash", provider: "deepseek" }` entries
  - Derive `displayName` from the identifier (strip provider prefix, convert kebab to title case) OR maintain a small hardcoded mapping
  - Return `availableModels` alongside `profiles` in the status response
- Update the `OpenCodeStatusResponse` TypeScript type (in `copilot-ui/ui/src/lib/types.ts`) to include `availableModels`
- Verify: `GET /api/opencode/status` response includes `availableModels` array.

**3.2 R3 — Client-Side: Model Selector Drawer (45 min)**
- In `copilot-ui/ui/src/tabs/OpenCode/OpenCodeView.tsx` ProfilesSection:
  - Replace the three `<input>` elements (small/big/review) with a ModelSelector drawer component
  - The drawer is a popover/panel triggered by clicking the current model display field
  - Each model option shows: `{displayName} ({provider})` — e.g., "DeepSeek V4 Flash (deepseek)"
  - Current selection is highlighted. Clicking an option closes the drawer and updates the field.
  - Support keyboard navigation (arrow keys, Enter to select, Escape to close)
  - The review model field becomes editable through the same drawer (not read-only with hardcoded string)
  - Reuse existing UI primitives (Badge, Button, Panel) — do NOT pull in a third-party dropdown library
- Initialize `reviewModel` from `status.profiles[activeProfileId].reviewModel` instead of hardcoded string
- Verify: Click model field → drawer opens with available models. Select a model → field updates. Save → models applied.

---

### Phase 4 — Drift Detection (30 min)

**4.1 R5 — Server-Side: Detect Profile Mismatch (15 min)**
- In `copilot-ui/routes/opencode.js`, in `buildOpenCodeStatus()`:
  - Read the state file's `activeProfileRoute`
  - Read one agent file (`~/.config/opencode/agents/standard.md`) and extract its frontmatter `model` field
  - Read the expected model from `profiles.json` for that agent's role (standard → big → look up in active profile)
  - Compare: if the agent file model doesn't match the active profile's expected model, set `profileMismatch: true` and include `expectedProfile: <id>`, `actualModel: <model>`, `expectedModel: <model>`
- **Limitation:** Drift detection samples only `standard.md`. If users edit other agent files (e.g., `quick.md`, `spec.md`) independently, those mismatches won't be flagged. This is a best-effort gate per the spec's "at least one agent file" requirement. Full multi-agent cross-check is out of scope.
- Return `profileMismatch` in the status response. Update `OpenCodeStatusResponse` type.
- Verify: Manually edit `standard.md` to a different model → status response includes `profileMismatch: true`.

**4.2 R5 — Client-Side: Mismatch Warning Banner (15 min)**
- In `copilot-ui/ui/src/tabs/OpenCode/OpenCodeView.tsx` ProfilesSection:
  - When `status.profileMismatch` is true, render a yellow warning banner below the profile cards:
    ```
    ⚠ Profile mismatch detected: active profile is {expectedProfile} but agent files use {actualModel} instead of {expectedModel}. Click Activate to re-apply.
    ```
  - Use the existing `Badge` component with `tone="warning"` or a styled div with yellow background
  - The banner must include the "Activate" button for the mismatched profile
- Verify: Manually create mismatch → yellow banner appears. Click Activate → mismatch resolved → banner disappears.

---

## Dependency Graph

```
R1 (Permissions crash) ──── independent ────┐
                                             │
R4 (Props wiring) ──────── independent ──────┤
                                             │
R0 (Codex isolation) ───── independent ──────┤
                                             │
                        ┌────────────────────┘
                        ▼
                    R2 (Backend integration)
                        │
              ┌─────────┴─────────┐
              ▼                   ▼
          R3 (Model drawer)   R5 (Drift detection)
```

- R1, R4, R0: Zero dependencies between them — can implement in any order or in parallel.
- R2: Depends on R4 (correct `saving` prop wiring enables the save/activate flow).
- R3: Depends on R2 (model resolution infrastructure from profile activation + available models from profiles.json).
- R5: Depends on R2 (agent file access infrastructure to read frontmatter for comparison).

---

## Files to Modify

| Phase | File | Changes |
|-------|------|---------|
| P1 R1 | `copilot-ui/routes/opencode.js` | Add `normalizePermissions()` helper; use in GET handler |
| P1 R4 | `copilot-ui/ui/src/tabs/OpenCode/OpenCodeView.tsx` | Update SectionProps, fix type casts, thread saving |
| P1 R4 | `copilot-ui/ui/src/stores/opencodeStore.ts` | No changes needed (saving already in state) |
| P1 R0 | `scripts/codex-config-patch.mjs` | Remove DEFAULT_PROVIDER_ID constant; accept optional providerId param; add --provider-id to parseArgs |
| P1 R0 | `scripts/codex-install.mjs` | Add --provider-id CLI argument |
| P1 R0 | `scripts/codex-config-patch.test.js` | Update tests asserting `model_provider = "` in output; add test with --provider-id |
| P2 R2 | `copilot-ui/routes/opencode.js` | POST handler invokes opencode-profile-switch.mjs via child_process; reorder state file update; add existence check + timeout |
| P2 R2 | `copilot-ui/ui/src/stores/opencodeStore.ts` | Handle structured API errors in saveConfig |
| P2 R2 | `copilot-ui/ui/src/tabs/OpenCode/OpenCodeView.tsx` | Show error/success messages for profile switch |
| P3 R3 | `copilot-ui/routes/opencode.js` | Add availableModels to buildProfiles response |
| P3 R3 | `copilot-ui/ui/src/lib/types.ts` | Add availableModels to OpenCodeStatusResponse |
| P3 R3 | `copilot-ui/ui/src/tabs/OpenCode/OpenCodeView.tsx` | Replace text inputs with ModelSelector drawer |
| P4 R5 | `copilot-ui/routes/opencode.js` | Detect profile mismatch in buildOpenCodeStatus |
| P4 R5 | `copilot-ui/ui/src/lib/types.ts` | Add profileMismatch to OpenCodeStatusResponse |
| P4 R5 | `copilot-ui/ui/src/tabs/OpenCode/OpenCodeView.tsx` | Render mismatch warning banner |

---

## Validation

After each phase:
- Run `npm run test:all` to ensure no regressions
- Run `npm run ci:local` to ensure TypeScript compiles and all validators pass
- Manual verification per acceptance check in spec.md

After all phases:
- Run spec validator against the spec
- Run full CI pass
- Manually verify all 6 acceptance checks from spec.md
