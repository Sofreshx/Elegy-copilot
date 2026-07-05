---
created: 2026-03-23
updated: 2026-06-29
category: system
status: current
doc_kind: node
id: obsidian-synced-notes-contract
summary: Contract for the external/non-canonical Obsidian planning note surface exposed through copilot-ui.
tags: [planning, obsidian, notes, contracts]
related: [planning-backlog-roadmap-contract, copilot-ui-guide, session-state-artifacts]
---

# Obsidian Synced Notes Contract

## Purpose

Define the local configuration, API shape, authority boundary, and repo-context expectations for
Obsidian-backed planning notes surfaced inside `copilot-ui`.

> **Note:** This contract governs the **planning surface** (external, non-canonical notes).
> For the **primary vault-backed Notes tab** (replacing SQLite), see
> [[obsidian-vault-notes](../specs/obsidian-vault-notes/spec.md)].

## Authority boundary

Obsidian notes are an **external, non-canonical** planning surface.

They may:

- provide operator context inside the Planning tab
- help seed a local session `plan.md`
- preserve explicit synced-note provenance for seeded plans
- suggest canonical backlog items or add items to the selected roadmap through explicit operator actions
- host deterministic mirror notes for canonical planning bullets and roadmap docs

They must not:

- override `~/.elegy/backlogs/{repo-name}/planning/bullets.md`
- override `~/.elegy/backlogs/{repo-name}/planning/intake/*.json`
- override `~/.elegy/backlogs/{repo-name}/backlogs/*.md`
- override roadmap folder indexes under `~/.elegy/backlogs/{repo-name}/roadmaps/*/index.md`
- become the canonical execution authority instead of the active session `plan.md`
- use note bodies or mirror edits as canonical write authority for repo planning docs

### Clarification: Docs Vault vs Planning Mirror

This contract governs the **planning surface** exposed inside
`copilot-ui` — external, non-canonical Obsidian notes used for backlog
seeding, mirror generation, and operator context.

It does NOT govern using Obsidian as a viewer/editor over canonical repo
documentation (`docs/system/**`, `docs/research/**`, `docs/specs/**`). That
workflow — opening a repo folder directly as an Obsidian vault with the
repo retaining full authority — is covered by the
[[repo-backed-obsidian-docs]]
[repo-backed-obsidian-docs.md](repo-backed-obsidian-docs.md)
contract.

The distinction:
- **Docs vault** ([[repo-backed-obsidian-docs]]
  [repo-backed-obsidian-docs.md](repo-backed-obsidian-docs.md)):
  Obsidian is a local editor/viewer over canonical repo docs. Git is the
  authority.
- **Planning mirror** (this contract): Obsidian hosts external,
  non-canonical planning notes. `copilot-ui` and `~/.elegy/backlogs/`
  are the authority.

## Repo context

`copilot-ui` MUST reuse the selected Catalog repo as the repo-context source for this surface.

- no second repo selector
- no separate note-authority registry
- no implicit cross-repo note mutation

The default note-folder resolution is repo-contextual through `notesPathTemplate`, which supports:

- `{repoId}`
- `{repoLabel}`

Example:

- `Planning/{repoId}`
- `Planning/{repoLabel}`

Tracker-synced note source records are resolved from the tracker source registry. Local Obsidian config
remains the authority for vault path, notes path template, CLI commands, remote sync settings, and
other runtime behavior.

Repo-scoped active source selection is persisted under `~/.elegy/obsidian-sync/` as local runtime
state. Source-placeholder remote sync never binds implicitly: if the configured URL depends on source
fields, operators must explicitly select a tracker source even when only one source record exists.

## Local configuration

Default file:

- `~/.elegy/obsidian-planning.json`

Environment overrides:

- `IE_OBSIDIAN_CONFIG_PATH` (legacy alias: `INSTRUCTION_ENGINE_OBSIDIAN_CONFIG_PATH`)
- `IE_OBSIDIAN_VAULT_PATH` (legacy alias: `INSTRUCTION_ENGINE_OBSIDIAN_VAULT_PATH`)
- `IE_OBSIDIAN_NOTES_PATH_TEMPLATE` (legacy alias: `INSTRUCTION_ENGINE_OBSIDIAN_NOTES_PATH_TEMPLATE`)
- `IE_OBSIDIAN_CLI_PATH` (legacy alias: `INSTRUCTION_ENGINE_OBSIDIAN_CLI_PATH`)
- `IE_OBSIDIAN_REMOTE_SYNC_URL`
- `IE_OBSIDIAN_REMOTE_SYNC_POLL_INTERVAL_MS`
- `IE_OBSIDIAN_REMOTE_SYNC_TIMEOUT_MS`
- `IE_OBSIDIAN_REMOTE_SYNC_TOKEN_ENV`

