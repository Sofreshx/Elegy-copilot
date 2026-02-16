# Messaging Gateway (Discord-first) — Setup & Runbook

This runbook describes how to operate the **Messaging Gateway** in `local-tracker/`.

The gateway is a local Node.js process that:
- Authenticates a Discord bot
- Enforces an allowlist + guild/channel scope
- (Connected mode) connects to the VS Code extension WebSocket server (loopback) to invoke agents and stream progress
- (Disconnected mode) provides read-only status/sessions and supports offline queueing via Executive3 CLI

## Prereqs

- **Node.js**: `>=20`
- **VS Code**: running (connected mode requires the extension WS server)
- **Instruction Engine VS Code extension**: installed and active in the VS Code window you want to control
- **Discord**:
  - A private Discord guild + a single dedicated private channel (recommended)
  - A bot added to that guild/channel
  - Your Discord user ID (for allowlisting)

## 1) Enable the extension WebSocket server

In VS Code Settings (JSON), enable:

```json
{
  "skillInstaller.ws.enabled": true,
  "skillInstaller.ws.port": 0
}
```

Notes:
- `skillInstaller.ws.port: 0` picks a random available port (recommended).
- After enabling, you may need to **Reload Window** so the WS server starts.

## 2) Pair the gateway (port + JWT)

### 2.1 Confirm the WS port

Run the VS Code command:
- `skillInstaller.ws.showPort`

This copies a URL like `ws://127.0.0.1:<PORT>` to your clipboard.

The extension also writes a local-only discovery file under each open workspace root:
- `<workspaceRoot>/.e3-local/ws-port.txt`

That file contains only the numeric port (no secrets). The gateway uses it to find the WS endpoint.

### 2.2 Generate a gateway token

Run the VS Code command:
- `skillInstaller.ws.pairGateway`

This copies a two-line pairing payload to your clipboard:

```text
WS_URL=ws://127.0.0.1:<PORT>
WS_TOKEN=<JWT>
```

Notes:
- The token is a JWT signed by the extension’s local secret.
- Default expiry is **7 days**; after expiry (or if the extension secret is regenerated), you’ll need to re-pair.

## 3) Create gateway config (non-secret)

Tip (easiest): you can generate this config from VS Code:
- Run the command: `Gateway: Setup Messaging Gateway`
- It writes the config to `$HOME/.instruction-engine/messaging-gateway.config.json`

### Location

By default, the gateway reads config from:
- `$HOME/.instruction-engine/messaging-gateway.config.json`

You can override via:
- `INSTRUCTION_ENGINE_GATEWAY_CONFIG_PATH=<path>`
- or inline JSON with `INSTRUCTION_ENGINE_GATEWAY_CONFIG_JSON=<json>`

### Example config

There is also a copy/paste template checked into the repo:
- `local-tracker/docs/messaging-gateway.config.example.json`

```json
{
  "mode": "auto",
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

### Why are `guildId` and `channelId` required?

They are a **security scope**. The gateway fails closed and only accepts commands from:
- the one Discord server (guild) you intended, and
- the one Discord channel you intended

This prevents accidental/unsafe command execution if the bot is added to other servers/channels, or if someone tries to invoke it outside your dedicated private channel.

### Where do the Discord IDs come from?

In Discord, enable **Developer Mode**, then right-click → **Copy ID**:
- Your user: right-click your profile/avatar → Copy ID → goes in `discord.allowlistedUserIds`
- Your server/guild: right-click the server icon → Copy ID → goes in `discord.guildId`
- The channel: right-click the channel → Copy ID → goes in `discord.channelId`

Alternative (often easier): right-click the target channel → **Copy Link**.
The link looks like:
- `https://discord.com/channels/<guildId>/<channelId>`

Those two numbers are exactly what the config needs.

### Windows quick create (PowerShell)

This creates the default config file location. Replace the placeholders.

