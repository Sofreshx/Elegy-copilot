---
created: 2026-06-04
updated: 2026-06-04
category: system
status: current
doc_kind: node
id: repo-backed-obsidian-docs
summary: Contract for using Obsidian as a local viewer/editor over canonical repo docs, with the repo remaining the source of truth.
tags: [obsidian, documentation, vault, repo, canonical]
related: [doc-graph-spec, obsidian-synced-notes-contract, documentation-authoring-governance, documentation-structure-governance]
---

# Repo-Backed Obsidian Documentation

## Intent

Obsidian is a powerful local Markdown editor, but when teams collaborate
through Git, repo Markdown files must stay the authoritative source.
This contract defines how to use Obsidian as a **viewer/editor** over
repo docs without moving, copying, or symlinking documentation out of the
repository.

## Authority Boundary

| Layer | Authority | Location |
|-------|-----------|----------|
| **Canonical docs** | Repo (Git) | `docs/system/**`, `docs/research/**`, `docs/specs/**` |
| **Obsidian vault** | Viewer/editor | Same repo path, opened in-place |
| **Planning mirrors** | Generated, non-canonical | `_elegy-copilot/planning-mirrors/` |
| **Personal notes** | User-local, non-canonical | External Obsidian paths |

The repo is always canonical. Obsidian provides a convenient editing
experience, but all changes must flow through normal Git workflows
(commit, review, push).

**Contrast with the Obsidian planning surface:** The
[[obsidian-synced-notes-contract]] [docs/system/obsidian-synced-notes-contract.md](docs/system/obsidian-synced-notes-contract.md)
defines an external, non-authoritative Obsidian surface for **planning
operations** (backlog seeding, mirror feeds). This contract covers a
different scope: using Obsidian to **view and edit canonical repo
documentation** in-place, with the repo retaining full authority.

## Vault Strategy

### Default: Direct Open

Open the target repo root or its `docs/` folder directly as an Obsidian
vault. No files are moved, copied, or symlinked.

```text
Obsidian → Open folder as vault → /path/to/project
# or
Obsidian → Open folder as vault → /path/to/project/docs
```

