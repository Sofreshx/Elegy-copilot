---
created: 2026-06-24
updated: 2026-06-24
category: system
status: current
doc_kind: node
id: repo-context-check
summary: Deterministic drift checking for repo scaffold documentation via claim extraction and verification.
tags: [repo-context, drift, validation, documentation, scaffold]
related: [commit-check-setup, documentation-structure-governance, doc-graph-spec, project-conventions-governance, repo-setup-governance]
---

# Repo Context Drift Check

## Purpose

Define the canonical contract for deterministic repo scaffold documentation drift checking. The `elegy docs check` command extracts verifiable claims from agent-facing scaffold files and checks them against the actual repo state — without consuming AI tokens.

## Authority

This doc sits under [[documentation-structure-governance]] [docs/system/documentation-structure-governance.md](docs/system/documentation-structure-governance.md) as a validation surface. It implements the Doc Freshness Sync Rule from that governance doc via automated claim verification.

## Architecture

The drift checker operates in five phases:

```
scaffold files → claim extraction → claim verification → structural checks → scored report
```

### Phase 1: Collect Scaffold Files

Scans the repo root for known scaffold file patterns:

| Pattern | Purpose |
|---|---|
| `AGENTS.md`, `CLAUDE.md`, `GEMINI.md` | Harness instruction anchors |
| `ROUTER.md` | Task-to-context routing table |
| `context/*.md` | Task-specific context docs (architecture, stack, setup, decisions, conventions) |
| `patterns/*.md` | Reusable task patterns |
| `SETUP.md`, `SYNC.md` | Setup and sync instructions |
| `.opencode/opencode.jsonc` | Harness configuration |

Only files that exist are checked. Missing scaffold files are not errors.

### Phase 2: Extract Claims

Each scaffold markdown file is parsed for structured claims:

| Claim type | Extraction pattern | Example |
|---|---|---|
| `path` | Backtick-quoted strings with file extensions or directory separators | `` `src/auth.ts` `` |
| `command` | Backtick-quoted CLI invocations with known prefixes | `` `npm run test` `` |
| `dependency` | Backtick-quoted package names | `` `react` ``, `` `@scope/pkg` `` |
| `route_edge` | Frontmatter `related:` field entries | `related: [doc-id-1]` |
| `internal_link` | Markdown links to local files | `[text](path/to/file.md)` |

