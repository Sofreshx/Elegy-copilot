# Instruction Engine

Shared GitHub Copilot agents, skills, and workflow conventions for multi-repo development. Provides structured orchestration so planning, implementation, testing, and reviews stay consistent across all your projects.

## How it works

Assets are installed from `engine-assets/` into `~/.copilot`. Agents, prompts, and instructions land there directly, and skills install into `skills/` and/or `skills-vault/` depending on pointer mode. Both **VS Code Copilot Chat** and the **Copilot CLI** discover assets from that location — no per-repo setup needed.

```
engine-assets/  →  ~/.copilot/
  agents/           agents/
  skills/           skills/ + skills-vault/
  prompts/          prompts/
  copilot-instructions.md   copilot-instructions.md
```

## Quick start

### Install assets

**Windows (PowerShell):**
```powershell
pwsh -File scripts/cli-install.ps1 --all --force
```

**macOS / Linux:**
```bash
bash scripts/cli-install.sh --all --force
```

This installs all agents, prompts, and the global instructions file into `~/.copilot`, and installs skills into `~/.copilot/skills/` and/or `~/.copilot/skills-vault/` based on pointer mode.

Optional workflow packs, including the vendored `Superpowers Workflow Pack`, can then be installed from the local dashboard with one click in `Assets` -> `Workflow packs`.

### Enable subagent delegation in VS Code

```json
{
  "chat.customAgentInSubagent.enabled": true
}
```

### Verify

- VS Code Chat → right-click → **Diagnostics** (shows loaded agents/skills/prompts)
- Copilot CLI: run `/agents`, `/skills`

---

## Asset inventory

| Type | Count | Location |
|------|-------|----------|
| Agents | 45 | `engine-assets/agents/*.agent.md` |
| Skills | 57 | `engine-assets/skills/<name>/SKILL.md` |
| Prompts | 3 | `engine-assets/prompts/*.prompt.md` |
| Instructions | 1 | `engine-assets/copilot-instructions.md` |
| Canonical asset manifest | — | `engine-assets/manifest.json` |
| Generated shipping manifest | — | `.cli/manifest.json` |

---

## Key agents

| Agent | Purpose |
|-------|---------|
| `@orchestrator` | Recommended general entry point — routes tasks by complexity and delegates to specialised agents |
| `@code-explorer` | Read-only codebase analysis and Q&A |
| `@code-architect` | Designs feature architectures from existing patterns |
| `@impl-business` | Implements app/domain work units (endpoints, services, UI) |
| `@impl-infra` | Implements infra work units (CI, Docker, config, deployments) |
| `@code-reviewer` | Bug, logic, and security review |
| `@goal-reviewer` | End-gate goal completion assessor (`complete|partial|not-complete`) that emits read-only unresolved-goal sync instructions for the workflow/docs lane |
| `@final-reviewer` | Requested-vs-delivered and remaining-work post-mortem summary |
| `@unit-test-runner` | Runs unit tests safely with timeouts |
| `@security-scanner` | Scans for OWASP/endpoint vulnerabilities |
| `@agent-governor` | Read-only structural audit pointer for existing agent files |

`@orchestrator` is the recommended default for new work. Persisted session-state artifacts remain
available for workflows that explicitly hand off approved plan packs into
`~/.copilot/session-state/<SESSION_ID>/`.

---

## State location

Primary runtime state lives under `~/.copilot`:

```
~/.copilot/
  agents/               installed agent files
  skills/               always-available installed skill folders
  skills-vault/         installed skill vault for on-demand and mirrored always skills
  prompts/              installed prompt files
  copilot-instructions.md
  session-state/        Copilot session logs and plans
    <SESSION_ID>/
      plan.md           persisted plan artifact + progress tracker
      proposition.md    append-only guidance (after planning + execution)
      plans/            plan revisions
  sessions-archive/     archived sessions
  repo-state/           per-repo task/artefact state
```

Override the default location with `skillInstaller.state.root` in VS Code settings, or pass
`--copilot-home` to the dashboard server.

Migration note:

