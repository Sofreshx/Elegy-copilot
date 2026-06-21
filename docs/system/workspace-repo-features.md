---
created: 2026-06-01
updated: 2026-06-21
category: system
status: current
doc_kind: node
id: workspace-repo-features
summary: Detailed description of workspace and repository management features in Elegy Copilot.
tags: [workspace, repo, features]
---

# Workspace & Repository Features

> Implemented: June 2026
> Updated: June 2026 (added session-status endpoint)
> Branch: feature/workspace-repo-assets-sessions-sqlite

## Overview

This document describes new workspace and repository management features added to Elegy Copilot.
The features focus on repo-specific agent/skill discovery, session/worktree lifecycle tracking,
SQLite state management, and code review integration.

---

## 1. SQLite State Management

### New Database: `~/.copilot/elegy-copilot.db`

Replaces scattered JSON file state with a unified SQLite database using `better-sqlite3` (v12.10+).

**Tables:**
- `sessions` — Agentic session records (source, harness, status, repo, worktree, model, plan)
- `worktrees` — Worktree tracking with status lifecycle (active, idle, done, cleaned)
- `session_worktrees` — Many-to-many junction linking sessions to worktrees
- `hook_events` — Lifecycle hook event log (session_start, session_end, worktree_create, worktree_remove)
- `repo_assets` — Per-repo agent/skill installation records per harness

**Backend module:** `copilot-ui/lib/elegyDb.js`
- Factory: `createElegyDb({ dbPath?, readonly? })`
- Migration system via `PRAGMA user_version`
- WAL journal mode enabled

