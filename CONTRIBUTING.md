# Contributing to Elegy Copilot

Thanks for helping improve Elegy Copilot.

## Before you start

- Use Node.js `20.x` to match the GitHub Actions environment.
- Use `npm` with the committed lockfiles.
- Read the canonical docs entrypoint in `docs/system/index.md` before making structural changes.

## Local setup

```powershell
npm ci
npm run build:contracts
```

Common local commands:

```powershell
# Run the full Repo CI build job locally (all validators + builds + tests)
npm run ci:local

# Same plus Tauri check + docs build (needs Rust toolchain)
npm run ci:local:full

# Run all workspace tests that define a test script
npm run test:all

# Validate canonical docs links/graph when touching docs/system
node scripts/validate-doc-graph.js

# Check for dead intra-doc markdown links
npm run docs:check:links

# Validate shipped asset metadata when touching engine-assets or .cli manifests
node scripts/validate-manifest.js
node scripts/validate-skill-discovery-map.js
node scripts/validate-codex-assets.js

# Build the dashboard UI
npm --prefix copilot-ui run ui:build
```

For deeper CI conventions, dependency troubleshooting, and the full local
validation matrix, see [docs/system/ci-conventions.md](docs/system/ci-conventions.md).

## Working in this repo

Source-of-truth areas:

- `codex-assets/` for shipped Codex instructions, custom agents, and skills
- `engine-assets/` for shipped agents, skills, prompts, and instructions
- `copilot-ui/` for the local dashboard and desktop shell
- `contracts/` for shared runtime contracts
- `local-tracker/` for local tracking and gateway runtime
- `docs/system/` for canonical design and operational guidance

When changing assets:

1. Edit Copilot assets in `engine-assets/` and Codex assets in `codex-assets/`.
2. Update `.cli/manifest.allowlist.json` if the shipped Copilot baseline changes.
3. Re-generate `.cli/manifest.json` with `node scripts/generate-cli-manifest.mjs` when shipped Copilot assets change.
4. Run `node scripts/validate-manifest.js` and `node scripts/validate-codex-assets.js` when touching shipped asset metadata or Codex content.

When changing workflows or release docs:

1. Keep `.github/workflows/repo-ci.yml` fail-closed.
2. Update `RELEASING.md` and any canonical docs that describe the affected workflow.
3. Prefer additive release lanes over weakening existing safety gates.

## Pull requests

- Keep changes scoped and explain the user-visible outcome.
- Include the narrowest relevant validation commands in the PR description.
- Update docs when behavior, workflow, or repo structure changes.
- Do not commit secrets, signing material, or machine-local state.

## Need help?

- Usage/support questions: see `SUPPORT.md`
- Security issues: see `SECURITY.md`
- Expected conduct: see `CODE_OF_CONDUCT.md`
