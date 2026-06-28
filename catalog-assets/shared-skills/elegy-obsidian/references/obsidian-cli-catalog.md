# Obsidian CLI Command Catalog

## Core Commands (official `obsidian` CLI v1.12.7+)

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

## Capability Catalog (17 capabilities across 7 groups)

| Group | Capabilities |
|---|---|
| Introspection | `vault-list`, `version` |
| Files | `file-read`, `file-create`, `file-append`, `file-patch`, `file-move`, `file-delete` |
| Search | `search` |
| Daily note | `daily-read`, `daily-append`, `random-note` |
| Tags | `tag-list`, `tag-notes` |
| Tasks | `task-list`, `task-toggle` |
| Escape hatch | `command` (raw `obsidian <subcommand>` pass-through) |
