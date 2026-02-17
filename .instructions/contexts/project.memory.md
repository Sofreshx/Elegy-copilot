# Project Memory

## Current Supported Stack (2026-02-17)
- Primary agent entry point: `@orchestrator`.
- VS Code extension: **RannIA** (folder `RannIA/`). Marketplace identity remains `sofreshx.skill-installer`; internal contributed IDs remain under `skillInstaller.*`.
- Remote control: Discord Messaging Gateway (`local-tracker`) connects to the extension’s loopback WS server and invokes agents (orchestrator-first).

## On-Disk Compatibility Surfaces
- Keep stable:
	- `.instructions/`
	- `.instructions-output/`
	- `<workspace>/.skill-installer/ws-port.txt` (WS port discovery; contains only the port number)

## Discord Messaging Gateway
- Config (non-secret): `~/.instruction-engine/messaging-gateway.config.json`
- Status file (non-secret): `~/.instruction-engine/messaging-gateway.status.json`
- Secrets: OS credential store (preferred) or env var fallback for the Discord bot token and extension WS JWT

## Testing Workflow
- For any feature or bug fix, add or update unit tests in the touched package before marking work complete.
- After code edits, run `get_errors` to catch compile/type issues before running tests.
- Use `unit-test-runner` at checkpoints; ask before running long integration or E2E tests.
- If long tests are declined, record the skip in `.instructions/testing/skipped-validation.md`.

## E2E (Playwright)
- E2E runs use Playwright against the web UI unless explicitly scoped elsewhere.
- Default base URL: http://localhost:5173. Override with `skillInstaller.e2e.url` or script args.
- Outputs go under `.instructions-output/e2e/` (reports, screenshots, logs).
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
