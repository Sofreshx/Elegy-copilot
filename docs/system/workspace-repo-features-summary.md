# Workspace & Repository Features — Summary

> Implemented: June 2026
> Branch: feature/workspace-repo-assets-sessions-sqlite

## Six Features

- **SQLite State Management** — Unified `~/.copilot/elegy-copilot.db` with 5 tables (sessions, worktrees, session_worktrees, hook_events, repo_assets) and 10 API endpoints. Backend-only; frontend integration planned.
- **Repo Docs Tree with Folder Hierarchy** — Recursive folder tree API (`GET /api/repo-docs/tree`) and `DocTreeNode` component replacing the flat doc list. Renders harness-tagged nodes with icons and badges.
- **Workspace Repo Assets** — Discover and install repo-specific agents/skills per harness (OpenCode, Codex, Copilot, Antigravity) via the new Assets tab and `POST /api/repo-assets/install`.
- **Session & Worktree Lifecycle Hooks** — `sessionHooks.js` factory with 4 hook functions (onSessionStart, onSessionEnd, onWorktreeCreate, onWorktreeRemove) integrated into executor service and worktree removal. Backend-only.
- **Enhanced Worktree Cards** — Enriched worktree data with session count badges and SQLite status. Code Review placeholder button on each worktree row.
- **Code Review Area** — New Review tab with worktree/PR target selection, diff preview, harness/lane selector, and CLI launch for OpenCode or Codex.

## UI Feature Matrix

| Feature | UI Visible | Status |
|---------|-----------|--------|
| Folder docs tree | ✅ Workspace > Docs tab | Complete |
| Harness badges on docs | ✅ In tree nodes | Complete |
| Repo assets tab | ✅ Workspace > Assets tab | Complete |
| Asset harness install buttons | ✅ In asset cards | Complete |
| Code review tab | ✅ Workspace > Review tab | Complete |
| Review harness/lane selector | ✅ In review tab | Complete |
| Worktree session count badge | ✅ In worktree cards | Complete |
| Code review launch button | ⚠️ Placeholder alert | Needs wiring |
| Session lifecycle tracking | ❌ Backend only | Needs frontend |
| Hook event viewer | ❌ Backend only | Needs frontend |
| SQLite DB health dashboard | ❌ API only | Needs frontend |
| Planning-linked sessions view | ❌ API only | Needs frontend |

## Top 4 Future Work Items

1. **Wire code review button** — Connect worktree card review button to the Review tab with pre-selected worktree
2. **Session viewer** — Show live session data from SQLite in the workspace
3. **Hook event dashboard** — Visualize hook events in the UI for debugging/observability
4. **PR diff fetching** — Implement actual PR diff retrieval for the PR review mode

---

Full document: `docs/system/workspace-repo-features.md`
