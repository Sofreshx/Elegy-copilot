---
spec_id: opencode-lane-model-profiles
title: OpenCode Lane Model Profiles
status: draft
type: feature
updated: 2026-06-08
---

# OpenCode Lane Model Profiles

## Intent

Add richer OpenCode profile support so a profile can independently route separate task roles (planning, implementation, exploration, review, research) to different models using OpenCode Go (`opencode-go/<model-id>`) and OpenCode Zen (`opencode/<model-id>`) provider prefixes, while keeping existing `small`/`big`/`review` profiles as backward-compatible aliases.

## Context Evidence

- `opencode-assets/profiles.json:1-26` — Current canonical profile schema: two profiles (`opencode-go`, `deepseek-direct`) with `small`/`big`/`review` fields + `reasoningEffort` + `agentRoles` indirection. Must be extended with `roleModels`.
- `opencode-assets/home/AGENTS.md:95-116` — Lane Agent table defines 7 agents mapped to small/big/review roles. Must be updated to use role names instead of small/big/review.
- `opencode-assets/home/AGENTS.md:156-176` — Provider Profiles section documents current small/big/review fields. Must be updated for roleModels.
- `docs/system/opencode-guide.md:57-70` — OpenCode guide documents provider profiles. Must be updated for roleModels and `opencode.jsonc` agent model overrides.
- `scripts/opencode-install.mjs:467-514` — Installer injects profile into agents and `opencode.jsonc`. Must normalize `roleModels`.
- `scripts/opencode-profile-switch.mjs:38-127` — Switcher reads profiles.json and updates agents + `opencode.jsonc`. Must accept any profile ID and normalize `roleModels`.
- `scripts/frontmatter-utils.mjs:55-85` — `updateAgentModel()` maps agent→roleKey→profile field. Must support `roleModels` via normalization.
- `copilot-ui/lib/opencodeConfig.js:17-26` — `LANE_SMALL_AGENT_KEYS`, `LANE_BIG_AGENT_KEYS`, `LANE_REVIEW_AGENT_KEYS` hardcoded; `setAgentModels()` writes to `opencode.jsonc`. Must gain `readProfileCatalog`, `normalizeProfile`, `applyProfile`, `setAgentRoleModels`.
- `copilot-ui/lib/opencodeConfig.js:200-228` — `getActiveProfileRoute()` reads `.elegy-opencode-agent-state.json` → `activeProfileRoute`. Must gain `activeProfileId` support with `activeProfileRoute` fallback.
- `copilot-ui/routes/opencode.js:223-255` — `buildProfiles()` hardcodes two profiles. Must read from `profiles.json` dynamically.
- `copilot-ui/routes/opencode.js:948-982` — `POST /api/opencode/config` accepts `smallModel`/`bigModel`/`reviewModel`. Must accept `profileId` and `roleModels`.
- `copilot-ui/ui/src/tabs/OpenCode/OpenCodeView.tsx:220-339` — Profiles tab renders static cards with `smallModel`/`bigModel`. Must render role-level selects per profile.
- `copilot-ui/ui/src/lib/types.ts:3415-3504` — `OpenCodeProfile`, `OpenCodeStatusResponse`, `OpenCodeConfigPayload` type definitions. Must be extended for roleModels.
- `specs/agentic-lanes-quality/spec.md:61-67` — R6 requires `profiles.json` as single source of truth; this spec extends that contract.
- `~/.config/opencode/.elegy-opencode-agent-state.json` — Contains `{ activeProfileRoute, updatedAt }`. Must gain `activeProfileId` support. `activeProfileId` takes precedence in dashboard; `activeProfile` in `profiles.json` takes precedence in CLI tools.

## Requirements

### R1 — Profile Schema Extension
- Add `roleModels` object to each profile entry in `profiles.json` with keys: `planning`, `implementation`, `exploration`, `review`, `research`. Each value is a model ID string like `"opencode-go/deepseek-v4-pro"`.
- `reasoningEffort` remains a per-profile field (not per-role). All roles in a profile share the same `reasoningEffort` value.
- Keep existing `small`, `big`, `review` fields in the existing two profiles for backward compat. These may be removed in a future spec once all profiles have `roleModels`, the dashboard no longer depends on `smallModel`/`bigModel`/`reviewModel` display fields, and the installer/switcher exclusively use `roleModels`.
- Add metadata fields per profile: `label` (human-readable name), `description` (one-liner), `tags` (string array), optional `notes`.
- Add a top-level `roleToAgent` mapping object (replacing/absorbing `agentRoles`) with role keys (`planning`, `implementation`, `exploration`, `review`, `research`) that each map to an array of agent names.
- The expanded `agentRoles` entries (maps agent→small/big/review) remain for backward compat but are also normalized into `roleToAgent`.

