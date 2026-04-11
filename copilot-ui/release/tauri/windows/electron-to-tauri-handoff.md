# Electron to Tauri Migration Handoff

- Desktop version: 1.0.1
- Release channel: stable
- Tauri installer: Elegy Copilot_1.0.1_x64-setup.exe

## Operator truth

- Electron remains available on the matching channel until the final cutover work is complete.
- This handoff is a manual installer transition, not an in-place Electron-to-Tauri auto-update.
- Release notes, publish metadata, and any operator messaging must point Electron users to the matching-channel Tauri installer download.

## User steps

1. Stay on the current Electron install until you are ready to migrate.
2. Download the matching-channel Tauri Windows installer (`Elegy Copilot_1.0.1_x64-setup.exe`).
3. Run the installer manually and launch the Tauri app.
4. Verify that the app starts successfully against the existing local `~/.copilot` runtime state.
5. Keep Electron installed until the Tauri install is confirmed; uninstall Electron only after verification if you no longer need it.

## Non-goals in this slice

- No fake seamless updater bridge from Electron into Tauri.
- No claim that Electron can replace itself with the Tauri binary in place.
- No claim that Tauri in-app updater/feed parity exists yet.

## Canonical docs

- `docs/system/desktop-runtime-tauri-migration-contract.md`
- `docs/system/desktop-update-rollback-runbook.md`
- `docs/system/copilot-ui-guide.md`
