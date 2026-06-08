# Implementation Plan: OpenCode Lane Model Profiles

> Derived from `specs/opencode-lane-model-profiles/spec.md` (draft)

## Phases

### Phase 1a: Profile Schema + Static Data (R1, R3, R4)
- Extend `opencode-assets/profiles.json`:
  - Add `roleModels` to each profile entry (`planning`, `implementation`, `exploration`, `review`, `research`)
  - Add metadata fields per profile: `label`, `description`, `tags` (optional `notes`)
  - Add top-level `roleToAgent` mapping (replacing/absorbing `agentRoles`) with role keys mapping to agent name arrays:
    - `planning`: `["plan", "standard", "spec", "project"]`
    - `implementation`: `["build", "impl", "quick"]`
    - `exploration`: `["explore", "explorer"]`
    - `review`: `["reviewer"]`
    - `research`: `["scout"]`
  - Keep existing `small`/`big`/`review` fields in `opencode-go` and `deepseek-direct` for backward compat
  - Keep `agentRoles` mapping for backward compat (normalized into `roleToAgent` at runtime)
  - `reasoningEffort` stays per-profile (not per-role)
- Add curated profiles: `opencode-go-balanced`, `opencode-go-fast`, `opencode-zen-free`, `opencode-zen-mixed`
- Rename existing `opencode-go` to `opencode-go-balanced` (add `roleModels`, keep `small`/`big`/`review`, add metadata)
- Keep `deepseek-direct` as direct fallback (add `roleModels` + backward compat `small`/`big`/`review`)

### Phase 1b: Library Functions + Unit Tests (R2, R5)
- Add to `copilot-ui/lib/opencodeConfig.js`:
  - `readProfileCatalog(workspaceRoot)` — reads and returns `profiles.json` from workspace root
  - `normalizeProfile(profile)` — if `roleModels` present, returns as-is; if legacy `small`/`big`/`review`, synthesizes `roleModels` (`small`→`exploration`+`implementation`, `big`→`planning`, `review`→`review`). Adds default `label`/`description`/`tags` if missing.
  - `applyProfile(opencodeHome, profile)` — writes normalized profile's `roleModels` into `opencode.jsonc` under `config.agentRoleModels` AND updates agent `.md` frontmatter `model` fields for each role→agent mapping (for agents that have `.md` files)
  - `setAgentRoleModels(opencodeHome, roleModels)` — writes `config.agentRoleModels.<role>.model` to `opencode.jsonc` (preferred API)
  - `getActiveProfileId(opencodeHome)` — reads `activeProfileId` from state file, falls back to `activeProfileRoute`
  - `setActiveProfileId(opencodeHome, profileId)` — writes `activeProfileId` to state file
- Keep `setAgentModels(opencodeHome, smallModel, bigModel, reviewModel)` as compatibility wrapper:
  - Maps `smallModel` → `exploration` + `implementation`, `bigModel` → `planning`, `reviewModel` → `review`
  - Delegates to `setAgentRoleModels` internally
  - Existing callers in routes and stores continue to work
- Keep `LANE_SMALL_AGENT_KEYS`, `LANE_BIG_AGENT_KEYS`, `LANE_REVIEW_AGENT_KEYS` as internal constants used only by `setAgentModels` compat path
- Implement precedence rule: when both `config.agent.<name>.model` and `config.agentRoleModels.<role>.model` exist, role-level entry wins for agents in `roleToAgent`
- Implement drift detection: compares normalized `roleModels`, not `small`/`big`/`review`
- Add unit tests in `copilot-ui/lib/opencodeConfig.test.js`:
  - `normalizeProfile` — legacy profile with `small`/`big`/`review` → synthesized `roleModels`
  - `normalizeProfile` — profile with `roleModels` → pass-through unchanged
  - `readProfileCatalog` — reads from disk, returns all profiles with normalized `roleModels`
  - `setAgentModels` (legacy compat) — maps `small`→`exploration`+`implementation`, `big`→`planning`, `review`→`review`
  - `setAgentRoleModels` — writes `config.agentRoleModels.<role>.model` to `opencode.jsonc`
  - `getActiveProfileId` / `setActiveProfileId` — write/read with `activeProfileRoute` fallback
  - State file migration — existing state files without `activeProfileId` fall back correctly
  - Precedence — `agentRoleModels` wins over `agent.<name>.model` for mapped agents

