# Windows Desktop Installation Guide

- Desktop version: 1.0.5
- Release channel: stable
- Windows installer: Elegy Copilot_1.0.5_x64-setup.exe

## Operator truth

- Tauri is the only supported desktop shell.
- Stable builds install from the stable channel; prerelease builds install from the prerelease channel.
- This release lane uses the signed Tauri updater for in-app updates.
- The desktop app checks the matching-channel update feed and applies signed updates in app.
- Managed CLI remediation may seed or refresh the approved Windows CLI into `~/.elegy/managed-cli/<channel>/` from the packaged `@github/copilot-win32-x64` dependency when the managed copy is missing or outdated.

## User steps

1. Download the matching-channel Windows installer (`Elegy Copilot_1.0.5_x64-setup.exe`).
2. Close any running desktop app instances before starting the installer.
3. Run the installer manually and follow the Windows installation prompts.
4. Launch the app after installation completes.
5. Verify that the app starts successfully against the existing local `~/.elegy` runtime state.

## Non-goals in this slice

- No claim that cross-channel installs are supported.
- No claim that the installer can bypass the standard Windows installation flow.

## Canonical docs

- `docs/system/desktop-runtime-tauri-migration-contract.md`
- `docs/system/desktop-update-rollback-runbook.md`
- `docs/system/copilot-ui-guide.md`
