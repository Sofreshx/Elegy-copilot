---
created: 2026-04-08
updated: 2026-06-29
category: system
status: current
doc_kind: node
id: desktop-runtime-tauri-migration-contract
summary: Frozen desktop-runtime contract for the Windows-first Tauri migration cut, including sidecar, startup-token, and cutover checkpoints.
tags: [desktop, tauri, runtime, packaging, updater]
related: [copilot-ui-guide, security-model, desktop-update-rollback-runbook, system-docs-index]
---

# Desktop Runtime Contract — Tauri Migration Target

## Status

This document freezes the approved/current contract for the Windows-first Tauri desktop runtime.

- **Former primary desktop runtime:** Electron
- **Approved migration target:** Windows-first Tauri desktop shell
- **Current primary desktop runtime:** Windows-first Tauri desktop shell
- **Current update posture:** the active Tauri Windows lane is a NSIS preview/manual-installer path with GitHub-release-backed automatic checks and explicit user download/apply, not an in-place updater cutover

The migration does **not** change these existing product contracts:

- local-only scope
- runtime-first session authority
- repo-state task authority
- managed CLI fail-closed behavior
- stable/prerelease app-lane pairing with matching SDK/CLI lanes

## Shell-neutral desktop runtime contract

The desktop shell has shifted to Tauri for the primary Windows path, but the runtime contract stays fixed:

1. The packaged desktop app boots a **local-only** runtime on `127.0.0.1`.
2. The localhost HTTP API remains the primary product/runtime boundary for the first Tauri cut.
3. Desktop-only shell bridges are reserved for shell-native concerns:
   - window lifecycle
   - single-instance activation/focus
   - external-link opening
   - resource/app-path lookup
   - startup bootstrap handoff
   - updater UI/status wiring
   - notifications if still required
4. Session authority stays with the live runtime; durable task authority stays under `~/.copilot/repo-state/<repoId>/tasks/`.
5. The packaged app remains the manager for the paired managed Copilot CLI lane and must continue to fail closed when the approved bundled/seeded CLI is unavailable.

## Ownership map

| Concern | Contract owner under Tauri first cut |
| --- | --- |
| Window lifecycle, focus, single-instance behavior | Tauri shell |
| Startup token minting + first navigation handoff | Tauri shell |
| Local backend boot supervision | Tauri shell launching bundled Node sidecar |
| Kimaki boot supervision | Desktop Node runtime |
| Runtime HTTP/API behavior | Node local runtime (`copilot-ui/server.js` and its modules) |
| Planning persistence bootstrap | Desktop runtime bootstrap, still rooted in `~/.copilot/planning-db` |
| Managed CLI lane enforcement | Desktop runtime bootstrap + bundled/seeded CLI contract |
| Update policy, rollback, kill switch | Desktop release policy; implementation may change at cutover but fail-closed rules stay fixed |
| Runtime health reporting | Local runtime HTTP surface consumed by the desktop UI |

## Packaged Windows Tauri runtime/resource layout

The first shipped Tauri cut must treat the Tauri-resolved resource directory as the only packaged runtime root for bundled Node resources. The frozen Windows layout is:

```text
Elegy Copilot.exe
<tauri resource dir>/
  node/
    node.exe
  copilot-ui/
    server.js
    lib/
    node_modules/
    routes/
    public/
    ui-dist/
    package.json
  copilot-cli/
  engine-assets/
  .cli/
    policy/
      pipeline-policy.lock.json
  local-tracker/
    dist/
    node_modules/
    package.json
  scripts/
  runtime-manifests/
    windows-tauri-node-sidecar.json
```

Layout rules:

- The Tauri shell resolves these paths through Tauri app/resource APIs; no runtime code may infer them from the executable path.
- Existing bundled directory names stay stable where possible (`copilot-cli`, `engine-assets`, `.cli/policy`, `local-tracker`) to minimize migration risk.
- `copilot-ui/package.json` and `copilot-ui/node_modules/` stay co-located so `server.js` can resolve its runtime dependencies without a host-installed Node environment.
- `@electric-sql/pglite` payloads under `copilot-ui/node_modules/@electric-sql/pglite/dist/` must remain filesystem-readable in packaged form because the runtime loads wasm/data side assets from disk-relative paths.
- `~/.copilot` remains the runtime state root; packaged resources are read-only app assets, not mutable state.
- Kimaki is installed with the desktop runtime and stores mutable state under `~/.elegy/kimaki`.