- `~/.copilot` is the canonical runtime state root for assets, session state, catalog state, and
  repo-state.
- remaining `~/.instruction-engine/*` inputs are legacy migration-only surfaces. Current runtime
  components rehome gateway config/status artifacts into `~/.copilot` when possible rather than
  treating `~/.instruction-engine` as a second root.

Persisted session-state artifacts live under `~/.copilot/session-state/<SESSION_ID>/`.
File-backed planning workflows write their `plan.md` and `proposition.md` artifacts there, and
`copilot-ui` reads the same location in its Sessions and Planning surfaces. The recommended
`@orchestrator` path keeps planning in chat unless a downstream workflow explicitly hands off to
persisted artifacts.

---

## Dashboard (local UI)

A local UI and control plane for viewing sessions, managing assets, and operating your `~/.copilot`
installation. `copilot-ui` can run as the local Node.js server or inside the packaged Electron shell.
`copilot-ui` is also the **catalog control plane** for the delivered asset system: it owns the
authoritative local catalog/search/audit APIs, repo inventory, projection refresh, and mutation
flows for shared, user-global, and repo-local assets.

```bash
# Direct
node copilot-ui/server.js

# Via helper scripts
scripts/cli-ui.ps1          # Windows
./scripts/cli-ui.sh         # macOS/Linux
```

Open: http://127.0.0.1:3210

The server binds to `127.0.0.1` only — do not expose to untrusted networks.
For the current tabs, route groups, persistence model, and validation anchors, see
`docs/system/copilot-ui-guide.md`.

The `Assets` tab now includes a `Workflow packs` panel for optional bundles that install multiple assets together. The first shipped bundle is `Superpowers Workflow Pack`, which installs the vendored Superpowers skills and reviewer agent into the user-global Copilot surface.

### Catalog control plane at a glance

- **Canonical management surface:** `copilot-ui`
- **Catalog projection storage:** `~/.copilot/catalog/projections/global.json` plus
  `~/.copilot/catalog/projections/repo-<repoId>.json`
- **Repo inventory storage:** `~/.copilot/catalog/repo-inventory.json`
- **Search telemetry storage:** `~/.copilot/catalog/search-telemetry.json`
- **Audit log storage:** `~/.copilot/catalog/audit/events.jsonl`

Authoritative write paths remain file-backed:

- shared shipped assets → `engine-assets/agents/*`, `engine-assets/skills/*`,
  `engine-assets/manifest.json`
- user-global assets → `~/.copilot/agents`, `~/.copilot/skills`, `~/.copilot/skills-vault`
- repo-local assets → `<repo>/.github/agents`, `<repo>/.github/skills`
- repo overlays only → `~/.copilot/repo-state/<repoId>/registry.json`

`repo-state` is never the source of asset content; it stores enable/disable overlays and derived
signals only.

### Catalog bootstrap and verification

The catalog is an operational projection, not a separate source of truth. Bootstrap is therefore a
**refresh/rebuild from files**, not a one-time data migration.

```powershell
# 1) Start the local control plane
node copilot-ui/server.js

# 2) Rebuild the global projection from engine-assets + ~/.copilot
Invoke-RestMethod -Method Post `
  -Uri 'http://127.0.0.1:3210/api/catalog/refresh' `
  -ContentType 'application/json' `
  -Body '{}'

# 3) Register/select a repo when you want repo-local .github assets included
Invoke-RestMethod -Method Post `
  -Uri 'http://127.0.0.1:3210/api/catalog/repos/register' `
  -ContentType 'application/json' `
  -Body (@{ repoPath = 'C:\path\to\repo'; select = $true } | ConvertTo-Json)

# 4) Rebuild the selected repo projection
Invoke-RestMethod -Method Post `
  -Uri 'http://127.0.0.1:3210/api/catalog/repos/refresh' `
  -ContentType 'application/json' `
  -Body (@{ repoPath = 'C:\path\to\repo' } | ConvertTo-Json)
