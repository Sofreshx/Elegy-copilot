# Implementation Plan — Assets & Tools Management V1

> Derived from `spec.md`. Status: ready for implementation.

## Phase 0: Pre-requisite Server Wiring

This phase adds the server-level infrastructure needed by all subsequent phases.

### P0.1 — Add Claude home resolver functions
**File:** `copilot-ui/server.js` (near lines 3794-3840, alongside existing resolvers)
**Change:** Add two new resolver functions:
```javascript
function resolveClaudeHomeFromEnv(env) {
  return env.CLAUDE_HOME || path.join(os.homedir(), '.claude');
}
function resolveClaudeSkillsHomeFromEnv(env, claudeHome) {
  return env.INSTRUCTION_ENGINE_CLAUDE_SKILLS_HOME || path.join(claudeHome, 'skills');
}
```

### P0.2 — Add Claude homes to server ctx
**File:** `copilot-ui/server.js` (in `handleApi()`, near lines 4566-4573 where other harness homes are resolved)
**Change:** Add these lines after the existing resolver chain:
```javascript
const claudeHome = resolveClaudeHomeFromEnv(process.env);
const claudeSkillsHome = resolveClaudeSkillsHomeFromEnv(process.env, claudeHome);
```

**File:** `copilot-ui/server.js` (near lines 4656-4685, where ctx is built for route dispatch)
**Change:** Add `claudeHome, claudeSkillsHome` to the context object passed to routes.

### P0.3 — Add homeKey/skillsHomeKey to GLOBAL_HARNESSES
**File:** `copilot-ui/lib/harnessCatalog.js:3-10`
**Change:** Each harness entry currently has `{ id, title, home, skillsHome, supportsMcp }`. Add `homeKey` and `skillsHomeKey` to EVERY entry so that `catalog.js` functions `listHarnessRows` (line 832-840) and `detectHarnessInstallPath` (line 842-862) can resolve runtime home paths from ctx. The full updated array:

```javascript
const GLOBAL_HARNESSES = Object.freeze([
  { id: 'copilot', title: 'Elegy', home: '~/.elegy', skillsHome: '~/.elegy/skills', supportsMcp: false, homeKey: 'elegyHomeAbs', skillsHomeKey: null },
  { id: 'codex', title: 'Codex', home: '~/.codex', skillsHome: '~/.codex/skills', supportsMcp: true, homeKey: 'codexHome', skillsHomeKey: 'codexSkillsHome' },
  { id: 'opencode', title: 'OpenCode', home: '~/.config/opencode', skillsHome: '~/.config/opencode/skills', supportsMcp: true, homeKey: 'opencodeHome', skillsHomeKey: 'opencodeSkillsHome' },
  { id: 'antigravity', title: 'Antigravity', home: '~/.gemini/antigravity', skillsHome: '~/.gemini/antigravity/skills', supportsMcp: false, homeKey: 'antigravityHome', skillsHomeKey: 'antigravitySkillsHome' },
  { id: 'gemini-cli', title: 'Antigravity CLI', home: '~/.gemini', skillsHome: null, supportsMcp: true, homeKey: 'geminiHome', skillsHomeKey: null },
  { id: 'claude-code', title: 'Claude Code', home: '~/.claude', skillsHome: '~/.claude/skills', supportsMcp: false, homeKey: 'claudeHome', skillsHomeKey: 'claudeSkillsHome' },
]);
```

**Risk note:** This fixes a pre-existing bug where `listHarnessRows` and `detectHarnessInstallPath` were reading undefined `homeKey`/`skillsHomeKey` on ALL harness entries (not just Claude). After this change, harness home paths should resolve correctly for all harnesses.

### P0.4 — Add harnessId-to-installTarget mapping helper
**File:** `copilot-ui/routes/catalog.js` (new helper, near the top constants section ~line 51)
**Change:** Add a small mapping function. Claude's harness ID (`claude-code`) differs from its install surface target (`claude`). This helper translates between them:
```javascript
function harnessIdToInstallSurfaceTarget(harnessId) {
  if (harnessId === 'claude-code') return 'claude';
  return harnessId;
}
function installSurfaceTargetToHarnessId(target) {
  if (target === 'claude') return 'claude-code';
  return target;
}
```

