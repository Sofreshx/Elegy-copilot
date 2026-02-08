---
schema: task/v1
id: task-000449
title: "Fix mobile PWA: icons, error boundary, install prompt"
type: bugfix
status: done
priority: low
owner: ""
skills: ["frontend"]
group_id: "group-06-polish"
group_title: "Group 6: Polish"
group_order: 2
depends_on: []
next_tasks: []
plan: x-PLAN-artefact.md
created: "2026-02-08"
updated: "2026-02-08"
---

## Context
The PWA is missing required icons (only a placeholder.txt exists), has no error boundary, and no install prompt. The Settings page has hardcoded values.

- Read `mobile-companion/public/manifest.json` for icon references
- Read `mobile-companion/public/icons/` (only has placeholder.txt)
- Read `mobile-companion/src/App.tsx` for component tree

## Acceptance Criteria
- [x] PWA icons exist and manifest references them correctly
- [x] Error boundary catches crashes and shows recovery UI
- [x] Install prompt shows when PWA is installable
- [x] Settings page shows real connection status
- [x] No TypeScript errors

## Plan / Approach

1. Add `icon-192.png` and `icon-512.png` to `public/icons/` (generate from a simple Instruction Engine logo or use a placeholder)
2. Fix `manifest.json` `purpose: "any maskable"` → separate entries for `"any"` and `"maskable"`
3. Create `ErrorBoundary.tsx` React error boundary component, wrap root `App` component
4. Create `useInstallPrompt.ts` hook that captures `beforeinstallprompt` event and exposes `installApp()` function
5. Fix Settings page hardcoded "Connected" status → use actual relay connection status
6. Fix Settings page hardcoded version `0.1.0` → import from package.json

## Attempts / Log

### Attempt 1 — 2026-02-08 (Success)
1. Created `scripts/generate-icons.mjs` — generates 192x192 and 512x512 PNG icons with "IE" branding on indigo circle over dark background. Uses Node.js built-in `zlib` for PNG encoding (zero dependencies).
2. Generated `public/icons/icon-192.png` (1192 bytes) and `public/icons/icon-512.png` (6655 bytes).
3. Removed `public/icons/placeholder.txt`.
4. Fixed `manifest.json` — split `"purpose": "any maskable"` into separate entries for `"any"` and `"maskable"` (4 icon entries total).
5. Created `src/components/ErrorBoundary.tsx` — React class component with `getDerivedStateFromError` + `componentDidCatch`, recovery UI with "Try Again" (resets state) and "Go Home" (navigates to `/`) buttons.
6. Wrapped root app in `main.tsx` with `<ErrorBoundary>` (outside `QueryClientProvider` and `BrowserRouter` to catch errors in any provider).
7. Created `src/hooks/useInstallPrompt.ts` — captures `beforeinstallprompt`, exposes `{ isInstallable, installApp() }`.
8. Fixed `Settings.tsx`:
   - Replaced hardcoded "Connected" with live relay connection status via `getRelayConnection().onStatusChange()`.
   - Replaced hardcoded version `0.1.0` with dynamic `appPackage.version` from `package.json` JSON import.
   - Added "Install App" button (conditionally shown when `isInstallable` is true).
9. Added CSS for `.status-badge.offline` and `.install-button` in `Settings.css`.
10. Verified: `npx tsc --noEmit` — zero errors.

## Failures

## Notes / Discoveries

## Next Steps
