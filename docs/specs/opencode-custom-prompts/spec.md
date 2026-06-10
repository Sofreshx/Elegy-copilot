---
spec_id: opencode-custom-prompts
title: OpenCode Custom System Prompts
status: draft
type: feature
updated: 2026-06-10
---

# OpenCode Custom System Prompts

## Intent

Enable users to add, edit, and remove custom system prompts per OpenCode agent, with optional model-specific overrides, through the Elegy Copilot UI. Prompts are applied safely—never clobbering manual user edits—and are activated when the agent's active model matches a configured override.

## Context Evidence

- `copilot-ui/lib/opencodeConfig.js:158-233` — `readConfig`/`writeConfig` for `opencode.jsonc`, `readState`/`writeState` for `.elegy-opencode-agent-state.json`. The sidecar is the existing mechanism for Elegy-managed agent state. Lines 529-551 (`applyProfile`) show the pattern for writing role-level config to `opencode.jsonc` on profile switch. Lines 553-570 (`setAgentRoleModels`) show the save-then-write pattern.
- `copilot-ui/routes/opencode.js:1202-1318` — `POST /api/opencode/config` handler. Accepts `profileId`, `roleModels`, `smallModel`/`bigModel`/`reviewModel`. Profile activation invokes `opencode-profile-switch.mjs` then calls `setAgentRoleModels`/`setAgentModels`. This is the injection point for prompt application.
- `copilot-ui/ui/src/tabs/OpenCode/OpenCodeView.tsx:16-26` — `TAB_SECTIONS` array with 8 existing sub-tabs. `SECTION_COMPONENTS` map at line 876. A new `prompts` tab fits into this registry pattern.
- `copilot-ui/ui/src/lib/types.ts:3644` — `OpenCodeTabSectionId` union type. Must be extended with `'prompts'`.
- `copilot-ui/ui/src/lib/types.ts:3559-3566` — `OpenCodeConfigPayload` interface. Only carries `profileId`, `profileRoute`, `roleModels`, `smallModel`, `bigModel`, `reviewModel`. No prompt field yet.
- `copilot-ui/ui/src/stores/opencodeStore.ts:33-69` — `OpenCodeState` interface and initial state. No prompt-related fields yet.
- `opencode-assets/profiles.json` — 5 profiles with `roleModels` mapping 5 roles to model IDs. Model IDs are the canonical source for available models.
- OpenCode schema (`https://opencode.ai/config.json`): `AgentConfig.properties.prompt` is a `string`. When set, it replaces the agent's provider prompt. This is the target OpenCode field we write to.

## Requirements

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
- Value: map of model ID → prompt string. An empty string or absent model key means "no override for this model."
- Only non-empty prompts are written to `opencode.jsonc`. Empty entries are preserved in the sidecar as explicit "cleared" markers.

### R2: Safe Prompt Application

Prompt application writes to `agent.<name>.prompt` in `opencode.jsonc` without clobbering manual user edits.

**Ownership tracking:**
A companion key `_managedPrompts` in `.elegy-opencode-agent-state.json` records which `agent.<name>.prompt` fields Elegy owns, using a content hash:
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
1. All unique model IDs across all profiles in `profiles.json` (canonical source).
2. All provider models configured in the user's `opencode.jsonc` (discovered via `listAvailableModels()`).
3. Deduplicated and sorted.

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
- Read-only display — the edit textarea above is for editing the custom override, not the effective prompt directly.

### R10: Built-In Prompt Content Note

Where OpenCode's built-in provider prompt content cannot be read from disk (it ships inside the OpenCode binary/package), display: "Built-in provider prompt for <modelId> — content not available for display. This is set by OpenCode and cannot be edited here." This avoids misleading the user into thinking their custom prompt is the only system instruction.

## Non-Goals

- **Not for harnesses other than OpenCode.** Claude Code, Copilot CLI, Codex, and Antigravity have no equivalent prompt-per-agent mechanism. This spec is OpenCode-only.
- **Not per-role prompts.** The storage maps agent → model → prompt. Role-based grouping (e.g., "all planning agents get this prompt") is a future concern.
- **Not prompt template variables.** No variable substitution (e.g., `{workingDir}`, `{date}`) in custom prompts.
- **Not for custom/non-standard models.** Only models listed in `profiles.json` or the user's configured providers are available. Arbitrary model IDs are rejected.
- **Not prompt preview/testing.** No built-in prompt testing or validation against a live model.
- **Not prompt versioning or history.** No undo/redo or prompt revision history.

