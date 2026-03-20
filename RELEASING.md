# Releasing Elegy Copilot

Elegy Copilot currently has two desktop distribution lanes:

- `desktop-preview-release.yml` for public, unsigned preview artifacts on GitHub Releases
- `desktop-release.yml` for the signed maintainer release flow

## 1. Preview release lane

Use `.github/workflows/desktop-preview-release.yml` when you need downloadable desktop artifacts on GitHub without the private signing service.

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
3. Run `desktop-release.yml` with that `release_tag`.

Required repository configuration:

- `DESKTOP_SIGNING_SERVICE_URL`
- optional `DESKTOP_SIGNING_SERVICE_AUDIENCE`
- optional `DESKTOP_SIGNING_SERVICE_API_KEY`

The signed release lane is intentionally fail-closed when signing evidence is unavailable.

## 3. CI expectations

- `.github/workflows/extension-ci.yml` is the repo-wide required CI workflow and must stay fail-closed.
- Release docs and workflow behavior must stay aligned.
- When changing desktop packaging, prefer updating both `README.md` and the canonical docs in `docs/system/`.