### P0.5 — Extend install ledger schema with assetHashes
**File:** `copilot-ui/lib/installLedger.js`
**Change:** Add per-asset hash tracking to the ledger schema. Each harness entry gains an `assetHashes` field:
```javascript
// Schema V2 addition:
"harnesses": {
  "<harnessId>": {
    "optedInAt": "<ISO timestamp>",
    "managedAssetIds": ["<asset-id>", ...],
    "assetHashes": {                    // NEW
      "<asset-id>": "<sha256-hex>"       // NEW
    },
    "lastResult": "ok",
    "lastRunAt": "<ISO timestamp>"
  }
}
```

Add new functions:
```javascript
function setAssetHashes(elegyHomeAbs, harnessId, hashMap) { ... }
function getAssetHash(elegyHomeAbs, harnessId, assetId) { ... }
```

No schema version bump required — `assetHashes` is additive and missing keys default to `undefined`.

### P0 validation:
- `node copilot-ui/routes/catalog.test.js` — existing tests still pass (homeKey additions should be transparent)
- Manual: verify `claudeHome`/`claudeSkillsHome` appear in route handler `ctx` for a test request

---

## Phase 1: Claude Code as First-Class Harness (R1)

### P1.1 — Type: InstallSurfaceTarget
**File:** `copilot-ui/ui/src/lib/types.ts:1316`
**Change:** Add `'claude'` to the union.
```
-  export type InstallSurfaceTarget = 'codex' | 'antigravity' | 'opencode' | 'all';
+  export type InstallSurfaceTarget = 'codex' | 'antigravity' | 'opencode' | 'claude' | 'all';
```

### P1.2 — Backend: INSTALL_SURFACE_HARNESSES
**File:** `copilot-ui/routes/catalog.js:43`
**Change:** Add `'claude-code'` (the harnessId, NOT `'claude'`) to the Set since this Set is checked against `manifestSource.harnessId`.
```
-  const INSTALL_SURFACE_HARNESSES = new Set(['codex', 'opencode', 'antigravity']);
+  const INSTALL_SURFACE_HARNESSES = new Set(['codex', 'opencode', 'antigravity', 'claude-code']);
```

### P1.3 — Backend: HARNESS_INSTALLABLE_KINDS
**File:** `copilot-ui/routes/catalog.js:44-51`
**Change:** Add `claude-code` entry. Per `claude-assets/manifest.json`, Claude has `skill` and `instructions` types.
```
+  'claude-code': new Set(['skill', 'instructions']),
```

### P1.4 — Backend: buildManifestInventory manifest scan
**File:** `copilot-ui/routes/catalog.js:1134-1138`
**Change:** Add `claude-assets/manifest.json` to the manifests array. Use `harnessId: 'claude-code'` to match `GLOBAL_HARNESSES`.
```
+  { source: 'claude', fileName: 'claude-assets/manifest.json', harnessId: 'claude-code', supportsItemInstall: false },
```
**Also:** Where `installSurfaceTargets` is assigned from `manifestSource.harnessId` (around line 1186-1188), use `harnessIdToInstallSurfaceTarget()` to translate `claude-code` → `claude` for the InstallSurfaceTarget type.

### P1.5 — Backend: collectManifestAssetIdsForHarness
**File:** `copilot-ui/routes/catalog.js:3328-3332`
**Change:** Add `'claude-code'` mapping.
```
+  'claude-code': 'claude-assets/manifest.json',
```