**Benefits:**
- Zero copy/sync overhead
- Git tracks all changes normally
- `.obsidian/` config commits alongside docs (shared settings)
- No symlink corruption risks (see
  [Obsidian Symlink Warnings](https://obsidian.md/help/symlinks))

### Vault Scope Auto-Detection

Scripts detect vault scope by locating `.obsidian/`:

| `.obsidian/` location | Detected scope | Scripts walk |
|---|---|---|
| `docs/.obsidian/` | `docs` | `docs/` tree |
| `.obsidian/` (repo root) | `root` | repo root (excluding `.obsidian/`, `node_modules/`, `.git/`) |
| Not yet created | `docs` (default) | `docs/` tree |

`obsidian-docs-init` defaults to creating `.obsidian/` inside `docs/` when
a `docs/` directory exists. Override with `--vault-scope=root`.

### Advanced: Symlink Mode (Opt-In Only)

Symlinks require explicit opt-in after the user acknowledges Obsidian's
documented warnings about corruption, sync conflicts, and file-watch
failures. See the `repo-backed-obsidian-docs` skill for the full risk
catalog.

## Setup Workflow

### 1. Preflight Check

Run before opening a repo in Obsidian for the first time:

```bash
node scripts/obsidian-docs-preflight.js /path/to/repo
```

Checks:
- Obsidian CLI availability (warns if missing, non-fatal)
- Repo docs layout (`docs/system/`, `docs/research/`)
- `.obsidian/` workspace state in `.gitignore`
- Doc-graph validator availability
- Symlink hazards

### 2. Initialize (One-Time)

```bash
node scripts/obsidian-docs-init.js /path/to/repo --with-config
# Or explicitly target docs/ as vault root:
node scripts/obsidian-docs-init.js /path/to/repo --with-config --vault-scope=docs
```

Adds `.gitignore` rules for Obsidian workspace state and optionally
writes safe `.obsidian/app.json` defaults (relative links, Markdown
links, `./assets` attachment path). When `docs/` exists, defaults to
creating `.obsidian/` inside `docs/`; override with `--vault-scope=root`.

### 3. Validate After Edits

```bash
node scripts/obsidian-docs-validate.js /path/to/repo
```

Runs the repo's doc-graph validator plus Obsidian metadata checks
(YAML frontmatter parseability, ASCII doc IDs, wikilink format).

## Gitignore Contract

When a repo serves as an Obsidian vault, only **workspace state**
(personal, per-machine) should be excluded from Git. Shared settings
should be committed:

```gitignore
# Obsidian — repo-backed vault
.obsidian/workspace*.json
.obsidian/workspace.json
.trash/
.obsidian/plugins/*/hot-reload.json
```

Do NOT gitignore these shared files:
- `.obsidian/app.json`
- `.obsidian/appearance.json`
- `.obsidian/core-plugins.json`
- `.obsidian/community-plugins.json`

## Frontmatter Compatibility

Repo docs must follow the [[doc-graph-spec]]
[docs/system/doc-graph-spec.md](docs/system/doc-graph-spec.md) frontmatter
contract. Obsidian's YAML Properties are compatible with this contract
because Obsidian silently ignores unknown YAML keys.

**Safe shared keys:** `created`, `updated`, `tags`

**Repo-only keys (safe in Obsidian):** `category`, `status`, `doc_kind`,
`id`, `related`, `applies_to`, `keywords`, `last_validated`,
`expires_after_days`, `schema_version`

**Obsidian-compatible keys (validated by repo):** `publish`, `cssclasses`, `aliases`

Rules:
1. Never remove repo-required frontmatter for Obsidian compatibility
2. Repo validators are the authority for allowed keys
3. Add Obsidian-compatible keys sparingly; prefer repo-meaningful keys

## Requirements

1. Repo docs MUST remain in `docs/system/**`, `docs/research/**`, or
   `docs/specs/**` — never moved into external Obsidian vaults.
2. The default strategy MUST be direct open (no symlinks).
3. Symlink mode MUST require explicit opt-in after the user acknowledges
   Obsidian's documented risks.
4. `.obsidian/workspace*.json` and `.trash/` MUST be in `.gitignore`
   when the repo is used as a vault.
5. Doc edits made in Obsidian MUST be validated with
   `validate-doc-graph.js` before committing.
6. Agents MUST classify every doc operation as canonical, research,
   inbox, mirror, or generated.

## Non-Goals

- Building an Obsidian community plugin
- Automatic sync from Obsidian back to repo (repo is always the source)
- Mirror generation from canonical docs (belongs to future
  `elegy-planning obsidian docs` subcommand)
- Replacing the doc-graph-spec validator with an Obsidian-only workflow

## Acceptance Checks

- → verify: repo can be opened in Obsidian via "Open folder as vault"
  without moving or copying files
- → verify: `node scripts/obsidian-docs-preflight.js` runs against this
  repo and reports status correctly
- → verify: `node scripts/obsidian-docs-init.js --with-config` creates
  `.gitignore` entries and safe `.obsidian/app.json`
- → verify: `node scripts/validate-doc-graph.js` passes after any doc edit
- → verify: `.obsidian/workspace.json` is gitignored but
  `.obsidian/app.json` is tracked

## Implementation Links

- Skill: `repo-backed-obsidian-docs` at
  `catalog-assets/shared-skills/repo-backed-obsidian-docs/SKILL.md`
- Scripts: `scripts/obsidian-docs-preflight.js`,
  `scripts/obsidian-docs-init.js`, `scripts/obsidian-docs-validate.js`
- Plugin: `plugins/elegy-obsidian-docs/.codex-plugin/plugin.json`
- Npm scripts: `obsidian-docs:preflight`, `obsidian-docs:init`,
  `obsidian-docs:validate`

## Validation Evidence

- `node scripts/obsidian-docs-preflight.js` — run against this repo
- `node scripts/validate-doc-graph.js` — must pass
- `npm run validate:specs` — must pass if spec changes exist

## Drift Notes

- This contract is new (2026-06-04). No drift to report.
- `aliases`, `publish`, and `cssclasses` are now validated by doc-graph-spec.
- Plugin package: `plugins/elegy-obsidian-docs/.codex-plugin/plugin.json`.
