---
name: repo-backed-obsidian-docs
description: "Teaches agents to document projects through Obsidian while keeping canonical Markdown source in the project repo. Repo docs are authoritative; Obsidian is a local viewer/editor only. Triggers on: obsidian docs, repo docs, doc vault, obsidian vault, documentation vault."
license: Apache-2.0
metadata: {"aliasKeys":["obsidian-docs","repo-docs","doc-vault"],"stacks":["docs","obsidian"],"tags":["obsidian","docs","documentation","repo","vault","canonical","authority"]}
---

# Repo-Backed Obsidian Documentation

## Purpose

`repo-backed-obsidian-docs` teaches agents how to author and maintain
canonical project documentation that is also browsable in Obsidian.
The essential contract: **repo Markdown files are the source of truth;
Obsidian is a local viewer/editor that reads them in-place.**

This skill establishes a consistent authority model, doc classification
system, and validation workflow so agents never blur the line between
canonical repo docs and personal Obsidian notes.

## Authority Model

The repo is always canonical. When a repo's `docs/` folder (or root) is
opened as an Obsidian vault, Obsidian becomes a **read-only presentation
layer with optional local editing** — but edits must be committed through
normal Git workflows.

| Layer | Authority | Location |
|-------|-----------|----------|
| **Canonical docs** | Repo (Git) | `docs/system/**`, `docs/research/**`, `docs/specs/**` |
| **Obsidian vault** | Viewer/editor | Same repo path, opened in-place (no copy, no symlink) |
| **Inbox/research notes** | Personal, non-canonical | Obsidian vault paths outside the repo |
| **Mirror notes** | Generated, non-canonical | `_planning-mirrors/` |
| **Generated views** | Cache, non-canonical | Build output, never committed |

## Vault Strategy

### Default: Direct Open (Safe)

Open the target repo root or its `docs/` folder directly as an Obsidian
vault. No files are moved or copied.

```
# Open repo root as a vault
Obsidian → Open folder as vault → /path/to/project

# OR open only docs/ as a vault
Obsidian → Open folder as vault → /path/to/project/docs
```

**Benefits:**
- Zero copy/sync overhead
- Git tracks all changes normally
- `.obsidian/` config lives alongside docs
- No symlink corruption risks

### Vault Scope Auto-Detection

The scripts automatically detect vault scope by locating `.obsidian/`:

| `.obsidian/` location | Detected scope | Scripts walk |
|---|---|---|
| `docs/.obsidian/` | `docs` | `docs/` tree |
| `.obsidian/` (repo root) | `root` | repo root (excluding `.obsidian/`, `node_modules/`, `.git/`) |
| Not yet created | `docs` (default) | `docs/` tree |

`obsidian-docs-init` defaults to creating `.obsidian/` inside `docs/` when
a `docs/` directory exists. Override with `--vault-scope=root`.

### Advanced: Symlink Mode (Opt-In Only)

Symlinks are **not the default** and require explicit opt-in. Obsidian's
own documentation warns about symlink corruption, sync conflicts, and
file-watch failures. See the Symlink Hazards section below.

If a user explicitly requests symlink mode:
1. Run `obsidian-docs-preflight` first
2. Warn about Obsidian's documented symlink risks
3. Require explicit confirmation before creating any symlink

## Doc Classification

Agents must classify every document operation into one of these tiers:

| Tier | Location | Git Tracked | Obsidian Editable | Authority |
|------|----------|-------------|-------------------|-----------|
| **Canonical doc** | `docs/system/**`, `docs/specs/**` | Yes | Read-mostly | Repo |
| **Research note** | `docs/research/**` | Yes | Yes | Repo (non-authoritative) |
| **ADR** | `docs/adr/*.md` | Yes | Read-only | Repo |
| **Inbox note** | Obsidian vault, outside repo | No | Yes | None |
| **Mirror** | `_planning-mirrors/` | No | Read-only | Repo source |
| **Generated** | Build output dirs | No | Never | Build |

## Frontmatter Compatibility

Repo docs use the doc-graph-spec frontmatter schema. Obsidian uses YAML
Properties. These systems overlap but are not identical.

### Safe for Both Systems

These repo doc-graph keys are compatible with Obsidian YAML Properties:

```yaml
created: YYYY-MM-DD
updated: YYYY-MM-DD
tags: [list, of, tags]
aliases: [alternate, names]
publish: true | false
cssclasses: [list]
```

### Repo-Only Keys (Ignored by Obsidian)

```yaml
category: system | research | adr | meta
status: current | stale | draft | archived
doc_kind: index | moc | node | redirect
id: kebab-case-id
related: [list, of, ids]
applies_to: [optional]
keywords: [optional]
last_validated: YYYY-MM-DD
expires_after_days: 90
schema_version: 2
```

These keys are validated by `scripts/validate-doc-graph.js`. Obsidian
silently ignores unknown YAML keys, so they don't cause issues in the
Obsidian UI.

### Rules

1. **Never remove repo-required frontmatter** to satisfy Obsidian
2. **Repo validators are authority** — if a key violates doc-graph-spec,
   fix it in the repo, not in Obsidian
3. **Add Obsidian-compatible keys sparingly** — prefer repo-meaningful keys

## Workflow: Using Obsidian with a Repo

### 1. Preflight Check

Run before opening a repo in Obsidian for the first time:

```bash
node scripts/obsidian-docs-preflight.js /path/to/target-repo
```