Legacy `INSTRUCTION_ENGINE_OBSIDIAN_*` aliases are retained only for the four path/template settings
above. Remote sync settings use the `IE_OBSIDIAN_*` names.

Canonical file shape:

```json
{
  "vaultPath": "C:/Users/example/Documents/PlanningVault",
  "notesPathTemplate": "Planning/{repoId}",
  "cliPath": "C:/Tools/obsidian-cli.exe",
  "cliCommands": {
    "probe": ["C:/Program Files/nodejs/node.exe", "-e", "process.exit(0)"],
    "refreshInventory": ["C:/Tools/obsidian-cli.exe", "refresh"],
    "syncStatus": ["C:/Tools/obsidian-cli.exe", "sync-status"],
    "manualSync": ["C:/Tools/obsidian-cli.exe", "pull"]
  },
  "remoteSyncUrl": "https://notes.example.net/feed?repoId={repoId}",
  "remoteSyncPollIntervalMs": 60000,
  "remoteSyncTimeoutMs": 15000,
  "remoteSyncAuthTokenEnv": "IE_OBSIDIAN_REMOTE_SYNC_TOKEN"
}
```

Rules:

1. `vaultPath` is required for read availability.
2. `notesPathTemplate` is vault-relative, must not contain `..`, and may interpolate `{repoId}` and
   `{repoLabel}` from the selected Catalog repo context.
3. `cliCommands` define the local CLI seam. `manualSyncCommand` and top-level `syncCommand` are accepted
   backward-compatible aliases for `cliCommands.manualSync`.
4. `remoteSyncUrl` is optional and pull-only. Request construction supports `{repoId}`, `{repoLabel}`,
   `{repoPath}`, `{cursor}`, `{sourceId}`, `{provider}`, `{host}`, `{owner}`, `{repo}`, `{branch}`,
   and `{notesPath}` placeholders. When source placeholders are used, sync requires an explicit
   selected tracker source for the current repo; there is no implicit singleton binding. When repo
   fields are not already represented in the URL, the client appends `repoId`, `repoLabel`, and a
   non-empty `cursor` query param automatically; an existing `repoPath=` query param is rewritten to
   the selected repo path when present, and existing source query params are rewritten from the
   effective selected source when present.
5. Remote feed payloads may use `notes` or `items`, `nextCursor` or `cursor`, and note entries may use
   `notePath` or `path`. `deleted: true` requests safe local deletion.
6. `remoteSyncAuthTokenEnv` may name an environment variable that contains a bearer token. No secrets or
   tokens belong in this config.
7. Source records are not configured in `obsidian-planning.json`; they come from the tracker synced-note
   source registry.

## Backend routes

| Method | Endpoint | Contract |
| --- | --- | --- |
| `GET` | `/api/planning/obsidian/status` | Returns deterministic config/read/sync availability for the selected repo context |
| `GET` | `/api/planning/obsidian/notes` | Returns deterministic note summaries or an unavailable/not-configured state |
| `GET` | `/api/planning/obsidian/notes/:noteId` | Returns one deterministic note detail or a fail-closed error |
| `POST` | `/api/planning/obsidian/sync` | Triggers a pull-only sync, applies safe local note updates, and returns additive sync status |
| `POST` | `/api/planning/obsidian/source-selection` | Persists or clears the repo-scoped active tracker synced-note source selection |
| `GET` | `/api/planning/obsidian/representations/status` | Returns aggregated deterministic status/freshness counts for canonical bullets/roadmap mirror notes |
| `GET` | `/api/planning/obsidian/representations` | Lists deterministic Obsidian mirror notes for canonical bullets and roadmaps in the selected repo |
| `POST` | `/api/planning/obsidian/representations/refresh` | Regenerates deterministic mirror notes from canonical repo artifacts; malformed metadata fails closed |

`status` responses now include:

- `cli`: probe/configuration state for the configured CLI seam
- `sourceResolution`: tracker source availability, repo-scoped active selection, effective source,
  and whether explicit selection is required before sync is available