```

Verification surfaces:

- `GET /api/catalog/summary` → projection stats, freshness, read mode, input file metadata
- `GET /api/catalog/repos` → merged repo inventory and selected repo
- `GET /api/runtime/catalog-health` → projection + audit-file health
- `POST /api/search/query` → deterministic catalog-backed search with explanations
- `GET /api/audit/assets` / `GET /api/audit/events` → lifecycle, search, and usage analytics

If a persisted projection is missing, the backend falls back to a filesystem build
(`readMode: "filesystem-fallback"`). Refreshing persists the snapshot again.

### Desktop distribution policy (locked)

- Packaging runtime: Electron (`electron-builder`) with in-app updates (`electron-updater`)
- Release scope: Windows GA first; Linux/macOS preview until signing parity
- Signing custody: managed external signing service via OIDC (no private keys in repo)
- Rollback authority: Release Engineering owns channel rollback + kill switch decisions
- Desktop package bundle includes runtime assets required for standalone mode:
  - `engine-assets/**`
  - `copilot-ui/ui-dist/**`
  - `local-tracker` runtime (`dist` + runtime deps)
  - helper scripts required by dashboard/runtime operations
- Packaged desktop runtime attempts embedded Postgres bootstrap in packaged mode (Windows-first). If runtime binaries are unavailable, app continues in non-persistent mode and surfaces a warning.

Desktop version automation:
- `.github/workflows/desktop-version-tag.yml` watches `copilot-ui/package.json` on `main` and creates `desktop-v<version>` tags for Changesets version commits (`Version Packages`).
- `.github/workflows/desktop-release.yml` remains the authoritative release publisher and is triggered by `desktop-v*` tags.

Release-safety rules (G-06-WU-03):
- Migration checksum safety is explicit: `pass` only when persisted migration checksums match manifest checksums; checksum drift is release-blocking (`PLANNING_MIGRATION_CHECKSUM_DRIFT`).
- Rollback threshold `R1`: any single deterministic safety failure (`PLANNING_MIGRATION_CHECKSUM_DRIFT`, `current_version_below_minimum_safe`, `candidate_version_above_channel_ceiling`) triggers immediate channel rollback actions.
- Rollback threshold `R2`: two consecutive fail-closed policy load cycles (`rollback_policy_source_unavailable` / `rollback_policy_malformed`) after remediation trigger escalation.
- Kill-switch ownership remains Release Engineering, with incident-commander approval for activation/deactivation and Security co-approval for trust-chain incidents.

### Workstream sequencing + ownership (locked)

- WS6 is a post-WS1 gate: execute WS6 compatibility/release-safety work only after the WS1 contract freeze (`G-01-WU-04`).
- WS2 owns the primary non-Docker default runtime behavior.
- WS6 non-Docker scope is compatibility/upgrade safety only (mixed-version compatibility, rollback, release safety), not primary default behavior changes.

### WS6 CI topology + required checks (locked)

- Authoritative workflow: `.github/workflows/extension-ci.yml`.
- Required topology is fixed and fail-closed: `build` → `ws6-evidence` (matrix `WS6-E1`..`WS6-E5`) → `ws6-artifact-gate` → `required-checks`.
- `required-checks` must fail when any required upstream job is non-`success`, skipped, or missing required artifact completeness output.
- `release` requires both `build` and `required-checks`; tag publish is blocked until both succeed.

### WS6 validation ladder + rollback contract (narrow → broad)

- Narrow: `node scripts/validate-manifest.js` and `node scripts/validate-doc-graph.js`.
- Mid: mixed-version + checksum invariants (`server.lifecycle-proxy.test.js`, `gatewayHttpServer.test.ts`, `planningPersistence.test.js`, `server.runtime-health.test.js`).
- Broad: rollback threshold + kill-switch assertions (`rollbackPolicy.test.js`, `updatePolicy.rollback.test.js`, `updater.rollback.test.js`).
- Any failure in this ladder is release-blocking and requires regenerated WS6 evidence artifacts.

### One-time VS Code setup (reducing permission prompts)

If VS Code/Copilot keeps prompting to “allow access” for `~/.copilot`, it’s usually one of two things:

- **Custom assets location** (agents/skills/prompts/instructions): VS Code reads these via `chat.*Locations` settings (e.g. `chat.agentSkillsLocations`).
- **Agent tool access** (reading/writing outside the workspace): approvals are stored in `~/.copilot/permissions-config.json`.


**Recommended one-time setup** (in the copilot-ui dashboard):

1. **Assets tab** → **Patch VS Code settings** button (calls `POST /api/vscode/patch-settings`)
   - Sets `chat.agentFilesLocations`, `chat.agentSkillsLocations`, `chat.promptFilesLocations`, `chat.instructionsFilesLocations`
   - Installs a conservative `chat.tools.terminal.autoApprove` set
2. **Assets tab** → **Authorize Copilot folders** button (calls `POST /api/copilot/authorize`)
  - Patches `~/.copilot/permissions-config.json` to pre-approve read/write/memory for `~/.copilot`, default folders, and dynamically discovered first-level subfolders
3. **Restart VS Code**

After this, permission prompts for `~/.copilot` should stop (or significantly reduce).

---

## Repo layout

```
instruction-engine/
├── engine-assets/
│   ├── agents/             agent .agent.md files (source of truth)
│   ├── skills/             skill folders with SKILL.md
│   ├── prompts/            *.prompt.md files
│   ├── copilot-instructions.md
├── .cli/
│   ├── manifest.allowlist.json  shipped agents/skills/prompts allowlist
│   └── manifest.json            generated install/shipping manifest
├── copilot-ui/             local dashboard (Node.js, not installed)
├── local-tracker/          session/task tracking daemon + Discord gateway
├── RannIA/                 VS Code extension (Instruction Engine host)
├── scripts/
│   ├── cli-install.ps1/.sh install scripts
│   └── cli-ui.ps1/.sh      dashboard launch scripts
├── docs/                   architecture docs and playbooks
└── .github/
    ├── copilot-instructions.md  (repo-level instructions for this repo)
    └── templates/
```

---

## Discord remote control

Run Copilot sessions from Discord via the Messaging Gateway in `local-tracker/`.

**Quick setup:**
1. Create a Discord bot and gather guild/channel/user IDs
2. Configure `~/.copilot/messaging-gateway.config.json` (use `local-tracker/docs/messaging-gateway.config.example.json` as template)
3. Store bot token: `npm --prefix local-tracker run dev:gateway -- --store-discord-bot-token`
4. Start Copilot CLI in ACP mode: `copilot --acp --port 3000`
5. Start gateway: `cd local-tracker && npm run start:gateway -- --mode connected`

Key Discord commands: `/task`, `/plan`, `/sessions`, `/stop`, `/status`

See `local-tracker/docs/messaging-gateway.md` for full reference.

---

## Contributing

1. Edit agents in `engine-assets/agents/` (flat `.agent.md` files)
2. Edit skills in `engine-assets/skills/<name>/SKILL.md`
3. Canonical asset metadata lives in `engine-assets/manifest.json`. If adding new assets to ship by default, also update `.cli/manifest.allowlist.json` and re-generate `.cli/manifest.json` via `node scripts/generate-cli-manifest.mjs`
4. Keep `engine-assets/copilot-instructions.md` concise — it loads into every Copilot session
5. Document behaviour changes in `docs/`

---

## Documentation

- [Domain Authorities Freeze](docs/system/domain-authorities-freeze.md)
- [Catalog Control Plane](docs/system/catalog-control-plane.md)
- [Copilot CLI Playbook](docs/system/copilot-cli-playbook.md)
- [Agents vs Skills](docs/system/agents-vs-skills.md)
- [Agent Architecture Simplicity](docs/system/agent-architecture-simplicity.md)
- [Agent Hooks](docs/system/agent-hooks.md)
- [Skills Governance](docs/system/skills-governance.md)
- [MCP Workflow](docs/system/mcp-workflow.md)
- [Security Model](docs/system/security-model.md)
- [Session-State Artifacts](docs/system/session-state-artifacts.md)
- [Instruction Changelog](docs/system/instruction-changelog.md)