This checks:
- Obsidian CLI availability (optional, warns if missing)
- Repo docs layout (`docs/` structure)
- `.obsidian/` config state (warns if hidden config would surprise Git)
- Validator availability (`scripts/validate-doc-graph.js`)
- Symlink hazards (if symlink mode is being considered)

### 2. Initialize (Optional, One-Time)

If the repo doesn't have `.obsidian/` config yet:

```bash
node scripts/obsidian-docs-init.js /path/to/target-repo
```

This:
- Adds `.obsidian/workspace*.json` to `.gitignore` (workspace state is personal)
- Adds `.trash/` to `.gitignore` (Obsidian trash folder, if enabled)
- Writes safe `.obsidian/app.json` with conservative defaults:
  - `"attachmentFolderPath": "./assets"` (keep attachments in docs)
  - `"newLinkFormat": "relative"` (use repo-relative links)
  - `"useMarkdownLinks": true` (prefer Markdown links over wikilinks for portability)
- Does NOT move any docs out of the repo

### 3. Author Docs

When creating or editing docs:

1. **Always edit repo files** — never create content in an external Obsidian vault
   and copy it in
2. **Follow doc-graph-spec frontmatter** — minimal required: `created`, `updated`,
   `category`, `status`, `doc_kind`
3. **Use Markdown links for repo portability** — `docs/system/file.md` is preferred
   over `[[wikilink]]` when the target is a repo doc
4. **Run the doc validator after edits**:
   ```bash
   node scripts/validate-doc-graph.js
   ```

### 4. Validate

After any doc change, run the combined validator:

```bash
node scripts/obsidian-docs-validate.js /path/to/target-repo
```

This runs:
1. `scripts/validate-doc-graph.js` (canonical doc graph checks)
2. Obsidian metadata sanity checks:
   - No YAML parse errors in frontmatter
   - No conflicting keys between repo and Obsidian conventions
   - No broken `[[wikilinks]]` that would fail in Obsidian
   - No non-ASCII characters in doc IDs

## Symlink Hazards

Obsidian's official documentation warns about symlinks:

> "Using symlinks for your vault can lead to sync issues, file corruption,
> and problems with file watching. It is not recommended."

Source: <https://obsidian.md/help/symlinks>

### Known Risks

| Risk | Description |
|------|-------------|
| **File corruption** | Obsidian's editor may not handle symlinked files correctly during saves |
| **Sync conflicts** | Obsidian Sync can corrupt symlinked vaults |
| **File-watch failures** | OS file watchers may not detect changes through symlinks |
| **Plugin breakage** | Community plugins assume real files, not symlinks |
| **Git confusion** | Symlinks in Git repos add complexity to diffs and merges |

### When Symlinks Might Be Acceptable

Only consider symlinks when ALL of these are true:
1. The docs folder MUST stay at a specific path (CI constraint)
2. The Obsidian vault MUST be at a different path (user preference)
3. The user explicitly acknowledges the documented risks
4. `obsidian-docs-preflight` passes with no blocking errors

Even then, prefer a bind mount or junction (Windows) over a symlink.

## Gitignore Rules

When a repo is opened as an Obsidian vault, these patterns should be in
`.gitignore`:

```gitignore
# Obsidian workspace state (personal, not shared)
.obsidian/workspace*.json
.obsidian/workspace.json

# Obsidian trash (if enabled)
.trash/

# Obsidian plugin caches
.obsidian/plugins/*/hot-reload.json
```

Do NOT gitignore these:
- `.obsidian/app.json` — shared default settings
- `.obsidian/appearance.json` — shared theme config
- `.obsidian/core-plugins.json` — shared plugin state
- `.obsidian/community-plugins.json` — shared plugin list

## Integration with Existing Contracts

- **[[doc-graph-spec]]** [docs/system/doc-graph-spec.md](docs/system/doc-graph-spec.md) — canonical doc structure that Obsidian-compatible docs must follow
- **[[obsidian-synced-notes-contract]]** [docs/system/obsidian-synced-notes-contract.md](docs/system/obsidian-synced-notes-contract.md) — the Obsidian planning surface (separate from docs vault)
- **[[elegy-obsidian]]** skill — the Obsidian CLI wrapper for automated vault operations
- **[[documentation-authoring-governance]]** [docs/system/documentation-authoring-governance.md](docs/system/documentation-authoring-governance.md) — page quality standards
- **[[documentation-structure-governance]]** [docs/system/documentation-structure-governance.md](docs/system/documentation-structure-governance.md) — information architecture rules
- **Plugin package** — `plugins/elegy-obsidian-docs/.codex-plugin/plugin.json`

## Rules

1. **Repo docs are always canonical.** Obsidian is a viewer/editor, never the authority.
2. **Default: open repo in-place.** Do not copy, move, or symlink docs out of the repo.
3. **Run `obsidian-docs-preflight` before first use** with any repo.
4. **Run `validate-doc-graph.js` after any doc edit.**
5. **Do not add Obsidian-only frontmatter that conflicts with doc-graph-spec.**
6. **Do not gitignore `.obsidian/` entirely** — only workspace state files.
7. **Symlinks require explicit opt-in** after the user acknowledges documented risks.
8. **Classify every doc operation** into canonical, research, inbox, mirror, or generated.
9. **Use `obsidian-docs-validate`** as the final check before committing doc changes.
10. **Keep Obsidian config conservative** — relative links, Markdown links, no exotic plugins
    that would break repo portability.

## Future Work (not in this skill)

- An `elegy-planning obsidian docs` subcommand for vault management
- Automated mirror generation from canonical docs into vault-readable formats
