# Project Memory

## E3 Database Access (2026-02-11)
- `vscode/runCommand` does NOT return values to agents — all `executive3.*` commands were broken.
- **Fix**: CLI bridge at `vscode-skill-installer/scripts/e3-cli.js`. Agents use `run_in_terminal` to invoke it.
- DB location: `.e3-local/executive3.db` in the first workspace folder (NOT VS Code's `context.storageUri`).
- Extension writes `.e3-local/db-path.txt` on startup for CLI discovery.
- Agent instructions (`executive3.agent.md`, `e3-task-creator.agent.md`) updated to use CLI.
- `vscode/runCommand` removed from Executive3's tool dependencies entirely.

## Relay System Status (2026-02-11)
- Auth working: GitHub OAuth → HS256 JWTs (1h access, 30d refresh). 42 auth tests passing. WS auth bugfix applied.
- SQLite persistence complete: 6 tables, migrations, WAL mode via better-sqlite3.
- REST APIs complete: sessions, tasks, push endpoints with full test coverage (183 tests / 11 suites).
- Mobile companion: REST client with auto-refresh, push notifications, tasks/git/sessions pages.
- Local tracker: scaffolded with file watchers, git monitor, extension bridge (port 9821), status dashboard (port 9822).
- E2E verification: `scripts/e2e-relay-flow.js`.
- Branch: `e3/relay-system-redesign` (pushed to origin).
- Full architecture: `.instructions/architecture.md`. Design research: `.instructions/research/e3-tooling-and-relay-redesign.md`.

## Testing Workflow
- For any feature or bug fix, add or update unit tests in the touched package before marking work complete.
- After code edits, run get_errors to catch compile or type issues before running tests.
- Use `unit-test-runner` at checkpoints; ask before running long integration or E2E tests.
- Default integration testing approach is **Alba** for in-process HTTP tests.
- If long tests are declined, record the skip in `.instructions/testing/skipped-validation.md`.

## E2E (Playwright)
- E2E runs use Playwright against the web UI (mobile companion) unless explicitly scoped elsewhere.
- Default base URL: http://localhost:5173. Override with `skillInstaller.e2e.url` or script args.
- Outputs go under `.instructions-output/e2e/` (reports, screenshots, logs).

## Test Task Backlog
- Add new test tasks under `.instructions/test-tasks/` with owner and relevant skills.

## RannIA Extension Refresh — Compatibility Contract (WU-001)

### Locked defaults (do-not-break)
- **Marketplace identity stays the same:** keep VS Code Marketplace `publisher=sofreshx` and `name=skill-installer` unchanged. Rebrand only via display strings (e.g., `displayName`, `description`, view/container titles, docs, and other user-facing labels).
- **Contributed IDs stay stable:** keep command IDs, view IDs, menu wiring, and settings keys stable under the existing `skillInstaller.*` namespace unless explicitly listed under “Approved breaking removals”.
- **Workspace storage paths stay stable:** keep the following paths stable and treated as compatibility surface:
	- `.e3-local/`
	- `.instructions/`
	- `.instructions-output/`

### Approved breaking removals (explicitly allowed)
The following removals are approved even though they may break legacy relay/mobile workflows:
- Remove the **relay/mobile stack** from the repo and extension:
	- Delete repo folders `cloud-relay/` and `mobile-companion/` (and their CI/docs/scripts references) in later work units.
	- Remove relay/mobile/OAuth runtime code paths and their related `skillInstaller.relay.*` settings/commands/views as part of the planned cleanup work units.

### Folder rename decision (gated)
- **Default: KEEP** the folder name `vscode-skill-installer/` for now.
- Any folder rename (e.g., to `rannia-extension/`) is **deferred** and must be handled in a separate future plan pack/work unit, because it ripples through scripts, tasks, and docs.

### Checklist for later WUs
- Marketplace gate: verify `publisher` + `name` in `vscode-skill-installer/package.json` are unchanged.
- Compatibility gate: diff `vscode-skill-installer/package.json` and confirm contributed IDs still use `skillInstaller.*` and unchanged view/command IDs (except items explicitly approved for removal).
- Storage gate: verify `.e3-local/`, `.instructions/`, `.instructions-output/` paths are not renamed or relocated.
- Removal sweep gate (when removals start): `grep` for `cloud-relay`, `mobile-companion`, `skillInstaller.relay.` and ensure only intentional references remain.

### WU-002 — Contributed Surface Inventory (Mapping Table)

Status tags used below:
- **KEEP** — keep identifier/key/path stable
- **CHANGE-LABEL-ONLY** — keep ID/key/path stable; update user-facing label/description only
- **REMOVE (relay/mobile)** — approved breaking removal (relay/mobile/OAuth stack)

#### Marketplace identity (VS Code Marketplace)

| Field | Current | Tag | Notes |
|---|---|---|---|
| `publisher` | `sofreshx` | KEEP | Keep for upgrade continuity (extension id stays `sofreshx.skill-installer`). |
| `name` | `skill-installer` | KEEP | Keep for upgrade continuity. |
| `displayName` | `Instruction Engine` | CHANGE-LABEL-ONLY | Rebrand UX to **RannIA** (no identity break). |
| `description` | Mentions remote mobile companion + AI session control | CHANGE-LABEL-ONLY | Update wording to remove relay/mobile references. |

#### Activity Bar containers (`contributes.viewsContainers.activitybar`)

| Container ID | Current title | Tag | Notes |
|---|---|---|---|
| `skillInstaller` | `Skills` | CHANGE-LABEL-ONLY | Keep ID stable; title/icon can rebrand to RannIA. |
| `skillInstallerOps` | `Operations` | KEEP | Planned single-tab consolidation later (WU-009) moves views out; container ID itself is not part of relay/mobile removal. |

#### Views (`contributes.views`)

| View ID | Current name | Tag | Notes |
|---|---|---|---|
| `skillInstaller.skillsView` | `Skill Discovery` | CHANGE-LABEL-ONLY | Keep view ID; rebrand the label. |
| `skillInstaller.agentsView` | `Agents` | CHANGE-LABEL-ONLY | Keep view ID; rebrand the label if needed. |
| `skillInstaller.workflowView` | `Task Workflow` | CHANGE-LABEL-ONLY | Keep view ID; rebrand the label if needed. |
| `skillInstaller.auditView` | `Audit Results` | CHANGE-LABEL-ONLY | Keep view ID; rebrand the label if needed. |
| `skillInstaller.connectionsView` | `Connections` | CHANGE-LABEL-ONLY | Keep view ID; will likely surface Discord gateway + loopback WS status. |
| `skillInstaller.requestsView` | `Requests` | CHANGE-LABEL-ONLY | Keep view ID. |
| `skillInstaller.permissionsView` | `Permissions` | CHANGE-LABEL-ONLY | Keep view ID. |
| `skillInstaller.mcpView` | `MCP Providers` | CHANGE-LABEL-ONLY | Keep view ID. |

#### Commands (`contributes.commands[*].command`)

| Group | Command ID | Tag | Notes |
|---|---|---|---|
| Core | `skillInstaller.refresh` | KEEP | Refresh all tree views/providers. |
| Core | `skillInstaller.initializeSkills` | KEEP | Copies skills into `.github/skills/` and updates enablement registry. |
| Core | `skillInstaller.enableSkill` | KEEP | Enables skill (writes registry + workspace settings). |
| Core | `skillInstaller.disableSkill` | KEEP | Disables skill (writes registry + workspace settings). |
| Core | `skillInstaller.enableAgent` | KEEP | Enables agent (writes registry + workspace settings). |
| Core | `skillInstaller.disableAgent` | KEEP | Disables agent (writes registry + workspace settings). |
| Core | `skillInstaller.enableMcpProvider` | KEEP | Enables MCP provider + syncs `.vscode/mcp.json`. |
| Core | `skillInstaller.disableMcpProvider` | KEEP | Disables MCP provider + syncs `.vscode/mcp.json`. |
| Core | `skillInstaller.syncMcpConfig` | KEEP | Writes `.vscode/mcp.json` (default path). |
| Core | `skillInstaller.openMcpSettings` | KEEP | Opens settings UI for `skillInstaller.mcp.*`. |
| Core | `skillInstaller.runAudit` | KEEP | Launches audit guidance (does not itself generate reports). |
| Core | `skillInstaller.refreshAudit` | KEEP | Refreshes audit view. |
| Core | `skillInstaller.runE2E` | KEEP | Opens configured E2E dashboard URL. |
| Core | `skillInstaller.clearRepoContext` | KEEP | Deletes local outputs/artefacts (not tasks) under `.instructions*` and `.instructions-output/`. |
| Core | `skillInstaller.clearAllRepoContexts` | KEEP | Same as above for all workspace roots. |
| Core | `skillInstaller.archiveDoneTasks` | KEEP | Moves `done` tasks from `.instructions/tasks/` → `.instructions/tasks.archive/`. |
| Core | `skillInstaller.purgeArchivedTasks` | KEEP | Deletes files under `.instructions/tasks.archive/`. |
| Core | `skillInstaller.login` | REMOVE (relay/mobile) | GitHub OAuth (currently used for relay/mobile auth bridge). |
| Core | `skillInstaller.logout` | REMOVE (relay/mobile) | GitHub OAuth (currently used for relay/mobile auth bridge). |
| Relay/Mobile | `skillInstaller.relayStatus` | REMOVE (relay/mobile) | Cloud relay status command. |
| Relay/Mobile | `skillInstaller.relay.testAuth` | REMOVE (relay/mobile) | Cloud relay auth test command. |
| Relay/Mobile | `skillInstaller.showClientList` | REMOVE (relay/mobile) | “Mobile companion clients” UI. |
| WS / Gateway | `skillInstaller.ws.showPort` | KEEP | Copies loopback WS URL (`ws://127.0.0.1:<port>`). |
| WS / Gateway | `skillInstaller.ws.pairGateway` | KEEP | Copies WS URL + JWT pairing token. |
| WS / Gateway | `skillInstaller.gateway.setup` | KEEP | Writes gateway config under user home and offers secret storage via local-tracker. |
| WS / Gateway | `skillInstaller.gateway.storeDiscordBotToken` | KEEP | Stores Discord bot token via local-tracker helper (OS credential store). |
| WS / Gateway | `skillInstaller.gateway.storeExtensionWsJwt` | KEEP | Stores extension WS JWT via local-tracker helper (OS credential store). |
| WS / Gateway | `skillInstaller.gateway.editDiscord` | KEEP | Edits gateway config file (Discord scope). |
| WS / Gateway | `skillInstaller.gateway.manageWorkspaces` | KEEP | Edits gateway config file (allowed roots). |
| WS / Gateway | `skillInstaller.gateway.syncWorkspaces` | KEEP | Syncs gateway config allowed roots to current VS Code workspace roots. |
| WS / Gateway | `skillInstaller.gateway.viewConfig` | KEEP | Reads and shows config summary. |
| WS / Gateway | `skillInstaller.gateway.openConfig` | KEEP | Opens the gateway config JSON in the editor. |
| E3 | `skillInstaller.openE3WebUI` | KEEP | Writes an HTML report under the E3 storage dir and opens it in the browser. |
| E3 | `executive3.ensureDb` | KEEP | E3 DB bootstrap + discovery; returns JSON string (used by CLI bridge). |
| E3 | `executive3.getTasks` | KEEP | E3 query. |
| E3 | `executive3.createTask` | KEEP | E3 mutation. |
| E3 | `executive3.updateTask` | KEEP | E3 mutation. |
| E3 | `executive3.logExecution` | KEEP | E3 mutation. |
| E3 | `executive3.getSession` | KEEP | E3 query. |
| E3 | `executive3.getSessions` | KEEP | E3 query. |
| E3 | `executive3.createSession` | KEEP | E3 mutation. |
| E3 | `executive3.createTodo` | KEEP | E3 mutation. |
| E3 | `executive3.getTodos` | KEEP | E3 query. |
| E3 | `executive3.createTaskPlan` | KEEP | E3 mutation. |
| E3 | `executive3.getTaskPlans` | KEEP | E3 query. |
| E3 | `executive3.storeContext` | KEEP | E3 mutation. |
| E3 | `executive3.getContext` | KEEP | E3 query. |
| E3 | `executive3.getNextTask` | KEEP | E3 query. |
| E3 | `executive3.createPlan` | KEEP | E3 mutation. |
| E3 | `executive3.getTaskSummary` | KEEP | E3 query. |
| E3 | `executive3.getExecutionLog` | KEEP | E3 query. |
| E3 | `executive3.incrementTaskAttempt` | KEEP | E3 mutation. |
| E3 | `executive3.incrementReplanCount` | KEEP | E3 mutation. |
| E3 | `executive3.exportAll` | KEEP | E3 export (used by dashboard). |
| E3 | `executive3.reset` | KEEP | E3 destructive (clears DB data). |
| E3 | `executive3.getDbHealth` | KEEP | E3 health query. |
| E3 | `executive3.diagnostics` | KEEP | E3 diagnostics. |

#### Configuration keys (`contributes.configuration.properties`)

| Category | Key | Default | Tag | Notes |
|---|---|---:|---|---|
| registry | `skillInstaller.registry.fileName` | `.instructions/registry.json` | KEEP | Registry path used to persist enablement metadata. |
| skills | `skillInstaller.skills.disabledByRepo` | `{}` | KEEP | Written via `config.update` (workspace settings). |
| skills | `skillInstaller.skills.showDefaultHandled` | `false` | KEEP | Display-only behavior. |
| agents | `skillInstaller.agents.disabledByRepo` | `{}` | KEEP | Written via `config.update` (workspace settings). |
| mcp | `skillInstaller.mcp.providers.disabledByRepo` | `{}` | KEEP | Written via `config.update` (workspace settings). |
| mcp | `skillInstaller.mcp.configPath` | `.vscode/mcp.json` | KEEP | Extension writes MCP server config file per repo. |
| mcp | `skillInstaller.mcp.autoSync` | `true` | KEEP | Auto-write MCP config on settings change. |
| mcp | `skillInstaller.mcp.providers` | (object) | KEEP | Provider definitions; labels may be reworded only. |
| workflow | `skillInstaller.e2e.url` | `""` | KEEP | Used by `skillInstaller.runE2E`. |
| workflow | `skillInstaller.workflow.nextUpLimit` | `5` | KEEP | View behavior only. |
| workflow | `skillInstaller.tasks.onlyOwner` | `false` | KEEP | View behavior only. |
| workflow | `skillInstaller.tasks.owner` | `""` | KEEP | View behavior only. |
| workflow | `skillInstaller.audit.autoStack` | `true` | KEEP | View behavior only. |
| workflow | `skillInstaller.audit.e2eMode` | `headless` | KEEP | View behavior only. |
| ws | `skillInstaller.ws.enabled` | `false` | KEEP | Keep key; description should stop referencing mobile companion. |
| ws | `skillInstaller.ws.port` | `0` | KEEP | Keep key (loopback WS). |
| ws | `skillInstaller.ws.secret` | `""` | KEEP | Secret is stored in VS Code SecretStorage when auto-generated. |
| ws | `skillInstaller.ws.heartbeatInterval` | `30000` | KEEP | Keep key. |
| ws | `skillInstaller.ws.staleTimeout` | `120000` | KEEP | Keep key. |
| session | `skillInstaller.session.loggingEnabled` | `true` | KEEP | Writes logs under `.instructions-output/sessions/`. |
| session | `skillInstaller.session.maxLogSize` | `102400` | KEEP | Log truncation limit. |
| oauth | `skillInstaller.oauth.clientId` | `""` | REMOVE (relay/mobile) | GitHub OAuth settings; remove with relay/mobile stack. |
| oauth | `skillInstaller.oauth.clientSecret` | `""` | REMOVE (relay/mobile) | GitHub OAuth settings; remove with relay/mobile stack. |
| oauth | `skillInstaller.oauth.redirectUri` | `vscode://sofreshx.skill-installer/auth/callback` | REMOVE (relay/mobile) | Bound to publisher+name; remove if OAuth is removed. |
| relay | `skillInstaller.relay.enabled` | `false` | REMOVE (relay/mobile) | Cloud relay settings. |
| relay | `skillInstaller.relay.url` | `wss://relay.sfrsh.xyz/v1/ws` | REMOVE (relay/mobile) | Cloud relay settings. |
| relay | `skillInstaller.relay.httpUrl` | `https://relay.sfrsh.xyz` | REMOVE (relay/mobile) | Cloud relay settings. |

#### Known on-disk paths written by the extension (or VS Code on its behalf)

| Surface | Path | Tag | Notes |
|---|---|---|---|
| E3 database | `<workspace>/.e3-local/executive3.db` | KEEP | DB file name is a compatibility surface for tooling. |
| E3 discovery | `<workspace>/.e3-local/db-path.txt` | KEEP | Written on activation for each workspace folder. |
| WS discovery | `<workspace>/.e3-local/ws-port.txt` | KEEP | Written when WS server starts; contains only port number. |
| E3 web dashboard | `<workspace>/.e3-local/reports/e3-dashboard.html` | KEEP | Written by `skillInstaller.openE3WebUI`. |
| Session logs | `<workspace>/.instructions-output/sessions/<sessionId>.json` | KEEP | Written by `SessionManager` when enabled. |
| Skill enablement registry | `<repo>/.instructions/registry.json` | KEEP | Written by enablement store (default path; configurable). |
| MCP config | `<repo>/.vscode/mcp.json` | KEEP | Written by MCP sync (default path; configurable). |
| Skills initialization target | `<repo>/.github/skills/**` | KEEP | Written by `skillInstaller.initializeSkills` (copies skills in). |
| Task archiving | `<repo>/.instructions/tasks.archive/**.md` | KEEP | Written by `skillInstaller.archiveDoneTasks`. |
| Gateway config | `~/.instruction-engine/messaging-gateway.config.json` | KEEP | Written/edited by gateway setup commands. |
| Context cleaner targets | `<repo>/.instructions-output/**`, `<repo>/.instructions/artefacts/**`, `<repo>/.instructions/tmp/**` | KEEP | Deleted by `skillInstaller.clearRepoContext*` (paths themselves remain part of expected layout). |

#### Other contributed surfaces (not required, but relevant)

| Surface | ID | Tag | Notes |
|---|---|---|---|
| Chat participant | `instruction-engine.remote-control` | KEEP | Used for in-editor remote control slash commands (`/status`, `/invoke`, etc.). |

## WU-003 — Locked Migration & Removal Plan

### Locked: no identity renames
- We will **NOT** rename VS Code Marketplace identity fields in the extension manifest:
	- **NOT** renaming `publisher`
	- **NOT** renaming `name`

### Locked: no contributed-ID renames (no aliases required)
- We will **NOT** rename contributed IDs. This includes (but is not limited to):
	- Commands: all `skillInstaller.*` command IDs that remain in product scope
	- Views: all `skillInstaller.*View` view IDs
	- Settings: all configuration keys under `skillInstaller.*` that remain in product scope
	- Activation events: `onCommand:skillInstaller.*`, `onView:skillInstaller.*` (except those tied to removed relay/mobile contributions)

### Locked: removals (relay/mobile stack is fully removed)
- We **WILL** remove relay/mobile-related contributions entirely:
	- Relay commands (e.g., `skillInstaller.relayStatus`, `skillInstaller.relay.testAuth`)
	- Relay settings (`skillInstaller.relay.*`)
	- OAuth settings (`skillInstaller.oauth.*`) **if** OAuth is only used for relay/mobile
	- Any relay/mobile UI contributions that exist solely to support those features
- We **WILL** remove the relay/mobile projects from the repo:
	- `cloud-relay/`
	- `mobile-companion/`

### Locked: single Activity Bar container (keep view IDs)
- We **WILL** consolidate to a single Activity Bar container by removing **only** the container ID `skillInstallerOps`.
- We will keep all existing view IDs the same; views formerly hosted under `skillInstallerOps` will be moved under the remaining container without ID changes.

## WU-008 — Single Activity Bar Tab Spec

### Container consolidation (keep IDs)
- Keep container ID: `skillInstaller`
- Remove container ID: `skillInstallerOps`

### Views after consolidation (view IDs unchanged; container assignment only)
- Container `skillInstaller`
	- `skillInstaller.skillsView`
	- `skillInstaller.agentsView`
	- `skillInstaller.workflowView`
	- `skillInstaller.auditView`
	- `skillInstaller.connectionsView`
	- `skillInstaller.requestsView`
	- `skillInstaller.permissionsView`
	- `skillInstaller.mcpView`

### Menus / wiring notes
- `contributes.menus` entries reference **view IDs** (e.g., `when: view == skillInstaller.mcpView`) and do **not** reference container IDs.
- `activationEvents` use `onView:<viewId>`; these view IDs remain unchanged.

### Locked: folder rename deferred; rebrand via display surface
- Folder rename to `RannIA/` (or similar) is **deferred**.
- Rebrand occurs via user-facing display surfaces (e.g., `displayName`, view/container titles, README(s), icon), while internal IDs remain stable.

### No-alias needed (justification)
- Because we are **not** renaming any kept IDs, there is no compatibility benefit to adding aliases for commands/views/settings.
- For items that are being removed (relay/mobile/OAuth), aliases would only preserve dead flows and increase maintenance; removals will be clearly documented instead.

### Deprecation documentation
- All breaking removals and “what changed” messaging will be documented in release notes and docs updates under **WU-017**.

## WU-011 — Dump Cleaner Safety Spec

### Purpose + scope
- Defines the safety contract and minimal configuration surface for the “Dump Cleaner” view.
- **Spec only** (implementation is WU-012).

### Allowed scan roots
- **Workspace folder roots only** (VS Code multi-root supported): scan starts at each `workspaceFolder.uri.fsPath`.
- Never scan outside those roots (no parent traversal, no home directory fallbacks, no repo-root discovery beyond VS Code’s workspace roots).

### Default patterns
- Default dump allowlist patterns (relative to each workspace root):
	- `tmpclaude-*` (covers common AI dump directories like `tmpclaude-*-cwd`)
	- `bash.exe.stackdump` (optional-but-safe single file at repo root)

### Pattern configuration surface (minimal)
- Single setting: `skillInstaller.dumpCleaner.patterns: string[]` (array of glob patterns).
- Defaults to the patterns above when unset/empty.
- Patterns are **allowlist only** (no “delete temp files” heuristics).

### Scan + safety semantics
- Resolve and evaluate patterns **per workspace root**; results are grouped by workspace root.
- Refuse any pattern containing `..` path segments; treat as invalid and ignore (do not attempt to normalize it into safety).
- Do **not** follow symlinks:
	- Use `lstat` to detect symlinks.
	- Skip symlink entries in scan results.
	- Refuse deletion if the selected path is a symlink.
- For every candidate path, enforce workspace containment:
	- Compute `relative = path.relative(root, candidateResolved)` and refuse if `relative` is empty, absolute, or starts with `..`.
	- Refuse any candidate that includes `..` traversal in its relative form.

### Deletion semantics
- Deletion is only allowed for candidates that pass the containment checks above.
- Always use OS trash: `useTrash: true`.
- Always require explicit per-item confirmation (modal) that includes the exact path and the workspace root.
- Never delete a workspace root itself.

### UI contract
- Single tree view grouped by workspace folder root:
	- Root node: workspace folder name/path.
	- Children: matching dump paths (file or directory).
- Commands:
	- `Refresh` (reload scan results)
	- `Delete item` (only on a selected dump path)

### Performance constraints
- Default scan is **shallow**: only match candidates at the workspace root level.
- Recursive scanning is **opt-in** via user-supplied patterns that imply recursion (e.g., contains `/` or `**`).
- If recursive scanning is enabled, prefer strict guardrails (depth/result caps and cancellation support) to avoid blocking the extension host.

## WU-013 — Messaging Gateway Status Schema (V1)

### Purpose
- Provide a stable, versioned, file-based read model for the VS Code extension to surface Messaging Gateway state (configured / connected / active sessions) without requiring direct process RPC.
- **Privacy-first:** the status file must never contain raw secrets (tokens/JWTs) or any message/prompt content.

### Status file location (default)
- Default path (user home, adjacent to gateway config directory):
	- `~/.instruction-engine/messaging-gateway.status.json`
- The gateway config default path is:
	- `~/.instruction-engine/messaging-gateway.config.json`

Notes:
- If a non-default config path is used (e.g., `INSTRUCTION_ENGINE_GATEWAY_CONFIG_PATH=/some/dir/messaging-gateway.config.json`), the status file should still be written **adjacent to that config file** when possible (same directory), using the same basename `messaging-gateway.status.json`.
- If config is provided via inline env JSON (`INSTRUCTION_ENGINE_GATEWAY_CONFIG_JSON`), there is no “adjacent” directory; in that case use the default home-based status file location.

### JSON schema: `MessagingGatewayStatusV1`

Schema name: `MessagingGatewayStatusV1`

Required top-level fields:
- `schemaVersion: 1`
- `lastUpdatedUtc`: ISO-8601 UTC timestamp string (e.g., `2026-02-17T20:30:15.123Z`)

Recommended shape (TypeScript-style contract):

```ts
export interface MessagingGatewayStatusV1 {
	schemaVersion: 1;
	lastUpdatedUtc: string; // ISO timestamp in UTC

	config: {
		configPath: string; // absolute path or "(env:INSTRUCTION_ENGINE_GATEWAY_CONFIG_JSON)"
		mode: 'connected' | 'disconnected'; // resolved effective mode (never "auto")

		discord: {
			guildId: string;
			channelId: string;
			// Future-facing (WU-015): optional separation for permission prompts.
			permissionsChannelId?: string;
		};

		allowlists: {
			discordUsersCount: number;
			workspaceRootsCount: number;
		};

		workspaces: {
			activeRoot: string; // absolute path
		};
	};

	// Secrets are presence + source only. NEVER write raw values.
	secrets: {
		discordBotToken: {
			present: boolean;
			fromKeychain: boolean;
			fromEnv: boolean;
		};
		extensionWsJwt: {
			present: boolean;
			fromKeychain: boolean;
			fromEnv: boolean;
		};
	};

	runtime: {
		discord: {
			connected: boolean;
			ready: boolean;
		};

		// Only present when the gateway is able to observe WS state (typically connected mode).
		extensionWs?: {
			connected: boolean;
		};

		// Only present when the gateway is tracking session threads.
		sessions?: {
			activeSessionThreadCount: number;
		};
	};
}
```

Example JSON instance (illustrative only):

```json
{
	"schemaVersion": 1,
	"lastUpdatedUtc": "2026-02-17T20:30:15.123Z",
	"config": {
		"configPath": "C:/Users/alice/.instruction-engine/messaging-gateway.config.json",
		"mode": "connected",
		"discord": {
			"guildId": "222222222222222222",
			"channelId": "333333333333333333"
		},
		"allowlists": {
			"discordUsersCount": 1,
			"workspaceRootsCount": 2
		},
		"workspaces": {
			"activeRoot": "C:/Users/alice/Documents/GitHub/instruction-engine"
		}
	},
	"secrets": {
		"discordBotToken": { "present": true, "fromKeychain": true, "fromEnv": false },
		"extensionWsJwt": { "present": true, "fromKeychain": true, "fromEnv": false }
	},
	"runtime": {
		"discord": { "connected": true, "ready": true },
		"extensionWs": { "connected": true },
		"sessions": { "activeSessionThreadCount": 1 }
	}
}
```

### Update frequency (heartbeat)
- The gateway should refresh `lastUpdatedUtc` and rewrite the status file:
	- **Immediately** on key lifecycle transitions (startup, config loaded, secrets status read, Discord client ready, Discord disconnect/reconnect, extension WS connect/disconnect/auth failure).
	- **Periodically** as a heartbeat while running (recommended: every **5 seconds**; acceptable range: 2–10s).

### Write strategy (atomic)
- Writes must be atomic to avoid the extension reading partial JSON:
	- Serialize JSON to a temp file in the same directory (e.g., `messaging-gateway.status.json.tmp`).
	- Rename/move the temp file to `messaging-gateway.status.json` (same directory) so replacement is atomic where supported.
	- If the platform cannot rename over an existing file, delete the old file first, then rename (still keeping the temp + rename pattern).

### Privacy rules (hard constraints)
- Never write raw secrets:
	- Discord bot token
	- extension WS JWT
	- any other credential store material
- Never write message content, prompts, tool outputs, or session transcript text.
- Never write full allowlist contents (Discord user IDs list, workspace roots list). Counts + active root are sufficient for status UX.