### R2 — Backward Compatibility Through Normalization
- A `normalizeProfile` function converts `small`→`exploration` + `implementation`, `big`→`planning`, `review`→`review` for profiles that lack `roleModels`.
- The `scout` agent currently receives the `big` model via `LANE_BIG_AGENT_KEYS` in `opencodeConfig.js`. Under the new `roleToAgent` mapping, `scout` moves to the `research` role. For profiles with `roleModels`, this means `scout` gets the `research` model. For legacy profiles normalized via `normalizeProfile`, `scout` keeps getting the `big` model (which maps to `planning`) until the profile is upgraded to `roleModels`. Existing users with legacy profiles are unaffected; users switching to a new profile with `roleModels` get the new `research` routing.
- `setAgentModels()` remains as a compatibility wrapper mapping `small` → `exploration/implementation`, `big` → `planning`, `review` → `review`.
- The new `setAgentRoleModels(roleModels)` is the preferred API and writes role-level overrides to `opencode.jsonc` as `config.agentRoleModels.<role>.model`.
- When both `config.agent.<name>.model` and `config.agentRoleModels.<role>.model` exist in `opencode.jsonc`, the role-level entry (`agentRoleModels`) takes precedence for agents listed in `roleToAgent`. Agent-level overrides for agents not in any role are preserved as-is.
- Drift detection compares normalized `roleModels`, not just `small`/`big`/`review`.

### R3 — Curated Profiles
Add these profiles to `profiles.json`:
- `opencode-go-balanced`: Go DeepSeek defaults — planning: `opencode-go/deepseek-v4-pro`, implementation: `opencode-go/deepseek-v4-flash`, exploration: `opencode-go/deepseek-v4-flash`, review: `opencode-go/deepseek-v4-pro`, research: `opencode-go/deepseek-v4-pro`
- `opencode-go-fast`: planning: `opencode-go/deepseek-v4-pro`, implementation: `opencode-go/deepseek-v4-flash`, exploration: `opencode-go/deepseek-v4-flash`, review: `opencode-go/deepseek-v4-pro`, research: `opencode-go/deepseek-v4-flash`
- `opencode-zen-free`: Zen free models — planning: `opencode/deepseek-v4-pro-free`, implementation: `opencode/deepseek-v4-flash-free`, exploration: `opencode/deepseek-v4-flash-free`, review: `opencode/deepseek-v4-pro-free`, research: `opencode/deepseek-v4-flash-free`
- `opencode-zen-mixed`: Zen free/cheap for exploration/research, stronger Zen/Go for planning/review — planning: `opencode/deepseek-v4-pro`, implementation: `opencode/deepseek-v4-flash-free`, exploration: `opencode/deepseek-v4-flash-free`, review: `opencode/deepseek-v4-pro`, research: `opencode/deepseek-v4-flash-free`
- Keep `deepseek-direct` as direct fallback (with roleModels + backward compat small/big/review)
- Add `label`, `description`, `tags` metadata per profile. Example: `opencode-go-balanced` gets label `"OpenCode Go Balanced"`, description `"Go provider with DeepSeek defaults"`, tags `["go", "deepseek", "balanced"]`.

### R4 — Role-to-Agent Mapping Expansion
- The top-level `roleToAgent` mapping defines:
  - `planning`: `["plan", "standard", "spec", "project"]`
  - `implementation`: `["build", "impl", "quick"]`
  - `exploration`: `["explore", "explorer"]`
  - `review`: `["reviewer"]`
  - `research`: `["scout"]`
- The `plan`, `build`, and `explore` agents in this mapping are OpenCode built-in agents. They do not have corresponding `.md` files in `opencode-assets/agents/`. Their model override is applied via `opencode.jsonc` only (under `config.agentRoleModels.<role>.model` or `config.agent.<name>.model`), not via agent frontmatter.
- Unknown/custom agent entries in `opencode.jsonc` are left untouched.
- The old `agentRoles` mapping is preserved but normalized into `roleToAgent` for the new code paths.

