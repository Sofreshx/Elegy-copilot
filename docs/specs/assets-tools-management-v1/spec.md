---
spec_id: assets-tools-management-v1
title: Assets & Tools Management V1
status: draft
type: feature
updated: 2026-06-11
related:
  - asset-sync-truthfulness
---

# Assets & Tools Management V1

## Intent

Build a first-class asset state model for Codex, OpenCode, and Claude Code CLI. Replace unclear global install flows with asset detail actions, accurate harness state, configured-ref source sync, managed-only uninstall, and per-harness inventory/diagnostics tabs.

Antigravity remains visible as secondary/legacy state where already present, but v1 management actions focus on Codex/OpenCode/Claude.

## Context Evidence

**Harness catalog and partial Claude wiring:**
- `copilot-ui/lib/harnessCatalog.js:3-10` — `GLOBAL_HARNESSES` defines 6 harnesses including `claude-code` with home `~/.claude` and skillsHome `~/.claude/skills`. Claude is defined but not fully integrated into catalog flows.
- `copilot-ui/routes/catalog.js:43` — `INSTALL_SURFACE_HARNESSES` Set: `['codex', 'opencode', 'antigravity']` — **missing `'claude'`**.
- `copilot-ui/routes/catalog.js:44-51` — `HARNESS_INSTALLABLE_KINDS` — missing `'claude-code'` entry. Codex/OpenCode/Antigravity have kinds defined; Claude does not.
- `copilot-ui/routes/catalog.js:1134-1138` — `buildManifestInventory` scans 4 manifest files (`engine-assets`, `codex-assets`, `opencode-assets`, `antigravity-assets`) but skips `claude-assets/manifest.json`.
- `copilot-ui/routes/catalog.js:3327-3340` — `collectManifestAssetIdsForHarness` — no `'claude-code'` entry in the `MANIFEST_FILE_BY_HARNESS` mapping.
- `copilot-ui/routes/catalog.js:3347` — `handleHarnessOptIn` rejects `claude-code`: `!['codex', 'opencode', 'antigravity'].includes(target)`.
- `copilot-ui/routes/assets.js:137-170` — `handleAssetsInstallSurfaces` resolves home paths for codex/opencode/antigravity but does not pass `claudeHome`/`claudeSkillsHome`.
- `copilot-ui/lib/installSurfaces.js:72` — `installClaudeSurface` **exists** and is wired into `'all'` target expansion. The installer infrastructure is ready but the catalog layer does not read it.

**Current type definitions:**
- `copilot-ui/ui/src/lib/types.ts:1316` — `InstallSurfaceTarget`: `'codex' | 'antigravity' | 'opencode' | 'all'` — **no `'claude'`**.
- `copilot-ui/ui/src/lib/types.ts:1729-1742` — `CatalogGlobalHarnessState`: `syncStatus` field is a loose string union; no explicit state enum, no `sourceHash`/`destinationHash`/`managedInventoryPath`/`lastCheckedAt`/`warnings`/`errors`.

**Current UI surface:**
- `copilot-ui/ui/src/views/Catalog/CatalogShellView.tsx` — Main Assets & Tools shell with 5-tab layout: Inventory, Diagnostics (Quality), Operations, Sources, Installation.
- `copilot-ui/ui/src/views/Catalog/InstallationTab.tsx:1-231` — Elegy CLI binaries (7 surfaces) + Harness installation panel. Claude Code entry is display-only with no action buttons.
- `copilot-ui/ui/src/views/Catalog/AssetDetailModal.tsx:1-138` — Modal with AssetReader (Overview/Document/Paths/Resolution sub-tabs) + StatusRail (per-harness status badges). Asset cards in the inventory grid have a `View` button that opens this modal.
- `copilot-ui/ui/src/tabs/Assets/catalogWorkspaceStore.ts:373-386` — `getInstallSurfaceLabel` missing `'claude'` case.
- `copilot-ui/ui/src/tabs/Assets/catalogWorkspaceStore.ts:916` — `installSurface()` calls `POST /api/assets/install-surfaces` then reloads workspace.
- `copilot-ui/ui/src/tabs/ClaudeCode/ClaudeCodeView.tsx:1-151` — Separate Claude Code tab (readiness, CLI install, provider panel). Not integrated into Assets & Tools management.

