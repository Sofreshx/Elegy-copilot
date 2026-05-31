# Elegy Copilot

Shared GitHub Copilot assets plus home-installed Codex and Antigravity session lanes for multi-repo development. Copilot, Codex, and Antigravity are intentionally supported through different asset models: Copilot gets repo-shipped assets and dashboard support, while Codex and Antigravity get lighter native home installs built around each surface's supported global locations.

## Install or refresh

Run the installer for the tool you use; re-running the same command refreshes the shared baseline.

| Tool | Windows (PowerShell) | macOS / Linux |
|------|-----------------------|---------------|
| Copilot install/refresh | `pwsh -File scripts/cli-install.ps1 --all` | `bash scripts/cli-install.sh --all` |
| Codex install/refresh | `pwsh -File scripts/codex-install.ps1` | `bash scripts/codex-install.sh` |
| Antigravity install/refresh | `pwsh -File scripts/antigravity-install.ps1` | `bash scripts/antigravity-install.sh` |
| Refresh everything | `pwsh -File scripts/install-all.ps1` | `bash scripts/install-all.sh` |

- Use the Copilot installer to refresh shared agents, skills, prompts, and instructions in `~/.copilot`.
- Use the Codex installer to refresh the shared Codex baseline in `~/.codex`, including native skills under `~/.codex/skills/`.
- Use the Antigravity installer to refresh shared skills in `~/.gemini/antigravity/skills/` and the managed Instruction Engine block in `~/.gemini/GEMINI.md`.
- Add `--force` to overwrite managed targets that diverged, or `--dry-run` to preview changes without writing.
- Use `/init` only for occasional repo-local guidance work such as creating or refining `guidelines.md` or `AGENTS.md`; it is not the normal shared-asset refresh path.

## Canonical docs breadcrumb

Use canonical docs for repo policy and workflow authority:

1. Start at `docs/system/index.md`.
2. Open the closest MOC.
3. Follow it to the smallest canonical node for the task.
4. Use `guidelines.md` and this README as lighter overlays after that bootstrap.

Useful starting points:

- Repo rules and precedence: `docs/system/project-conventions-governance.md`
- Clarity and rationale placement: `docs/system/self-documenting-code-and-rationale-placement.md`
- Documentation structure and entrypoints: `docs/system/documentation-structure-governance.md`
- Search/execute routing: `docs/system/search-execute-workflow.md`

## How it works

Assets are installed from `engine-assets/` into `~/.copilot`. The default source install copies the shipped first-party agents, prompts, instructions, and skills there. Optional workflow packs and repo-local `.github/*` assets are separate post-install layers. Both **VS Code Copilot Chat** and the **Copilot CLI** discover user-global assets from that location — no per-repo setup needed for the default baseline.

```
engine-assets/  →  ~/.copilot/
  agents/           agents/
  skills/           skills/ + skills-vault/
  prompts/          prompts/
  copilot-instructions.md   copilot-instructions.md
```

Codex uses a separate home-installed lane from `codex-assets/` plus shared engine content:

```
codex-assets/   →  ~/.codex/
  home/AGENTS.md    ~/.codex/AGENTS.md
  agents/           ~/.codex/agents/
  skills/           ~/.codex/skills/
engine-assets/  →  ~/.codex/
  agents/*.agent.md  ~/.codex/agents/*.toml (generated Codex roles)
  skills/            ~/.codex/skills/
```

Antigravity uses `antigravity-assets/` plus shared engine skills:

```
antigravity-assets/  →  ~/.gemini/
  home/GEMINI.md        ~/.gemini/GEMINI.md (managed block only)
engine-assets/       →  ~/.gemini/antigravity/
  skills/               ~/.gemini/antigravity/skills/
```

## Quick start

