# GitHub OAuth Setup Guide

This document explains how to set up GitHub OAuth authentication for the Instruction Engine Skill Installer extension.

## Overview

GitHub OAuth enables secure authentication for:
- Mobile companion app connections
- Cloud relay service communication
- GitHub API access (Models, Copilot features)

## Prerequisites

- A GitHub account
- VS Code with the Skill Installer extension installed

## Step 1: Create a GitHub OAuth App

1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. Click **"New OAuth App"** (or **"Register a new application"**)
3. Fill in the application details:

| Field | Value |
|-------|-------|
| **Application name** | `Instruction Engine` (or your preferred name) |
| **Homepage URL** | `https://github.com/Sofreshx/instruction-engine` |
| **Application description** | (Optional) Remote control for Copilot agent sessions |
| **Authorization callback URL** | `vscode://sofreshx.skill-installer/auth/callback` |

4. Click **"Register application"**
5. Note down the **Client ID** (you'll need this)
6. Click **"Generate a new client secret"** and save it securely

> ⚠️ **Important**: The client secret should be kept confidential. For production use, consider using a token exchange proxy instead of storing the secret in VS Code settings.

## Step 2: Configure the Extension

### Option A: VS Code Settings (Development)

1. Open VS Code Settings (`Ctrl+,` or `Cmd+,`)
2. Search for `skillInstaller.oauth`
3. Set the following:
   - **Client ID**: Your GitHub OAuth App Client ID
   - **Client Secret**: Your GitHub OAuth App Client Secret (development only)
   - **Redirect URI**: Leave as default (`vscode://sofreshx.skill-installer/auth/callback`)

### Option B: settings.json

Add to your `settings.json`:

```json
{
  "skillInstaller.oauth.clientId": "your_client_id_here",
  "skillInstaller.oauth.clientSecret": "your_client_secret_here"
}
```

### Option C: Environment Variables (Recommended for Teams)

For shared development environments, you can set variables that the extension reads:

```bash
GITHUB_OAUTH_CLIENT_ID=your_client_id
GITHUB_OAUTH_CLIENT_SECRET=your_client_secret
```

## Step 3: Login

1. Open the Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P`)
2. Run **"Skill Installer: Login with GitHub"**
3. Your browser will open to GitHub's authorization page
4. Click **"Authorize"** to grant access
5. You'll be redirected back to VS Code automatically

## Multi-Platform Configuration

If you're also using the mobile companion app, you'll need multiple callback URLs:

### GitHub OAuth App Settings

Add these callback URLs (one per line):
```
vscode://sofreshx.skill-installer/auth/callback
http://localhost:3000/auth/callback
https://your-relay-service.com/auth/callback
```

## Security Considerations

### Client Secret Storage

- **Development**: Store in VS Code settings (not recommended for team repos)
- **Production**: Use a token exchange proxy service:
  1. Client initiates OAuth (gets auth code)
  2. Client sends code to your backend
  3. Backend exchanges code for token (keeps secret secure)
  4. Backend returns token to client

### Token Exchange Proxy Example

```typescript
// Your backend server
app.post('/auth/exchange', async (req, res) => {
  const { code, redirect_uri } = req.body;
  
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Accept': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri
    })
  });
  
  const tokens = await response.json();
  res.json(tokens);
});
```

### Scopes Requested

The extension requests these OAuth scopes:
- `read:user` - Read user profile information
- `user:email` - Access user email address

These are the minimum scopes needed for authentication. No repository access is requested.

## Troubleshooting

### "Invalid or expired state parameter"

This error occurs when:
- The login session took too long (> 10 minutes)
- The browser session was interrupted
- You're trying to use an old callback URL

**Solution**: Try logging in again with a fresh session.

### "GitHub OAuth not configured"

The extension couldn't find a Client ID in settings.

**Solution**: Ensure `skillInstaller.oauth.clientId` is set in your VS Code settings.

### "Failed to open browser"

VS Code couldn't open your default browser.

**Solution**: 
1. Check your default browser settings
2. Try manually navigating to the GitHub OAuth URL
3. Copy the callback URL and paste it in VS Code

### "Redirect URI mismatch"

The callback URL in your request doesn't match what's configured in the GitHub OAuth App.

**Solution**: 
1. Go to your [GitHub OAuth App settings](https://github.com/settings/developers)
2. Ensure the callback URL matches exactly: `vscode://sofreshx.skill-installer/auth/callback`

### Browser Shows Error After Authorization

If you see an error page after clicking "Authorize" on GitHub:

1. Check if VS Code is running and the extension is activated
2. Ensure the extension has registered its URI handler
3. Try reloading VS Code and attempting login again

## API Integration

Once authenticated, the extension can:

1. **Generate WebSocket tokens** for mobile companion connections
2. **Access GitHub APIs** using the stored access token
3. **Emit authenticated events** through the relay service

### Accessing the OAuth Manager (Extension Development)

```typescript
import { GitHubOAuthManager } from './oauthManager';

// In your extension
const oauthManager = new GitHubOAuthManager(context.secrets, outputChannel);
await oauthManager.initialize();

// Check login status
if (oauthManager.isLoggedIn()) {
  const user = oauthManager.getUser();
  console.log(`Logged in as ${user?.login}`);
}

// Get access token for API calls
const token = await oauthManager.getAccessToken();
```

## Logout

To logout and clear stored tokens:

1. Open the Command Palette
2. Run **"Skill Installer: Logout from GitHub"**
3. Confirm the logout

This clears:
- Stored GitHub access token
- Cached user information
- All pending OAuth states

## For Mobile Companion App

The mobile app uses the same OAuth flow but with different redirect URIs:

1. Configure the relay service URL in the app
2. The relay service handles token exchange
3. App stores tokens securely using platform APIs (Keychain/Keystore)

See the [Mobile Companion documentation](../mobile-companion/docs/auth.md) for mobile-specific setup.

## Related Documentation

- [Relay Protocol Specification](./relay-protocol.md) - Authentication flow details
- [WebSocket Server](./ws-server.md) - Token validation and client authentication
- [Mobile Companion](../mobile-companion/README.md) - Mobile app setup
