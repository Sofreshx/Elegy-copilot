# Elegy Copilot — Repo Entrypoint

Shared-asset and control-plane workspace for Copilot, Codex, OpenCode, Antigravity, Claude Code,
and the local desktop UI.

## Bootstrap

1. Open `docs/system/index.md`.
2. Use the task routes below to find the owning canonical node.
3. Read the smallest set of owning nodes required for the task, plus any nearer
   scoped instruction file, before editing.

If no canonical node owns a rule-bearing change, route the gap through
`docs/system/mocs/conventions-and-governance.md` instead of inferring policy.

## Task Routes

| Task | Start | Focused validation |
|---|---|---|
| Instructions or governance | `docs/system/mocs/conventions-and-governance.md` | `npm run validate:instruction-wiring`, `npm run validate:instruction-quality`, and `npm run validate:instruction-budgets` |
| Documentation structure or links | `docs/system/documentation-structure-governance.md` | `npm run docs:check:links` |
| Harness assets or installers | `docs/system/harness-asset-flow.md` | `node scripts/validate-manifest.js`, then the harness-specific check owned there |
| Desktop UI | `docs/system/copilot-ui-guide.md` | `npm run ui:check` |
| Specs or planning | `docs/system/spec-driven-development.md` | `npm run docs:check:links`; run `npm run generate:spec-index` when the spec inventory changes |
| Broad repository change | `docs/system/project-conventions-governance.md` | `npm run ci:local` |

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