### P1.6 — Backend: handleHarnessOptIn guard + install options
**File:** `copilot-ui/routes/catalog.js:3347`
**Change:**
1. Update target validation to accept `'claude'`:
```
-  if (!['codex', 'opencode', 'antigravity'].includes(target)) {
-    throw Object.assign(new Error('target must be codex, opencode, or antigravity'), { statusCode: 400 });
+  if (!['codex', 'opencode', 'antigravity', 'claude'].includes(target)) {
+    throw Object.assign(new Error('target must be codex, opencode, antigravity, or claude'), { statusCode: 400 });
```
2. After validation, translate to harnessId for manifest operations:
```javascript
const harnessId = installSurfaceTargetToHarnessId(target);
```
3. Pass `claudeHome`/`claudeSkillsHome` in installOptions (lines 3352-3365):
```javascript
claudeHome: ctx.claudeHome,
claudeSkillsHome: ctx.claudeSkillsHome,
```
4. Use `harnessId` (not `target`) when calling `collectManifestAssetIdsForHarness` and `setHarnessOptIn`/`removeHarnessOptIn`:
```javascript
const managedAssetIds = collectManifestAssetIdsForHarness(deps.engineRoot || ctx.engineRoot, harnessId);
installLedgerLib.setHarnessOptIn(ctx.elegyHomeAbs, harnessId, managedAssetIds);
```

### P1.7 — Backend: handleAssetsInstallSurfaces
**File:** `copilot-ui/routes/assets.js:137-170`
**Change:** Add `claudeHome`/`claudeSkillsHome` to the destructured deps (line 139-151) and pass them through to `installSurfaces` call (lines 154-167).

### P1.8 — Frontend: getInstallSurfaceLabel
**File:** `copilot-ui/ui/src/tabs/Assets/catalogWorkspaceStore.ts:373-386`
**Change:** Add `'claude'` case.
```
+  case 'claude':
+    return 'Claude Code';
```

### P1.9 — Frontend: toggleHarnessOptIn type + API payload type
**File:** `copilot-ui/ui/src/tabs/Assets/catalogWorkspaceStore.ts:969`
**Change:** Add `'claude'` to the union.
```
-  async function toggleHarnessOptIn(target: 'codex' | 'opencode' | 'antigravity', optIn: boolean): Promise<void> {
+  async function toggleHarnessOptIn(target: 'codex' | 'opencode' | 'antigravity' | 'claude', optIn: boolean): Promise<void> {
```

**File:** `copilot-ui/ui/src/lib/api/catalog.ts:163-166`
**Change:** Update `HarnessOptInPayload.target` type:
```
-  target: 'codex' | 'opencode' | 'antigravity';
+  target: 'codex' | 'opencode' | 'antigravity' | 'claude';
```

**P1 validation:**
- `node copilot-ui/routes/catalog.test.js` — Claude Code manifests appear in summary
- `node copilot-ui/tests/assets-routes.test.js` — Claude target accepted by install-surfaces
- Verify `claude-code` appears in `GET /api/catalog/summary` response

---

## Phase 2: Rich State Model + New API Routes (R2, R3)

### P2.1 — Extend CatalogGlobalHarnessState type
**File:** `copilot-ui/ui/src/lib/types.ts:1729-1742`
**Change:** Add new fields to the interface.
```
  // NEW fields (R2):
  state: 'supported' | 'available' | 'not-installed' | 'installed' | 'stale' | 'conflict' | 'unmanaged' | 'unknown';
  sourceHash?: string | null;
  destinationHash?: string | null;
  managedInventoryPath?: string | null;
  lastCheckedAt?: string | null;
  warnings?: string[];
  errors?: string[];
```

### P2.2 — Backend: state derivation in buildManifestInventory
**File:** `copilot-ui/routes/catalog.js` (within `buildManifestInventory`, ~line 1170 area where harness states are assembled)
**Change:** After the current per-harness-per-asset state computation, compute the `state` field using the derivation rules from the spec. Use the install ledger (`installLedgerLib.readInstallLedger`) to determine `managedInventoryPath`, compute hashes via `safeStatHash()`, and compare.

