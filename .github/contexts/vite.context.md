---
description: "Context: Vite build tool configuration."
---

# Vite Context

## Overview
Next Generation Frontend Tooling.

## Configuration
- **Config File**: `vite.config.ts`.
- **Plugins**: Use `@vitejs/plugin-react` for React support.

## Features
- **HMR**: Hot Module Replacement (enabled by default).
- **Env Variables**: Prefix with `VITE_` to expose to client.
- **Proxy**: Configure `server.proxy` to avoid CORS in dev.

## Commands
- `npm run dev`: Start dev server.
- `npm run build`: Build for production.
- `npm run preview`: Preview production build.