Claims are NOT extracted from:
- Fenced code blocks (```` ``` ````)
- HTML comments (`<!-- -->`)
- External URLs (`https://...`)

### Phase 3: Verify Claims

Each extracted claim is verified against the actual repo state:

| Claim type | Verification |
|---|---|
| `path` | `fs.existsSync(resolvedPath)` |
| `command` | Check `package.json.scripts` for `npm run <script>` and `yarn <script>`; check `Cargo.toml` for `cargo` commands |
| `dependency` | Check `package.json` dependencies, devDependencies, peerDependencies |
| `route_edge` | Check if any doc in `docs/` has matching frontmatter `id` |
| `internal_link` | Resolve relative to source file, check `fs.existsSync` |

Failed verifications produce `DriftIssue` records with machine-readable codes.

### Phase 4: Structural Checks

Additional checks that don't require claim extraction:

| Check | What it finds |
|---|---|
| Frontmatter validation | Missing or invalid `created`/`updated` dates in scaffold files with frontmatter |
| Staleness | Documents with `updated` date older than 90 days |
| Script coverage | `package.json` scripts not referenced in any scaffold file |
| Broken links | Internal markdown links whose targets don't exist |

### Phase 5: Scored Report

All issues are aggregated into a `DriftReport`:

- **Score**: 0-100, computed from verified/failed claim ratio minus structural issue penalties
- **Issues**: Typed drift issues with codes, severities, file locations, and suggested fixes
- **Counts**: files checked, claims extracted, verified, failed
- **Timestamp**: ISO 8601

## Operation

### CLI

```bash
# Full check, machine-readable
node scripts/elegy-docs-check.js --json

# Human-readable summary
node scripts/elegy-docs-check.js

# Run a specific check subset
node scripts/elegy-docs-check.js --check claims --json
node scripts/elegy-docs-check.js --check frontmatter --json
node scripts/elegy-docs-check.js --check links --json
node scripts/elegy-docs-check.js --check scripts --json

# Target a different repo
node scripts/elegy-docs-check.js --target /path/to/repo --json
```

### Integration Test

```bash
node scripts/validate-repo-context.js
```

### Unit Tests

```bash
node --test scripts/validate-repo-context.test.js
```

### Output Contract

The `--json` flag produces a `DriftReport` object matching the JSON schema at `contracts/elegy/repo-context/drift-check-result.schema.json`.

### npm Script Registration

Add to `package.json`:

```json
{
  "scripts": {
    "elegy:docs:check": "node scripts/elegy-docs-check.js",
    "elegy:docs:check:json": "node scripts/elegy-docs-check.js --json",
    "validate:repo-context": "node scripts/validate-repo-context.js"
  }
}
```

## Drift Issue Codes

| Code | Severity | Meaning |
|---|---|---|
| `missing_path` | error | Referenced file path does not exist |
| `stale_command` | warning | Referenced command not found in package.json scripts |
| `missing_dependency` | warning | Referenced dependency not in package.json |
| `version_mismatch` | warning | Claimed version doesn't match manifest |
| `broken_route_edge` | warning | Frontmatter `related:` ID doesn't resolve to any doc |
| `broken_internal_link` | error | Markdown link target file does not exist |
| `undocumented_script` | info | package.json script not referenced in any scaffold file |
| `config_key_missing` | warning | Referenced config key not found |
| `frontmatter_missing` | warning | Scaffold file lacks expected frontmatter |
| `frontmatter_invalid` | warning | Frontmatter contains invalid values |
| `stale_doc` | warning | Document not updated within 90-day threshold |
| `pattern_index_drift` | warning | patterns/INDEX.md out of sync with patterns/*.md |
| `todo_fixme_marker` | info | TODO/FIXME marker found in scaffold doc |
| `cross_file_conflict` | warning | Same claim in two files with conflicting values |
| `manifest_parse_error` | error | Could not parse package.json or Cargo.toml |

## Edge Cases

- **Template paths**: Paths containing placeholders like `<slug>` are flagged as `missing_path` since they don't resolve to real files. This is intentional — template docs should use prose descriptions, not backtick-quoted template paths.
- **Monorepos**: `verifyCommandClaim` checks the root `package.json` only. Workspace-level scripts are not checked (V1 limitation).
- **Global commands**: Commands like `git`, `make`, `docker`, `kubectl`, and `elegy` are assumed to exist and not verified against `$PATH`.
- **Anchor-only links**: Links with only a fragment (`#section-name`) are skipped since heading existence can't be verified without a full HTML renderer.
- **No scaffold files**: If no scaffold files exist (empty repo or no context docs yet), the check still succeeds with score 100 and a note that no files were checked.
- **Missing package.json**: Commands and dependency checks return `manifest_parse_error` instead of crashing. Script coverage check returns empty.

## Design Principles

1. **Deterministic only**: No AI tokens consumed. Pure regex parsing, filesystem checks, and manifest lookups.
2. **Read-only**: Never modifies files. The `elegy docs fix` command (future) will handle auto-repair.
3. **Projections, not authorities**: Scaffold files (AGENTS.md, ROUTER.md, context/, patterns/) are treated as generated projections of durable authority (elegy-planning, docs/system/, codegraph). Drift means the projection is stale, not that code is wrong.
4. **Machine-readable**: JSON output with typed issues enables CI integration, Copilot UI dashboards, and agent consumption.
5. **Composable**: Each check phase runs independently. Subset invocation via `--check` allows CI to run fast targeted checks.

## Acceptance Checks

- [ ] `node scripts/elegy-docs-check.js --json` produces valid JSON matching the DriftCheckResult schema
- [ ] `node scripts/elegy-docs-check.js --help` prints usage text
- [ ] `node scripts/validate-repo-context.js` returns exit code 0
- [ ] `node --test scripts/validate-repo-context.test.js` returns all tests passing
- [ ] Passes `node scripts/validate-doc-graph.js` (frontmatter is valid)
- [ ] Score is between 0 and 100 inclusive
- [ ] Every DriftIssue has required fields: code, severity, file, line, message
- [ ] No AI tokens are consumed during checking (verify via token counter or instrumentation)

## Canonical References

- [[documentation-structure-governance]] [docs/system/documentation-structure-governance.md](docs/system/documentation-structure-governance.md)
- [[commit-check-setup]] [docs/system/commit-check-setup.md](docs/system/commit-check-setup.md)
- [[doc-graph-spec]] [docs/system/doc-graph-spec.md](docs/system/doc-graph-spec.md)
- [[project-conventions-governance]] [docs/system/project-conventions-governance.md](docs/system/project-conventions-governance.md)
- [[repo-setup-governance]] [docs/system/repo-setup-governance.md](docs/system/repo-setup-governance.md)
- `contracts/src/repoContext.ts`
- `contracts/elegy/repo-context/drift-check-result.schema.json`
- `scripts/elegy-docs-check.js`
- `scripts/lib/claim-extractor.js`
- `scripts/lib/claim-verifier.js`
