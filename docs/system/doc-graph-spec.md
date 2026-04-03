---
created: 2026-02-23
updated: 2026-04-03
category: system
status: current
doc_kind: node
id: doc-graph-spec
summary: Canonical contract for graph-based documentation in this repo (layout, frontmatter, ids, links, redirects, validation).
tags: [documentation, graph, mocs, ids, validation]
---

# Doc Graph Spec (Canonical)

This document defines the **canonical contract** for documentation in this repo.

## Goals

- Keep documentation navigable via **progressive disclosure** (index → MOC → nodes).
- Keep agent context lean by making docs **traversable** (small pages, explicit edges).
- Prevent doc drift with an **automatable validator**.

## Directory Layout

- `docs/system/**` — canonical, system-of-record documentation.
- `docs/research/**` — non-canonical notes/spikes/audits.
- `docs/backlogs/*.md` — approved primary repo-backed Planning artifact locations for per-session Repository Backlog docs.
- `docs/backlog.md` — approved legacy compatibility Planning artifact location for the Repository Backlog.
- `docs/roadmaps/*.md` — approved repo-backed Planning artifact locations for Roadmaps.
- other top-level `docs/*.md` paths — reserved for **redirect stubs** only (after migration).

Redirect docs may also exist in other legacy paths (e.g., `docs/orchestrator/*`) when preserving older inbound links.

The Planning artifact exception above is intentionally narrow: it exists only to support the approved
repo-backed backlog and roadmap contract without reopening top-level `docs/*.md` as a general-purpose
content area.

## Document Kinds (`doc_kind`)

- `index` — short entrypoint map.
- `moc` — Map of Content: clusters and routes attention.
- `node` — atomic doc: one technique/constraint/pattern.
- `redirect` — compatibility stub pointing to a new location.

## Required Frontmatter

Every `docs/**.md` file MUST start with YAML frontmatter and include:

```yaml
---
created: YYYY-MM-DD
updated: YYYY-MM-DD
category: system | research | adr | meta
status: current | stale | draft | archived
doc_kind: index | moc | node | redirect
---
```

### Allowed Optional Keys

Non-redirect docs (`doc_kind != redirect`) may additionally include:

```yaml
id: kebab-case-id
summary: One sentence.
tags: [optional]
related: [optional, list, of, ids]
applies_to: [optional]
keywords: [optional]
last_validated: YYYY-MM-DD
expires_after_days: 90
schema_version: 2
```

Redirect docs (`doc_kind: redirect`) may additionally include:

```yaml
redirect_to: docs/system/some-doc.md
```

No other keys are permitted.

## IDs

- **Every non-redirect doc** under `docs/system/**` and `docs/research/**` MUST have a unique frontmatter `id`.
- Redirect docs MUST NOT have `id`.
- ID format is **ASCII kebab-case**: `[a-z0-9-]`.
  - No leading/trailing `-`.
  - No `--`.
- IDs are case-sensitive, but IDs that differ only by case are forbidden.

## Links

### Markdown links (human navigation)

- Use repo-relative links like `docs/system/index.md`.

### Wikilinks (agent edges)

- Allowed syntax: `[[id]]` only.
- `[[id]]` MUST resolve directly to exactly one non-redirect doc by matching frontmatter `id`.
- Redirects never participate in wikilink resolution.

### Dual-link rule (required)

If a line contains `[[id]]`, it must also contain a Markdown link to the resolved target on:
- the same line, OR
- the immediately following line.

## Redirect Docs

Redirect docs preserve older file-path links after migration.

Redirect requirements:
- `doc_kind: redirect`
- `redirect_to` is a repo-relative path that starts with `docs/`.
- `redirect_to` must point to an existing **non-redirect** doc.
- Redirect docs MUST NOT contain wikilinks.

## Repo-Backed Planning Artifact Exception

The approved repo-backed Planning artifact paths:

- `docs/backlogs/*.md`
- `docs/backlog.md`
- `docs/roadmaps/*.md`

are valid non-redirect docs under this spec. They still require standard `docs/**.md` frontmatter and
all normal value validation, but they are exempt from the top-level redirect-only rule that applies to
other `docs/*.md` files.

## Validator Severity

The validator treats these as **errors** (fail):
- missing/invalid frontmatter
- disallowed keys / invalid values
- missing `id` (non-redirect)
- invalid `id` format or duplicates (case-insensitive collision included)
- unresolved `[[id]]` wikilinks
- dual-link violations
- invalid redirects (missing target, redirect chains)

These are **warnings** (non-failing by default):
- missing `summary`
- stale/expired docs (`last_validated` + `expires_after_days`)
- missing `keywords` / `applies_to`

## Precedence

- `docs/system/**` overrides `docs/research/**` when they conflict.
- Research docs may link up to system docs.