**Existing managed inventory:**
- `copilot-ui/lib/installLedger.js` — Install ledger at `~/.elegy/catalog/install-ledger.json`. Tracks `harnesses[].optedInAt`, `managedAssetIds`, `lastRunAt`. Provides `isAssetExpectedForUser()` and `setHarnessOptIn()`.
- `scripts/claude-install.mjs` — Full Claude Code install script using shared `install-surface-utils.mjs` primitives.
- `claude-assets/manifest.json` — Full Claude Code manifest with 8 assets (1 instructions + 7 skills).

**External source infrastructure:**
- `copilot-ui/routes/catalog.js:1216` — `buildExternalSourceInventory` handles community/cli-tool sources with their own verification. External sources use `sourceType === 'external-source'` with cached ref metadata.
- `copilot-ui/ui/src/views/Catalog/SourcesTab.tsx` — Source management tab with add/remove/refresh.

**Test infrastructure:**
- `copilot-ui/routes/catalog.test.js` (1019 lines) — Node-native tests for catalog routes using tmpdir fixtures.
- `copilot-ui/tests/assets-routes.test.js` (358 lines) — Node-native tests for assets routes.
- `copilot-ui/vite.config.ts` — Vitest config with jsdom environment for UI component tests.
- `scripts/validate-specs.js` (867 lines) — Spec structural + strict-mode validator.

## Requirements

### Allowed Behavior

- Claude Code as a first-class harness across all catalog enumeration points
- Eight-state catalog summary model (supported, available, not-installed, installed, stale, conflict, unmanaged, unknown) with state derivation rules
- Managed-only uninstall with hash-based ownership verification
- Deep check (dry-run validation) reporting drift and warnings per asset
- Install/sync via existing `POST /api/assets/install-surfaces`
- Card click opening detail modal as primary management surface (no per-card View button)
- Scoped sync/install actions per harness tab and detail modal rows
- External source sync with configured ref/channel refresh and drift display

### Forbidden Behavior

- Adding Claude Code to Antigravity management actions (Antigravity remains secondary/legacy)
- GitHub latest-release auto-detection in v1 (configured ref/channel refresh only)
- New CLI surface for asset management (all actions are dashboard-only)
- Changes to existing Copilot (`engine-assets`) asset flow
- Auto-opt-in for any harness (opt-in remains explicit)
- Changes to installer scripts themselves
- Uninstall when destination hash does not match managed inventory record
- Global "Sync Harnesses" button (replaced by scoped actions)

### R1 — Claude Code as first-class harness in catalog

Add Claude Code (`claude-code` harness, `claude` install-surface target) to every enumeration point currently limited to Codex/OpenCode/Antigravity:

| Location | Change |
|---|---|
| `types.ts:1316` — `InstallSurfaceTarget` | Add `'claude'` |
| `catalog.js:43` — `INSTALL_SURFACE_HARNESSES` | Add `'claude'` |
| `catalog.js:44-51` — `HARNESS_INSTALLABLE_KINDS` | Add `'claude-code'` entry with asset kinds (skill, instructions) |
| `catalog.js:1134-1138` — `buildManifestInventory` | Add `claude-assets/manifest.json` to manifest scan |
| `catalog.js:3327-3340` — `collectManifestAssetIdsForHarness` | Add `'claude-code'` → `'claude-assets/manifest.json'` mapping |
| `catalog.js:3347` — `handleHarnessOptIn` guard | Allow `claude-code` in addition to codex/opencode/antigravity |
| `assets.js:137-170` — `handleAssetsInstallSurfaces` | Resolve and pass `claudeHome`/`claudeSkillsHome` |
| `catalogWorkspaceStore.ts:373` — `getInstallSurfaceLabel` | Add `'claude'` → `'Claude Code'` case |

After this, Claude Code manifest assets appear in the global inventory, opt-in works, and the install surface is callable from the catalog layer.

### R2 — Rich catalog summary state model

Extend `CatalogGlobalHarnessState` with additional fields:

```typescript
interface CatalogGlobalHarnessState {
  // existing fields...
  harnessId: string;
  title: string;
  supported: boolean;
  expected?: boolean;
  installed?: boolean;
  active?: boolean;
  syncStatus?: 'synced' | 'missing' | 'installed' | 'active' | 'available' | 'unsupported' | string;
  installPath?: string | null;
  actions?: CatalogGlobalHarnessActions;
  
  // NEW fields:
  state: 'supported' | 'available' | 'not-installed' | 'installed' | 'stale' | 'conflict' | 'unmanaged' | 'unknown';
  sourceHash?: string | null;
  destinationHash?: string | null;
  managedInventoryPath?: string | null;
  lastCheckedAt?: string | null;
  warnings?: string[];
  errors?: string[];
}
```

**State derivation rules:**

| State | Condition | Meaning |
|-------|-----------|---------|
| `supported` | Harness is defined in `GLOBAL_HARNESSES` and can install this asset kind. | Harness infrastructure exists but no state computed yet. |
| `available` | Harness home path resolvable on disk, user has not opted in. | Ready for opt-in; no assets installed. |
| `not-installed` | User opted in, asset is tracked in install ledger, but destination path does not exist on disk. | Needs install. |
| `installed` | Destination path exists AND its hash matches the hash recorded in the install ledger. | Healthy, in-sync. |
| `stale` | Destination path exists at a ledger-tracked path, but its hash differs from the source hash recorded in the ledger. | Needs sync/update — source has changed since last install. |
| `conflict` | Destination path exists at a ledger-tracked path, but its hash matches NEITHER the source hash NOR the ledger record. | Externally modified — file was changed outside the tool. Uninstall and reinstall may be needed. |
| `unmanaged` | Destination path exists but is NOT tracked in the install ledger at all. | A file exists at the harness path that was not placed by the management tool. Uninstall is blocked; manual deletion required. |
| `unknown` | Cannot determine state (missing harness home, corrupt ledger, unreadable file, etc.). | Inspect manually. |

**Relationship to `syncStatus`:**

`state` is the new canonical field. The existing `syncStatus` field is retained for backward compatibility — existing UI components (StatusRail, CatalogView) read `syncStatus`. New code in the AssetDetailModal and harness tabs MUST read `state` as the authoritative source. Over time, `syncStatus` should be deprecated in favor of `state`.

**Ownership proof rule:**
Uninstall eligibility requires `managedInventoryPath` to exist AND `destinationHash` to match the managed inventory record. If the destination hash does not match, the file is treated as `unmanaged` and uninstall is blocked with an appropriate warning.

### R3 — New harness action API routes

**R3a — Managed-only uninstall:**

```
POST /api/catalog/harness-assets/uninstall
Body: { harnessId: string, assetId: string }
Response: { ok: boolean, removed: string[], warnings?: string[], error?: string }
```

- Reads the install ledger to confirm ownership.
- Computes hash of the destination file before removal.
- Only removes if hash matches managed inventory record.
- On mismatch: returns `ok: false` with `warnings: ["Asset is unmanaged at <path> — hash mismatch. Use check to inspect or delete manually."]`.

**R3b — Deep check (dry-run validation):**

```
POST /api/catalog/harness-assets/check
Body: { harnessId?: string, assetId?: string }
Response: { ok: boolean, results: Array<{ assetId: string, harnessId: string, state: string, sourceHash?: string, destHash?: string, drift?: boolean, warnings?: string[] }> }
```

- Runs without writing any files.
- For each asset: stats source and destination, computes hashes, compares against managed inventory.
- `drift: true` when source hash ≠ destination hash.
- `warnings` includes any consistency issues (missing source, missing dest, hash mismatch, missing ledger entry).
- If `harnessId` is provided, scopes to that harness. If `assetId` is provided, scopes to that asset.

**R3c — Install/sync (reuse existing):**

Reuse `POST /api/assets/install-surfaces` for install and sync. The route handler in `assets.js` already delegates to `lib/installSurfaces.js` which supports per-target install with force/dryRun options. After install/sync, the workspace store reloads the catalog summary to reflect updated state.

### R4 — UI overhaul: Assets & Tools tabs and management surface