**Logic:**
```
function deriveHarnessAssetState(asset, harnessId, ledger, destPath, sourcePath) {
  const harnessEntry = ledger?.harnesses?.[harnessId];
  const isTracked = harnessEntry?.managedAssetIds?.includes(asset.id);
  const destExists = safeStatSync(destPath) !== null;
  const sourceExists = safeStatSync(sourcePath) !== null;
  
  if (!destExists && !isTracked) return 'available';
  if (!destExists && isTracked) return 'not-installed';
  if (destExists && !isTracked) return 'unmanaged';
  if (!destExists) return 'unknown';
  
  const destHash = computeFileHash(destPath);
  const sourceHash = sourceExists ? computeFileHash(sourcePath) : null;
  const ledgerHash = harnessEntry?.assetHashes?.[asset.id];
  
  if (destHash === ledgerHash && destHash === sourceHash) return 'installed';
  if (destHash !== sourceHash && destHash === ledgerHash) return 'stale'; // source updated
  if (destHash !== ledgerHash && destHash !== sourceHash) return 'conflict'; // externally modified
  return 'unknown';
}
```
### P2.2a — Store asset hashes in ledger after install
**File:** `copilot-ui/routes/catalog.js` (in `handleHarnessOptIn`, after successful install)
**Change:** After `deps.installSurfaces(installOptions)` completes (line 3366), stat each destination file for the installed assets and compute SHA-256 hashes:
```javascript
const assetHashes = {};
for (const assetId of managedAssetIds) {
  // Resolve destination path from manifest definition
  const destPath = resolveAssetDestinationPath(ctx, harnessId, assetId);
  if (destPath) {
    const hash = computeFileHash(deps.fs, destPath);
    if (hash) assetHashes[assetId] = hash;
  }
}
installLedgerLib.setAssetHashes(ctx.elegyHomeAbs, harnessId, assetHashes);
```

**File:** `copilot-ui/routes/assets.js` (in `handleAssetsInstallSurfaces`, after `deps.installSurfaces(...)` resolves at line 168)
**Change:** Add similar hash capture — but since `installSurfaces` returns surface-level aggregate results only (not per-asset details), hash capture here may be limited. For v1, primary hash capture happens in `handleHarnessOptIn`. Add a TODO comment for per-asset hash capture when the install surface API is extended.

**Note:** This is a v1 approach. The install surface API (`lib/installSurfaces.js`) returns aggregate counts, not per-asset paths. Full per-asset hash capture may require extending the install surface response in a future iteration. For v1, the ledger hash from `handleHarnessOptIn` is sufficient for the ownership proof used by uninstall (R3a).

### P2.3 — Backend: POST /api/catalog/harness-assets/uninstall
**File:** `copilot-ui/routes/catalog.js` (new handler function)

**Implementation:**
1. Read body: `{ harnessId, assetId }`
2. Read install ledger: `installLedgerLib.readInstallLedger(ctx.elegyHomeAbs)`
3. Look up asset in ledger: `ledger.harnesses[harnessId].managedAssetIds`
4. If not tracked → 400: "Asset is not managed by Elegy."
5. Resolve destination path from manifest definition.
6. Compute hash of destination file.
7. Compare against ledger hash.
8. If match → `safeUnlinkSync(destPath)` → remove from ledger `managedAssetIds` → write ledger → return `{ ok: true, removed: [assetId] }`
9. If mismatch → return `{ ok: false, warnings: ["Asset is unmanaged at <path> — hash mismatch. Use check to inspect or delete manually."] }`

**Route registration** (~line 3567 area, near harness-opt-in):
```
{ method: 'POST', path: '/api/catalog/harness-assets/uninstall', handler: (ctx) => handleHarnessAssetUninstall(ctx, resolvedDeps) },
```

### P2.4 — Backend: POST /api/catalog/harness-assets/check
**File:** `copilot-ui/routes/catalog.js` (new handler function)

