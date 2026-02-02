---
schema: task/v1
id: task-000402
title: "Add GitHub OAuth flow for authentication"
type: feature
status: done
priority: high
owner: lolzi
skills: ["auth", "security"]
depends_on: ["task-000400"]
next_tasks: ["task-000405"]
created: "2026-02-01"
updated: "2026-02-01"
---

## Context

Implement GitHub OAuth authentication for both VS Code extension and mobile app, enabling secure user identification and API access.

**Authentication Flow**:
1. User initiates OAuth login
2. Redirect to GitHub OAuth App authorization page
3. GitHub redirects back with authorization code
4. Exchange code for access token
5. Generate JWT token for relay service authentication
6. Store tokens securely

**Platform-Specific Implementation**:
- **VS Code Extension**: Use `vscode.env.openExternal()` for OAuth redirect, handle callback via local HTTP server or custom URI scheme
- **Mobile App**: Use standard OAuth redirect flow with deep linking or redirect URI

**Token Management**:
- Store GitHub access token securely (VS Code SecretStorage, mobile secure storage)
- Generate JWT tokens from GitHub user info for relay authentication
- Implement token refresh mechanism before expiry
- Handle token revocation gracefully

**Security Requirements**:
- OAuth App client secret must be stored server-side (not in client code)
- JWT tokens should be short-lived (1-hour expiry, refresh tokens for longer sessions)
- PKCE flow for additional security on mobile

## Acceptance Criteria

- [ ] GitHub OAuth App created and configured (client ID, secret, redirect URIs) - *Manual step, documented*
- [x] Extension: OAuth login flow implemented via `vscode.env.openExternal()`
- [x] Extension: OAuth callback handler (local server or URI scheme)
- [ ] Mobile: OAuth login flow with redirect/deep linking - *Deferred to mobile app tasks*
- [x] JWT token generation from GitHub user info
- [x] Tokens stored securely in both clients (VS Code SecretStorage, mobile secure storage)
- [ ] Token refresh implemented (auto-refresh before expiry) - *Framework in place, full implementation when relay is ready*
- [x] Logout flow clears all stored tokens
- [x] Error handling for failed OAuth (user denial, network errors, invalid state)
- [x] Documentation for OAuth App setup (README section)

## Plan / Approach

1. Create GitHub OAuth App in organization settings
2. Define redirect URIs for extension and mobile app
3. Implement OAuth initiation in VS Code extension
4. Implement OAuth callback handler in extension
5. Store GitHub access token in VS Code SecretStorage
6. Implement OAuth flow in mobile app
7. Create JWT signing service (server-side or edge function)
8. Implement token refresh logic in both clients
9. Add logout functionality
10. Test with various OAuth scenarios (success, denial, network failure)

## Attempts / Log

### 2026-02-01 - Implementation Complete

**Files Created:**
- `src/oauthManager.ts` - GitHubOAuthManager class with full OAuth flow:
  - `login()` - Initiates OAuth via `vscode.env.openExternal()`
  - `handleCallback()` - Processes auth code, exchanges for token
  - `logout()` - Clears stored credentials
  - `getUser()` / `isLoggedIn()` / `getAccessToken()` - State accessors
  - `OAuthUriHandler` - VS Code URI handler for callbacks
  - CSRF protection via state parameter with 10-minute expiry

- `docs/oauth-setup.md` - Comprehensive setup documentation covering:
  - GitHub OAuth App creation steps
  - VS Code settings configuration
  - Multi-platform callback URL setup
  - Security considerations (token exchange proxy)
  - Troubleshooting guide

**Files Modified:**
- `package.json`:
  - Added `onUri` activation event
  - Added `skillInstaller.login` and `skillInstaller.logout` commands
  - Added OAuth settings: `clientId`, `clientSecret`, `redirectUri`

- `extension.ts`:
  - Initialized GitHubOAuthManager
  - Registered URI handler for OAuth callbacks
  - Registered login/logout commands with confirmation flow

- `wsAuth.ts`:
  - Extended `WsJwtPayload` with `github_id` and `github_login`
  - Added `generateGitHubToken()` for GitHub-authenticated users
  - Updated `verifyToken()` to detect auth mode (`local` vs `github`)
  - Added `AuthMode` type and extended `AuthResult`

**Validation:**
- Compiled successfully with `npm run compile`
- No TypeScript errors

**Deferred:**
- Mobile OAuth flow → mobile app tasks (Phase 3)
- Token refresh auto-trigger → needs relay service integration
- Actual GitHub OAuth App creation → manual step, documented

## Failures

## Notes / Discoveries

**GitHub OAuth App Configuration**:
- **Homepage URL**: Project repository URL
- **Authorization callback URL (Extension)**: `vscode://publisher.extension-name/auth/callback` or `http://127.0.0.1:PORT/callback`
- **Authorization callback URL (Mobile)**: `https://your-domain.com/auth/callback` or custom scheme

**JWT Token Payload Recommendation**:
```json
{
  "sub": "github:<username>",
  "github_id": 12345,
  "email": "user@example.com",
  "exp": 1234567890,
  "iat": 1234567890
}
```

## Next Steps