**R4a — Remove Installation tab:**
- Remove the `Installation` tab entirely from `CatalogShellView.tsx` (delete the tab entry and its conditional render branch).
- Elegy CLI binary surfaces move to a dedicated "CLI Tools" section at the top of the Diagnostics tab.
- The `InstallationTab.tsx` component may be deleted or kept as dead code — implementer's choice.

**R4b — Remove per-card View button:**
- In the inventory grid (`InventoryTab.tsx` / `AssetGroupList.tsx`), remove the per-card `View` button.
- Clicking an asset card opens the detail modal directly.
- The detail modal (`AssetDetailModal.tsx`) becomes the primary management surface.

**R4c — Detail modal as management surface:**
- Per-harness rows in the modal show:
  - Harness name and icon
  - Current `state` (with color-coded badge)
  - `installPath` (with copyable tooltip)
  - Drift indicator (when `state === 'stale'` or `state === 'conflict'`)
  - `warnings`/`errors` expandable list
  - Action buttons: Install/Update, Sync, Uninstall, Check
- Actions are scoped to the specific harness+asset combination.

**Action visibility by state:**

| State | Install/Update | Sync | Uninstall | Check |
|-------|:---:|:---:|:---:|:---:|
| `supported` | — | — | — | — |
| `available` | Install (opt-in + install) | — | — | — |
| `not-installed` | Install | — | — | — |
| `installed` | Update | Sync | Uninstall | Check |
| `stale` | Update | Sync | Uninstall | Check |
| `conflict` | Reinstall (force) | — | Uninstall (with warning) | Check |
| `unmanaged` | — | — | — (blocked) | Check |
| `unknown` | — | — | — | Check |

- "Install" triggers opt-in then install surface for this harness.
- "Update" runs install surface with force flag.
- "Sync" runs install surface without force.
- "Uninstall" is greyed out / blocked when state is `unmanaged` or `conflict` (ownership proof fails).
- "Check" is always available when a destination path exists.

**R4d — Replace top-level Sync Harnesses:**
- Remove the global "Sync Harnesses" button from `CatalogShellView.tsx`.
- Add scoped sync/install actions in:
  - Per-harness tabs (Codex, OpenCode, Claude)
  - Asset detail modal per-harness rows

**R4e — New tab layout:**

| Tab | Content |
|-----|---------|
| **Inventory** | Existing inventory grid (agents, skills, MCP, hooks, plugins) with provenance grouping. Cards open detail modal on click. No per-card `View` button. |
| **Diagnostics** | CLI Tools section (Elegy CLI binary surfaces) at top, followed by deep check runner. Shows results grid with drift/warnings/errors. Can scope to one harness or run all. |
| **Operations** | Catalog freshness, rebuild history, and runtime health (unchanged from current Operations tab). |
| **Sources** | Existing source management (add/remove/refresh external sources). Shows cached ref vs resolved ref, last refresh, verification status, drift for each source. |
| **Codex** | Codex-only asset list grouped by installed/stale/conflict/not-installed. Per-asset actions (install, sync, uninstall, check). Summary header with overall Codex state. |
| **OpenCode** | Same structure as Codex tab, scoped to OpenCode harness. |
| **Claude** | Same structure as Codex tab, scoped to Claude Code harness. |

### R5 — External source sync with ref drift display

In the Sources tab:
- "Latest" means refresh the configured ref/channel from the external source definition.
- Show per-source: cached ref (last fetched commit/branch/tag), resolved ref (what currently exists at the source), last refresh timestamp, verification status (ok/warning/error).
- Show drift indicator when cached ref ≠ resolved ref.
- Do not introduce GitHub latest-release semantics in v1. Stay with configured ref/channel refresh only.

## Non-Goals

- Antigravity remains secondary/legacy — visible where already present but no new management actions.
- No GitHub latest-release auto-detection in v1.
- No new CLI surface for asset management. All actions are dashboard-only.
- Do not change the existing Copilot (`engine-assets`) asset flow. Copilot already has its own managed inventory and install surface.
- Do not merge or deduplicate the two separate catalog views (`CatalogShellView` and `CatalogView`/`CatalogStatusView`). Keep them separate; only modify `CatalogShellView`.
- Do not add auto-opt-in for any harness. Opt-in remains explicit.
- Do not change the installer scripts themselves (`scripts/codex-install.mjs`, `scripts/claude-install.mjs`, etc.).

