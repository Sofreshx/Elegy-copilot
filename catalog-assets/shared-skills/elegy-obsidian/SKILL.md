---
name: elegy-obsidian
description: "Foundation skill for read/write/search operations against a local Obsidian vault via the official Obsidian Desktop CLI (v1.12+). Non-authoritative convenience layer; durable planning state continues to flow through elegy-planning and SQLite. Triggers on: obsidian, vault, notes, daily, tag, search, task, non-authoritative-mirror, elegy."
metadata: {"aliasKeys":["obsidian","obsidian-cli","elegy-obsidian"],"stacks":["vault","notes"],"tags":["obsidian","vault","notes","search","tasks","tags","elegy","non-authoritative-mirror"]}
---

# Elegy Obsidian

## Purpose

`elegy-obsidian` is a thin convenience layer that wraps the official
`obsidian` CLI shipped with Obsidian Desktop 1.12+. It is a foundation
surface only; it deliberately does **not** mirror, attach, resolve, or
list Obsidian vault state into the Elegy planning authority. That work
belongs to a future `elegy-planning obsidian ...` Rust subcommand set.

Obsidian is treated as a **non-authoritative** mirror:

- The official `obsidian` CLI is a black-box process boundary; the
  skill does not parse or normalize its output into an Elegy
  planning schema.
- Durable cross-session state continues to live in `elegy-planning`
  (goals, roadmaps, plans, todos, issues, review points) backed by
  SQLite.
- Vault reads, file appends, and search results must not be written
  into paths that would shadow planning authority (for example,
  `.copilot/backlogs/`, `roadmaps/`, or any spec/ADR location owned
  by another skill).

## Prerequisite

The official `obsidian` binary must be available on PATH. It is shipped
with Obsidian Desktop 1.12+; the CLI is not enabled by default.

If the `obsidian` CLI is not installed, this skill cannot function --
inform the user and offer to install Obsidian Desktop or enable the
CLI in Obsidian Settings -> General -> "Open and close" or
"Command line interface" (depending on platform build).

## Installation

### Enable the official `obsidian` CLI

1. Install Obsidian Desktop 1.12 or later from
   <https://obsidian.md/download>.
2. In Obsidian, open **Settings -> General** and enable
   **Command line interface** (also exposed under
   **Settings -> General -> Advanced -> Command line interface** on
   some builds).
3. Verify the CLI:
   ```bash
   obsidian version
   obsidian help
   ```
4. The CLI uses `key=value` arguments and the active vault by
   default; pass `vault=<name>` to target a specific vault.

### No `elegy-obsidian` binary

This skill does **not** ship an executable. It is a routing and
convention layer over the official `obsidian` CLI. The Elegy wrapper
archive (`elegy-obsidian-wrapper-*.zip`) contains only governance
fixtures, the skill content, and the `delegatesTo.externalExecutable`
declaration; it does not contain an `obsidian` binary.

## Core Commands (official `obsidian` CLI v1.12+)

```text
obsidian version
obsidian vault=<name> [command] [key=value ...]
obsidian help
obsidian read file=<path>
obsidian create file=<path> content=<text>
obsidian append file=<path> content=<text>
obsidian patch file=<path> [<key>=<value> ...]
obsidian move from=<path> to=<path>
obsidian delete file=<path>
obsidian search query=<text> [path=<prefix>] [limit=<n>]
obsidian daily [date=YYYY-MM-DD]
obsidian daily:read [date=YYYY-MM-DD]
obsidian daily:append content=<text>
obsidian random [vault=<name>]
obsidian tags [vault=<name>]
obsidian tag notes=<tag> [vault=<name>]
obsidian tasks [status=open|done|all] [vault=<name>]
obsidian task toggle file=<path> line=<n> [vault=<name>]
obsidian command <name> [key=value ...]
```

All read commands print text to stdout. Side-effecting commands
(`create`, `append`, `patch`, `move`, `delete`, `daily:append`,
`task toggle`) return a short confirmation line. The
`obsidian-result/v1` envelope is intentionally permissive on `data`
shape because the official CLI returns text by default.

## Capability Catalog (17)

The governed capability catalog lives in the Elegy repo. The consumer
mirror documents the high-level shape; the canonical capability set,
side-effect classification, and argument schemas must be read from the
upstream fixtures.

