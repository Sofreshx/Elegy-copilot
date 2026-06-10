---
plan_id: opencode-custom-prompts
spec_id: opencode-custom-prompts
title: OpenCode Custom Prompts — Implementation Plan
status: implemented
updated: 2026-06-10
---

# Implementation Plan: OpenCode Custom Prompts

## Phases

### Phase 1: Backend — Config & State Layer
**Files:** `copilot-ui/lib/opencodeConfig.js`

| Step | Description | Depends On |
|---|---|---|
| 1.0 | **Pre-flight:** verify `readState` (line 187) and `writeState` (line 230) are exported. Already true in current code. | None |
| 1.1 | Implement `readCustomPrompts(opencodeHome)` — reads `customPrompts` key from sidecar, returns `{}` if missing or unparseable (R11 safety). | 1.0 |
| 1.2 | Implement `writeCustomPrompts(opencodeHome, customPrompts)` — merges into sidecar preserving other keys (`activeProfileId`, `worktreeProfile`, etc.), uses `writeTextAtomic`. | 1.0 |
| 1.3 | Implement `computeHash(promptText)` — SHA-256 hex digest via Node `crypto.createHash('sha256')`. | None |
| 1.4 | Implement `resolveActiveModel(agentName, profile)` — resolves which model ID an agent uses under a given profile. **Algorithm:** (1) If profile has `roleModels`, search `roleToAgent` for a role whose agent array contains `agentName`; if found, return `roleModels[role]`. (2) Fall back: `agentRoles[agentName]` → lookup profile field matching the role key (`small`/`big`/`review`). (3) Return `null` if unresolvable. See precedent at `copilot-ui/lib/frontmatter-utils.mjs:56-78`. | None |
| 1.5 | Implement `applyCustomPrompts(opencodeHome, profileOrRoleModels, engineRoot?)` — two signatures: (a) full profile object with `roleToAgent`/`agentRoles`; (b) `Record<string, string>` roleModels + `engineRoot` for catalog lookup. Resolves active model per `ALL_LANE_AGENT_KEYS`, applies R2 ownership rules, writes/removes `agent.<name>.prompt` in `opencode.jsonc`, updates `_managedPrompts`. Returns `{ applied, skipped, errors }`. | 1.1, 1.2, 1.3, 1.4 |
| 1.6 | Wire `applyCustomPrompts()` into `applyProfile()` after `writeConfig`. **Rollback:** wrap in try/catch — on failure, restore previous config from a pre-write snapshot (read config before writing, restore on error). | 1.5 |
| 1.7 | Extend `resetConfig()` to remove managed `agent.<name>.prompt` entries (matching `_managedPrompts` hash) before `removeState()`. Note: `removeState()` at line 379 already deletes the sidecar, clearing `customPrompts`/`_managedPrompts` — only config-level prompt removal is needed. | 1.5 |
| 1.8 | Implement `getAvailableModels(opencodeHome, engineRoot)` — unions profile `roleModels` model IDs across all profiles + `listAvailableModels()` output, deduplicates by exact string match, sorts alphabetically. | None |

### Phase 2: API Layer
**Files:** `copilot-ui/routes/opencode.js`

| Step | Description | Depends On |
|---|---|---|
| 2.1 | Add `POST /api/opencode/prompts` handler — accepts `customPrompts` body, calls `writeCustomPrompts` then `applyCustomPrompts`, returns `{ok, applied, skipped, errors}`. | 1.5, 1.2 |
| 2.2 | Extend `GET /api/opencode/status` response to include `customPrompts` and `_managedPrompts` (filtered — hashes only, not prompt content). `availableModels` already returned by `buildOpenCodeStatus`. | 1.1 |
| 2.3 | Add `GET /api/opencode/prompts/effective?agent=<name>` — reads AGENTS.md content, agent `.md` content, current `agent.<name>.prompt` value, returns layers with source paths. Returns `"(file not found)"` blocks for missing files per R9. | None |
| 2.4 | Call `applyCustomPrompts()` from `POST /api/opencode/config` handler after `setAgentRoleModels()` (line 1297). This replaces wiring inside `setAgentRoleModels` itself — the API handler has access to `engineRoot` and can resolve the profile catalog, which the library function alone cannot. Signature (b) with `roleModels` + `engineRoot`. | 1.5 |

### Phase 3: Types & Store
**Files:** `copilot-ui/ui/src/lib/types.ts`, `copilot-ui/ui/src/stores/opencodeStore.ts`

| Step | Description | Depends On |
|---|---|---|
| 3.1 | Extend `OpenCodeTabSectionId` with `'prompts'`. | None |
| 3.2 | Add `CustomPromptMap` interface: `Record<string, Record<string, string>>`. | None |
| 3.3 | Extend `OpenCodeStatusResponse` with `customPrompts: CustomPromptMap`, `_managedPrompts: Record<string, {hash: string, modelId: string}>`. `availableModels` already present. | 2.2 |
| 3.4 | Extend `OpenCodeConfigPayload` with `customPrompts?: CustomPromptMap`. | None |
| 3.5 | Add `savePrompts()` action to `opencodeStore` — calls `POST /api/opencode/prompts`, handles applied/skipped/errors. | 2.1 |
| 3.6 | Add `loadEffectivePrompt(agentName)` action — calls `GET /api/opencode/prompts/effective`. | 2.3 |
| 3.7 | Add prompt-specific state fields: `customPrompts: CustomPromptMap`, `managedPrompts`, `effectivePrompts`, `promptsLoading`, `promptsSaving`. | None |
| 3.8 | Tab switching: `setActiveSection` already handles it — no code change needed beyond adding `'prompts'` to the type. | 3.1 |

