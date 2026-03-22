# Optional Messaging Gateway (Discord → Copilot CLI ACP)

Control your **Copilot CLI** agent sessions from **Discord** using slash commands, threads, and permission buttons.

This gateway is an **optional companion process** under `local-tracker/`. The default tracker runtime can watch repo-state, git status, and serve the local extension bridge without running the gateway. Use this guide only if you explicitly want Discord-based remote control.

When enabled, the gateway is a local Node.js process that:
- Authenticates a Discord bot
- Enforces an allowlist + guild/channel scope
- Connects to a Copilot CLI ACP (Agent Communication Protocol) server
- Routes Discord commands to agent sessions and streams progress back

---

## Prerequisites

- **Opt-in use case**: only needed if you want the optional remote-control surface
- **Node.js**: `>=20`
- **Copilot CLI**: available on PATH with ACP support (`copilot --acp`)
- **Gateway runtime deps installed**: if your base tracker install used `npm install --omit=optional`, run `npm install --include=optional` from `local-tracker/` before starting the gateway
- **Discord**:
  - A Discord bot created in the [Discord Developer Portal](https://discord.com/developers/applications)
  - Bot added to your private guild/channel (recommended: dedicated private channel)
  - Your Discord user ID (for allowlisting)

---

## Setup Checklist

Follow these steps in order to set up Discord control of Copilot CLI sessions:

### ✅ Step 1: Create Discord bot + install to guild/channel

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a **New Application** (or use an existing one)
3. Go to the **Bot** tab and create a bot token (copy and save it securely)
4. No privileged Gateway Intents are required for this gateway (it uses slash commands / application commands).
5. Go to **OAuth2 → URL Generator**:
    - Scopes: `bot`, `applications.commands`
    - Bot Permissions (recommended): `Send Messages`, `Create Public Threads`, `Send Messages in Threads`, `Read Message History`
6. Copy the generated URL and open it in your browser to **install the bot** to your Discord server (guild)
7. Enable **Developer Mode** in Discord (User Settings → Advanced → Developer Mode)

### ✅ Step 2: Gather Discord IDs and create config file

**Config file location**: `$HOME/.copilot/messaging-gateway.config.json`

Legacy compatibility: if an older `$HOME/.instruction-engine/messaging-gateway.config.json` exists
and the canonical `~/.copilot` config is absent, the gateway will rehome that legacy file into the
canonical `~/.copilot` location before continuing.

You can override this path with:
- `INSTRUCTION_ENGINE_GATEWAY_CONFIG_PATH=<path>`
- or inline JSON: `INSTRUCTION_ENGINE_GATEWAY_CONFIG_JSON=<json>`

#### How to get Discord IDs

In Discord (with Developer Mode enabled), right-click and **Copy ID**:
- **Your user ID**: Right-click your profile/avatar → Copy ID → goes in `allowlistedUserIds`
- **Guild ID**: Right-click the server icon → Copy ID → goes in `guildId`
- **Channel ID**: Right-click the channel → Copy ID → goes in `channelId`

**Quick trick**: Right-click the target channel → **Copy Link**. The link looks like:
```
https://discord.com/channels/<guildId>/<channelId>
```

#### Create the config file

See the example template below or copy from `local-tracker/docs/messaging-gateway.config.example.json`.

**Required fields**:

```json
{
  "mode": "auto",
  "acp": {
    "host": "127.0.0.1",
    "port": 3000
  },
  "sandboxLifecycle": {
    "maxSandboxes": 10,
    "portRange": {
      "start": 13000,
      "end": 13099
    },
    "cleanupOnStartup": false,
    "staleTtlMs": 86400000
  },
  "discord": {
    "allowlistedUserIds": ["<YOUR_DISCORD_USER_ID>"],
    "guildId": "<YOUR_DISCORD_GUILD_ID>",
    "channelId": "<YOUR_DISCORD_CHANNEL_ID>"
  },
  "workspaces": {
    "allowedRoots": ["<ABSOLUTE_WORKSPACE_ROOT>"],
    "activeRoot": "<ABSOLUTE_WORKSPACE_ROOT>"
  }
}
```

- **`mode`**: `"auto"` (recommended) or `"connected"`
- **`acp.host`**: ACP server host (default: `127.0.0.1`)
- **`acp.port`**: ACP server port (must match Copilot CLI `--port`)
- **`sandboxLifecycle.maxSandboxes`**: Max concurrent sandboxes (1-100, default: `10`)
- **`sandboxLifecycle.portRange`**: Host port range for ACP sidecars (`start`/`end`, 1-65535, `start <= end`, default: `13000-13099`)
- **`sandboxLifecycle.cleanupOnStartup`**: Whether to run startup sandbox directory orphan/stale cleanup (default: `false`)
- **`sandboxLifecycle.staleTtlMs`**: Stale directory threshold in milliseconds for non-active sandboxes (default: `86400000`)
- **`discord.allowlistedUserIds`**: Array of Discord user IDs (strings) allowed to use commands
- **`discord.guildId`**: Your Discord server (guild) ID (string)
- **`discord.channelId`**: Your Discord channel ID (string) where commands are accepted
- **`workspaces.allowedRoots`**: Array of absolute workspace paths the gateway can access
- **`workspaces.activeRoot`**: Active workspace (must be in `allowedRoots`)

**Optional field**: `"permissionsChannelId"` (inside `discord`) — if set, permission prompts (approve/deny buttons) are posted to this separate channel instead of the session thread.

#### Windows quick create (PowerShell)

Replace the placeholders with your actual IDs:

```powershell
$dir = Join-Path $HOME ".copilot"
New-Item -ItemType Directory -Force -Path $dir | Out-Null

$configPath = Join-Path $dir "messaging-gateway.config.json"
@'
{
  "mode": "auto",
  "acp": {
    "host": "127.0.0.1",
    "port": 3000
  },
  "discord": {
    "allowlistedUserIds": ["<YOUR_DISCORD_USER_ID>"],
    "guildId": "<YOUR_DISCORD_GUILD_ID>",
    "channelId": "<YOUR_DISCORD_CHANNEL_ID>"
  },
  "workspaces": {
    "allowedRoots": ["<ABSOLUTE_WORKSPACE_ROOT>"],
    "activeRoot": "<ABSOLUTE_WORKSPACE_ROOT>"
  }
}
'@ | Set-Content -Encoding UTF8 -Path $configPath

Write-Host "Wrote config:" $configPath
```

### ✅ Step 3: Store Discord bot token in OS credential store

The gateway uses the **OS credential store** (Windows Credential Manager / macOS Keychain / libsecret) for secure secret storage.

1. **Set an environment variable** with your Discord bot token (temporarily):
   ```bash
   export INSTRUCTION_ENGINE_DISCORD_BOT_TOKEN=<YOUR_DISCORD_BOT_TOKEN>
   # or on Windows PowerShell:
   # $env:INSTRUCTION_ENGINE_DISCORD_BOT_TOKEN="<YOUR_DISCORD_BOT_TOKEN>"
   ```

2. **Store it** using the gateway CLI flag (from `local-tracker/`):
   ```bash
   npm run dev:gateway -- --store-discord-bot-token
   ```

   This writes the token to the OS credential store and exits.

### ✅ Step 4: Start Copilot CLI ACP server (TCP mode)

Start the Copilot CLI in ACP mode on the port you configured (default: 3000):

```bash
copilot --acp --port 3000
```

**Important**: The `acp.port` in your gateway config **must match** this port.

You can override the config using environment variables:
- `INSTRUCTION_ENGINE_ACP_PORT=3000`
- `INSTRUCTION_ENGINE_ACP_HOST=127.0.0.1` (optional)

### ✅ Step 5: Start the gateway in connected/auto mode

From `local-tracker/`:

`npm run dev` starts the default tracker only. Use the commands below when you have explicitly opted into the gateway:

**Dev mode (TypeScript via ts-node)**:
```bash
npm install --include=optional   # only needed if you previously omitted optional deps
npm run dev:gateway
```

**Production mode (compiled JS)**:
```bash
npm install --include=optional   # only needed if you previously omitted optional deps
npm run build
npm run build:gateway
npm run start:gateway
```

The gateway will:
- Load config from `$HOME/.copilot/messaging-gateway.config.json`
- Retrieve the Discord bot token from OS credential store
- Connect to the Copilot CLI ACP server at `127.0.0.1:3000`
- Authenticate with Discord and start listening for commands

### ✅ Step 6: Use Discord commands

In your configured Discord channel, you can now use slash commands:

| Command | Description |
|---------|-------------|
| `/status` | Show gateway status and active sessions |
| `/sessions` | List all active agent sessions |
| `/task prompt:<text>` | Create a new task session (opens a thread) |
| `/plan prompt:<text>` | Create a new plan-only session (opens a thread) |
| `/stop sessionid:<id>` | Stop a session |
| `/git` | Show git status for active workspace |
| `/workspaces` | List allowlisted workspaces |
| `/switch workspaceroot:<path>` | Switch the active workspace root |

**Permission buttons**: When an agent requests permission (e.g., file edits, tool usage), the gateway posts interactive buttons:
- ✅ **Approve** — allow the action
- ❌ **Deny** — reject the action

Buttons appear in the session thread (or in a dedicated `permissionsChannelId` if configured).

---

## Configuration Reference

### Location

By default, the gateway reads config from:
- `$HOME/.copilot/messaging-gateway.config.json`
- and only treats `$HOME/.instruction-engine/messaging-gateway.config.json` as a legacy rehome source

You can override via:
- `INSTRUCTION_ENGINE_GATEWAY_CONFIG_PATH=<path>`
- or inline JSON with `INSTRUCTION_ENGINE_GATEWAY_CONFIG_JSON=<json>`

### WS4 closure path + idempotency checkpoint

For WS4 freeze/gate evidence, treat these as contract-level invariants:

- **Canonical config path semantics**
  - tracker config path resolves in this order: CLI path → `INSTRUCTION_ENGINE_GATEWAY_CONFIG_PATH` → `~/.copilot/messaging-gateway.config.json`
  - if the canonical `~/.copilot` file is absent, the loader may rehome `~/.instruction-engine/messaging-gateway.config.json` into the canonical path
  - paths are normalized to absolute paths before use

- **Canonical status path semantics**
  - gateway status artifact is machine-global and deterministic at:
    - `~/.copilot/messaging-gateway.status.json`
  - if the canonical status file is absent, an older `~/.instruction-engine/messaging-gateway.status.json` may be rehomed forward once

- **Lifecycle idempotency semantics**
  - finish retries preserve canonical `sandboxId`
  - coalesced duplicate finish calls return deterministic dedupe metadata
  - mismatched payload replays fail explicitly with `idempotency_conflict` + `idempotency_key_payload_mismatch`

### Example config

There is also a copy/paste template checked into the repo:
- `local-tracker/docs/messaging-gateway.config.example.json`

```json
{
  "mode": "auto",
  "acp": {
    "host": "127.0.0.1",
    "port": 3000
  },
  "sandboxLifecycle": {
    "maxSandboxes": 10,
    "portRange": {
      "start": 13000,
      "end": 13099
    },
    "cleanupOnStartup": false,
    "staleTtlMs": 86400000
  },
  "discord": {
    "allowlistedUserIds": ["111111111111111111"],
    "guildId": "222222222222222222",
    "channelId": "333333333333333333"
  },
  "workspaces": {
    "allowedRoots": ["<ABSOLUTE_WORKSPACE_ROOT_1>", "<ABSOLUTE_WORKSPACE_ROOT_2>"],
    "activeRoot": "<ABSOLUTE_WORKSPACE_ROOT_1>"
  }
}
```

Important:
- Discord IDs must be **numeric strings** (Discord “snowflakes”).
- `workspaces.activeRoot` must be included in `workspaces.allowedRoots`.
- `workspaces.activeRoot` must exist and be a directory.
### Optional: `discord.permissionsChannelId`

You can optionally add `"permissionsChannelId": "<CHANNEL_ID>"` inside the `discord` block. When set, permission prompts (approve/deny buttons) are posted to that separate channel instead of the session thread.

```json
{
  "discord": {
    "allowlistedUserIds": ["111111111111111111"],
    "guildId": "222222222222222222",
    "channelId": "333333333333333333",
    "permissionsChannelId": "444444444444444444"
  }
}
```

**Default behavior**: Permission prompts go to the session thread.
### Why are `guildId` and `channelId` required?

They are a **security scope**. The gateway fails closed and only accepts commands from:
- The one Discord server (guild) you intended
- The one Discord channel you intended

This prevents accidental/unsafe command execution if the bot is added to other servers/channels.

---

## Troubleshooting

### ACP not connected

Symptoms:
- Gateway logs show ACP connection failures.

Fix:
- Ensure Copilot CLI is running in ACP mode: `copilot --acp --port <PORT>`
- Ensure the gateway has a matching port configured (`INSTRUCTION_ENGINE_ACP_PORT` or config `acp.port`)

### Missing secrets

Symptoms:
- Gateway exits with “Missing required secret: Discord bot token”

Fix:
- Store secrets using:
  - `npm run dev:gateway -- --store-discord-bot-token`
- Or temporarily set the appropriate env vars (see the help text in the gateway entrypoint)

## Security notes

- Do **not** paste tokens/secrets into Discord messages. Treat Discord as an untrusted surface.
- The config file is **non-secret** by design (allowlists + scope + workspace roots only).
- Discord mention parsing is disabled (`allowedMentions.parse = []`) and outbound content is sanitized/capped.
- The gateway fails closed:
  - only allowlisted Discord users are permitted
  - only the configured guild/channel is accepted
  - workspace access is restricted to configured allowlisted roots

## Sandbox lifecycle authorization matrix (G-04-WU-01)

The gateway-level policy for sandbox actions is:

| Action | Local UI (authenticated) | Discord allowlisted user | Any other caller |
|---|---|---|---|
| `create` | allow | allow | deny |
| `start` | allow | allow | deny |
| `stop` | allow | allow | deny |
| `open-terminal` | allow (local-machine only) | deny | deny |
| `pr-open` | allow (host token only) | allow (host token only) | deny |

Operational notes:
- `open-terminal` remains restricted to local machine scope even when Discord control is enabled.
- PR tokens remain host-only and are not passed into sandbox environment variables.
- Policy evaluation is fail-closed for unauthorized or malformed requests.

## Sandbox lifecycle contract freeze (G-01-WU-01)

This section freezes lifecycle behavior expected by downstream implementation work.

### Create ID contract

- `create` accepts an optional `sandboxId` input.
- If `sandboxId` is not supplied by the caller, the client flow MUST auto-generate a valid draft sandbox ID before submission.
- Auto-generated draft IDs MUST remain editable by the user until the create request is submitted.
- The first successful create response defines the canonical sandbox ID.
- After canonicalization, retries and finish paths MUST reuse the canonical sandbox ID and MUST NOT regenerate or rewrite it.

### Runtime provider contract

- Non-Docker runtime is the primary path for sandbox lifecycle operations.
- Docker runtime remains supported as an optional path.
- Lifecycle request/response semantics are provider-agnostic; provider choice MUST NOT change lifecycle contract shape.

### Mixed-version lifecycle compatibility gate (G-06-WU-02)

Lifecycle routes now enforce deterministic mixed-version compatibility checks so old/new client-tracker pairs fail closed predictably.

Required request headers on `POST /api/lifecycle/:action`:
- `X-Instruction-Engine-Lifecycle-Contract-Version: 1`
- `X-Instruction-Engine-Lifecycle-Capability: mixed-version-lifecycle-v1`

Gateway behavior:
- Missing or unsupported header values return `501` with deterministic marker envelope:
  - `error = "Lifecycle compatibility unsupported"`
  - `code = "lifecycle_compatibility_unsupported"`
  - `deterministic = true`
  - `unsupported.marker = "unsupported"`
  - `unsupported.direction = "old_client_new_tracker"`
- Supported lifecycle requests keep existing success envelope shape (`{ ok, action, result }`).

Lifecycle responses include compatibility headers so newer clients can fail closed when talking to older trackers that do not publish the gate.

### Finish flow contract

Finish sequence is deterministic and always allows closure:

1. Prompt for optional PR action first (`open-pr` or `skip-pr`).
2. Process the chosen PR branch.
3. Allow session closure in all branches.

Decision table:

| PR branch outcome | Close allowed | Required behavior |
|---|---|---|
| `skip-pr` | yes | Close path available immediately |
| `open-pr:success` | yes | Close path available after PR result is surfaced |
| `open-pr:failure` | yes | Surface PR error and keep close path available |
| `open-pr:canceled` | yes | No PR side effect is committed; close path remains available |