| Group | Capabilities |
|---|---|
| Introspection | `vault-list`, `version` |
| Files | `file-read`, `file-create`, `file-append`, `file-patch`, `file-move`, `file-delete` |
| Search | `search` |
| Daily note | `daily-read`, `daily-append`, `random-note` |
| Tags | `tag-list`, `tag-notes` |
| Tasks | `task-list`, `task-toggle` |
| Escape hatch | `command` (raw `obsidian <subcommand>` pass-through) |

## Quick Reference

| Task | Command |
|---|---|
| List vaults | `obsidian vault list` (or just `obsidian` with no args on some builds) |
| Read a note | `obsidian read file=notes/foo.md` |
| Append to a note | `obsidian append file=notes/foo.md content="New line"` |
| Search the vault | `obsidian search query="planning" limit=20` |
| Read today's daily note | `obsidian daily:read` |
| Append to today's daily note | `obsidian daily:append content="- [ ] triage obsidian queue"` |
| List open tasks | `obsidian tasks status=open` |
| Toggle a task | `obsidian task toggle file=notes/daily.md line=12` |

## Result Envelope

Every skill invocation must return an `obsidian-result/v1` envelope:

```jsonc
{
  "schemaVersion": "obsidian-result/v1",
  "command": "obsidian read file=notes/foo.md",
  "status": "ok" | "error" | "timeout" | "missing-vault" | "permission-denied",
  "vault": "<vault name or null>",
  "data": "<opaque passthrough of `obsidian` stdout or null on error>",
  "rawOutput": "<full stdout/stderr for debugging>",
  "error": { "message": "...", "exitCode": <int|null> } | null
}
```

The `data` field is intentionally opaque: the official `obsidian` CLI
returns text by default and the skill does not parse it. Future
`elegy-planning obsidian ...` subcommands may introduce a stricter
parse/resolve shape, but that is **not** the responsibility of this
foundation skill.

## Rules

- Always pass `vault=<name>` explicitly when more than one vault is
  registered; the active-vault default is platform-specific.
- Treat the `obsidian` CLI as a black-box process boundary. Do not
  parse, normalize, or reinterpret its output into Elegy planning
  schemas.
- Do not write vault content into paths that would shadow Elegy
  planning authority (`.copilot/backlogs/`, `roadmaps/`, ADR/spec
  locations, `docs/system/**` governance nodes).
- Use `obsidian-result/v1` envelopes for every invocation. If the CLI
  exits non-zero, set `status` to the most specific terminal state
  (`missing-vault`, `permission-denied`, `error`) and put the
  diagnostics in `error.message`.
- Respect the three mandatory constraints encoded in
  `skill-definition-v2.elegy-obsidian.json`:
  `external-binary-dependency`, `non-authoritative-vault`,
  `no-projection-of-authority`.

## Authority Chain

- Upstream governed definition (canonical):
  Elegy repo `contracts/fixtures/skill-definition-v2.elegy-obsidian.json`
- Upstream discovery projection (canonical):
  Elegy repo `contracts/fixtures/skill-discovery-index.elegy-obsidian.json`
- Upstream result envelope:
  Elegy repo `contracts/schemas/obsidian-result.schema.json`
- Consumer-side governed definition (mirror):
  `contracts/elegy/fixtures/skill-definition-v2.elegy-obsidian.json`
- Consumer-side discovery projection (mirror):
  `contracts/elegy/fixtures/skill-discovery-index.elegy-obsidian.json`
- Wrapper archive declaration:
  Elegy repo `src/Elegy-obsidian/wrapper-entrypoint.json`
  (`delegatesTo.externalExecutable`, no binary in archive)

## Future Work (not in foundation)

The following belong to a future Rust surface under
`rust/crates/elegy-planning/src/obsidian.rs` and the
`elegy-planning` CLI umbrella, **not** to this skill:

- `elegy-planning obsidian mirror` -- snapshot a vault subtree into
  the planning catalog as a non-authoritative mirror.
- `elegy-planning obsidian attach` -- bind a vault path to a goal,
  roadmap, plan, or work point as a related surface.
- `elegy-planning obsidian resolve` -- answer a planning query
  (entity, identifier) by walking the attached mirrors.
- `elegy-planning obsidian list` -- enumerate attached mirrors and
  their state.
- Promotion of this skill's `lifecycleState` from `draft` to
  `active` once the mirror command set lands.
