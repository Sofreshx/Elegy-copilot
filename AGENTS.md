# Instruction Engine — Agent Entrypoint

This is the Instruction Engine monorepo, also published as Elegy Copilot. It is the shared-asset and control-plane workspace for Copilot, Codex, OpenCode, and Antigravity.

## Before any work

Follow `guidelines.md`: clarify ambiguity before implementation; write concise, precise, diagram-forward instructions; avoid vague or ceremonial prose.

1. Start at `docs/system/index.md` for the task's canonical doc entrypoint.
2. Use the narrowest relevant validator after changes (`npm run test:all`, `npm run ci:local`, or the specific module's test script).
3. Before authoring specs, install the pre-commit hook: `node scripts/install-spec-hooks.mjs`. This is part of the spec-system-hardening reliability layers and ensures spec validation runs before every commit. See `docs/system/spec-driven-development.md` for the full spec-driven development contract.

## Quick orientation

| Area | Path | Purpose |
|------|------|---------|
| Engine assets | `engine-assets/` | Shipped Copilot agents, skills, prompts, instructions |
| Codex assets | `codex-assets/` | Shipped Codex instructions, agents, skills |
| OpenCode assets | `opencode-assets/` | OpenCode home baseline |
| Antigravity assets | `antigravity-assets/` | Antigravity Gemini.md + skills |
| Dashboard UI | `copilot-ui/` | Local dashboard + desktop shell (Node + Tauri) |
| Contracts | `contracts/` | Shared runtime contracts |
| Local tracker | `local-tracker/` | Session/task tracking + Discord gateway |
| Native runtime | `native/` | Rust runtime for select API routes |
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

## Rules

- Never commit secrets, signing material, or machine-local state.
- Run validation after every change (lint, typecheck, test).
- When changing shipped assets, update manifest + allowlist + validators together.
- When changing UI structure, update `docs/system/copilot-ui-guide.md`.
- Prefer additive changes over weakening existing safety gates.

## Authority

1. Explicit user instruction for the current task
2. Canonical docs in `docs/system/**`
3. `README.md` and other maintained docs
4. Repeated implementation patterns