```powershell
$dir = Join-Path $HOME ".instruction-engine"
New-Item -ItemType Directory -Force -Path $dir | Out-Null

$configPath = Join-Path $dir "messaging-gateway.config.json"
@'
{
  "mode": "auto",
  "discord": {
    "allowlistedUserIds": ["<YOUR_DISCORD_USER_ID>"],
    "guildId": "<YOUR_DISCORD_GUILD_ID>",
    "channelId": "<YOUR_DISCORD_CHANNEL_ID>"
  },
  "workspaces": {
    "allowedRoots": [
      "<ABSOLUTE_WORKSPACE_ROOT_1>",
      "<ABSOLUTE_WORKSPACE_ROOT_2>"
    ],
    "activeRoot": "<ABSOLUTE_WORKSPACE_ROOT_1>"
  }
}
'@ | Set-Content -Encoding UTF8 -Path $configPath

Write-Host "Wrote config:" $configPath
```

## 4) Store secrets (Discord bot token + extension WS JWT)

The gateway prefers the **OS credential store** (Windows Credential Manager / macOS Keychain / libsecret).
It can also read from env vars as a fallback.

### 4.1 Store the Discord bot token

The Discord bot token is created in the **Discord Developer Portal** for your bot application. Treat it as a secret.

1) Set an env var (choose one):
- `INSTRUCTION_ENGINE_DISCORD_BOT_TOKEN=<DISCORD_BOT_TOKEN>`
- or `DISCORD_BOT_TOKEN=<DISCORD_BOT_TOKEN>`

2) Store it in the OS credential store:

```bash
npm run dev:gateway -- --store-discord-bot-token
```

### 4.2 Store the extension WS JWT

1) From the pairing payload, take `WS_TOKEN` and set (choose one):
- `INSTRUCTION_ENGINE_EXTENSION_WS_JWT=<WS_TOKEN>`
- or `INSTRUCTION_ENGINE_WS_JWT=<WS_TOKEN>`
- or `EXTENSION_WS_JWT=<WS_TOKEN>`

2) Store it in the OS credential store:

```bash
npm run dev:gateway -- --store-extension-ws-jwt
```

Tip: after storing, you can remove the env vars so the secrets are only in the OS credential store.

## 5) Run the gateway

From `local-tracker/`:

- Dev (TypeScript via ts-node):

```bash
npm run dev:gateway
```

- Production-like (compiled JS):

```bash
npm run build
npm run start:gateway
```

## Troubleshooting

### WebSocket 401 Unauthorized

Symptoms:
- Gateway logs show WS connection failures and/or `401`.

Common causes:
- Missing/incorrect extension WS JWT in the OS credential store
- Token expired (default: 7 days)
- Extension WS secret regenerated (invalidates old tokens)

Fix:
- Re-run `skillInstaller.ws.pairGateway` in VS Code
- Store the new token again with `npm run dev:gateway -- --store-extension-ws-jwt`

### Missing `.e3-local/ws-port.txt`

Symptoms:
- Gateway errors that connected mode requires the WS port discovery file.

Fix:
- Ensure VS Code is running and the extension WS server is enabled (`skillInstaller.ws.enabled: true`)
- Reload VS Code window
- Confirm you opened the same workspace root that your gateway config uses as `workspaces.activeRoot`

### Port changes between runs

If `skillInstaller.ws.port` is `0`, the port can change after a VS Code restart.

Expected behavior:
- The extension rewrites `<workspaceRoot>/.e3-local/ws-port.txt`
- The gateway re-reads the file and reconnects

If it doesn’t recover:
- Restart the gateway
- Run `skillInstaller.ws.showPort` to confirm the extension is listening
- Optionally set a fixed port via `skillInstaller.ws.port` (and ensure it’s free)

### Missing secrets

Symptoms:
- Gateway exits with “Missing required secret: Discord bot token”
- Or (connected mode) “Missing required secret: extension WS JWT”

Fix:
- Store secrets using:
  - `npm run dev:gateway -- --store-discord-bot-token`
  - `npm run dev:gateway -- --store-extension-ws-jwt`
- Or temporarily set the appropriate env vars (see the help text in the gateway entrypoint)

## Security notes

- Do **not** paste tokens/secrets into Discord messages. Treat Discord as an untrusted surface.
- The config file is **non-secret** by design (allowlists + scope + workspace roots only).
- Discord mention parsing is disabled (`allowedMentions.parse = []`) and outbound content is sanitized/capped.
- The gateway fails closed:
  - only allowlisted Discord users are permitted
  - only the configured guild/channel is accepted
  - workspace access is restricted to configured allowlisted roots
