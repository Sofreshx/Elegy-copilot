# Mobile Companion

The mobile companion is a Vite + React app that connects to the Instruction Engine relay and uses GitHub OAuth for sign-in.

## Prerequisites

- Node.js 20+
- A GitHub OAuth App
- The cloud relay service running locally or hosted

## GitHub OAuth Setup

1. Create a GitHub OAuth App at https://github.com/settings/developers
2. Set the Authorization callback URL to:
   - http://localhost:5173/auth/callback (local dev)
   - https://your-mobile-domain/auth/callback (production PWA domain)
3. Copy the Client ID (client secret stays on the relay server).

## Configure Environment Variables

Copy `.env.example` to `.env` and fill in values:

- `VITE_GITHUB_CLIENT_ID` (required)
- `VITE_GITHUB_REDIRECT_URI` (optional)
- `VITE_RELAY_HTTP_URL` (required for token exchange)
- `VITE_RELAY_WS_URL` (required for WebSocket updates, include `/v1/ws`)

Production example (hosted PWA + shared relay):

- `VITE_GITHUB_REDIRECT_URI=https://your-mobile-domain/auth/callback`
- `VITE_RELAY_HTTP_URL=https://relay.sfrsh.xyz`
- `VITE_RELAY_WS_URL=wss://relay.sfrsh.xyz/v1/ws`

Deployment variable mapping (build-time):

- `OAUTH_CLIENT_ID` -> `VITE_GITHUB_CLIENT_ID`
- `RELAY_HTTP_URL` -> `VITE_RELAY_HTTP_URL`
- `RELAY_WS_URL` -> `VITE_RELAY_WS_URL`

Note: the client appends `?token=...` when connecting, so do not include a query string in `VITE_RELAY_WS_URL`.

## Relay Service Configuration

The relay exchanges the OAuth code for a token. Run the relay with these variables:

- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `GITHUB_REDIRECT_URI` (must match `VITE_GITHUB_REDIRECT_URI`)
- `JWT_SECRET` (store as `RELAY_JWT_SECRET` in deployment secrets)

Example (PowerShell):

```
$env:GITHUB_CLIENT_ID="your_client_id"
$env:GITHUB_CLIENT_SECRET="your_client_secret"
$env:GITHUB_REDIRECT_URI="http://localhost:5173/auth/callback"
```

For production with the shared relay, set `GITHUB_REDIRECT_URI` to your PWA callback
URL (for example, `https://your-mobile-domain/auth/callback`).

## Run the App

```
npm install
npm run dev
```

Then open http://localhost:5173 and sign in with GitHub.

## Production Hosting Note

When hosting on Cloudflare (or any static host), ensure your host rewrites `/auth/callback` to `index.html` so the SPA can process the OAuth response.
Set the OAuth callback URL to the hosted domain, for example `https://your-mobile-domain/auth/callback`.
If you host the PWA on the relay domain, make sure the relay front-end serves the SPA
for `GET /auth/callback` (the relay API only exposes POST `/auth/callback` for token
exchange).