### R5 — Centralize Profile Loading in opencodeConfig.js
Add these exported functions to `copilot-ui/lib/opencodeConfig.js`:
- `readProfileCatalog(workspaceRoot)` — reads and returns `profiles.json` from the workspace root. Returns the parsed JSON object.
- `normalizeProfile(profile)` — accepts a raw profile object; if it has `roleModels` returns as-is; if it has legacy `small`/`big`/`review`, synthesizes `roleModels` where `small`→`exploration`+`implementation`, `big`→`planning`, `review`→`review`. Adds default `label`/`description`/`tags` if missing.
- `applyProfile(opencodeHome, profile)` — writes normalized profile's `roleModels` into `opencode.jsonc` under `config.agentRoleModels` and updates agent `.md` frontmatter `model` fields for each role→agent mapping.
- `setAgentRoleModels(opencodeHome, roleModels)` — writes role-level model overrides into `opencode.jsonc` under `config.agentRoleModels.<role>.model`. This is the preferred API (replacing `setAgentModels`).
- `getActiveProfileId(opencodeHome)` — reads `activeProfileId` from `.elegy-opencode-agent-state.json`, falls back to `activeProfileRoute`.
- `setActiveProfileId(opencodeHome, profileId)` — writes `activeProfileId` into `.elegy-opencode-agent-state.json`.

