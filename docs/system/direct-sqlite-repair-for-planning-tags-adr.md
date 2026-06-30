---
created: 2026-06-04
updated: 2026-06-30
category: system
status: current
doc_kind: node
id: direct-sqlite-repair-for-planning-tags-adr
summary: Records the decision to write directly to the `elegy-planning` SQLite DB (tags_json + tag_index) for the one-time consolidation-goal/roadmap tag repair, because the pre-compiled CLI exposes no tag-update subcommand.
tags: [adr, planning, elegy-planning, sqlite, repair, copilot-ui]
related: [planning-backlog-roadmap-contract, adr-governance, self-documenting-code-and-rationale-placement]
---

# Direct SQLite Repair for Planning Tags ADR

## Scope

This ADR documents the decision to bypass the `elegy-planning` CLI and write
directly to the `tags_json` column and `tag_index` table of
`C:\Users\lolzi\.copilot\elegy-planning.db` for the one-time repair of
`GOAL-COPILOT-GIT-WORKTREE-VALIDATION-20260603` and its 5 child roadmaps.

In scope:

- The repair script at `scripts/repair-consolidation-tags.mjs`.
- The transaction shape, backup, and idempotency guarantees.
- The `tag_index` rebuild rules.
- The `planning_events` row that is emitted (or intentionally NOT emitted) by the script.

Out of scope:

- Future tag-mutation flows (which should use the CLI once a `tag update`
  subcommand exists).
- The CLI's own architecture or schema.
- The replacement of the legacy `align-elegy-db-assets` spec.
- The validation, inherited-scope, and UI work; those are covered by
  `docs/specs/planning-visibility-canonicalization/spec.md`.

## Context

The `elegy-planning` CLI (`C:\Users\lolzi\.copilot\managed-cli\planning\elegy-planning.exe`)
exposes only `goal create --tag <t>` and `roadmap create --tag <t>`. It does
NOT expose a `tag add`, `tag update`, or `tag remove` subcommand. The 5
consolidation roadmaps (`RM-COPILOT-GIT-UI-20260603`,
`RM-WORKTREE-MERGE-CONSISTENCY-20260603`,
`RM-VALIDATION-RECEIPTS-20260603`,
`RM-HOOKS-AGENT-LANE-ENFORCEMENT-20260603`,
`RM-CODEX-PLANNING-BOOTSTRAP-20260603`) and their parent goal
(`GOAL-COPILOT-GIT-WORKTREE-VALIDATION-20260603`) were created WITHOUT
`repo:<id>`, `repo:<label>`, `source:<harness>`, `theme:<token>`, or
`phase:<token>` tags. The roadmaps therefore fail repo-scope matching in the
Copilot UI's Planning tab.

The CLI source is shipped pre-compiled and is not available in the
`elegy-copilot` repo. The CLI cannot be rebuilt or patched from this
workspace. The only practical path to add tags to existing records is a
direct SQLite write.

Direct DB writes have three risks:

1. **Schema drift**: if the CLI's `tags_json` representation or `tag_index`
   columns change in a future release, the repair script will write to the
   wrong shape. The repair script MUST be guarded by a schema version check
   and an explicit "repair-script-version" tag on the affected rows.
2. **Event loss**: the CLI emits a `planning_events` row on every mutation.
   A direct DB write skips that audit trail. The repair script MUST emit
   a synthetic `planning_events` row whose `event_type` is
   `tag_repair_direct_sqlite` and whose `payload` includes the
   before/after tag lists, the script version, the operator, and a
   re-runnable idempotency key.