**API endpoints:** (registered in `copilot-ui/routes/elegyDb.js`)
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/elegy-db/health` | DB health check (path, table count, version) |
| GET | `/api/elegy-db/sessions` | List sessions (filters: status, source, repoPath, worktreePath) |
| GET | `/api/elegy-db/sessions/:id` | Get session by ID |
| GET | `/api/elegy-db/worktrees` | List worktrees from SQLite (filters: status, source, repoPath) |
| GET | `/api/elegy-db/worktrees/:id` | Get worktree + linked sessions |
| GET | `/api/elegy-db/worktrees/enriched` | Enriched worktrees with session and hook event data |
| GET | `/api/elegy-db/worktrees/session-status` | Worktree session status (active sessions, session count, recent hook events) |
| GET | `/api/elegy-db/repo-assets` | Get repo-specific asset records |
| GET | `/api/elegy-db/hook-events` | List hook events (filters: hookType, sessionId, worktreeId) |
| GET | `/api/elegy-db/worktree-sessions` | Sessions linked to a worktree |
| GET | `/api/elegy-db/planning/summary` | Sessions with linked plan_id/goal_id |

**UI Integration:** Backend-only for now. Data is queryable via API. Frontend integration planned.

---

## 2. Repo Docs Tree with Folder Hierarchy

### What changed

Previously the docs panel showed a flat list of markdown files. Now it shows a proper folder tree.

**Backend:** `copilot-ui/routes/repoDocs.js`
- New endpoint: `GET /api/repo-docs/tree` returns a recursive tree structure
- Scans: `docs/specs/`, `docs/`, root `AGENTS.md`/`CLAUDE.md`/`GEMINI.md`, `skills/` dirs, `agents/` dirs
- Also scans harness config dirs: `.opencode/`, `.codex/`, `.copilot/`, `.gemini/`
- Each node has: name, path, kind (file/directory), children, fileKind (doc/agent/skill/config)
- Harness-tagged nodes show which harness they belong to

**Frontend:** `copilot-ui/ui/src/views/Workspace/WorkspaceDocsCenter.tsx`
- Recursive `DocTreeNode` component renders folders with expand/collapse
- Folders show icons by kind: specs (📋), docs (📄), skills (⚡), agents (🤖), harness (⊞)
- Files show icons by type: agent (🤖), skill (⚡), config (⚙)
- Harness badges on files from harness config directories
- Backward compatible: falls back to flat list if tree API fails

**UI Status:** ✅ Fully integrated in workspace Docs tab

**API endpoint:** `GET /api/repo-docs/tree?repoPath=...`

---

## 3. Workspace Repo Assets

### What changed

Repo-specific agents and skills are now discoverable and manageable within the Workspace area,
not buried in Settings.

**Backend:** `copilot-ui/routes/repoAssets.js`
- `GET /api/repo-assets/discover?repoPath=...` — Scans repo for agents/skills, checks SQLite for install status
- `POST /api/repo-assets/install` — Marks asset as installed for a harness in SQLite
- Returns per-harness installation status for each discovered asset

**Frontend:** `copilot-ui/ui/src/views/Workspace/WorkspaceAssetsTab.tsx`
- New "Assets" tab (🧩) in workspace area
- Shows all discovered agents/skills as cards
- Each card shows: name, kind badge, source harness badge, path
- Harness buttons: ⊞ OpenCode, ◈ Codex, ⚙ Copilot, ⬡ Antigravity
- Each harness button shows: installed (✓), available (+), or installing (⏳)
- Click uninstalled harness button to mark as installed (SQLite record)

**CSS:** Workspace asset cards with harness buttons, installed/adding states

**UI Status:** ✅ Fully integrated as workspace "Assets" tab

**Settings migration:** The "Repository Assets" button was removed from CatalogShellView with a migration note.

---

## 4. Session & Worktree Lifecycle Hooks

### What changed

New hook system tracks session start/end and updates worktree status in SQLite.

**Backend:** `copilot-ui/lib/sessionHooks.js`
- `createSessionHooks({ db?, dbPath? })` — Factory function
- `onSessionStart(session)` — Records session in DB, links to worktree, marks worktree active
- `onSessionEnd(session)` — Updates session status, decrements worktree session count, marks idle
- `onWorktreeCreate(worktree)` — Records worktree in DB
- `onWorktreeRemove(worktreePath)` — Marks worktree as done

**Integration points (in `copilot-ui/lib/executorService.js`):**
- Session creation: after `createSdkSession()` returns
- Session completion: in `_completeRun()`
- Session failure: in `_failRun()`
- Session cancellation: in `cancelRun()`
- Server shutdown: iterate all active runs in `shutdown()`

**Integration points (in `copilot-ui/routes/executor.js`):**
- Worktree removal: after successful `git worktree remove`

**Server startup (`copilot-ui/server.js`):**
- `sessionHooks` created with the shared `elegyDb` instance
- Passed to `createExecutorService` and through route dispatch context
- Closed on server shutdown alongside DB

**UI Status:** ⚠️ Backend-only. Session/worktree hook data is stored in SQLite and available via API, but not yet surfaced in the UI beyond the enriched worktree cards. Frontend integration pending.

---

## 5. Enhanced Worktree Cards

### What changed

Worktree cards in the workspace right rail now show enriched data from SQLite.

**Frontend:** `copilot-ui/ui/src/views/Workspace/WorkspaceWorktreesCard.tsx`
- Fetches enriched worktree data from `GET /api/elegy-db/worktrees/enriched`
- Shows session count badge when worktree has active sessions
- Shows enriched status from SQLite (active/idle/done)
- Merges executor worktree data with SQLite enrichment by path matching

**Code Review Button:**
- Each worktree row now has a "🔍 Review" button
- Navigates to the Review tab in the workspace
- The Review tab auto-selects the most active worktree for review

**CSS:** `.workspace-worktree-sessions` badge, `.workspace-worktree-code-review-btn`

**UI Status:** ✅ Session count badges visible. Code review button navigates to Review tab.

---

## 6. Code Review Area

### What changed

New dedicated "Review" tab in the workspace area for launching automated code reviews.

**Backend:** `copilot-ui/routes/codeReview.js`
- `GET /api/code-review/prepare` — Analyzes worktree: branch, diff stats, changed files
- `POST /api/code-review/launch` — Launches OpenCode or Codex with review context

**Frontend:** `copilot-ui/ui/src/views/Workspace/WorkspaceReviewTab.tsx`
- New "Review" tab (🔍) in workspace area
- Review target selection: Local Worktree or Pull Request (URL)
- Worktree selector shows all worktrees for the repo with session counts
- Diff preview shows changed files and diff stat before launching
- Harness selector: OpenCode (⊞) or Codex (◈)
- OpenCode lane selector: Quick, Standard, Spec, Project
- Launch button starts the CLI with appropriate context

**Launch behavior:**
- OpenCode: `opencode --lane <lane> --cwd <worktree> "Review..."`
- Codex: `codex "Review..."` in worktree directory
- CLI is spawned detached (same pattern as workspace launcher)

**UI Status:** ✅ Fully integrated as workspace "Review" tab
**Known limitation:** PR URL mode is a placeholder — no PR diff fetching yet.

---

## API Reference Summary

### New Endpoints

| Method | Path | Module | Purpose |
|--------|------|--------|---------|
| GET | `/api/elegy-db/health` | elegyDb.js | SQLite DB health check |
| GET | `/api/elegy-db/sessions` | elegyDb.js | List sessions with filters |
| GET | `/api/elegy-db/sessions/:id` | elegyDb.js | Get session detail |
| GET | `/api/elegy-db/worktrees` | elegyDb.js | List worktrees |
| GET | `/api/elegy-db/worktrees/:id` | elegyDb.js | Get worktree + sessions |
| GET | `/api/elegy-db/worktrees/enriched` | elegyDb.js | Enriched worktrees with sessions + hooks |
| GET | `/api/elegy-db/repo-assets` | elegyDb.js | Repo asset records |
| GET | `/api/elegy-db/hook-events` | elegyDb.js | Hook event log |
| GET | `/api/elegy-db/worktree-sessions` | elegyDb.js | Sessions per worktree |
| GET | `/api/elegy-db/planning/summary` | elegyDb.js | Planning-linked sessions |
| GET | `/api/repo-docs/tree` | repoDocs.js | Folder tree of repo docs |
| GET | `/api/repo-assets/discover` | repoAssets.js | Discover repo agents/skills |
| POST | `/api/repo-assets/install` | repoAssets.js | Install asset for harness |
| GET | `/api/code-review/prepare` | codeReview.js | Analyze review context |
| POST | `/api/code-review/launch` | codeReview.js | Launch code review CLI |

### Modified Endpoints

| Method | Path | Change |
|--------|------|--------|
| GET | `/api/repo-docs/list` | Unchanged (backward compatible) |
| GET | `/api/repo-docs/read` | Unchanged |
| GET | `/api/repo-docs/graph` | Unchanged |

---

## New/Modified Files

### Backend (copilot-ui/)
| File | Status | Purpose |
|------|--------|---------|
| `lib/elegyDb.js` | NEW | SQLite database module with migration + CRUD |
| `lib/sessionHooks.js` | NEW | Session lifecycle hooks (start/end/worktree) |
| `routes/elegyDb.js` | NEW | API routes for SQLite queries |
| `routes/repoAssets.js` | NEW | API routes for repo asset discovery/install |
| `routes/codeReview.js` | NEW | API routes for code review prep/launch |
| `routes/repoDocs.js` | MODIFIED | Added tree endpoint |
| `routes/index.js` | MODIFIED | Registered 4 new route modules |
| `routes/executor.js` | MODIFIED | Added worktree remove hook |
| `lib/executorService.js` | MODIFIED | 6 hook injection points |
| `server.js` | MODIFIED | DB/hooks init, dispatch, shutdown |
| `package.json` | MODIFIED | Added better-sqlite3 dependency |

### Frontend (copilot-ui/ui/src/)
| File | Status | Purpose |
|------|--------|---------|
| `lib/api/elegyDb.ts` | NEW | API client for elegy-db endpoints |
| `lib/api/repoAssets.ts` | NEW | API client for repo assets |
| `lib/api/index.ts` | MODIFIED | Export new API modules |
| `lib/api/repoDocs.ts` | MODIFIED | Added tree API types + function |
| `lib/types.ts` | MODIFIED | Added tree, asset, enriched worktree, code review types |
| `stores/navigation.ts` | MODIFIED | Added 'assets' and 'review' tabs |
| `views/Workspace/WorkspaceDocsCenter.tsx` | MODIFIED | Tree view with folders |
| `views/Workspace/WorkspaceAssetsTab.tsx` | NEW | Repo assets tab component |
| `views/Workspace/WorkspaceReviewTab.tsx` | NEW | Code review tab component |
| `views/Workspace/WorkspaceLocalTabs.tsx` | MODIFIED | Added Assets and Review tabs |
| `views/Workspace/WorkspaceView.tsx` | MODIFIED | Route new tabs |
| `views/Workspace/WorkspaceWorktreesCard.tsx` | MODIFIED | Enriched worktree data + review button |
| `views/Catalog/CatalogShellView.tsx` | MODIFIED | Removed repo assets button |
| `app.css` | MODIFIED | Tree, asset card, review tab styles |

---

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
| Code review launch button | ✅ Navigates to Review tab | Complete |
| Session lifecycle tracking | ❌ Backend only | Needs frontend |
| Hook event viewer | ❌ Backend only | Needs frontend |
| SQLite DB health dashboard | ❌ API only | Needs frontend |
| Planning-linked sessions view | ❌ API only | Needs frontend |

---

## Future Work / Gaps

### High Priority
1. **Session viewer** — Show live session data from SQLite in the workspace (which sessions are running on which worktrees)
2. **Hook event dashboard** — Visualize hook events in the UI for debugging/observability
3. **PR diff fetching** — Implement actual PR diff retrieval for the PR review mode

### Medium Priority
4. **Plan/goal linkage UI** — Show linked plans and goals on worktree cards (data already in SQLite)
5. **Worktree lifecycle timeline** — Visual timeline of worktree status changes from hook events
6. **Asset installation actions** — Actually copy/register agent/skill files for different harnesses (currently only records in SQLite)
7. **OpenCode Go workspace integration** — Track OpenCode Go workspace sessions in SQLite hooks

### Low Priority
8. **SQLite migration UI** — Admin panel for DB migrations and health
9. **Session-worktree graph** — Visual graph showing which sessions ran on which worktrees