**Implementation:**
1. Read body: `{ harnessId?, assetId? }`
2. If `harnessId` → scope to that harness's manifest assets.
3. If `assetId` → scope to that single asset across harnesses.
4. For each asset, compute:
   - `sourceHash` from source path
   - `destHash` from destination path
   - `drift: sourceHash !== destHash`
   - `warnings`: missing source, missing dest, hash mismatch, missing ledger entry
5. Return `{ ok: true, results: [...] }`

**Route registration:**
```
{ method: 'POST', path: '/api/catalog/harness-assets/check', handler: (ctx) => handleHarnessAssetCheck(ctx, resolvedDeps) },
```

### P2.5 — Update API contract snapshot
**File:** `copilot-ui/tests/api-contract.snapshot.json`
**Change:** Run tests to regenerate snapshot with new routes.

**P2 validation:**
- `node scripts/validate-specs.js --strict docs/specs` on full directory
- `node copilot-ui/routes/catalog.test.js` — new test groups for uninstall + check routes

---

## Phase 3: UI Overhaul (R4)

### P3.1 — Remove Installation tab from CatalogShellView
**File:** `copilot-ui/ui/src/views/Catalog/CatalogShellView.tsx`
**Changes:**
1. Remove `'installation'` from the `activeTab` type union (line 130).
2. Remove `{ key: 'installation' as const, label: 'Installation' }` from the tab bar array (line 372).
3. Remove the `{activeTab === 'installation' && <InstallationTab .../>}` block (line 416).
4. Remove the `import InstallationTab` statement.
5. Remove the `handleSyncHarnesses` function (lines 198-201).
6. Remove the `Sync Harnesses` button (lines 317-324).

### P3.2 — Remove per-card View button; click opens modal
**Files:**
- `copilot-ui/ui/src/views/Catalog/InventoryTab.tsx`
- `copilot-ui/ui/src/views/Catalog/AssetGroupList.tsx`

**Changes:**
1. Remove any `View` button rendered on each asset card.
2. Add `onClick` handler to the card itself that opens `AssetDetailModal` for that item.
3. Ensure `AssetDetailModal` receives the full item data (including `harnessStates`).

### P3.3 — Enhance AssetDetailModal as management surface
**File:** `copilot-ui/ui/src/views/Catalog/AssetDetailModal.tsx`
**Changes:**
1. Add per-harness action rows within the modal body (replacing or extending the StatusRail section).
2. Each harness row shows: harness name, state badge (color-coded per state), install path (copyable), drift indicator, warnings/errors expandable list.
3. Action buttons rendered per state (per spec R4c action visibility table):
   - `available` → Install button
   - `not-installed` → Install button
   - `installed` → Update, Sync, Uninstall, Check buttons
   - `stale` → Update, Sync, Uninstall, Check buttons
   - `conflict` → Reinstall (force), Uninstall (with warning), Check buttons
   - `unmanaged` → Check button only (Uninstall disabled)
   - `unknown` → Check button only
4. Wire action buttons to store methods: `installSurface(target)`, `syncSurface(target)`, `uninstallAsset(harnessId, assetId)`, `checkAsset(harnessId, assetId)`.

### P3.4 — Add new store methods for harness actions
**File:** `copilot-ui/ui/src/tabs/Assets/catalogWorkspaceStore.ts`
**Changes:**
Add these methods to the store:
```
async function uninstallAsset(harnessId: string, assetId: string): Promise<void>
async function checkAssets(harnessId?: string, assetId?: string): Promise<CheckResult[]>
async function syncHarness(target: InstallSurfaceTarget): Promise<void>
```

**API client additions** (`copilot-ui/ui/src/lib/api/catalog.ts`):
```
export async function uninstallHarnessAsset(body: { harnessId: string; assetId: string }): Promise<...>
export async function checkHarnessAssets(body: { harnessId?: string; assetId?: string }): Promise<...>
```

### P3.5 — Add harness-specific tabs (Codex, OpenCode, Claude)
**Files to create:**
- `copilot-ui/ui/src/views/Catalog/HarnessTab.tsx` (reusable component)

