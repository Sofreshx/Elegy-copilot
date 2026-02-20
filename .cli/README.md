# .cli (Copilot CLI install + dashboard)

This folder contains the **Copilot CLI-oriented install contract** (manifest + UI + CLI-first global instructions).

Canonical engine assets live under:
- `.github/agents/` — agent definitions
- `.github/skills/` — skill folders
- `.github/prompts/` — VS Code prompt files (`*.prompt.md`)

Installers and the local dashboard sync from those canonical sources into `~/.copilot/...` so the same assets are usable across any repo (CLI + VS Code), without duplicating the source of truth.

## What it contains
- `manifest.json` — the authoritative list of installable assets + package metadata
- `instructions\` — a single `copilot-instructions.md` file intended to be installed as the user’s global Copilot instructions
- `ui\` — dashboard UI helpers (**repo-run only**, not installed via `manifest.json` in v1)

Legacy (deprecated):
- `agents\` and `skills\` under this folder may exist from earlier packaging iterations; canonical sources are under `.github/`.

Notable utility agents shipped in this distribution:
- `@remaining-work` — quick “is anything left to do?” checker (pinned to the free model `gpt-5-mini`)
- `@agent-governor` — create/edit/audit agent files and evaluate the overall agent system for CLI readiness

## Default install locations (installer behavior)
Installers typically copy these assets into the user’s Copilot home:
- `.github/agents\*` → `~/.copilot/agents/`
- `.github/skills\*` → `~/.copilot/skills/`
- `.github/prompts\*` → `~/.copilot/prompts/` (VS Code-only)
- `instructions\copilot-instructions.md` → `~/.copilot/copilot-instructions.md`

## Notes on path / discovery uncertainty
Some environments may not reliably discover agent/skill files **recursively** (or may flatten folders during install).
To reduce ambiguity:
- Agent files are kept **flat** under `.github/agents/`.
- Skills use **skill-name folders** under `.github/skills/<name>/...`.
- Prompt files use `*.prompt.md` under `.github/prompts/` (VS Code-only).
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

