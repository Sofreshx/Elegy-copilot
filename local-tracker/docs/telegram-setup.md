# Telegram Bot Setup for the Optional Messaging Gateway

If you opt into the Messaging Gateway, you can control your **Copilot CLI** agent sessions from **Telegram** using bot commands, inline keyboards, and webhook-based messaging.

The optional messaging gateway supports dual-channel operation — Discord and Telegram can run simultaneously. The Telegram integration uses:

- **Grammy** (npm) as the Bot Framework
- **Webhook-only mode** (no polling)
- Bot token stored in OS keychain via `getGatewaySecret('telegramBotToken')`
- Webhook endpoint at `POST /api/telegram/webhook`

---

## Prerequisites

- **Node.js**: `>=20`
- **Optional messaging gateway** already set up and running (see [messaging-gateway.md](messaging-gateway.md) for general setup)
- **A Telegram account**

---

## Setup Checklist

### Step 1: Create a Telegram Bot via BotFather

1. Open Telegram and search for **@BotFather** (or go to [https://t.me/BotFather](https://t.me/BotFather))
2. Send `/newbot`
3. Choose a **display name** for your bot (e.g. `My Copilot Gateway`)
4. Choose a **username** — must end in `bot` (e.g. `my_copilot_gw_bot`)
5. BotFather replies with your **bot token** — it looks like:
   ```
   123456789:ABCdefGHIjklMNOpqrSTUvwxYZ
   ```
6. **Copy the token immediately.** Do not share it or commit it to any repository.

---

### Step 2: Store the Bot Token

#### Option A: Environment Variable (development / CI)

```bash
export IE_TELEGRAM_BOT_TOKEN=<your-token>
```

This is the simplest approach for local development. Set it in your shell profile or CI secrets.

#### Option B: OS Keychain (preferred for production)

Keychain storage will follow the same pattern as Discord (`--store-discord-bot-token`). Once the CLI flag is available:

```bash
npm run dev:gateway -- --store-telegram-bot-token
```

> **Note:** The `--store-telegram-bot-token` CLI flag does not exist yet. Use the environment variable approach for now. The gateway reads `telegramBotToken` from keychain first, falling back to `IE_TELEGRAM_BOT_TOKEN`.

---

### Step 3: Find Your Telegram User ID

Your user ID is a numeric ID (not your username). You need it for the allowlist.

**Option A:** Send any message to **@userinfobot** on Telegram — it replies with your user ID.

**Option B:** Use the Bot API directly:

```bash
# After sending a message to your bot, call getUpdates:
curl "https://api.telegram.org/bot<TOKEN>/getUpdates"
```

Look for `message.from.id` in the response.

---

### Step 4: Configure the Gateway

Add a `telegram` block to your gateway config file at `~/.copilot/messaging-gateway.config.json`:

```json
{
  "telegram": {
    "allowlistedUserIds": ["<your-telegram-user-id>"]
  },
  "discord": { "..." : "..." },
  "workspaces": { "..." : "..." }
}
```

Replace `<your-telegram-user-id>` with the numeric ID from Step 3.

> **Tip:** You can run both Discord and Telegram simultaneously — each has its own config block.

---

### Step 5: Set Up the Webhook

Telegram bots in webhook mode require an HTTPS URL that Telegram can reach.

#### Development (ngrok)

1. Start ngrok pointing at the gateway HTTP port (default `4120`):

   ```bash
   ngrok http 4120
   ```

2. Copy the `https://` forwarding URL from ngrok output.

3. Register the webhook with Telegram:

   ```bash
   curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
     -H "Content-Type: application/json" \
     -d '{
       "url": "https://<ngrok-subdomain>.ngrok-free.app/api/telegram/webhook",
       "secret_token": "<TOKEN>"
     }'
   ```

   Replace `<TOKEN>` with your bot token and `<ngrok-subdomain>` with the ngrok subdomain.

   > **Note:** The `secret_token` parameter is used by the gateway for webhook verification. Currently, the gateway uses the bot token itself as the secret token.

4. Verify the webhook was set:

   ```bash
   curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
   ```

   You should see `"url"` set and `"last_error_date"` absent.

#### Production

Use a reverse proxy (nginx, Caddy) or cloud service with a valid HTTPS certificate. Set the webhook URL to your production domain:

```bash
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-domain.example.com/api/telegram/webhook",
    "secret_token": "<TOKEN>"
  }'
```

---

### Step 6: Verify It Works

1. Start the gateway:

   ```bash
   npm install --include=optional   # only needed if you previously omitted optional deps
   npm run dev:gateway -- --config ~/.copilot/messaging-gateway.config.json
   ```

2. Open Telegram and send `/status` to your bot.

3. You should receive a status response.

4. Check the gateway status file:

   ```bash
   cat ~/.copilot/messaging-gateway.status.json
   ```

   It should show `telegram.connected: true`.

---

## Available Commands

| Command | Tier | Description |
|---------|------|-------------|
| `/status` | read | Show gateway status |
| `/sessions` | read | List recent sessions |
| `/git` | read | Show git status |
| `/workspaces` | read | List workspaces |
| `/task` | invoke | Run a task (requires confirmation) |
| `/plan` | invoke | Plan work (requires confirmation) |
| `/stop` | invoke | Stop a session (requires confirmation) |

**Invoke-tier commands** show an inline keyboard with Confirm / Cancel buttons before executing. This prevents accidental invocations.

---

## Troubleshooting

### "Missing required secret: telegramBotToken"

The gateway cannot find the bot token. Fix:

```bash
export IE_TELEGRAM_BOT_TOKEN=<your-token>
```

Then restart the gateway.

### Bot not responding

1. **Is ngrok running?** Check `ngrok http 4120` is active and the URL hasn't expired.
2. **Is the webhook set?** Run:
   ```bash
   curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
   ```
   Verify `url` is correct and there are no recent errors.
3. **Does `secret_token` match?** The `secret_token` in your `setWebhook` call must be your bot token (the gateway uses it for verification).
4. **Is the gateway running?** Check the process is alive and listening on port `4120`.

### "Unauthorized" reply from bot

Your Telegram user ID is not in the allowlist. Add your numeric user ID to:

```json
{
  "telegram": {
    "allowlistedUserIds": ["123456789"]
  }
}
```

### Webhook returns 404

The gateway HTTP server is not running or not listening on the expected port. Verify:

- The gateway started without errors
- The port matches what ngrok/your proxy is forwarding to (default: `4120`)
- The path is exactly `/api/telegram/webhook`

### Webhook returns 401 or 403

The `secret_token` in your `setWebhook` call doesn't match what the gateway expects. Re-register the webhook with the correct bot token as `secret_token`.
