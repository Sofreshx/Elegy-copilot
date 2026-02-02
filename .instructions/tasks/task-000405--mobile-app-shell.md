---
schema: task/v1
id: task-000405
title: "Create mobile app shell and navigation"
type: feature
status: done
priority: high
owner: "lolzi"
skills: ["frontend", "react-query"]
depends_on: ["task-000402"]
next_tasks: ["task-000406", "task-000407", "task-000408", "task-000409", "task-000410", "task-000411"]
created: "2026-02-01"
updated: "2026-02-01"
completed: "2026-02-01"
---

## Context

Create the foundational mobile app shell for the mobile companion. This is a Progressive Web App (PWA) built with React + TypeScript + Vite in a new `mobile-companion/` folder.

The app provides 5 main navigation tabs:
1. **Dashboard** - Client overview and status
2. **Sessions** - Agent session control
3. **Ideas** - Feature/task drafting
4. **AI Chat** - Direct AI conversation
5. **Settings** - Configuration and auth

Requires WebSocket connection to the relay service and GitHub OAuth for authentication.

Part of Phase 3 from `.instructions/artefacts/mobile-companion-PLAN-artefact.md`.

## Acceptance Criteria

- [x] React app scaffolded with Vite in `mobile-companion/` folder
- [x] TypeScript configured with strict mode
- [x] Bottom navigation bar with 5 tabs (Dashboard, Sessions, Ideas, AI Chat, Settings)
- [x] PWA manifest with app metadata and icons
- [x] Service worker for offline capability
- [x] WebSocket connection manager for relay communication
- [x] GitHub OAuth login flow integrated
- [x] Authentication state management
- [x] Responsive layout for mobile and tablet
- [x] Basic routing between tabs

## Plan / Approach

1. **Scaffold app**:
   - Run `npm create vite@latest mobile-companion -- --template react-ts`
   - Configure Vite for PWA with `vite-plugin-pwa`
   - Set up folder structure: `src/components/`, `src/pages/`, `src/services/`, `src/hooks/`

2. **Navigation**:
   - Install React Router DOM
   - Create `BottomNav` component with 5 tabs
   - Set up routes for each main view
   - Add tab icons and active state styling

3. **PWA Setup**:
   - Create `manifest.json` with app name, icons, theme colors
   - Configure service worker with offline fallback
   - Add PWA install prompt

4. **WebSocket Connection**:
   - Create `RelayConnection` service class
   - Implement reconnection logic with exponential backoff
   - Add connection status indicator in UI
   - Handle authentication token in WebSocket handshake

5. **GitHub OAuth**:
   - Create `AuthService` with GitHub OAuth flow
   - Store tokens in secure storage (localStorage with encryption consideration)
   - Add login screen/modal
   - Protect routes requiring authentication

6. **State Management**:
   - Set up React Query for server state
   - Create auth context for user session
   - Create WebSocket context for connection state

## Attempts / Log

**2026-02-01**: Initial implementation complete.

Created `mobile-companion/` React PWA with full project structure:
- **Build config**: `package.json`, `tsconfig.json` (strict mode), `vite.config.ts` with PWA plugin
- **PWA**: `public/manifest.json`, service worker via vite-plugin-pwa, placeholder icons folder
- **Entry**: `index.html`, `src/main.tsx`, `src/App.tsx` with routing and auth gating
- **Styles**: `src/index.css` (CSS vars, base styles), `src/App.css` (layout, login, cards)
- **Navigation**: `src/components/BottomNav.tsx` - 5-tab nav with SVG icons
- **Pages**: Dashboard, Sessions, Ideas, AiChat, Settings - all with placeholder content
- **Services**: 
  - `relayConnection.ts` - WebSocket manager with reconnect logic, exponential backoff
  - `authService.ts` - GitHub OAuth flow, token storage, user fetch
- **State**: `AuthContext.tsx` + `useAuth.ts` hook for app-wide auth

Dependencies: react, react-dom, react-router-dom, @tanstack/react-query, vite-plugin-pwa

Build verified: `npm run build` passes, PWA service worker generated.

## Failures

_Document any blockers or failed approaches_

## Notes / Discoveries

- Consider using Zustand or Context API for lightweight client state
- WebSocket token should match the relay's authentication scheme
- PWA service worker caching strategy: network-first for API, cache-first for assets
- GitHub OAuth redirect URI must be configured in GitHub app settings

## Next Steps

Once complete, this unblocks:
- task-000406 (client management view)
- task-000407 (session control panel)
- task-000408 (idea drafting system)
- task-000409 (AI chat interface)
- task-000410 (settings screen)
- task-000411 (notifications system)
