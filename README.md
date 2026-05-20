# Instruction Engine

Instruction Engine is the shared asset repo behind Elegy Copilot. It ships curated install surfaces for Copilot, Codex, OpenCode, and Antigravity/Gemini, plus a local catalog UI for status, external sources, and repo registration.

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

## Current Install Model

- Copilot installs from `engine-assets/` into `~/.copilot`.
- Copilot skills use `~/.copilot/skills` and `~/.copilot/skills-vault` based on `loadMode`.
- Codex installs from `codex-assets/` into `~/.codex`.
- OpenCode installs from `opencode-assets/` into `~/.config/opencode`.
- Antigravity installs from `antigravity-assets/` into `~/.gemini`, with shared skills under `~/.gemini/antigravity/skills`.
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
- Current external-source MCP targets: `codex`, `opencode`, `gemini-cli`.

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