## Acceptance Checks

- **A1.** Claude Code manifest assets appear in `GET /api/catalog/summary` global inventory with correct harness states.
  → verify: `node copilot-ui/routes/catalog.test.js` — new test group asserts Claude Code harness presence in summary response
  
- **A2.** `InstallSurfaceTarget` type includes `'claude'` and `POST /api/assets/install-surfaces` accepts `target: 'claude'`.
  → verify: `node copilot-ui/tests/assets-routes.test.js` — test for claude target acceptance

- **A3.** Missing harness rows render explicit `state` values (`not-installed`, `available`, etc.) instead of absent rows or "Not supported".
  → verify: `npm --prefix copilot-ui run test:vitest` — focused UI test for harness state badges

- **A4.** Managed-only uninstall (`POST /api/catalog/harness-assets/uninstall`) succeeds when destination hash matches managed inventory, and blocks with warning when hash does not match.
  → verify: `node copilot-ui/routes/catalog.test.js` — test group for uninstall with matching + mismatching hashes

- **A5.** Deep check (`POST /api/catalog/harness-assets/check`) reports drift for assets where source hash ≠ destination hash, and reports warnings for missing sources or destinations.
  → verify: `node copilot-ui/routes/catalog.test.js` — test group for deep check with drift + missing scenarios

- **A6.** Asset card click opens detail modal. No per-card `View` button and no `Installation` tab.
  → verify: `npm --prefix copilot-ui run test:vitest` — UI component tests assert modal opens on card click, View button absent, Installation tab absent

- **A7.** Codex/OpenCode/Claude harness tabs show only that harness's assets grouped by state (installed/stale/conflict/not-installed), with per-asset actions.
  → verify: `npm --prefix copilot-ui run test:vitest` — harness tab component tests with mock catalog data

- **A8.** Diagnostics tab deep check runner renders results grid with drift indicators and expandable warnings.
  → verify: `npm --prefix copilot-ui run test:vitest` — diagnostics tab component test

- **A9.** Sources tab shows cached ref, resolved ref, last refresh, verification status, and drift indicator per source.
  → verify: `npm --prefix copilot-ui run test:vitest` — sources tab component test

- **A10.** Spec validation passes.
  → verify: `node scripts/validate-specs.js --strict docs/specs/assets-tools-management-v1/spec.md`

- **A11.** Full UI build succeeds.
  → verify: `npm --prefix copilot-ui run ui:build`

- **A12.** No global "Sync Harnesses" button exists in the CatalogShellView tab bar or header area (R4d).
  → verify: `npm --prefix copilot-ui run test:vitest` — UI component test asserts sync-harnesses button is absent from CatalogShellView

- **A13.** Per-harness rows in the asset detail modal show correct actions per state: Install for `not-installed`, Update + Sync + Uninstall + Check for `installed`, Check-only for `unmanaged` (R4c).
  → verify: `npm --prefix copilot-ui run test:vitest` — detail modal test with mock harness states, asserts button visibility per-state

- **A14.** Uninstall button is disabled/greyed when harness state is `unmanaged` or `conflict` (ownership proof fails — R2).
  → verify: `npm --prefix copilot-ui run test:vitest` — detail modal test asserts uninstall button disabled for unmanaged/conflict states

- **A15.** Stale and conflict state badges render distinct visual indicators in the inventory grid and harness tabs (R2).
  → verify: `npm --prefix copilot-ui run test:vitest` — badge component test for stale (yellow) and conflict (red) state indicators

## Implementation Links

- This spec: `docs/specs/assets-tools-management-v1/spec.md`
- Plan: docs/specs/assets-tools-management-v1/plan.md (to be created in Phase 2)
- Claude manifest: `claude-assets/manifest.json` (8 assets: 1 instructions + 7 skills)

## Validation Evidence

- Pending — to be populated during Phase 4 verification.

## Drift Notes

- None.