Use the commands in [Install or refresh](#install-or-refresh), then use the notes below for what each installer changes.

### Copilot install details

This installs the shipped first-party agents, prompts, and global instructions file into `~/.copilot`, and installs shipped skills into `~/.copilot/skills/` and/or `~/.copilot/skills-vault/` based on pointer mode. The installer also prunes stale previously managed shipped agents, prompts, and skills that are no longer part of `engine-assets/`, while leaving repo-local workflow packs and other user-managed `.github/agents` / `.github/skills` content alone.

### Codex install details

This installs `~/.codex/AGENTS.md`, curated Codex TOML agents, generated Codex role wrappers from shared `engine-assets/agents/*.agent.md`, and shared skills into `~/.codex/skills/`, then patches `~/.codex/config.toml` conservatively. The patcher only adds `review_model` when it is absent and only adds the managed planning profile when that profile name is unused.

### Antigravity install details

This installs shared skills into `~/.gemini/antigravity/skills/` and updates only the bounded Instruction Engine block inside `~/.gemini/GEMINI.md`, preserving user content outside that block.

### Codex quick use

- Native Codex commands stay primary: `/plan`, `/review`, `/init`, `/resume`, `/fork`
- For routine shared-asset setup or refresh, re-run `scripts/codex-install.ps1`, `bash scripts/codex-install.sh`, or use `scripts/install-all.*` when you want every supported surface updated together
- This repo adds one curated reviewer agent plus generated role wrappers from shared engine agents
- This repo adds the curated `repo-setup` Codex skill plus shared engine skills under `~/.codex/skills/`
- Use `/init` only when you actually want Codex to create or refine repo-local guidance such as `guidelines.md` or `AGENTS.md`; it is more expensive and is not the normal path for refreshing shared assets
- There is no custom `/setup-repo` slash command; use the `repo-setup` skill, and pair it with native `/init` only for that occasional repo-local guidance work

Optional workflow packs, including the vendored `Superpowers Workflow Pack`, can then be installed explicitly from the local dashboard in `Catalog` -> `Workflow packs`. Repo-specific governance lanes only appear when you register/select a repo that provides repo-local `.github/*` assets or repo-scoped overrides.

### Enable subagent delegation in VS Code

```json
{
  "chat.customAgentInSubagent.enabled": true
}
```

### Verify

- VS Code Chat → right-click → **Diagnostics** (shows loaded agents/skills/prompts)
- Copilot CLI: run `/agents`, `/skills`

## Windows Desktop Download

Windows desktop installers are published on the GitHub Releases page: [Sofreshx/Elegy-copilot releases](https://github.com/Sofreshx/Elegy-copilot/releases).

- Stable users should choose the latest non-prerelease `desktop-v*` release.
- Semver tags such as `1.2.3` and `1.2.3-rc.1` are preview/evaluation releases and stay marked as prerelease on GitHub.
- The current Windows Tauri lane is a manual-installer path. The app may perform automatic matching-channel checks, but installer download and apply remain explicit user actions.
- Do not treat `/releases/latest` as the stable shortcut yet; historic semver releases must be remediated so none remain non-prerelease first.

### Open-source contributor quickstart

```powershell
npm ci
npm run build:contracts
npm run test:all
```

More contributor and community guidance:

- [License](LICENSE)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Support](SUPPORT.md)
- [Code of conduct](CODE_OF_CONDUCT.md)
- [Releasing](RELEASING.md)

---

## Asset inventory

| Type | Count | Location |
|------|-------|----------|
| Agents | 6 | `engine-assets/agents/*.agent.md` |
| Skills | 11 | `engine-assets/skills/<name>/SKILL.md` |
| Prompts | 1 | `engine-assets/prompts/*.prompt.md` |
| Instructions | 1 | `engine-assets/copilot-instructions.md` |
| Canonical asset manifest | — | `engine-assets/manifest.json` |
| Generated shipping manifest | — | `.cli/manifest.json` |

Codex baseline:

| Type | Count | Location |
|------|-------|----------|
| Global instructions | 1 | `codex-assets/home/AGENTS.md` |
| Custom agents | 1 | `codex-assets/agents/*.toml` |
| Skills | 1 native + shared manifest entries | `codex-assets/skills/<name>/SKILL.md` plus shared `catalog-assets/shared-skills/**` sources |
| Canonical asset manifest | — | `codex-assets/manifest.json` |

---

## Key agents

| Agent | Purpose |
|-------|---------|
| `@search` | Read-only codebase exploration and research |
| `@execute` | Leaf implementation agent for code changes |
| `@impl` | Unified implementation lane for app/domain or infra work units (`kind: business | infra`) |
| `@code-explorer` | Fast read-only codebase analysis and Q&A (flash model optimized) |
| `@code-reviewer` | Spec-fit, correctness, regression, and convention review |
| `@test-runner` | Consolidated unit, integration, and browser/E2E validation lane |

---

## State location

Primary runtime state lives under `~/.copilot`:

```
~/.copilot/
  agents/               installed agent files
  skills/               always-available installed skill folders
  skills-vault/         installed skill vault for on-demand skills
  prompts/              installed prompt files
  copilot-instructions.md
  session-state/        Copilot session logs and plans
    <SESSION_ID>/
      plan.md           persisted plan artifact + progress tracker
      proposition.md    append-only guidance (after planning + execution)
      plans/            plan revisions
  sessions-archive/     archived sessions
  repo-state/           per-repo task/artefact state
    <repoId>/
      tasks/            durable repo-state task store
      tasks.archive/    archived repo-state tasks
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
installation. The default/recommended runtime is the packaged desktop app: it starts the local runtime
for you, points the window at that local backend, and keeps the SDK/gateway wiring in one place.
`copilot-ui` can still run from the raw Node.js server when you are developing or debugging the backend.
`copilot-ui` is also the **catalog control plane** for the delivered asset system: it owns the
authoritative local catalog/search/audit APIs, repo inventory, projection refresh, and mutation
flows for shared, user-global, and repo-local assets.

```bash
# Desktop app development (Tauri-first Windows path)
npm --prefix copilot-ui run desktop:dev

# Raw server backend/API fallback
node copilot-ui/server.js

# Raw server via helper scripts
scripts/cli-ui.ps1          # Windows
./scripts/cli-ui.sh         # macOS/Linux
```

Packaged desktop behavior:

- uses `~/.copilot` as the runtime home for session state, installed assets, repo-state, and gateway config
- default-enables the Copilot SDK bridge unless `INSTRUCTION_ENGINE_DISABLE_SDK_BRIDGE=1`
- starts the messaging gateway dependency automatically, rehomes legacy gateway config into `~/.copilot`, and keeps the desktop-only disconnected bootstrap config env-scoped instead of writing a non-canonical platformless file
- starts the same local backend on `127.0.0.1`
- provisions an embedded planning database in packaged mode, stored under `~/.copilot/planning-db`, so planning persistence is available by default without a separate local database install
- keeps orchestration local-only and is the intended surface for the visible task board backed by `~/.copilot/repo-state/<repoId>/tasks/`
- manages Copilot CLI ensure/install/update for the active channel; stable desktop builds pair with stable SDK/CLI lanes, prerelease builds pair with prerelease SDK/CLI lanes
- current bounded MVP slice is fail-closed: the desktop app only approves a bundled CLI payload or a seeded managed install under `~/.copilot/managed-cli/<channel>/`; it no longer silently falls back to PATH or desktop `cliUrl` overrides
- bundles workflow-layer runtime assets for packaged parity checks, but keeps the workflow sidecar default-disabled unless explicitly enabled; packaged smoke now treats any default-on sidecar activation as drift

Use `scripts/cli-ui.ps1 --sdk` or `./scripts/cli-ui.sh --sdk` only when you intentionally want the raw
server path with the SDK bridge forced on.

Desktop UI delivery is now desktop-only for normal use. The Tauri shell bootstraps a per-startup
local UI session and is the supported dashboard runtime on the active Windows desktop path. A plain
browser request to the raw `node copilot-ui/server.js` server no longer receives the dashboard UI;
use that mode for `/api` routes and backend debugging only.

For the packaged Windows preview/manual-installer lane, run
`npm --prefix copilot-ui run desktop:preview:stage`. This stages the Tauri installer plus
`release-manifest.json` and Windows installation guidance under
`release-artifacts/windows-tauri/`.

The server binds to `127.0.0.1` only — do not expose to untrusted networks.
For the current tabs, route groups, persistence model, and validation anchors, see
`docs/system/copilot-ui-guide.md`.

The Catalog surface includes a `Workflow packs` panel for optional bundles that install multiple assets together. The first shipped bundle is `Superpowers Workflow Pack`, which installs the vendored Superpowers skills and reviewer agent into the user-global Copilot surface. Profiles and routing policy can mark bundles active, but optional bundle members are still copied only when you explicitly install that pack. Repo-specific governance lanes stay repo-scoped and are discovered from the selected repo's `.github/*` assets instead of being copied into the user-global baseline.

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

### Desktop packaging and release lane (locked)

- Desktop packaging is the primary end-user delivery surface for Elegy Copilot.
- Primary packaging runtime: Windows-first Tauri shell (`@tauri-apps/cli`) with a bundled Node sidecar; the current Tauri release lane is manual-installer metadata, not in-app updater parity
- Release scope when packaging is used: Windows primary under Tauri
- Signing custody: managed external signing service via OIDC (no private keys in repo)
- Rollback authority: Release Engineering owns channel rollback + kill switch decisions
- Desktop package bundle includes runtime assets required for standalone mode:
  - `engine-assets/**`
  - generated `copilot-ui/ui-dist/**` assets from `npm --prefix copilot-ui run ui:build`
  - generated `copilot-ui/src-tauri/gen/resources/**` assets from `npm --prefix copilot-ui run desktop:preview`
  - `local-tracker` runtime (`dist` + runtime deps)
  - managed Copilot CLI channel contract metadata (`copilot-ui/resources/copilot-cli/**`)
  - bounded workflow-layer runtime assets, with the sidecar kept default-disabled unless explicitly enabled
  - helper scripts required by dashboard/runtime operations
- Generated build outputs such as `copilot-ui/ui-dist/**` and `copilot-ui/src-tauri/gen/resources/**` are primary desktop package inputs. None of them should be source-controlled artifacts.
- Packaged desktop runtime now boots with an embedded planning database by default. The local runtime, SDK bridge, tracker, and planning persistence all come up together under `~/.copilot`.

Desktop release tag helper flow, when the optional packaging lane is exercised:
- `.github/workflows/desktop-version-tag.yml` is a maintainer-only manual helper that can target a specific ref to create `desktop-v<version>` tags when an explicit desktop release flow should advance.
- `.github/workflows/desktop-preview-release.yml` publishes unsigned prerelease artifacts to GitHub Releases for public/open-source evaluation, but only when the pushed preview tag matches `copilot-ui/package.json`'s version.
- `.github/workflows/desktop-release.yml` now auto-runs on pushed `desktop-v*` tags and creates or updates the matching published signed desktop release; manual dispatch remains for backfills and draft overrides.

Release-safety rules (G-06-WU-03) for packaged desktop releases:
- Migration checksum safety is explicit: `pass` only when persisted migration checksums match manifest checksums; checksum drift is release-blocking (`PLANNING_MIGRATION_CHECKSUM_DRIFT`).
- Rollback threshold `R1`: any single deterministic safety failure (`PLANNING_MIGRATION_CHECKSUM_DRIFT`, `current_version_below_minimum_safe`, `candidate_version_above_channel_ceiling`) triggers immediate channel rollback actions.
- Rollback threshold `R2`: two consecutive fail-closed policy load cycles (`rollback_policy_source_unavailable` / `rollback_policy_malformed`) after remediation trigger escalation.
- Kill-switch ownership remains Release Engineering, with incident-commander approval for activation/deactivation and Security co-approval for trust-chain incidents.

### Workstream sequencing + ownership (locked)

- WS6 is a post-WS1 gate: execute WS6 compatibility/release-safety work only after the WS1 contract freeze (`G-01-WU-04`).
- WS2 owns the primary non-Docker default runtime behavior.
- WS6 non-Docker scope is compatibility/upgrade safety for the optional desktop packaging lane only
  (mixed-version compatibility, rollback, release safety), not primary default behavior changes.

### WS6 CI topology + required checks (locked)

- Authoritative workflow file: `.github/workflows/repo-ci.yml`.
- Required topology is fixed and fail-closed: `build` → `desktop-tauri-preview` → `required-checks`.
- `required-checks` must fail when any required upstream job is non-`success`, skipped, or missing required artifact completeness output.
- Desktop packaging and release stay isolated in `.github/workflows/desktop-preview-release.yml`, `.github/workflows/desktop-release.yml`, and `.github/workflows/desktop-version-tag.yml`.

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
├── codex-assets/
│   ├── home/               Codex global AGENTS.md source
│   ├── agents/             Codex custom agent TOML files
│   ├── skills/             Codex skill folders with SKILL.md
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
├── scripts/
│   ├── cli-install.ps1/.sh install scripts
│   ├── codex-install.ps1/.sh Codex install scripts
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

Start with [CONTRIBUTING.md](CONTRIBUTING.md) for local setup, validation commands, and PR expectations.

Quick reminders:

1. Edit Copilot assets in `engine-assets/` and Codex assets in `codex-assets/`.
2. Canonical Copilot metadata lives in `engine-assets/manifest.json`; Codex metadata lives in `codex-assets/manifest.json`.
3. If shipped Copilot assets change, update `.cli/manifest.allowlist.json` and re-generate `.cli/manifest.json` via `node scripts/generate-cli-manifest.mjs`.
4. Keep `engine-assets/copilot-instructions.md` concise because it loads into every Copilot session, and keep `codex-assets/home/AGENTS.md` workflow-specific because it loads across repos.
5. Document behavior and workflow changes in `docs/` and the relevant root community docs.

---

## Documentation

- [System Docs Index (canonical start here)](docs/system/index.md)
- [Conventions & Governance entrypoint](docs/system/mocs/conventions-and-governance.md)
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
