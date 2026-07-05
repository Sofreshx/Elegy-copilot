---
spec_id: obsidian-vault-notes
title: Obsidian Vault Notes
status: draft
type: feature
created: 2026-07-02
updated: 2026-07-02
---

# Obsidian Vault Notes

## Intent

Replace the SQLite-backed Notes tab with an Obsidian vault as primary storage, add local git versioning (manual commits), and add Google Drive sync via rclone so notes are accessible on phone via the Obsidian mobile app.

## Context Evidence

- `copilot-ui/lib/vaultBackend.js` — file-based CRUD over `.md` files with YAML frontmatter
- `copilot-ui/lib/vaultGit.js` — git wrapper (init, status, commit, log, diff)
- `copilot-ui/lib/vaultDriveSync.js` — rclone-based Google Drive sync
- `copilot-ui/lib/vaultConfig.js` — config resolution from `~/.elegy/obsidian-vault.json`
- `copilot-ui/routes/notes.js` — all notes API routes
- `copilot-ui/ui/src/lib/api/notes.ts` — frontend API types and functions
- `copilot-ui/ui/src/views/Workspace/WorkspaceNotesTab.tsx` — notes tab with vault/git/drive controls
- `copilot-ui/ui/src/views/Settings/NotesSettingsView.tsx` — settings page with vault/git/drive config

## Design

### Vault File Format

Each note is a `.md` file with YAML frontmatter:

```yaml
---
id: my-note-slug
title: My Note
theme: Projects
tags:
  - research
  - idea
created: 2026-07-02T10:00:00.000Z
updated: 2026-07-02T12:00:00.000Z
archived: false
---

# My Note

Note body content here...
```

Rules:
- `id` is derived from the filename slug (e.g., `My-Note.md` becomes `my-note`)
- `title` is the human-readable title
- `theme` is derived from the parent directory name (e.g., `Projects/My-Note.md` becomes `Projects`)
- `tags` is a YAML array (parsed from `[tag1, tag2]` syntax or newline-separated)
- `created` and `updated` are ISO timestamps
- `archived` is a boolean (default: false)
- Body starts after `---` separator (leading newlines stripped)

### File Organization

The vault root (e.g., `C:/Users/lolzi/Documents/Dev`) contains subdirectories:

```
Dev/
  Projects/
    Project-Alpha.md
  Research/
    AI-Notes.md
  Tasks/
    Current-Sprint.md
  Resources/
    Useful-Links.md
  Index.md
```

The `theme` field in frontmatter corresponds to the parent directory name.

### Search and Filtering

Search is substring-based across title, tags, theme, and content (no fuzzy search).

Filtering supports:
- `theme` — exact match on parent directory name
- `tag` — substring match on tags array

### Git Versioning

Git is initialized in the vault root. Operations:
- `git status` — list modified/added/deleted/untracked files
- `git commit` — commit specific files or all changes with a message
- `git log` — last N commits with messages
- `git diff` — unified diff for all changes or specific files

Rules:
- Git is manual only (no auto-commits)
- `.gitignore` excludes: `.obsidian/workspace.json`, `.trash/`, `*.conflict.*.md`, `node_modules/`
- Commits are per-file (one commit per note change)

### Google Drive Sync (via rclone)

rclone handles all OAuth and sync complexity. No Google Cloud Console setup needed.

Setup:
1. Install rclone: `winget install rclone` (Windows) or `brew install rclone` (Mac)
2. Run `rclone config` to create remote named `DevVault` and follow browser auth

Sync operations:
- Push: `rclone sync <vault> <remote>:<folder> --backup-dir <remote>:<folder>_conflicts/<date>`
- Pull: `rclone sync <remote>:<folder> <vault> --backup-dir <vault>/_conflicts/<date>`
- Status: `rclone about <remote>:<folder>` (checks existence)
- Auth: `rclone config` (interactive setup, one-time)

Conflict handling: both push and pull use `--backup-dir` to preserve conflicting files with timestamps.

### Config

Config lives at `~/.elegy/obsidian-vault.json`:

```json
{
  "vaultPath": "C:/Users/lolzi/Documents/Dev",
  "git": {
    "enabled": true,
    "autoCommit": false
  },
  "gdrive": {
    "enabled": true,
    "remoteFolderName": "Dev-Vault-Backup",
    "rcloneRemote": "DevVault"
  }
}
```

Environment overrides:
- `IE_VAULT_PATH` — vault root path
- `IE_GIT_ENABLED` — enable git operations
- `IE_GDRIVE_ENABLED` — enable Google Drive sync

### API Routes

| Method | Endpoint | Contract |
|--------|----------|----------|
| `GET` | `/api/notes` | List notes (query: `search`, `tag`, `theme`, `limit`, `offset`) |
| `POST` | `/api/notes` | Create note (body: `{ title, content?, tags?, theme? }`) |
| `GET` | `/api/notes/:id` | Get note by ID |
| `PUT` | `/api/notes/:id` | Update note (body: `{ title?, content?, tags?, theme? }`) |
| `DELETE` | `/api/notes/:id` | Delete note |
| `GET` | `/api/notes/vault/status` | Vault status (path, git, gdrive, rclone) |
| `POST` | `/api/notes/git/init` | Initialize git in vault |
| `GET` | `/api/notes/git/status` | Git status (modified, added, deleted, untracked) |
| `POST` | `/api/notes/git/commit` | Commit changes (body: `{ files?: string[], message }`) |
| `GET` | `/api/notes/git/log` | Git log (query: `limit`) |
| `POST` | `/api/notes/git/diff` | Git diff (body: `{ file?: string }`) |
| `POST` | `/api/notes/drive/push` | Push to Google Drive via rclone |
| `POST` | `/api/notes/drive/pull` | Pull from Google Drive via rclone |
| `GET` | `/api/notes/drive/status` | Drive sync status (rclone installed, remote configured, etc.) |

## Requirements

### Allowed Behavior

- CRUD operations on `.md` files with YAML frontmatter
- Git init, status, commit, log, diff operations
- rclone-based Google Drive sync (push/pull/status)
- Config resolution from `~/.elegy/obsidian-vault.json` with env overrides
- Windows path handling (forward slashes for Node.js, WSL conversion when running on Linux)

### Forbidden Behavior

- No fuzzy search (substring only)
- No automatic git commits
- No direct Google Drive API integration (use rclone)
- No migration from old SQLite notes
- No agent run blocks (deferred for now)

### Non-Goals

- Real-time collaboration
- Conflict resolution beyond backup-dir preservation
- Automatic sync on note changes
- Custom note viewers (use Obsidian mobile app)

## Acceptance Checks

- [ ] Create a note — `.md` file appears in vault with correct frontmatter
- [ ] Read a note — frontmatter parsed correctly, body starts after `---`
- [ ] Search notes — substring match across title, tags, theme, content
- [ ] Git status — shows modified/added/deleted files
- [ ] Git commit — creates commit with correct message
- [ ] rclone push — vault synced to Google Drive
- [ ] rclone pull — Google Drive synced to vault
- [ ] Phone access — Obsidian mobile app opens vault from Google Drive

## Implementation Links

- `copilot-ui/lib/vaultBackend.js`
- `copilot-ui/lib/vaultGit.js`
- `copilot-ui/lib/vaultDriveSync.js`
- `copilot-ui/lib/vaultConfig.js`
- `copilot-ui/routes/notes.js`
- `copilot-ui/ui/src/lib/api/notes.ts`
- `copilot-ui/ui/src/views/Workspace/WorkspaceNotesTab.tsx`
- `copilot-ui/ui/src/views/Settings/NotesSettingsView.tsx`

## Validation Evidence

- Backend integration tests: 20/20 passing
- Vault path detection: verified
- Git operations: verified
- rclone detection: returns `null` when not installed (expected)

## Drift Notes

- Agent run blocks (`note_blocks`) are stubbed out — not yet implemented
- The old SQLite-backed notes are NOT migrated — only vault notes are supported
- rclone is not installed on the machine — user needs to run `winget install rclone`
