# Instruction Engine

Shared GitHub Copilot agents, skills, and workflow conventions for multi-repo development. Provides structured orchestration so planning, implementation, testing, and reviews stay consistent across all your projects.

## How it works

All assets (agents, skills, prompts, instructions) are installed from `engine-assets/` into `~/.copilot`. Both **VS Code Copilot Chat** and the **Copilot CLI** discover assets from that single location — no per-repo setup needed.

```
engine-assets/  →  ~/.copilot/
  agents/           agents/
  skills/           skills/
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
./scripts/cli-install.sh --all --force
```

This copies all agents, skills, prompts, and the global instructions file into `~/.copilot`.

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
| Agents | 32 | `engine-assets/agents/*.agent.md` |
| Skills | 40 | `engine-assets/skills/<name>/SKILL.md` |
| Prompts | 3 | `engine-assets/prompts/*.prompt.md` |
| Instructions | 1 | `engine-assets/copilot-instructions.md` |
| Manifest (install/shipping) | — | `.cli/manifest.json` |

---

## Key agents

| Agent | Purpose |
|-------|---------|
| `@orchestrator` | Main entry point — routes tasks by complexity, delegates to specialised agents |
| `@code-explorer` | Read-only codebase analysis and Q&A |
| `@code-architect` | Designs feature architectures from existing patterns |
| `@impl-business` | Implements app/domain work units (endpoints, services, UI) |
| `@impl-infra` | Implements infra work units (CI, Docker, config, deployments) |
| `@elegy-planner` | Hierarchical planning — calls `@elegy-direction` (high-level) + `@elegy-subplanner` (parallel work units) |
| `@code-reviewer` | Bug, logic, and security review |
| `@unit-test-runner` | Runs unit tests safely with timeouts |
| `@security-scanner` | Scans for OWASP/endpoint vulnerabilities |
| `@agent-governor` | Creates/audits agent `.agent.md` files |

---

## State location

Everything lives under `~/.copilot`:

```
~/.copilot/
  agents/               installed agent files
  skills/               installed skill folders
  prompts/              installed prompt files
  copilot-instructions.md
  session-state/        Copilot session logs and plans
    <SESSION_ID>/
      plan.md           Elegy plan + progress tracker
      proposition.md    append-only guidance (after planning + execution)
      plans/            plan revisions
  sessions-archive/     archived sessions
  repo-state/           per-repo task/artefact state
```

Override the default location with `skillInstaller.state.root` in VS Code settings, or pass `--copilot-home` to the dashboard server.

**Elegy plans** are persisted to `~/.copilot/session-state/<SESSION_ID>/plan.md` (not the legacy `.instructions/sessions` folder). The dashboard reads this location automatically.

---

## Dashboard (local UI)

A local Node.js dashboard to view sessions, sync assets, and manage your `~/.copilot` installation.

```bash
# Direct
node copilot-ui/server.js

# Via helper scripts
scripts/cli-ui.ps1          # Windows
./scripts/cli-ui.sh         # macOS/Linux
```

Open: http://127.0.0.1:3210

The server binds to `127.0.0.1` only — do not expose to untrusted networks.

### One-time VS Code setup (reducing permission prompts)

If VS Code/Copilot keeps prompting to “allow access” for `~/.copilot`, it’s usually one of two things:

- **Custom assets location** (agents/skills/prompts/instructions): VS Code reads these via `chat.*Locations` settings (e.g. `chat.agentSkillsLocations`).
- **Agent tool access** (reading/writing outside the workspace): approvals are stored in `~/.copilot/permissions-config.json`.


**Recommended one-time setup** (in the copilot-ui dashboard):

1. **Assets tab** → **Patch VS Code settings** button (calls `POST /api/vscode/patch-settings`)
   - Sets `chat.agentFilesLocations`, `chat.agentSkillsLocations`, `chat.promptFilesLocations`, `chat.instructionsFilesLocations`
   - Installs a conservative `chat.tools.terminal.autoApprove` set
2. **Assets tab** → **Authorize Copilot folders** button (calls `POST /api/copilot/authorize`)
   - Patches `~/.copilot/permissions-config.json` to pre-approve read/write/memory for `~/.copilot` and common subfolders
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
3. If adding new assets to ship by default, update `.cli/manifest.allowlist.json` and re-generate `.cli/manifest.json` via `node scripts/generate-cli-manifest.mjs`
4. Keep `engine-assets/copilot-instructions.md` concise — it loads into every Copilot session
5. Document behaviour changes in `docs/`

---

## Documentation

- [Copilot CLI Playbook](docs/system/copilot-cli-playbook.md)
- [Agents vs Skills](docs/system/agents-vs-skills.md)
- [Agent Architecture Simplicity](docs/system/agent-architecture-simplicity.md)
- [Agent Hooks](docs/system/agent-hooks.md)
- [Skills Governance](docs/system/skills-governance.md)
- [MCP Workflow](docs/system/mcp-workflow.md)
- [Security Model](docs/system/security-model.md)
- [Elegy Model Audit](docs/research/elegy-model-audit.md)
- [Instruction Changelog](docs/system/instruction-changelog.md)
