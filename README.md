# Instruction Engine / Elegy Copilot

Shared agent, skill, prompt, instruction, and local-control-plane assets for Copilot, Codex, OpenCode, Antigravity, and Claude Code.

## Install or refresh

Run the installer for the tool you use; re-running the same command refreshes the shared baseline.

| Tool | Windows (PowerShell) | macOS / Linux |
|------|-----------------------|---------------|
| Copilot install/refresh | `pwsh -File scripts/cli-install.ps1 --all` | `bash scripts/cli-install.sh --all` |
| Codex install/refresh | `pwsh -File scripts/codex-install.ps1` | `bash scripts/codex-install.sh` |
| OpenCode install/refresh | `pwsh -File scripts/opencode-install.ps1` | `bash scripts/opencode-install.sh` |
| Antigravity install/refresh | `pwsh -File scripts/antigravity-install.ps1` | `bash scripts/antigravity-install.sh` |
| Claude Code install/refresh | `pwsh -File scripts/claude-install.ps1` | `bash scripts/claude-install.sh` |
| Refresh everything | `pwsh -File scripts/install-all.ps1` | `bash scripts/install-all.sh` |

Add `--force` to overwrite managed targets that diverged, or `--dry-run` to preview changes without writing. See [Harness Asset Flow](docs/system/harness-asset-flow.md) for the full install model.

## Canonical docs breadcrumb

Start at `docs/system/index.md` → closest MOC → smallest canonical node.

Useful starting points:
- Repo rules and precedence: `docs/system/project-conventions-governance.md`
- Instruction writing: `docs/system/concise-instruction-governance.md`
- Spec-driven development: `docs/system/spec-driven-development.md`
- OpenCode native model: `docs/system/opencode-guide.md`
- Harness install and sync: `docs/system/harness-asset-flow.md`

## Repo layout

```
instruction-engine/
├── antigravity-assets/     Antigravity Gemini.md source + skills
├── catalog-assets/         Shared cross-surface skill catalog
├── claude-assets/          Claude Code CLAUDE.md source + skills
├── codex-assets/           Codex global AGENTS.md + agents + skills
├── configuration/          App-level config overlays
├── contracts/              Shared runtime contracts
├── copilot-ui/             Local dashboard + desktop shell (Node.js + Tauri)
├── docs/
│   ├── system/             Canonical design and operational docs
│   └── specs/              Durable spec-driven development specs
├── engine-assets/          Shipped Copilot agents, skills, prompts, instructions
├── local-tracker/          Session/task tracking daemon + Discord gateway
├── opencode-assets/        OpenCode home baseline (agents, skills, plugins, profiles)
├── scripts/                Install, validate, and admin scripts
└── specs/                  Redirect to docs/specs/
```

## Quick start

```powershell
npm ci
npm run build:contracts
npm run test:all
```

Desktop app development: `npm --prefix copilot-ui run desktop:dev`

Desktop download: [Releases page](https://github.com/Sofreshx/Elegy-copilot/releases)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for local setup, validation commands, and PR expectations.

Edit Copilot assets in `engine-assets/`. Edit harness-specific assets in `codex-assets/`, `opencode-assets/`, `antigravity-assets/`, or `claude-assets/`. Edit shared skills in `catalog-assets/shared-skills/`. Keep manifest metadata current.

---

## Documentation

- [System Docs Index](docs/system/index.md) — canonical start
- [Spec-Driven Development](docs/system/spec-driven-development.md)
- [Harness Asset Flow](docs/system/harness-asset-flow.md)
- [Concise Instruction Governance](docs/system/concise-instruction-governance.md)
- [OpenCode Guide](docs/system/opencode-guide.md)
- [Copilot UI Guide](docs/system/copilot-ui-guide.md)
- [Documentation Structure Governance](docs/system/documentation-structure-governance.md)