**Files to modify:**
- `copilot-ui/ui/src/views/Catalog/CatalogShellView.tsx` — add tab entries for Codex, OpenCode, Claude

**HarnessTab component:**
1. Receives `harnessId` prop.
2. Filters `summary.globalInventory.sections` items by `harnessStates[].harnessId === harnessId`.
3. Groups items by `state`: installed, stale, conflict, not-installed, available, unmanaged, unknown.
4. Renders each group as a section with state badge header.
5. Per-item: title, kind badge, state badge, install path, action buttons (install/sync/uninstall/check per state).

### P3.6 — Update Diagnostics tab with CLI tools section
**File:** `copilot-ui/ui/src/views/Catalog/QualityTab.tsx` (renamed or augmented)

**Change:** Rename "Diagnostics" tab content. Add CLI Tools section at top displaying Elegy CLI binary surfaces (move from InstallationTab). Below it, add deep check runner UI:
- Dropdown to select harness scope (All / Codex / OpenCode / Claude).
- "Run Check" button → calls `checkAssets(harnessId)`.
- Results grid: assetId, harnessId, state badge, drift indicator, warnings expandable.

### P3.7 — Remove InstallationTab dependency
**File:** `copilot-ui/ui/src/views/Catalog/InstallationTab.tsx`
**Change:** Can be deleted or left as dead code (per spec non-goal). If Elegy CLI binaries section was the only reason to keep it, that content moves to Diagnostics tab.

**P3 validation:**
- `npm --prefix copilot-ui run ui:build` — no errors
- `npm --prefix copilot-ui run test:vitest` — focused tests for new tabs, modal actions, state badges

---

## Phase 4: Source Ref Drift Display (R5)

