# Elegy Copilot — Repo Entrypoint

Shared-asset and control-plane workspace for Copilot, Codex, OpenCode, Antigravity, Claude Code,
and the local desktop UI.

## Start Here

1. Open `docs/system/index.md`.
2. For governance or instruction-surface work, route through
   `docs/system/mocs/conventions-and-governance.md`.
3. Expand only to the smallest owning node for the active rule family.

## Area Map

| Area | Path | Purpose |
|---|---|---|
| Canonical docs | `docs/system/` | Repo policy, design, governance, operations |
| Specs | `docs/specs/` | Optional design artifacts |
| Shared catalog | `catalog-assets/` | Cross-harness shared skill sources |
| Harness assets | `engine-assets/`, `codex-assets/`, `opencode-assets/`, `antigravity-assets/`, `claude-assets/` | Shipped instructions, skills, agents |
| Desktop UI | `copilot-ui/` | Local dashboard, desktop shell, backend |
| Contracts | `contracts/` | Shared runtime contracts |
| Local tracker | `local-tracker/` | Session/task tracking and gateway support |

## Key Commands

```bash
npm ci
npm run test:all
npm run ci:local
npm run ci:local:full
npm run docs:check:links
npm run generate:spec-index
npm run ui:check
npm run build:rust-backend
npm run test:rust-backend
npm --prefix copilot-ui run desktop:dev
```

Additional npm scripts: `npm run postinstall`, `npm run contracts:validate:session-state-sample`, `npm run docs:dev`, `npm run docs:preview`, `npm run docs:check:links`, `npm run validate:guidelines-wiring`, `npm run validate:instruction-wiring`, `npm run validate:instruction-budgets`, `npm run obsidian-docs:preflight`, `npm run obsidian-docs:init`, `npm run obsidian-docs:validate`, `npm run generate:spec-index`, `npm run ci:local:full`, `npm run ui:check`, `npm run ui:check:validate`, `npm run commit-check:discover`, `npm run commit-check:setup`, `npm run commit-check:run`, `npm run build:rust-backend`, `npm run test:rust-backend`, `npm run install:ghcp`, `npm run install:ghcp:dry`, `npm run ghcp:profile:switch`, `npm run ghcp:profile:list`, `npm run ghcp:profile:current`.


## Canonical Pointers

- Instruction writing and thin entrypoints: `docs/system/concise-instruction-governance.md`
- Repo conventions and review posture: `docs/system/project-conventions-governance.md`
- Documentation structure and freshness: `docs/system/documentation-structure-governance.md`
- Shared baseline workflow contract: `catalog-assets/instructions/agent-session-defaults.md`