- `remoteSync`: pull-loop/manual-sync status, timestamps, counts, conflict state, cooldown/backoff,
  lease metadata, and stale-lease recovery timestamps

Persistent sync state lives under `~/.elegy/obsidian-sync/` and remains non-canonical runtime state.
That runtime state includes repo-scoped source selection plus per-repo sync cursors, summaries, and
lease files.

Deterministic planning mirror notes live under the selected repo's resolved Obsidian note folder in a
tool-managed subdirectory:

- _elegy-copilot/planning-mirrors/bullets.md
- `_elegy-copilot/planning-mirrors/roadmaps/<roadmap-slug>.md`

Those note paths are deterministic, repo-scoped, and remain external/non-canonical.

## Mirror note rules

Planning mirrors are a SAFE representation of canonical repo docs, not a second planning authority.

Rules:

1. Bullets mirrors are generated from `~/.elegy/backlogs/{repo-name}/planning/bullets.md`.
2. Roadmap mirrors are generated one-per-slug from roadmap folder indexes under
   `~/.elegy/backlogs/{repo-name}/roadmaps/*/index.md`; legacy single-file roadmaps may still be
   mirrored as compatibility inputs.
3. Mirror frontmatter MUST include explicit non-canonical provenance and enough metadata for freshness
   checks.
4. Freshness may compare canonical source metadata or deterministic hashes, but mirror content must not
   be parsed back into canonical backlog/roadmap/bullets authority.
5. If mirror metadata is malformed or would require an unsafe overwrite, refresh MUST fail closed.
6. If a canonical source file is absent, the mirror should surface that source-missing state explicitly
   rather than invent fallback authority.

## Pull feed expectations

The remote service is outside this repo, but `copilot-ui` expects a pull-only JSON feed shaped like:

```json
{
  "nextCursor": "cursor-002",
  "notes": [
    {
      "notePath": "daily-sync.md",
      "content": "# Daily sync\n\nPulled from the remote feed.",
      "lastModifiedAt": "2026-03-23T10:00:00.000Z"
    }
  ]
}
```

Rules:

1. `notePath` is relative to the selected repo's resolved `notesPathTemplate` directory.
2. `deleted: true` may be used to request safe local deletion.
3. local files with unsynced edits must fail closed and surface `conflict` instead of being overwritten.
4. the cursor persisted under `~/.elegy/obsidian-sync/` is reused for timer polls and manual syncs.
5. this repo only implements the local client, status persistence, and polling loop.

## Sync safety rules

Remote sync remains local, pull-only, and fail-closed.

Rules:

1. Each repo sync acquires a file-backed lease under `~/.elegy/obsidian-sync/` before any local note
   mutation runs.
2. Stale lease recovery is explicit and bounded; active leases block overlapping sync work instead of
   allowing concurrent mutation.
3. Timer sync respects cooldown and retry/backoff state, and that metadata is surfaced in status.
4. Conflicting local note edits fail closed and surface conflict metadata instead of being overwritten.
5. Source-placeholder remote sync requires a resolved selected tracker source for the current repo.

## UI rules

Planning must label this surface as:

- external
- non-canonical

The primary note viewer may use this surface, but legacy planning-record research notes remain
compatibility-only.

Planning also surfaces deterministic mirror freshness/actions for canonical bullets and roadmap docs.
Those mirrors must be labeled as generated representations, not authoring surfaces.

## Seeding and promotion rules

When a plan is seeded from an Obsidian note:

1. the local linked plan session source MUST be `seed-from-synced-note`
2. the origin kind MUST remain `synced-note`
3. the note id/title should stay attached as provenance metadata
4. the plan body should remind operators to promote durable decisions into canonical repo docs or the
   active session plan

Operators may also explicitly promote an external note into canonical planning docs.

Rules:

1. Suggesting a backlog item or adding an item to the selected roadmap is an explicit operator action,
   never an implicit sync side effect.
2. Promotions must preserve synced-note provenance in the canonical repo artifact they create or update.
3. After promotion, canonical authority lives in repo docs and does not flow back from the note body.

## Out of scope in this block

- push sync
- webhook-driven updates
- automatic or heuristic promotion from note content into canonical repo planning docs
- using note bodies or mirror notes as a canonical write path
- changing top-level tabs or repo-authority rules