### Phase 4: UI — Prompts Tab
**Files:** `copilot-ui/ui/src/tabs/OpenCode/OpenCodeView.tsx`, new `PromptsSection` component

| Step | Description | Depends On |
|---|---|---|
| 4.1 | Add `'prompts'` to `TAB_SECTIONS` array. | 3.1 |
| 4.2 | Create `PromptsSection` component with agent rows (9 agents from `ALL_LANE_AGENT_KEYS`). Scope note: `build` and `plan` (OpenCode built-ins) are intentionally excluded — they have no shipped `.md` agent files. | 3.7 |
| 4.3 | Implement agent row: name, current active model badge (read-only), status dot (green/gray/yellow), expand/collapse toggle. | None |
| 4.4 | Implement editable textarea for active model's prompt (pre-filled from `customPrompts` if exists). | None |
| 4.5 | Implement "Add model override..." dropdown — shows available models filtered to exclude already-configured ones per agent. | 3.3 |
| 4.6 | Implement "Remove override" button per model section (clears value to empty string `""` in sidecar). | None |
| 4.7 | Implement Effective Prompt expandable section — calls `loadEffectivePrompt`, renders 4 layers with source paths. Handles missing files per R9. | 3.6 |
| 4.8 | Implement "Save All" button with spinner, success/error feedback, per-agent skipped warnings (when manual edit blocked an override). | 3.5 |
| 4.9 | Handle empty state: first-time user sees all agents with gray dots and "Using default system prompt." | None |
| 4.10 | Handle degraded states per R11: missing sidecar shown as fresh start; missing opencode.jsonc shows warning + disabled Save. | None |
| 4.11 | Register `PromptsSection` in `SECTION_COMPONENTS` map. | 4.2 |

### Phase 5: Integration & Validation
**All files.**

| Step | Description | Depends On |
|---|---|---|
| 5.1 | End-to-end test: set prompt → save → verify `agent.<name>.prompt` in `opencode.jsonc`. | All |
| 5.2 | End-to-end test: profile switch → verify prompt changes to match new active model. | All |
| 5.3 | End-to-end test: manual edit detection (skip behavior) — manually change `agent.<name>.prompt`, save different prompt via UI, confirm skipped. | All |
| 5.4 | End-to-end test: reset config clears all managed prompts + sidecar keys. | All |
| 5.5 | Unit test: `resolveActiveModel` against all 9 agents in `ALL_LANE_AGENT_KEYS` with both roleModels-aware and legacy profiles. | 1.4 |
| 5.6 | Integration test: corrupt sidecar JSON, trigger profile switch, confirm API returns structured error (not silent partial config). | 1.6 |
| 5.7 | Run `node scripts/validate-specs.js --strict docs/specs/opencode-custom-prompts/spec.md` — must pass. | All |
| 5.8 | Run `npm --prefix copilot-ui run lint` — no regressions. | All |
| 5.9 | TypeScript compilation: `npm --prefix copilot-ui run build` or `tsc --noEmit` — no errors. | All |

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `setAgentRoleModels` called without profile catalog — cannot resolve agent models for prompt application | High | Medium — prompts silently not applied on manual role-model saves | Step 2.4: call `applyCustomPrompts` from the API route handler with `engineRoot`, not from inside the library function. |
| Config partially mutated: `writeConfig` succeeds, `applyCustomPrompts` throws | Medium | High — role models written, prompts not applied, user sees error but config is dirty | Step 1.6: snapshot config before writing, restore on failure. |
| Hash collision: user writes same prompt text manually, Elegy incorrectly claims ownership | Low | Medium — silent ownership takeover | Accept for draft. If observed in practice, add nonce or `owned` boolean to `_managedPrompts`. Promote to ADR (see below). |
| Concurrent saves: two browser tabs save prompts simultaneously | Low | Low — last write wins via `writeTextAtomic` | Atomic rename prevents partial writes. Accept last-write-wins. |
| Sidecar corruption: manual JSON edit breaks `JSON.parse` | Low | High — user loses all custom prompts | R11: treat as missing sidecar, don't auto-claim. |
| Orphaned model overrides: model removed from profiles.json after override created | Medium | Low — override sits unused in sidecar, no harm | Future: UI warning for unavailable model. Current spec: silent no-op. |
| AGENTS.md or agent .md not installed (fresh OpenCode setup) | Medium | Low — effective prompt view shows "(file not found)" | R9 covers this. |

## ADR Follow-Up

The hash-based ownership model (`_managedPrompts` with SHA-256 content hashing) is a reusable pattern for Elegy-managed fields in shared config files (`opencode.jsonc`). Create ADR at `docs/adr/config-field-ownership-tracking.md` documenting:
- Pattern: SHA-256 hash of managed value stored in sidecar → compare before overwrite → skip on mismatch
- Tradeoff: simplicity vs collision risk (user writes same text manually = false ownership claim)
- Acceptance: acceptable for draft; add nonce if observed in practice
- Reuse: managed permission rules, custom agent config, any Elegy-written field in shared config

## Validation Sequencing

1. Run spec validator: `node scripts/validate-specs.js --strict docs/specs/opencode-custom-prompts/spec.md`
2. Unit test `resolveActiveModel` (step 5.5)
3. Integration test corrupt sidecar (step 5.6)
4. Walk through each spec acceptance check, capture evidence
5. Run `npm --prefix copilot-ui run lint`
6. Run `npm run test:all` (or `npm run ci:local`)
7. Update `Validation Evidence` in spec.md with results