### Phase 2: Installers + Switcher (R6)
- Strategy: Extract `normalizeProfile` to a shared module at `scripts/lib/profile-normalizer.mjs` so both `copilot-ui/lib/opencodeConfig.js` and `scripts/` can import it. The `copilot-ui/lib/` version re-exports from this shared module.
- Update `scripts/frontmatter-utils.mjs`:
  - `updateAgentModel(agentFilePath, agentName, profile, agentRoles)`:
    - If profile has `roleModels`, resolve agent's role from `roleToAgent` map, then use `roleModels[role]`
    - If profile is legacy (no `roleModels`), fall back to existing `agentRoles[agentName]` → profile field lookup
    - Import `normalizeProfile` from the shared module
- Update `scripts/opencode-install.mjs`:
  - Read `profiles.json`, normalize the active profile
  - Apply `roleModels` to agent frontmatter via `updateAgentModel`
  - Write `config.agentRoleModels.<role>.model` to `opencode.jsonc`
  - Keep writing legacy `config.agent.<name>.model` for backward compat (dual-write)
- Update `scripts/opencode-profile-switch.mjs`:
  - Accept any profile ID from `profiles.json` (not hardcoded two-profile list)
  - `--list` shows all profiles with their labels and role model assignments
  - Normalize the selected profile, apply `roleModels` to agent frontmatter + `opencode.jsonc`
  - Write updated `activeProfile` back to `profiles.json`
  - Write `activeProfileId` to `.elegy-opencode-agent-state.json`
  - Authority rule: `activeProfileId` wins in dashboard; `activeProfile` wins in CLI
- Add script checks:
  - Run `node scripts/opencode-profile-switch.mjs --list` to confirm all profiles appear
  - Run switcher against temp `OPENCODE_HOME`, assert `opencode.jsonc` has `config.agentRoleModels.planning.model`
  - Run `node scripts/opencode-install.mjs --dry-run --opencode-home <temp>` to ensure no schema/load failures

### Phase 3: Dashboard API (R7)
- Refactor `buildProfiles()` in `copilot-ui/routes/opencode.js`:
  - Read from `profiles.json` dynamically (using `readProfileCatalog`)
  - Return all profiles with normalized `roleModels`, `label`, `description`, `tags`
  - Keep legacy `smallModel`/`bigModel`/`reviewModel` display fields alongside `roleModels` for backward compat
  - Active state determined by `activeProfileId`
- Update `POST /api/opencode/config` handler:
  - Accept `{ profileId }` for switching → calls `setActiveProfileId()`
  - Accept `{ roleModels }` for manual overrides → calls `setAgentRoleModels()`
  - Keep accepting legacy `{ smallModel, bigModel, reviewModel }` → delegates to `setAgentModels()` compat wrapper
- Build available models list from every role in every profile (both `opencode-go/...` and `opencode/...` prefixes)
- Update TypeScript types in `copilot-ui/ui/src/lib/types.ts`:
  - `OpenCodeProfile`: add `roleModels?: Record<string, string>`, `label: string`, `description: string`, `tags: string[]`, `notes?: string`
  - `OpenCodeStatusResponse`: add `roleModels?: Record<string, string>`, keep `smallModel`/`bigModel`/`reviewModel`
  - `OpenCodeConfigPayload`: add `profileId?: string`, `roleModels?: Record<string, string>`, keep `smallModel`/`bigModel`/`reviewModel`
- Update `copilot-ui/tests/opencode-api.vitest.ts`:
  - Dynamic profile IDs from `profiles.json` in status response
  - Invalid profile rejection
  - `profileId` switching
  - `roleModels` override payloads
  - Legacy `smallModel`/`bigModel`/`reviewModel` payload still accepted
