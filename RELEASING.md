# Releasing Elegy Copilot

Elegy Copilot currently has two desktop distribution lanes:

- `desktop-preview-release.yml` for public, unsigned preview artifacts on GitHub Releases
- `desktop-release.yml` for the signed maintainer release flow

Release-channel pairing is part of the packaged desktop contract:

- stable app releases must ship and update against stable SDK/CLI lanes
- prerelease app releases must ship and update against prerelease SDK/CLI lanes
- the packaged app owns Copilot CLI ensure/install/update for its matched lane rather than treating it
  as a separate manual prerequisite
- this slice currently ships channel-contract metadata only; if no bundled CLI payload is present, desktop SDK features fail closed until a matching managed CLI is seeded or a later release adds the bundle/fetch path
- packaged workflow assets are still bundled for parity checks, but the workflow sidecar must remain default-disabled unless explicitly enabled

## 1. Preview release lane

`.github/workflows/desktop-preview-release.yml` is the default public distribution lane.

- Pushing a normal release tag such as `1.0.0` or `1.0.0-rc.1` automatically builds and attaches unsigned desktop artifacts to that GitHub release.
- The preview release tag must exactly match `copilot-ui/package.json`'s version at the selected ref.
- Auto-published preview releases are always marked as prereleases because the artifacts are intentionally unsigned.
- Manual `workflow_dispatch` remains available when you need to backfill assets for an existing tag or build from a non-tag ref.
- The workflow now fails closed if it is run from a repository that does not match `copilot-ui/electron-builder.yml`'s GitHub publish target.

Inputs:

- `ref` — branch, tag, or commit to build
- `tag_name` — GitHub release tag to create/update
- `release_name` — optional human-friendly release title
- `prerelease` — whether to mark the release as a prerelease

What it publishes:

- unsigned Windows desktop artifacts from `copilot-ui/release`
- Linux preview tarball + checksum
- macOS preview tarball
- explicit unsigned marker files for each preview lane

This lane is the safest default for open-source/public preview distribution.

## 2. Signed maintainer release lane

Use `.github/workflows/desktop-version-tag.yml` and `.github/workflows/desktop-release.yml` for the signed maintainer flow.

Workflow:

1. Bump `copilot-ui/package.json` version.
2. Run the desktop tag helper workflow to create `desktop-v<version>`.
3. Pushing that `desktop-v<version>` tag now auto-runs `desktop-release.yml` and creates or updates the matching published GitHub release.
4. Use manual `workflow_dispatch` only when you need to backfill an existing desktop tag or intentionally override `publish_mode` back to `draft`.

Required repository configuration:

- `DESKTOP_SIGNING_SERVICE_URL`
- optional `DESKTOP_SIGNING_SERVICE_AUDIENCE`
- optional `DESKTOP_SIGNING_SERVICE_API_KEY`

The signed release lane is intentionally fail-closed when signing evidence is unavailable.
Updater metadata for packaged builds is emitted against `Sofreshx/Elegy-copilot`, so published assets and
in-app update discovery stay aligned with the actual GitHub repository.
The maintainer tag helper and signed release workflows now refuse to run from any other repository.

## 3. Local packaged updater smoke

Run `npm --prefix copilot-ui run package:win:smoke` before cutting or validating a Windows desktop release when you need a local integrity check for the packaged runtime and updater lane.

What it validates:

- the desktop packaging step rebuilt the React UI, Electron main bundle, `local-tracker`, and `local-tracker` gateway runtime that packaged Electron depends on
- the packaged Copilot CLI channel contract still matches the source metadata and the app's stable/prerelease SDK lane
- the packaged Windows app boots and serves `/api/health`
- the packaged SDK bridge fails closed with `managed_cli_missing` when the current channel-contract-only slice has no bundled or seeded CLI payload
- `copilot-ui/release/latest.yml` version and installer path match the packaged desktop version
- the referenced installer and `.blockmap` exist in `copilot-ui/release`
- the packaged `win-unpacked/resources/app-update.yml` still matches the current GitHub publish metadata
- packaged `engine-assets` and workflow-layer assets remain present, and the bundled workflow sidecar stays default-disabled by default
- the packaged updater regression tests shipped under `win-unpacked/resources/app/dist-electron` still execute successfully

What it does not validate:

- GitHub Release publishing
- live update discovery against GitHub
- installer replacement and restart behavior on a second installed build

## 4. CI expectations

- `.github/workflows/extension-ci.yml` is the repo-wide required CI workflow and must stay fail-closed.
- `.github/workflows/extension-ci.yml` now includes a required Windows `desktop-package-smoke` job that runs `npm --prefix copilot-ui run package:win:smoke`.
- Release docs and workflow behavior must stay aligned.
- When changing desktop packaging, prefer updating both `README.md` and the canonical docs in `docs/system/`.
