# Elegy Copilot

Elegy Copilot (formerly Instruction Engine) is the shared asset repo for the desktop application and supporting install surfaces. It ships curated assets for Copilot, Codex, OpenCode, and Antigravity 2 / Antigravity CLI with Gemini CLI compatibility, plus a local catalog UI for status, external sources, and repo registration.

## Install Or Refresh

| Surface | Windows | macOS / Linux |
| --- | --- | --- |
| Copilot | `pwsh -File scripts/cli-install.ps1 --all` | `bash scripts/cli-install.sh --all` |
| Codex | `pwsh -File scripts/codex-install.ps1` | `bash scripts/codex-install.sh` |
| Antigravity | `pwsh -File scripts/antigravity-install.ps1` | `bash scripts/antigravity-install.sh` |
| OpenCode | `pwsh -File scripts/opencode-install.ps1` | `bash scripts/opencode-install.sh` |
| Everything | `pwsh -File scripts/install-all.ps1` | `bash scripts/install-all.sh` |

- Add `--force` to overwrite managed files.
- Add `--dry-run` to preview writes.

## Opt-In Spec-Driven Repo Setup

- Shared spec skills still install globally per harness.
- Repo-local spec bootstrap is opt-in for one selected repo at a time.
- Use the existing harness installer with `--repo-root <path> --setup-profile spec-driven`.
- This bootstraps repo-local spec surfaces without creating a new runtime or planner fleet.

Examples:

```powershell
pwsh -File scripts/codex-install.ps1 --repo-root C:\src\my-repo --setup-profile spec-driven
pwsh -File scripts/opencode-install.ps1 --repo-root C:\src\my-repo --setup-profile spec-driven
pwsh -File scripts/antigravity-install.ps1 --repo-root C:\src\my-repo --setup-profile spec-driven
```

What the `spec-driven` profile bootstraps:

- `.github/copilot-instructions.md` managed spec-driven block
- repo `AGENTS.md` for Codex/OpenCode or repo `GEMINI.md` for Antigravity managed spec-driven block
- `.github/agents/` and `.github/skills/`
- `specs/` with starter `specs/index.md`
- `scripts/validate-specs.js`
- `package.json` script `validate:specs` when `package.json` exists and the script name is free
- repo-local skill mirrors for the selected harness: `.agents/skills/`, `.opencode/skills/`, or `.gemini/skills/`

## Current Install Model

- Copilot installs from `engine-assets/` into `~/.copilot`.
- Copilot skills use `~/.copilot/skills` and `~/.copilot/skills-vault` based on `loadMode`.
- Codex installs from `codex-assets/` into `~/.codex`.
- OpenCode installs from `opencode-assets/` into `~/.config/opencode`.
- Antigravity 2 / Antigravity CLI installs from `antigravity-assets/` into the current Gemini-compatible `~/.gemini` layout, with shared skills under `~/.gemini/antigravity/skills`.
- Global shipped assets are still split by harness. There is not one universal global skill root yet.

## Catalog

`copilot-ui` is the local control plane and desktop app.

- `Catalog > Status` is the main status page.
- It shows supported install targets, external sources, installed inventory, and recent runtime-used skills.
- External sources are separate from the older provider system.
- GitHub sources are ingested by repo contents only: `SKILL.md` for skills and `server.json` for MCP servers.
- Upstream installer scripts are never executed.
- Activation is global per target, not repo-scoped.
- Current external-source skill targets: `codex`, `opencode`, `antigravity`.
- Current external-source MCP targets: `codex`, `opencode`, `antigravity-cli` (legacy alias: `gemini-cli`).

## Repo-Local Skills

- Canonical source: `.github/skills/<skill>/SKILL.md`
- Generated mirrors: `.agents/skills/<skill>`, `.opencode/skills/<skill>`, `.gemini/skills/<skill>`
- Check, install, or fully reconcile mirrors with:

```powershell
node scripts/check-repo-skill-mirrors.mjs
node scripts/install-repo-skill-mirrors.mjs
node scripts/update-repo-skill-mirrors.mjs
```

- This applies only to repo-local skills. Shipped global assets still live in their harness-specific trees.
- The `spec-driven` repo setup profile uses the same `.github/skills` authority and installs only the selected harness mirror.

## Docs

- Start at `docs/system/index.md`.
- `docs/system/copilot-ui-guide.md` covers the local UI, desktop runtime, and current navigation.
- `docs/system/catalog-control-plane.md` covers installs, external sources, and `Catalog > Status`.
- `docs/system/opencode-guide.md` covers the supported OpenCode model.
- `docs/system/repo-skill-sync-governance.md` covers repo-local skill authority and mirrors.

## Development

```powershell
npm ci
npm run build:contracts
npm run test:all
```

Use `npm --prefix copilot-ui run desktop:dev` when working on the desktop app.

More project docs: [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), [SUPPORT.md](SUPPORT.md), [RELEASING.md](RELEASING.md).
