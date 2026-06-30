---
spec_id: opencode-custom-prompts
title: OpenCode Custom System Prompts
status: implemented
type: feature
updated: 2026-06-30
liveness_skip_paths:
  - copilot-ui/ui/src/lib/api/opencode.ts
---

# OpenCode Custom System Prompts

## Intent

Enable users to add, edit, and remove custom system prompts per OpenCode agent, with optional model-specific overrides, through the Elegy Copilot UI. Prompts are applied safely—never clobbering manual user edits—and are activated when the agent's active model matches a configured override.

## Context Evidence

- `copilot-ui/lib/opencodeConfig.js` — `readConfig`/`writeConfig` for the OpenCode config, `readState`/`writeState` for the agent state sidecar. The sidecar is the existing mechanism for Elegy-managed agent state. `applyProfile` shows the pattern for writing role-level config on profile switch. `setAgentRoleModels` shows the save-then-write pattern.
- `copilot-ui/routes/opencode.js` — `POST /api/opencode/config` handler. Accepts `profileId`, `roleModels`, `smallModel`/`bigModel`/`reviewModel`. Profile activation invokes the profile switch script then calls `setAgentRoleModels`/`setAgentModels`. This is the injection point for prompt application.
- `copilot-ui/ui/src/tabs/OpenCode/OpenCodeView.tsx` — `TAB_SECTIONS` array with existing sub-tabs. `SECTION_COMPONENTS` map. A new `prompts` tab fits into this registry pattern.
- `copilot-ui/ui/src/lib/types.ts` — `OpenCodeTabSectionId` union type. Must be extended with `'prompts'`.
- `copilot-ui/ui/src/lib/types.ts` — `OpenCodeConfigPayload` interface. Only carries profile and model fields. No prompt field yet.
- `copilot-ui/ui/src/stores/opencodeStore.ts` — `OpenCodeState` interface and initial state. No prompt-related fields yet.
- `opencode-assets/profiles.json` — profiles with `roleModels` mapping roles to model IDs. Model IDs are the canonical source for available models.
- OpenCode schema: `AgentConfig.properties.prompt` is a `string`. When set, it replaces the agent's provider prompt. This is the target OpenCode field we write to.

## Requirements

### Allowed Behavior

- Custom prompts stored in `.elegy-opencode-agent-state.json` with agent → model → prompt mapping
- Safe overwrite detection via SHA-256 hash-based ownership tracking in `_managedPrompts`
- Prompt application on profile switch, role model changes, and explicit user save
- Available model list derived from all profile `roleModels` and user-configured providers
- Prompts sub-tab with per-agent rows, status indicators, editable textareas, and per-model overrides
- `POST /api/opencode/prompts` endpoint with applied/skipped/errors response
- Agent fallback returning to built-in prompt when no override exists for active model
- `resetConfig()` removing all managed prompts and clearing sidecar entries
- Effective prompt view showing all assembly layers with source paths
- Degraded state recovery when sidecar or `opencode.jsonc` is missing

### Forbidden Behavior

- Clobbering manually edited agent prompts in `opencode.jsonc` (skip if hash mismatches)
- Auto-claiming ownership of pre-existing `agent.<name>.prompt` values when sidecar is missing
- Per-role prompts (storage maps agent → model → prompt only)
- Prompt template variables or variable substitution
- Prompts for non-standard models not listed in `profiles.json` or configured providers
- Prompt preview or testing against live models
- Prompt versioning, undo/redo, or revision history
- Extending custom prompts to non-OpenCode harnesses

### R1: Prompt Storage

Custom prompts are stored in `.elegy-opencode-agent-state.json` under a `customPrompts` key.

**Shape:**
```json
{
  "customPrompts": {
    "build": {
      "opencode-go/deepseek-v4-pro": "You are a build agent. Be concise..."
    },
    "reviewer": {
      "opencode-go/deepseek-v4-pro": "You are a code reviewer. Challenge everything..."
    }
  }
}
```

- Key: agent name (matching `ALL_LANE_AGENT_KEYS`).
- Value: map of model ID → prompt string.
- An empty string `""` means "override was explicitly cleared for this model — do not apply."
- An absent model key means "no override exists for this model."
- Only non-empty strings are written to `opencode.jsonc`. Empty strings are stored in the sidecar to distinguish "user cleared the override" from "user never set one."