## Acceptance Checks

- Custom prompt for active model is written to `agent.<name>.prompt` on save.
  → verify: Set a prompt for `build` → `opencode-go/deepseek-v4-pro` in the UI. Save. Check `opencode.jsonc` that `config.agent.build.prompt` equals the entered text.
- Manual user edit to `agent.<name>.prompt` is not clobbered by subsequent saves.
  → verify: Set a prompt via UI. Manually edit `agent.build.prompt` in `opencode.jsonc` to a different value. Save a different prompt via UI. Confirm `agent.build.prompt` in `opencode.jsonc` was NOT overwritten (skipped). Confirm UI shows the agent as "skipped."
- Clearing a model override removes the prompt from `opencode.jsonc`.
  → verify: Set a prompt for `build` → `deepseek-v4-pro`. Confirm it writes. Clear the prompt in UI (empty textarea). Save. Confirm `agent.build.prompt` is removed from `opencode.jsonc`.
- Profile switch applies correct model-specific prompt.
  → verify: Set prompt A for `build` → `opencode-go/deepseek-v4-pro`. Set prompt B for `build` → `opencode-go/deepseek-v4-flash`. With build on `pro`, confirm prompt A is written. Switch profiles so build gets `flash`. Confirm prompt B is written and `_managedPrompts.build.modelId` is `flash`.
- Available model list includes all profile models and user-configured provider models.
  → verify: Open Prompts tab. Click "Add model override." Confirm dropdown lists at minimum: `opencode-go/deepseek-v4-pro`, `opencode-go/deepseek-v4-flash`, `opencode/deepseek-v4-pro-free`, `opencode/deepseek-v4-flash-free`, `deepseek-direct/deepseek-v4-pro`, `deepseek-direct/deepseek-v4-flash`.
- `resetConfig()` clears all managed prompts.
  → verify: Set prompts for 3 agents. Run reset config from UI. Confirm no `agent.<name>.prompt` fields remain in `opencode.jsonc`. Confirm `customPrompts` and `_managedPrompts` are cleared from the sidecar.
- Prompt status indicator reflects current state.
  → verify: With no overrides, status dot is gray and shows "Using default system prompt." Set an override for the active model → dot turns green. Set an override for a different model → dot turns yellow with "Override exists for <modelId>."
- Effective prompt view shows all available layers with source paths.
  → verify: Expand "Effective Prompt" for the build agent. Confirm sections appear for: Agent definition (path to `.md` file), AGENTS.md (path), Built-in provider prompt (note about unavailability), Custom override (if set). Confirm each section has a labeled header with the source path.
- Effective prompt view shows manual override when not Elegy-managed.
  → verify: Manually set `agent.build.prompt` in `opencode.jsonc` to a value not matching `_managedPrompts` hash. Open Prompts tab, expand Effective Prompt for build. Confirm the override is shown as "Manual override (not Elegy-managed)" with the prompt text.

## Implementation Links

- `copilot-ui/lib/opencodeConfig.js`
- `copilot-ui/routes/opencode.js`
- `copilot-ui/ui/src/tabs/OpenCode/OpenCodeView.tsx`
- `copilot-ui/ui/src/stores/opencodeStore.ts`
- `copilot-ui/ui/src/lib/types.ts`
- `copilot-ui/ui/src/lib/api/opencode.ts`
- `opencode-assets/profiles.json`

## Validation Evidence

- Pending

## Drift Notes

- **Legacy small/big/review model keys removal (follow-up):** `profiles.json` carries `small`, `big`, `review` fields alongside `roleModels`. `opencodeConfig.js` exposes `setAgentModels()` with these legacy keys, and the UI store/API payload reference `smallModel`/`bigModel`/`reviewModel`. These should be removed in a separate cleanup since profiles are now managed through `roleModels` + `agentRoles` + `roleToAgent`. This spec does not touch those legacy keys — it follows the existing `roleModels`-based API (`setAgentRoleModels`, `applyProfile`). The cleanup should be done before or alongside this spec to avoid confusion about which codepath applies custom prompts.
