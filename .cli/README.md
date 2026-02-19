# .cli (Copilot CLI distribution)

This folder is an **installable distribution** of Instruction Engine assets for GitHub Copilot CLI (or other installers).

## What it contains
- `agents\` — Copilot custom agents (`*.agent.md`)
- `skills\` — Copilot skills (`<skill-name>\SKILL.md`)
- `instructions\` — a single `copilot-instructions.md` file intended to be installed as the user’s global Copilot instructions
- `manifest.json` — the authoritative list of installable assets + package metadata
- `ui\` — dashboard UI helpers (**repo-run only**, not installed via `manifest.json` in v1)

Notable utility agents shipped in this distribution:
- `@remaining-work` — quick “is anything left to do?” checker (pinned to the free model `gpt-5-mini`)
- `@agent-governor` — create/edit/audit agent files and evaluate the overall agent system for CLI readiness

## Default install locations (installer behavior)
Installers typically copy these assets into the user’s Copilot home:
- `agents\*` → `~/.copilot/agents/`
- `skills\**` → `~/.copilot/skills/`
- `instructions\copilot-instructions.md` → `~/.copilot/copilot-instructions.md`

## Notes on path / discovery uncertainty
Some environments may not reliably discover agent/skill files **recursively** (or may flatten folders during install).
To reduce ambiguity:
- Agent files in this distribution are kept **flat** under `agents\`.
- Skill files keep a **skill-name folder** (`skills\<name>\SKILL.md`) and the manifest provides explicit destination paths.
- Installers should prefer the `destination` fields in `manifest.json` over any implicit “copy folder recursively” logic.

## Dashboard (repo-run only, v1)
For v1, the dashboard is **not** installed into `~/.copilot` (it is intentionally omitted from `manifest.json`).

- UI server code lives in this repo at: `.cli\ui\`
- Run (direct):
  - `node .cli/ui/server.js`
- Run (helper scripts):
  - `scripts/cli-ui.ps1`
  - `./scripts/cli-ui.sh`
- Open: http://127.0.0.1:3210

### What it observes
- `~/.copilot/session-state/` (sessions, events, plans)
- `~/.copilot/agents/` + `~/.copilot/skills/` (installed assets)
- `~/.copilot/*` config files (e.g., instructions), plus this repo’s `.cli\manifest.json` for managed asset status

### Actions
- Refresh/reload (re-scan local state)
- Sync/update assets (copy managed assets into `~/.copilot`)
- Delete/remove assets (**guarded**; refuses unsafe deletes unless explicitly forced)

### Safety
- Local-only UI (no auth): intended for localhost development.
- The server binds to `127.0.0.1` by default — **do not expose the port** to untrusted networks.

