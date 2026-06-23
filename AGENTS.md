# Elegy Copilot — Agent Entrypoint

Shared-asset and control-plane workspace for Copilot, Codex, OpenCode, Antigravity, and Claude Code.

## Before any work

1. Start at `docs/system/index.md` for the task's canonical doc entrypoint.
2. For governance or instruction-surface work, route through `docs/system/mocs/conventions-and-governance.md`, then open the smallest owning node.
3. Use the narrowest relevant validator after changes (`npm run test:all`, `npm run ci:local`, or the specific module's test script).
4. Specs are optional design artifacts at `docs/specs/<slug>/spec.md`. See `docs/system/spec-driven-development.md` for the current operating model. Spec validation is not enforced as repo policy.

## Quick orientation

| Area | Path | Purpose |
|------|------|---------|
| Shared catalog | `catalog-assets/` | Cross-harness shared skill sources |
| Engine assets | `engine-assets/` | Shipped Copilot agents, skills, prompts, instructions |
| Codex assets | `codex-assets/` | Shipped Codex instructions, agents, skills |
| OpenCode assets | `opencode-assets/` | OpenCode home baseline |
| Antigravity assets | `antigravity-assets/` | Antigravity Gemini.md + skills |
| Claude assets | `claude-assets/` | Claude Code CLAUDE.md + skills |
| Dashboard UI | `copilot-ui/` | Local dashboard + desktop shell (Node + Tauri) |
| UI governance | `.elegy/ui-check.json`, `docs/system/ui-development-governance.md`, `catalog-assets/shared-skills/ui-system/` | Stack-neutral UI workflow with component inventory, validation lanes, and evidence gates |
| Contracts | `contracts/` | Shared runtime contracts |
| Local tracker | `local-tracker/` | Session/task tracking + Discord gateway |
| Canonical docs | `docs/system/` | Design, governance, and operational docs |
| Specs | `docs/specs/` | Durable spec-driven development specs |

Future docs and specs must be concise, map-like, and scoped to their stated purpose (no tangential exposition, no duplicated policy).

## Key commands

```bash
npm ci                          # Install all dependencies
npm run build:contracts         # Build shared contracts
npm run test:all                # Run all workspace tests
npm run ci:local                # Full local CI (validators + builds + tests)
npm --prefix copilot-ui run desktop:dev   # Start desktop app in dev mode
node copilot-ui/server.js       # Raw server (API debugging only)
```

## Authority

| Priority | Source |
|---|---|
| 1 | Explicit user instruction |
| 2 | Repo-local canonical docs |
| 3 | `README.md` and maintained docs |
| 4 | Repeated implementation patterns |

If sources conflict, follow the highest authority and report the conflict.

## Where rules live

This file is repo-local orientation only. Durable policy and operational rules live elsewhere:

- Instruction writing, clarification, planning → `docs/system/concise-instruction-governance.md`
- Repo conventions, review rules, thin entrypoints → `docs/system/project-conventions-governance.md`
- Documentation shape, IA, freshness → `docs/system/documentation-structure-governance.md`
- Code quality, review flags, core workflow → shared baseline (`catalog-assets/instructions/agent-session-defaults.md`)