### R6 — Update Installers and Switcher
- `scripts/opencode-install.mjs`: Read `profiles.json`, normalize the active profile, apply `roleModels` to agent frontmatter via `updateAgentModel` and to `opencode.jsonc` under `config.agentRoleModels`. Keep writing legacy `config.agent.<name>.model` for backward compat.
- `scripts/opencode-profile-switch.mjs`: Accept any profile ID from `profiles.json` (not hardcoded two-profile list). Normalize the selected profile. Write updated `activeProfile` back to `profiles.json`. Apply `roleModels` to agent frontmatter and `opencode.jsonc`.
- Store `activeProfileId` in `.elegy-opencode-agent-state.json` (keeping old `activeProfileRoute` as fallback read).
- `activeProfileId` in `.elegy-opencode-agent-state.json` is the authoritative active profile identifier for the dashboard. The `activeProfile` field in `profiles.json` is secondary (written by the CLI switcher for the installer's benefit). When both exist and conflict, `activeProfileId` wins in the dashboard; `activeProfile` wins in the CLI installer/switcher.
- `scripts/frontmatter-utils.mjs`: `updateAgentModel()` must accept `roleModels` through normalization: if profile has `roleModels`, use the correct role→model mapping to resolve the agent's model.

### R7 — Dashboard API Updates
- `GET /api/opencode/status`: Read profiles from `profiles.json` (not hardcoded). Return all profiles with normalized `roleModels`, `label`, `description`, `tags`, and active state. Keep the legacy `smallModel`/`bigModel`/`reviewModel` display fields for backward compat alongside new `roleModels` field.
- `POST /api/opencode/config`: Accept `{ profileId }` for switching and `{ roleModels }` for manual overrides. Write through to `setActiveProfileId()` and `setAgentRoleModels()`. Keep accepting legacy `smallModel`/`bigModel`/`reviewModel` payload.
- Available models list is built from every role in every profile, including both `opencode-go/...` and `opencode/...` ID prefixes.

### R8 — Dashboard UI Updates
- Profiles tab renders role-specific model assignments per profile instead of only Small/Big/Review.
- Model Selection form exposes five selects: Planning, Implementation, Exploration, Review, Research.
- Each profile card shows its `label`, `description`, `tags`, and list of role→model assignments.
- Active profile badge works off `activeProfileId`.
- Model select dropdowns are populated from all unique model IDs across all profiles and roles.
- Save button sends `{ roleModels: { planning, implementation, exploration, review, research } }` payload.

### R9 — Documentation Updates
- Fix `docs/system/opencode-guide.md` to: say the installer updates `opencode.jsonc` agent model overrides; document the new role model contract with five roles; distinguish OpenCode Go vs Zen provider prefixes; document the profile switch command.
- Update `opencode-assets/home/AGENTS.md` Provider Profiles section to use role names (planning, implementation, exploration, review, research) instead of small/big/review, with role-to-agent mapping table.

## Non-Goals

- Do NOT fetch live model lists at runtime (v1). Curated shipped profiles + manual role overrides only.
- Do NOT remove `small`/`big`/`review` from `profiles.json` yet — backward compat window.
- Do NOT change agent prompt content, lane boundaries, or lane agent routing logic.
- Do NOT add a spec validator for profile schemas (JSON Schema) in this spec — just ensure profile loading does not crash on missing fields.
- Do NOT change the `elegy-planning` CLI or its SQLite schema.
- Do NOT change the OpenCode CLI runtime itself — only config file writes.
- Do NOT migrate or auto-normalize existing user `config.agent.<name>.model` overrides in `opencode.jsonc`. Existing overrides are preserved as-is alongside new `roleModels` entries.
- Do NOT add installed agent `.md` files for OpenCode built-in agents (`plan`, `build`, `explore`, `scout`). Built-in agent model routing via `roleToAgent` is `opencode.jsonc`-only.

## Acceptance Checks

- Normalized profile: profiles with only small/big/review yield correct roleModels after normalizeProfile.
   → verify: `node copilot-ui/lib/opencodeConfig.test.js --testNamePattern="normalizeProfile"`

- Full profile: profiles with roleModels pass through normalizeProfile unchanged.
   → verify: `node copilot-ui/lib/opencodeConfig.test.js --testNamePattern="normalizeProfile"`

- Profile catalog reads from disk and returns all profiles with normalized roleModels.
   → verify: `node copilot-ui/lib/opencodeConfig.test.js --testNamePattern="readProfileCatalog"`

- Legacy setAgentModels maps small→exploration/implementation, big→planning, review→review.
   → verify: `node copilot-ui/lib/opencodeConfig.test.js --testNamePattern="setAgentModels"`

- setAgentRoleModels writes config.agentRoleModels.<role>.model to opencode.jsonc.
   → verify: `node copilot-ui/lib/opencodeConfig.test.js --testNamePattern="setAgentRoleModels"`

- Active profile ID read/write with activeProfileRoute fallback.
   → verify: `node copilot-ui/lib/opencodeConfig.test.js --testNamePattern="activeProfileId"`

- GET /api/opencode/status returns dynamic profiles from profiles.json with roleModels.
   → verify: `npm --prefix copilot-ui test -- opencode-api --testNamePattern="status"`

- POST /api/opencode/config accepts profileId and roleModels payloads.
   → verify: `npm --prefix copilot-ui test -- opencode-api --testNamePattern="config"`

- Profile switcher accepts any profile ID from profiles.json.
   → verify: run `node scripts/opencode-profile-switch.mjs --list` and confirm all new profiles appear

- Switcher writes correct roleModels to agent frontmatter and opencode.jsonc.
   → verify: run switcher against temp OPENCODE_HOME, assert `opencode.jsonc` has `config.agentRoleModels.planning.model`

- Installer normalizes profile and does not crash with new schema.
   → verify: `node scripts/opencode-install.mjs --dry-run --opencode-home <temp>`

- Profiles tab renders role-level model selects (Planning, Implementation, Exploration, Review, Research).
   → verify: `npm --prefix copilot-ui test -- opencode-view --testNamePattern="profiles"`

- Profile switch via dashboard POST /api/opencode/config with { profileId } updates active state.
   → verify: `npm --prefix copilot-ui test -- opencode-api --testNamePattern="profile switch"`

- Spec validates cleanly.
   → verify: `node scripts/validate-specs.js specs/opencode-lane-model-profiles/spec.md`

- Existing spec tests still pass (no regression).
   → verify: `node scripts/validate-specs.js`

- Full focused test suite passes.
   → verify: `npm --prefix copilot-ui test -- opencode`

## Implementation Links

- `opencode-assets/profiles.json`
- `opencode-assets/home/AGENTS.md`
- `docs/system/opencode-guide.md`
- `scripts/opencode-install.mjs`
- `scripts/opencode-profile-switch.mjs`
- `scripts/frontmatter-utils.mjs`
- `copilot-ui/lib/opencodeConfig.js`
- `copilot-ui/lib/opencodeConfig.test.js`
- `copilot-ui/routes/opencode.js`
- `copilot-ui/ui/src/tabs/OpenCode/OpenCodeView.tsx`
- `copilot-ui/ui/src/lib/types.ts`
- `copilot-ui/ui/src/lib/api/opencode.ts`
- `copilot-ui/ui/src/stores/opencodeStore.ts`
- `copilot-ui/tests/opencode-api.vitest.ts`
- `copilot-ui/tests/opencode-view.vitest.tsx`
- `copilot-ui/tests/api-contract.snapshot.json`

## Validation Evidence

- pending

## Drift Notes

- This spec extends `agentic-lanes-quality` R6 (profiles.json as single source of truth). It adds `smallModel`/`bigModel`/`reviewModel` display fields in the dashboard alongside `roleModels` — this is a deliberate transitional deviation from the single-source requirement, justified by backward compatibility. A future spec should remove these display fields once `roleModels` is the sole surface.