### P4.1 — Enhance SourcesTab with per-source metadata
**File:** `copilot-ui/ui/src/views/Catalog/SourcesTab.tsx`
**Changes:**
1. For each external source, display:
   - Cached ref (last fetched commit/branch/tag from source metadata)
   - Resolved ref (what currently exists — requires a GET to the source's configured endpoint)
   - Last refresh timestamp
   - Verification status (ok / warning / error)
   - Drift indicator (badge/icon) when cached ref ≠ resolved ref
2. "Refresh" button per source triggers the existing `refreshCatalogSource` flow, which updates cached ref.

### P4.2 — Backend: expose ref metadata in source list endpoint
**File:** `copilot-ui/routes/catalog.js` (in `buildExternalSourceInventory`, ~line 1228-1238)
**Change:** The existing `detail` sub-object on external source items already contains `sourceResolvedRef`, `sourceLastVerifiedAt`, `sourceVerificationStatus` fields. Verify these are populated correctly. If they are already present, no backend change is needed — only the frontend Sources tab needs to surface them (P4.1). If any field is absent, add it to the `detail` computation.

**P4 validation:**
- `npm --prefix copilot-ui run test:vitest` — sources tab component test

---

## Phase 5: Tests, Validation, and Polish

> **Implementation ordering:** Phase 0 must be implemented before Phase 1. P1 depends on the server context (`claudeHome`/`claudeSkillsHome`) and resolver functions (`resolveClaudeHomeFromEnv`, `resolveClaudeSkillsHomeFromEnv`, `harnessIdToInstallSurfaceTarget`, `installSurfaceTargetToHarnessId`) set up in Phase 0.

### P5.1 — Backend tests
**File:** `copilot-ui/routes/catalog.test.js`
**Add test groups:**
1. Claude Code manifest assets in catalog summary
2. `POST /api/catalog/harness-assets/uninstall` — success (matching hash), blocked (mismatching hash), blocked (unmanaged)
3. `POST /api/catalog/harness-assets/check` — drift detection, missing source/dest warnings, scoped to harness, scoped to asset

**File:** `copilot-ui/tests/assets-routes.test.js`
**Add test group:**
4. `POST /api/assets/install-surfaces` accepts `target: 'claude'`

### P5.2 — Frontend tests
**New Vitest test files:**
- `copilot-ui/ui/src/views/Catalog/HarnessTab.test.tsx` — A7: harness-filtered asset list grouped by state
- `copilot-ui/ui/src/views/Catalog/AssetDetailModal.test.tsx` — A13: per-state action visibility, A14: uninstall disabled for unmanaged/conflict
- `copilot-ui/ui/src/views/Catalog/DiagnosticsTab.test.tsx` — A8: deep check runner results grid
- `copilot-ui/ui/src/views/Catalog/CatalogShellView.test.tsx` — A6: modal opens on card click, no View button, no Installation tab, A12: no global Sync Harnesses button

### P5.3 — Spec validation
- Run `node scripts/validate-specs.js --strict docs/specs` on full directory
- Fix all errors

### P5.4 — Full build and test suite
- `npm --prefix copilot-ui run ui:build`
- `npm --prefix copilot-ui run test:vitest`
- `node copilot-ui/routes/catalog.test.js`
- `node copilot-ui/tests/assets-routes.test.js`

---

## File Change Summary

| File | Phase | Change |
|------|-------|--------|
| `copilot-ui/server.js` | P0.1-P0.2 | Add `resolveClaudeHomeFromEnv`/`resolveClaudeSkillsHomeFromEnv`; add `claudeHome`/`claudeSkillsHome` to ctx |
| `copilot-ui/lib/harnessCatalog.js` | P0.3 | Add `homeKey`/`skillsHomeKey` to all GLOBAL_HARNESSES entries |
| `copilot-ui/lib/installLedger.js` | P0.5 | Add `assetHashes` field + `setAssetHashes`/`getAssetHash` functions |
| `copilot-ui/routes/catalog.js` | P0.4, P1.2-P1.6, P2.2-P2.4, P4.2 | Mapping helpers + Claude wiring + state derivation + uninstall/check routes + hash storage + ref metadata |
| `copilot-ui/routes/assets.js` | P1.7 | Pass claudeHome/claudeSkillsHome; add hash capture TODO |
| `copilot-ui/ui/src/lib/types.ts` | P1.1, P2.1 | Add `'claude'` to InstallSurfaceTarget; extend CatalogGlobalHarnessState |
| `copilot-ui/ui/src/lib/api/catalog.ts` | P1.9 | Update `HarnessOptInPayload.target` union |
| `copilot-ui/ui/src/tabs/Assets/catalogWorkspaceStore.ts` | P1.8-P1.9, P3.4 | Claude label + optIn type + new store methods (uninstall, check, sync) |
| `copilot-ui/ui/src/views/Catalog/CatalogShellView.tsx` | P3.1, P3.5 | Remove Installation tab + Sync Harnesses button; add harness tabs |
| `copilot-ui/ui/src/views/Catalog/AssetDetailModal.tsx` | P3.3 | Per-harness management rows with actions |
| `copilot-ui/ui/src/views/Catalog/AssetGroupList.tsx` | P3.2 | Remove View button, add card click → modal |
| `copilot-ui/ui/src/views/Catalog/InventoryTab.tsx` | P3.2 | Coordinate card click → modal |
| `copilot-ui/ui/src/views/Catalog/QualityTab.tsx` | P3.6 | Add CLI tools section + deep check runner |
| `copilot-ui/ui/src/views/Catalog/SourcesTab.tsx` | P4.1 | Add ref drift display |
| `copilot-ui/ui/src/views/Catalog/HarnessTab.tsx` | P3.5 | NEW — reusable harness-scoped asset list |
| `copilot-ui/tests/api-contract.snapshot.json` | P2.5 | Regenerate with new routes |
| `copilot-ui/routes/catalog.test.js` | P5.1 | New test groups for Claude + uninstall + check |
| `copilot-ui/tests/assets-routes.test.js` | P5.1 | Claude target test |
| Multiple new `.test.tsx` files | P5.2 | Vitest UI component tests |
