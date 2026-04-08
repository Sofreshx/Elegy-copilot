# Releasing Elegy Copilot

Elegy Copilot now ships as a Tauri-only Windows desktop app with a bundled Node sidecar.

## Release lanes

- `npm --prefix copilot-ui run desktop:preview:stage` builds and stages the local Windows preview lane.
- `.github/workflows/desktop-preview-release.yml` publishes unsigned Windows preview artifacts for a matching semver tag.
- `.github/workflows/desktop-version-tag.yml` creates `desktop-v<version>` tags for maintainer release flows.
- `.github/workflows/desktop-release.yml` signs and publishes the Windows release for `desktop-v*` tags.

## Channel contract

- stable app releases must stay on stable SDK/CLI lanes
- prerelease app releases must stay on prerelease SDK/CLI lanes
- the packaged app owns Copilot CLI ensure/install/update for its matched lane
- packaged workflow assets remain bundled for parity checks, but the workflow sidecar stays default-disabled unless explicitly enabled

## Local preview/staging

Run:

```bash
npm --prefix copilot-ui run desktop:preview:stage
```

This produces:

- a Windows NSIS installer under `copilot-ui/release/tauri/windows`
- `release-manifest.json` with fail-closed channel metadata
- `windows-installation-guide.md`
- staged release files under `release-artifacts/windows-tauri`

This lane is manual-installer only. It does not claim in-app updater/feed parity.

## Public preview release

`.github/workflows/desktop-preview-release.yml` is the public preview lane.

- Pushing a normal semver tag such as `1.0.0` or `1.0.0-rc.1` builds and publishes unsigned Windows preview artifacts.
- The preview tag must exactly match `copilot-ui/package.json` at the selected ref.
- Manual `workflow_dispatch` is available for backfills or non-tag refs.
- The workflow fails closed unless it runs from the repository declared in `copilot-ui/package.json` under `desktopRelease.publishRepository`.

## Signed maintainer release

Use `.github/workflows/desktop-version-tag.yml` and `.github/workflows/desktop-release.yml`.

Workflow:

1. Bump `copilot-ui/package.json` version.
2. Run the desktop tag helper workflow to create `desktop-v<version>`.
3. Push that tag to trigger the signed release workflow.
4. Use manual `workflow_dispatch` only for backfills or `publish_mode=draft`.

Required repository configuration:

- `DESKTOP_SIGNING_SERVICE_URL`
- optional `DESKTOP_SIGNING_SERVICE_AUDIENCE`
- optional `DESKTOP_SIGNING_SERVICE_API_KEY`

The signed release lane is fail-closed when signing evidence is unavailable.

## CI expectations

- `.github/workflows/repo-ci.yml` is the repo-wide required CI workflow.
- The Windows packaging check in that workflow runs `npm --prefix copilot-ui run desktop:preview:stage`.
- Release docs and workflow behavior must stay aligned.