3. **No CLI validation**: the CLI may enforce business rules (e.g. a goal
   must have at least one `repo:*` tag, or a roadmap's `repo:*` tags must
   be a subset of the parent goal's `repo:*` tags) that a direct write
   bypasses. The repair script MUST verify the post-state against the
   validator at `scripts/validate-planning-metadata.js` before declaring
   success.

## Decision

Adopt a **one-time direct-SQLite-write** for the consolidation-goal/roadmap
tag repair, governed by these rules:

1. **Backup is the first action.** The script MUST copy
   `elegy-planning.db` to
   `~/.copilot/backups/elegy-planning.db.bak-<UTC-timestamp>` and verify the
   backup file size matches the source before opening the source in
   read-write mode.
2. **Schema version check.** The script MUST read `PRAGMA user_version`
   from the source DB and refuse to run if the version is outside the
   `repair-script-known-versions` list declared at the top of the script.
3. **Single transaction.** All writes to `tags_json` and `tag_index` MUST
   execute inside a single SQLite transaction. The script MUST roll back
   on any error and re-throw.
4. **`tag_index` rebuild.** For each affected `entity_type`/`entity_id`,
   the script MUST delete all existing `tag_index` rows whose
   `(entity_type, entity_id)` matches and re-insert one row per canonical
   tag. This is preferred over a diff because the in-DB canonical form may
   differ from the script's expected canonical form.
5. **Synthetic event row.** The script MUST insert a row into
   `planning_events` with `event_type = 'tag_repair_direct_sqlite'` and a
   JSON `payload` containing `{ scriptVersion, operator, runs, before,
   after, idempotencyKey }`. The `idempotencyKey` is the SHA-256 of the
   sorted (entityId, canonicalTags[]) tuples; if a row with the same key
   exists, the script aborts as a no-op.
6. **Post-state validation.** The script MUST run
   `scripts/validate-planning-metadata.js --db <db-path> --strict --json`
   against the source DB after committing. If the validator exits 1, the
   script MUST roll back, restore the backup, and exit non-zero.
7. **CLI patch is a follow-up.** A separate work item will add
   `elegy-planning tag add --entity-type <t> --entity-id <id> --tag <t>`
   to the CLI. Once that ships, this ADR will be updated to mark the
   direct-write path as deprecated and the repair script will be replaced
   with a CLI call.

## Alternatives Considered

- **Recreate the consolidation goal and roadmaps** (the
  `align-elegy-db-assets` approach). Rejected: this would orphan the
  existing `planning_events` history, lose the original entity IDs, and
  require manual re-association of any child work that may exist. The user
  has chosen NOT to create placeholder work points/plans/todos, so
  recreation is unnecessary churn.
- **Fork the CLI and add a `tag add` subcommand locally.** Rejected: the
  CLI is shipped as a pre-compiled binary and its source is not in this
  repo. A fork would require a separate build/distribution pipeline and
  would diverge from the upstream CLI the rest of the system uses.
- **Use `node:sqlite` in Node 22.12 to do the write.** Rejected:
  `node:sqlite` is NOT available in Node 22.12 (verified). The script
  MUST use `better-sqlite3`, which is already present at
  `elegy-copilot/node_modules/better-sqlite3`.
- **Add the tags via a UI form.** Rejected: the current Planning UI does
  not expose tag editing, and the consolidation goal/roadmaps may not
  appear in the UI without tags (chicken-and-egg). Adding tag editing to
  the UI is a separate work item and is out of scope for the repair.

## Consequences

Positive:

- The 5 consolidation roadmaps get the canonical `repo:<id>`, `repo:<label>`,
  `source:codex`, `theme:<token>`, `phase:<token>` tag set without losing
  their original entity IDs or `planning_events` history.
- The Copilot UI's Planning tab can match these roadmaps against the
  `elegy-copilot` and `elegy` repo selections.
- The repair is idempotent (the `idempotencyKey` check makes re-runs
  safe) and the backup-then-restore fallback is a hard guarantee.

Tradeoffs:

- The repair script sets a precedent for direct DB writes. Future tag
  edits will be tempted to bypass the CLI. The follow-up `tag add`
  subcommand is intended to retire this path.
- The script's `repair-script-known-versions` list must be kept in sync
  with the CLI's `PRAGMA user_version` evolution. A schema bump without
  updating the list will block the repair with a clear error.
- The synthetic `planning_events` row is a different shape from CLI-
  emitted rows. Downstream analytics that assume CLI events will need
  to handle the new `event_type`.

Follow-up:

- Track a work item: "Add `tag add` subcommand to the `elegy-planning`
  CLI; deprecate `scripts/repair-consolidation-tags.mjs` in favor of
  `elegy-planning tag add` invocations." This ADR will be re-stated as
  historical context once that subcommand ships.
- Track a work item: "Add tag editing to the Copilot UI Planning tab so
  the UI can be the canonical tag mutation surface for daily work, with
  the CLI script reserved for one-off bulk operations."

## Validation Notes

- `scripts/repair-consolidation-tags.mjs --db <path>` MUST exit 0 on a
  fresh run and on a re-run (idempotency).
- `scripts/validate-planning-metadata.js --db <path> --strict` MUST exit
  0 after the repair.
- `scripts/roundtrip-validator-strict.test.js` MUST exercise the
  backup-then-repair-then-validate cycle against a temp copy of the live
  DB and never mutate the live DB.
- The first production run is the "acceptance event" for this ADR. The
  author will record the timestamp, the operator, and the validator
  output in the spec's evidence log.

## References

- `docs/system/adr-governance.md`
- `docs/system/planning-backlog-roadmap-contract.md`
- `docs/specs/planning-visibility-canonicalization/spec.md` (R2.2, Drift Notes)
- `docs/specs/align-elegy-db-assets/spec.md` (predecessor, NOT modified by this ADR)
- `scripts/repair-consolidation-tags.mjs` (implementation)
- `scripts/validate-planning-metadata.js` (post-state validator)
- `C:\Users\lolzi\.copilot\managed-cli\planning\elegy-planning.exe` (CLI, read-only from this ADR's perspective)