## Bundled Node sidecar model

The first Tauri cut ships with a bundled Windows Node runtime sidecar.

- The shell launches `node.exe` explicitly for packaged child processes.
- The shell does **not** rely on Electron-style `process.execPath` self-spawn behavior.
- The shell launches explicit JS entrypoints from the resource directory:
  - `copilot-ui/server.js`
- Shell-neutral services must accept resolved paths for:
  - resource root
  - bundled Node executable
  - server entrypoint

Packaging contract:

- A host-installed Node.js is **not** required for the packaged Windows Tauri app.
- Managed CLI acquisition remains limited to a bundled payload or a seeded install under `~/.copilot/managed-cli/<channel>/`.
- On Windows, when neither approved payload exists yet, the desktop runtime may seed that managed install from the packaged @github/copilot-win32-x64 dependency dependency and must still fail closed if that packaged dependency is unavailable.
- Stable app builds continue to pair only with stable SDK/CLI bits; prerelease builds continue to pair only with prerelease SDK/CLI bits.

## Startup-token ownership and handoff

Startup-token authority moves from Electron implementation details to the desktop-shell contract itself:

1. The desktop shell mints the startup token.
2. The token is handed to the local runtime only for the initial window bootstrap.
3. The first window navigation carries the token to the loopback root.
4. The runtime exchanges that token for an `HttpOnly`, `SameSite=Strict` local session cookie and removes the token from the visible URL by redirect.
5. The shell does not persist the raw token to repo state, session state, or packaged resources.
6. Plain browser access without the shell-issued token/cookie remains denied.

The contract is shell-neutral: Tauri may use different implementation plumbing than Electron, but it must preserve one-shell-issued bootstrap token, one local cookie establishment step, and denial of raw browser dashboard access.

## Updater/feed/signing checkpoint for the active Tauri lane

Tauri is now the primary shell, but updater cutover is still **not** considered full in-app parity until this checkpoint remains satisfied and the remaining workflow cutover is completed.

Canon for the active Windows Tauri preview/release lane must record:

1. the Tauri updater/feed mechanism to use, or an explicit first-cut manual-installer posture
2. the Windows signing path and evidence expectations
3. rollback + kill-switch equivalence with existing fail-closed policy
4. stable/prerelease lane handling for app artifacts and managed SDK/CLI pairing
5. the release workflow semantics for the Tauri packaging lane

Checkpoint rules:

- No private signing keys may be committed to the repo or stored on CI runners.
- Signing custody remains external through the managed signing service / HSM / KMS posture already frozen in [[security-model]] [security-model.md](security-model.md).
- The current implemented checkpoint seam is a Windows-first NSIS packaging lane that emits manual-installer release metadata with fail-closed channel pairing; it performs automatic matching-channel release checks but does **not** claim live in-app updater/feed parity yet.
- The active Tauri shell may expose GitHub-release-backed updater status and manual-installer download state through a shell bridge, but that bridge must require explicit user action for installer download/apply and must not imply seamless transport/feed support until a later cut enables it.
- Public GitHub semver tags such as `1.2.3` and `1.2.3-rc.1` remain preview/evaluation releases and should stay marked as prerelease, while stable desktop downloads come from promoted non-prerelease `desktop-v*` releases.
- Until historic semver releases are remediated so none remain non-prerelease, `/releases/latest` must not be treated as the stable desktop shortcut.

## Cutover checkpoint status

The current Windows-first Tauri cut now owns the canonical desktop path because these checkpoint
conditions are in place:

1. the bundled Node sidecar model is implemented and validated on Windows
2. startup-token handoff parity is proven under Tauri
3. updater/feed/signing decisions for the current slice are documented as an explicit manual-installer posture
4. rollback/kill-switch posture remains fail closed
5. legacy shell migration guidance has been retired from release metadata

That residue must stay clearly marked and must not retake primary-path status without an explicit
rollback or follow-up cutover decision.
