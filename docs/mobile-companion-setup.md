# Mobile Companion Setup Guide

This guide covers setting up the Mobile Companion ecosystem for remote VS Code/Copilot agent management.

## Overview

The Mobile Companion system consists of three parts:
1. **VS Code Extension** - WebSocket server and session management
2. **Cloud Relay** - Optional cloud relay for remote access
3. **Mobile PWA** - Progressive Web App for phone/tablet access

## Quick Start

### 1. Install the Extension

Download and install the VS Code extension:

```bash
# From VSIX
code --install-extension skill-installer.vsix

# Or install from source
cd vscode-skill-installer
npm install && npm run compile
# Then use "Developer: Install Extension from Location..."
```

### 2. Enable WebSocket Server

Add to your VS Code settings:

```json
{
  "skillInstaller.ws.enabled": true,
  "skillInstaller.ws.port": 0
}
```

Port `0` uses a random available port (recommended for security).

### 3. Access the Mobile App

Option A: **GitHub Pages** (Recommended)
- Navigate to: `https://[your-org].github.io/instruction-engine/`

Option B: **Local Development**
```bash
cd mobile-companion
npm install
npm run dev
```

#### Local Development Details (Mobile App)

Create a local env file for dev settings:

```bash
cd mobile-companion
```

Create `mobile-companion/.env.local`:

```env
# Mobile app dev server
VITE_RELAY_URL=ws://127.0.0.1:5173

# GitHub OAuth (optional for local UI checks)
VITE_GITHUB_CLIENT_ID=your_client_id
VITE_GITHUB_REDIRECT_URI=http://localhost:5173/auth/callback
```

Then run the app:

```bash
npm run dev
```

Open: `http://localhost:5173`

Notes:
- Without a relay/token exchange service, the GitHub login flow will not complete (GitHub blocks direct token exchange from the browser).
- You can still validate the UI and navigation locally without logging in.
- For full auth + data flows, use the local relay path described in [Mobile Local Testing](./mobile-local-testing.md).

### 4. Connect

1. Open the Mobile Companion app
2. Login with GitHub
3. Scan the QR code shown in VS Code status bar, or enter connection details manually

## Extension Configuration

### WebSocket Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `skillInstaller.ws.enabled` | `false` | Enable WebSocket server |
| `skillInstaller.ws.port` | `0` | Server port (0 = random) |
| `skillInstaller.ws.secret` | `""` | JWT secret (auto-generated if empty) |
| `skillInstaller.ws.heartbeatInterval` | `30000` | Ping interval (ms) |
| `skillInstaller.ws.staleTimeout` | `120000` | Connection timeout (ms) |

### Session Logging

| Setting | Default | Description |
|---------|---------|-------------|
| `skillInstaller.session.loggingEnabled` | `true` | Enable session logs |
| `skillInstaller.session.maxLogSize` | `102400` | Max log entry size (bytes) |

### OAuth Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `skillInstaller.oauth.clientId` | `""` | GitHub OAuth App Client ID |
| `skillInstaller.oauth.clientSecret` | `""` | OAuth Client Secret (dev only) |
| `skillInstaller.oauth.redirectUri` | `vscode://...` | OAuth callback URI |

## Mobile App Features

### Session Monitoring
- View active Copilot sessions
- See session history and logs
- Monitor execution progress

### Idea Drafting
- Quick-capture ideas while away from computer
- Draft prompts for later execution
- Organize with tags and categories

### Remote Execution
- Queue ideas for agent execution
- Trigger GitHub Actions workflows
- Launch Codespaces for cloud execution

### AI Chat
- Chat with GitHub Models API
- Learning mode with checkpoints
- Spaced repetition for review

### Offline Support
- All data persisted to IndexedDB
- Sync queue for offline changes
- Conflict resolution when back online

## Cloud Relay (Optional)

For accessing your VS Code from outside your local network:

### Self-Hosted Relay

1. Deploy the relay service:
```bash
cd cloud-relay
docker-compose up -d
```

2. Configure environment:
```env
JWT_SECRET=your-secure-secret
GITHUB_CLIENT_ID=your-oauth-app-id
GITHUB_CLIENT_SECRET=your-oauth-secret
```

3. Point mobile app to your relay URL

### Security Considerations

See [Security Model](./security-model.md) for detailed security guidance.

## Troubleshooting

### Connection Issues

**Can't connect from mobile:**
1. Ensure `skillInstaller.ws.enabled` is `true`
2. Check firewall allows the WebSocket port
3. For remote access, use the cloud relay

**Authentication failing:**
1. Verify GitHub OAuth app configuration
2. Check redirect URI matches settings
3. Ensure tokens haven't expired

### Performance Issues

**Slow sync:**
1. Check network connectivity
2. Reduce `skillInstaller.ws.heartbeatInterval` if needed
3. Clear offline sync queue if too large

**High memory usage:**
1. Reduce `skillInstaller.session.maxLogSize`
2. Archive old sessions periodically
3. Clear completed items from queue

## Next Steps

- [Mobile Local Testing](./mobile-local-testing.md) - Local testing plan and integration audit
- [Security Model](./security-model.md) - Understand the security architecture
- [Relay API Reference](./relay-api-reference.md) - API documentation
- [Contributing](../CONTRIBUTING.md) - Help improve the project