- Update API contract snapshot: `copilot-ui/tests/api-contract.snapshot.json`

### Phase 4: Dashboard UI (R8)
- Rewrite Profiles tab in `copilot-ui/ui/src/tabs/OpenCode/OpenCodeView.tsx`:
  - Render profile cards with `label`, `description`, `tags`, and role→model assignments
  - Active profile badge works off `activeProfileId`
  - "Activate" button calls `handleProfileSwitch(profileId)` which POSTs `{ profileId }`
- Add Model Selection form with five selects: Planning, Implementation, Exploration, Review, Research
- Model select dropdowns populated from all unique model IDs across all profiles and roles
- Save button sends `{ roleModels: { planning, implementation, exploration, review, research } }` payload
- Also keep the existing `smallModel`/`bigModel` inputs functional (delegating to compat path)
- Update `copilot-ui/ui/src/stores/opencodeStore.ts`:
  - Add `activeProfileId`, `roleModels` to store state
  - Add `switchProfile(profileId)` action
  - Add `updateRoleModels(roleModels)` action
- Update `copilot-ui/ui/src/lib/api/opencode.ts`:
  - `saveOpenCodeConfig()`: add `profileId` and `roleModels` to the payload type
- Update `copilot-ui/tests/opencode-view.vitest.tsx`:
  - Rendering multiple profiles with role-level model info
  - Five role selectors rendered
  - Save payload contains `roleModels` shape
  - Active profile badge

### Phase 5: Documentation (R9)
- Update `docs/system/opencode-guide.md`:
  - State that the installer updates `opencode.jsonc` agent model overrides
  - Document the new role model contract with five roles
  - Distinguish OpenCode Go (`opencode-go/...`) vs Zen (`opencode/...`) provider prefixes
  - Document the profile switch command
- Update `opencode-assets/home/AGENTS.md`:
  - Provider Profiles section: use role names (planning, implementation, exploration, review, research) instead of `small`/`big`/`review`
  - Add role-to-agent mapping table
  - Document curated profiles with labels and descriptions

### Phase 6: Integration Validation
- Run full focused test suite: `npm --prefix copilot-ui test -- opencode`
- Run spec validation: `node scripts/validate-specs.js`
- Run `node scripts/opencode-profile-switch.mjs --list`
- Run installer dry-run: `node scripts/opencode-install.mjs --dry-run --opencode-home <temp>`
- Verify all 16 acceptance checks from spec.md pass

## Risk Register

- **scout behavior change**: `scout` moves from `big` → `research` role. Mitigated: legacy profiles preserve old behavior; only new profiles change routing.
- **Dual-state drift**: CLI and dashboard write to different state locations. Mitigated: documented priority rules (dashboard uses `activeProfileId`, CLI uses `activeProfile`).
- **Built-in agents**: `plan`, `build`, `explore` have no agent `.md` files. Mitigated: these are `opencode.jsonc`-only overrides.
- **Existing test regression**: `opencodeConfig.test.js` has 373 lines of existing tests. Mitigated: `setAgentModels` kept as compat wrapper; new functions are additive.
- **Cross-package normalization drift**: `copilot-ui/lib/` and `scripts/` both need `normalizeProfile`. Mitigated: extract to shared module at `scripts/lib/profile-normalizer.mjs`; `copilot-ui/lib/` re-exports from it.
- **State file migration**: existing `.elegy-opencode-agent-state.json` files lack `activeProfileId`. Mitigated: `getActiveProfileId` falls back to `activeProfileRoute`.
- **API contract snapshot drift**: snapshot must update atomically with Phase 3. Mitigated: snapshot update task in Phase 3, not deferred to Phase 6.
- **Agent multi-role ambiguity**: if agent appears in multiple `roleToAgent` entries. Mitigated: current mapping has no overlaps; first match wins if overlap occurs in future.