### R2: Safe Prompt Application

Prompt application writes to `agent.<name>.prompt` in `opencode.jsonc` without clobbering manual user edits.

**Ownership tracking:**
A companion key `_managedPrompts` in `.elegy-opencode-agent-state.json` records which `agent.<name>.prompt` fields Elegy owns, using a SHA-256 hex digest of the prompt text:
```json
{
  "_managedPrompts": {
    "build": { "hash": "<sha256-hex>", "modelId": "opencode-go/deepseek-v4-pro" }
  }
}
```

**Application rules (on profile switch or explicit save):**
1. For each agent in `ALL_LANE_AGENT_KEYS`, determine the active model from the current profile's `roleModels` + `agentRoles` + `roleToAgent` mapping.
2. Look up `customPrompts[agentName][activeModel]`.
3. If a non-empty prompt is found:
   a. Read the current `agent.<name>.prompt` from `opencode.jsonc`.
   b. If `_managedPrompts[agentName]` exists and its hash matches the current value → safe to overwrite.
   c. If `agent.<name>.prompt` does not exist in `opencode.jsonc` → safe to write.
   d. If `agent.<name>.prompt` exists but `_managedPrompts[agentName]` is missing or hash mismatches → **skip** (user manually edited it).
4. If no prompt override exists for the active model and `_managedPrompts[agentName]` exists with matching hash → **remove** `agent.<name>.prompt` from opencode.jsonc and remove `_managedPrompts[agentName]`.
5. After writing, update `_managedPrompts[agentName]` with the new hash and modelId.
6. A `resetConfig()` call removes all `_managedPrompts` entries alongside agent model removals.

### R3: Prompt Application Hook

`applyCustomPrompts()` runs at these trigger points:
- After `applyProfile()` writes role models (in `opencodeConfig.js`, immediately after `writeConfig` on line 549).
- After `setAgentRoleModels()` writes role models (line 569).
- When user saves prompts from the UI (via a new API endpoint).

### R4: Available Model List

The list of models available for creating overrides is derived from:
1. All unique model IDs from `roleModels` across all profiles in `profiles.json` (canonical source, read first).
2. All provider models configured in the user's `opencode.jsonc` (discovered via `listAvailableModels()`).
3. The two sets are unioned (no precedence — both sources contribute), deduplicated by exact model ID string match, and sorted alphabetically.

Models are displayed with their provider prefix (e.g., `opencode-go/deepseek-v4-pro`).

### R5: UI — Prompts Sub-Tab

A new `prompts` tab in the OpenCode settings view.

**Components:**
- One row per agent (from `ALL_LANE_AGENT_KEYS`: `explore`, `scout`, `quick`, `impl`, `explorer`, `standard`, `spec`, `project`, `reviewer`).
- Each row shows: agent name, current active model (read-only), prompt status indicator.
- Status indicator: green dot = override active, gray dot = using agent default.
- Row expands on click to show an editable textarea for the **active model's** prompt.
- "Add model override..." button opens a model selector dropdown containing all available models not yet configured for this agent.
- Each model-specific override gets its own textarea labeled with the model ID.
- "Remove override" button per model section.
- Global "Save All" button triggers `applyCustomPrompts()`.

**States:**
| State | Display |
|---|---|
| No overrides configured | Gray dot, "Using default system prompt" |
| Override for current active model | Green dot, prompt text shown |
| Override configured for other model, not active | Yellow dot, "Override exists for <modelId>" |
| Saving | Spinner on Save button |
| Save error | Red error text below affected agent |

### R6: API Endpoint

`POST /api/opencode/prompts`

**Request body:**
```json
{
  "customPrompts": {
    "build": {
      "opencode-go/deepseek-v4-pro": "You are a build agent..."
    },
    "reviewer": {}
  }
}
```

**Response:**
```json
{
  "ok": true,
  "applied": ["build"],
  "skipped": ["reviewer"],
  "errors": []
}
```

- `applied`: agents where prompt was written successfully.
- `skipped`: agents where `agent.<name>.prompt` was manually modified and could not be overwritten.
- `errors`: agents where writing failed for a technical reason.

### R7: Agent Fallback

