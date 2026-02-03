# Mobile Companion

The mobile companion is a Vite + React app that connects to the Instruction Engine relay and uses GitHub OAuth for sign-in.

## Prerequisites

- Node.js 20+
- A GitHub OAuth App
- The cloud relay service running locally or hosted

## GitHub OAuth Setup

1. Create a GitHub OAuth App at https://github.com/settings/developers
2. Set the Authorization callback URL to:
   - http://localhost:5173/auth/callback
3. Copy the Client ID (client secret stays on the relay server).

## Configure Environment Variables

Copy `.env.example` to `.env` and fill in values:

- `VITE_GITHUB_CLIENT_ID` (required)
- `VITE_GITHUB_REDIRECT_URI` (optional)
- `VITE_RELAY_HTTP_URL` (required for token exchange)
- `VITE_RELAY_WS_URL` (required for WebSocket updates)

## Relay Service Configuration

The relay exchanges the OAuth code for a token. Run the relay with these variables:

- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `GITHUB_REDIRECT_URI` (should match the mobile redirect URI)

Example (PowerShell):

```
$env:GITHUB_CLIENT_ID="your_client_id"
$env:GITHUB_CLIENT_SECRET="your_client_secret"
$env:GITHUB_REDIRECT_URI="http://localhost:5173/auth/callback"
```

## Run the App

```
npm install
npm run dev
```

Then open http://localhost:5173 and sign in with GitHub.

## Production Hosting Note

If you host the app as static files, ensure your host rewrites `/auth/callback` to `index.html` so the SPA can process the OAuth response.