When `customPrompts[agentName]` has no entry for the active model:
- If `_managedPrompts[agentName]` exists and hash matches, the prompt field is removed from `opencode.jsonc`, returning the agent to its built-in prompt.
- If `_managedPrompts[agentName]` is missing, no action is taken (agent keeps whatever prompt it has).

### R8: Config Reset

`resetConfig()` (line 360-382 in `opencodeConfig.js`) removes all `agent.<name>.model` entries. It must also:
1. Remove all `agent.<name>.prompt` entries owned by Elegy (matching `_managedPrompts` hash).
2. Clear `customPrompts` and `_managedPrompts` from the sidecar state file.

### R9: Effective Prompt Visibility

The Prompts tab shows the composed effective prompt for each agent — what OpenCode will actually send to the model when that agent runs.

**Effective prompt layers (in OpenCode's assembly order):**

| Layer | Source | Shown? | How |
|---|---|---|---|
| Provider prompt | OpenCode built-in (model-specific, not readable from disk) | Partial | Label: "Built-in provider prompt for <modelId>" — content not accessible |
| AGENTS.md | `~/.config/opencode/AGENTS.md` | Full | Read from disk, display with path label |
| Agent definition | `~/.config/opencode/agents/<name>.md` | Full | Read from disk, display with path label |
| Custom override | `agent.<name>.prompt` in `opencode.jsonc` (or empty) | Full | Our managed prompt or whatever is currently set |

**Display:**
- Expandable "Effective Prompt" section at the bottom of each agent row (collapsed by default).
- Shows each layer as a labeled block with its source path.
- If a custom override is active, it is highlighted as the "Elegy-managed" layer.
- If the agent has no custom override but `agent.<name>.prompt` is set manually, show it as "Manual override (not Elegy-managed)."
- If `AGENTS.md` or an agent `.md` file does not exist on disk, display "(file not found)" with the expected path instead of failing silently or showing an empty block.
- Read-only display — the edit textarea above is for editing the custom override, not the effective prompt directly.

### R10: Built-In Prompt Content Note

Where OpenCode's built-in provider prompt content cannot be read from disk (it ships inside the OpenCode binary/package), display: "Built-in provider prompt for <modelId> — content not available for display. This is set by OpenCode and cannot be edited here." This avoids misleading the user into thinking their custom prompt is the only system instruction.

### R11: Degraded State Recovery

When `.elegy-opencode-agent-state.json` is missing, empty, or unparseable but `agent.<name>.prompt` fields exist in `opencode.jsonc`:

- The Prompts tab loads with all agents showing "Manual override (not Elegy-managed)" for any existing `agent.<name>.prompt` values present in `opencode.jsonc`.
- The edit textareas start empty (no `customPrompts` to pre-fill from the missing sidecar).
- Saving from the UI treats this as a fresh start: writes `customPrompts` and `_managedPrompts` to a new sidecar file, and ONLY overwrites `agent.<name>.prompt` entries for agents where the user explicitly typed a new prompt and saved.
- Never auto-claim ownership of pre-existing `agent.<name>.prompt` values when the sidecar is missing — they remain "Manual override" until the user explicitly saves through the UI.

When `opencode.jsonc` is missing or unparseable:
- The Prompts tab displays a warning: "opencode.jsonc not found or unreadable. Custom prompts cannot be applied."
- Save is disabled until `opencode.jsonc` is available.
- The sidecar is not modified.

Where OpenCode's built-in provider prompt content cannot be read from disk (it ships inside the OpenCode binary/package), display: "Built-in provider prompt for <modelId> — content not available for display. This is set by OpenCode and cannot be edited here." This avoids misleading the user into thinking their custom prompt is the only system instruction.

## Non-Goals

- **Not for harnesses other than OpenCode.** Claude Code, Copilot CLI, Codex, and Antigravity have no equivalent prompt-per-agent mechanism. This spec is OpenCode-only.
- **Not per-role prompts.** The storage maps agent → model → prompt. Role-based grouping (e.g., "all planning agents get this prompt") is a future concern.
- **Not prompt template variables.** No variable substitution (e.g., `{workingDir}`, `{date}`) in custom prompts.
- **Not for custom/non-standard models.** Only models listed in `profiles.json` or the user's configured providers are available. Arbitrary model IDs are rejected.
- **Not prompt preview/testing.** No built-in prompt testing or validation against a live model.
- **Not prompt versioning or history.** No undo/redo or prompt revision history.

## Acceptance Checks

- Custom prompt for active model is written on save.
  → verify: Set a prompt for build agent. Save. Confirm the config file has the prompt text.
- Manual user edit to prompt is not clobbered by subsequent saves.
  → verify: Set a prompt via UI. Manually edit the config. Save a different prompt via UI. Confirm the manual edit was NOT overwritten (skipped).
- Clearing a model override removes the prompt from config.
  → verify: Set a prompt. Confirm it writes. Clear the prompt in UI (empty textarea). Save. Confirm the prompt is removed from config.
- Profile switch applies correct model-specific prompt.
  → verify: Set prompt A for pro model. Set prompt B for flash model. With build on pro, confirm prompt A is written. Switch profiles so build gets flash. Confirm prompt B is written.
- Available model list includes all profile models and user-configured provider models.
  → verify: Open Prompts tab. Click "Add model override." Confirm dropdown lists available models.
- Reset config clears all managed prompts.
  → verify: Set prompts for 3 agents. Run reset config from UI. Confirm no prompt fields remain in config. Confirm sidecar state is cleared.
- Prompt status indicator reflects current state.
  → verify: With no overrides, status dot is gray. Set an override for the active model → dot turns green. Set an override for a different model → dot turns yellow.
- Effective prompt view shows all available layers with source paths.
  → verify: Expand "Effective Prompt" for the build agent. Confirm sections appear for each layer with labeled headers.
- Effective prompt view shows manual override when not Elegy-managed.
  → verify: Manually set a prompt in config not matching managed hash. Open Prompts tab, expand Effective Prompt. Confirm shown as "Manual override (not Elegy-managed)."
- Effective prompt view handles missing source files gracefully.
  → verify: Temporarily rename the agents file. Open Prompts tab, expand Effective Prompt. Confirm "(file not found)" is shown. Restore the file.
- Missing sidecar with pre-existing prompts shows manual override state.
  → verify: Set a prompt manually. Delete the sidecar. Open Prompts tab. Confirm manual override state and empty edit textarea.
- Missing config disables save and shows warning.
  → verify: Temporarily rename the config. Open Prompts tab. Confirm warning displayed and Save button disabled.

## Implementation Links

- `copilot-ui/lib/opencodeConfig.js`
- `copilot-ui/routes/opencode.js`
- `copilot-ui/ui/src/tabs/OpenCode/OpenCodeView.tsx`
- `copilot-ui/ui/src/stores/opencodeStore.ts`
- `copilot-ui/ui/src/lib/types.ts`
- `copilot-ui/ui/src/lib/api/opencode.ts` — existing file, new endpoint added
- `opencode-assets/profiles.json`

## Validation Evidence

- TypeScript compilation: `npx tsc -p copilot-ui/ui/tsconfig.json --noEmit` — 0 new errors.
- Spec validation: `node scripts/validate-specs.js --strict docs/specs/opencode-custom-prompts/spec.md` — PASS (clean).
- Full spec directory: `node scripts/validate-specs.js docs/specs` — 9 specs ok.
- Full test suite: `npm run test:all` — 9 tests pass (pre-existing failures in unrelated install/catalog/manifest tests).
- Module exports: all 8 new `opencodeConfig.js` exports verified loadable via `require()`.
- Config smoke tests: `applyCustomPrompts` writes/removes/skips correctly; `resetConfig` clears managed prompts.
- Store sync: `savePrompts()` updates local `customPrompts` state on success.

## Drift Notes

- **Legacy small/big/review model keys removal (follow-up):** `profiles.json` carries `small`, `big`, `review` fields alongside `roleModels`. `opencodeConfig.js` exposes `setAgentModels()` with these legacy keys, and the UI store/API payload reference `smallModel`/`bigModel`/`reviewModel`. These should be removed in a separate cleanup since profiles are now managed through `roleModels` + `agentRoles` + `roleToAgent`. This spec does not touch those legacy keys — it follows the existing `roleModels`-based API (`setAgentRoleModels`, `applyProfile`). The cleanup should be done before or alongside this spec to avoid confusion about which codepath applies custom prompts.
