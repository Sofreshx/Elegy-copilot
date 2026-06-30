---
created: 2026-06-24
updated: 2026-06-29
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

This doc sits under [[documentation-structure-governance]] [documentation-structure-governance.md](documentation-structure-governance.md) as a validation surface. It implements the Doc Freshness Sync Rule from that governance doc via automated claim verification.

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
| `README.md`, `SECURITY.md`, `SUPPORT.md`, `CODE_OF_CONDUCT.md` | Repo-level documentation |
| `ROUTER.md` | Task-to-context routing table |
| `context/*.md` | Task-specific context docs (architecture, stack, setup, decisions, conventions) |
| `patterns/*.md` | Reusable task patterns |
| `docs/**/*.md` | All nested documentation under `docs/` (system docs, specs, MOCs) |
| `SETUP.md`, `SYNC.md` | Setup and sync instructions |
| `.opencode/**/*` | Harness configuration files (agents, profiles, MCP configs; skips `node_modules/`) |

Only files that exist are checked. Missing scaffold files are not errors.

### Phase 2: Extract Claims

Each scaffold markdown file is parsed for structured claims:

| Claim type | Extraction pattern | Example |
|---|---|---|
| `path` | Backtick-quoted strings with file extensions or directory separators | `` `src/auth.ts` `` |
| command (claim type) | Backtick-quoted CLI invocations with known prefixes | `` `npm run test` `` |
| `dependency` | Backtick-quoted package names | `` `react` ``, `` `@scope/pkg` `` |
| `route_edge` | Frontmatter `related:` field entries | `related: [doc-id-1]` |
| `internal_link` | Markdown links to local files | ``[label](index.md)`` |

Claims are NOT extracted from:
- Fenced code blocks (```` ``` ````)
- HTML comments (`<!-- -->`)
- External URLs (`https://...`)
- Template placeholders (values containing `<` or `>`, e.g., `` `docs/specs/<slug>/spec.md` ``)
- Inline code spans (for `TODO`/`FIXME` marker scanning)

### Phase 3: Verify Claims

Each extracted claim is verified against the actual repo state:

| Claim type | Verification |
|---|---|
| `path` | `fs.existsSync(resolvedPath)` |
| command (claim type) | Check `package.json.scripts` for `npm run <script>` and `yarn <script>`; check `Cargo.toml` for `cargo` commands |
| `dependency` | Check `package.json` (root, `copilot-ui/`, `contracts/`) for dependencies, devDependencies, peerDependencies |
| `route_edge` | Check if any doc in `docs/` has matching frontmatter `id` |
| `internal_link` | Resolve relative to source file, check `fs.existsSync` |

Failed verifications produce `DriftIssue` records with machine-readable codes.

### Phase 4: Structural Checks

Additional checks that don't require claim extraction:

| Check | What it finds |
|---|---|
| Frontmatter validation | Missing or invalid `created`/`updated` dates in scaffold files with frontmatter |
| Staleness | Documents with `updated` date older than configurable threshold (default 90 days), or >50/200 commits since last update |
| Cross-file conflict | Same dependency with different versions claimed in different files; same script referenced with different package managers |
| `TODO`/`FIXME` markers | Unresolved `TODO` or `FIXME` markers in scaffold markdown (skips code blocks, HTML comments, inline code spans) |
| Tool config sync | Drifted doc references between harness instruction files (AGENTS.md, CLAUDE.md, GEMINI.md) |
| Script coverage | `package.json` scripts not referenced in any scaffold file |
| Broken links | Internal markdown links whose targets don't exist |

Staleness thresholds are configurable via `.elegy/repo-check-config.json`:
```json
{ "staleness": { "warnDays": 90, "warnCommits": 50, "errorCommits": 200 } }
```

### Phase 5: Scored Report

All issues are aggregated into a `DriftReport`:

- **Score**: 0-100 (integer), computed from verified/failed claim ratio minus structural issue penalties
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
node scripts/elegy-docs-check.js --check staleness --json
node scripts/elegy-docs-check.js --check links --json
node scripts/elegy-docs-check.js --check scripts --json
node scripts/elegy-docs-check.js --check cross-file --json
node scripts/elegy-docs-check.js --check todo-fixme --json
node scripts/elegy-docs-check.js --check tool-config-sync --json

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
| `missing_dependency` | warning | Referenced dependency not in package.json (searched across root, `copilot-ui/`, `contracts/`) |
| `version_mismatch` | warning | Claimed version doesn't match manifest |
| `broken_route_edge` | warning | Frontmatter `related:` ID doesn't resolve to any doc |
| `broken_internal_link` | error | Markdown link target file does not exist |
| `undocumented_script` | info | package.json script not referenced in any scaffold file |
| `config_key_missing` | warning | Referenced config key not found |
| `frontmatter_missing` | warning | Scaffold file lacks expected frontmatter |
| `frontmatter_invalid` | warning | Frontmatter contains invalid values |
| `stale_doc` | warning | Document not updated within configured day+commit thresholds |
| `pattern_index_drift` | warning | patterns/INDEX.md out of sync with patterns/*.md |
| `todo_fixme_marker` | warning | Unresolved `TODO`/`FIXME` marker found in scaffold markdown |
| `cross_file_conflict` | error | Same dependency with conflicting versions across files; same script with different package managers |
| `tool_config_drift` | warning | Doc references diverged between harness instruction files (or SHA256 mismatch when hash mode enabled) |
| `manifest_parse_error` | error | Could not parse package.json or Cargo.toml |

## Edge Cases

- **Template paths**: Paths containing placeholders like `<slug>` or `{repo-name}` are excluded from claim extraction. Values containing `<` or `>` are treated as template expressions, not real file paths.
- **Monorepos**: `verifyDependencyClaim` checks `package.json` at root, `copilot-ui/`, and `contracts/`. `verifyCommandClaim` still checks the root `package.json` only for script verification.
- **`node_modules`**: Recursive directory scans (`.opencode/`, `docs/`) skip `node_modules/` and `.git/` directories.
- **Global commands**: Commands like `git`, `make`, `docker`, `kubectl`, and `elegy` are assumed to exist and not verified against `$PATH`.
- **Commit-based staleness**: If `git` is unavailable or the repo has no commits matching the date range, staleness falls back to wall-clock-only behavior.
- **Anchor-only links**: Links with only a fragment (`#section-name`) are skipped since heading existence can't be verified without a full HTML renderer.
- **No scaffold files**: If no scaffold files exist (empty repo or no context docs yet), the check still succeeds with score 100 and a note that no files were checked.
- **Missing package.json**: Commands and dependency checks return `manifest_parse_error` instead of crashing. Script coverage check returns empty.

## Upcoming Enhancements

| Enhancement | Description | Inspired by |
|---|---|---|
| Cargo.toml dependency verification | Extend `verifyDependencyClaim` to parse `Cargo.toml` and verify Rust crate claims. Currently only checks `package.json`. Single Cargo.toml in this repo (`copilot-ui/src-tauri/`), but needed as Tauri/Rust usage grows. | — |
| Exact-byte-content tool config sync | Extend `checkToolConfigSync` with a mode that compares SHA256 of instruction files meant to be identical copies (e.g., installed agent configs vs shipped templates). Currently supported via `{ useHash: true }` opt-in; future enhancements would add target-specific hash comparison pairs. | [mex checkToolConfigSync](https://github.com/mex-memory/mex) |
| `elegy sync`-style remediation | Generate targeted AI fix prompts per stale file, similar to MEX's `mex sync` flow. Currently users copy the report from the Health tab to compose fix prompts manually. | [mex sync](https://github.com/mex-memory/mex#commands) |
| Post-commit hook / watch mode | Continuous monitoring via git hooks or polling. MEX provides `mex watch` for persistent-agent workspaces and `mex heartbeat` for lightweight health checks. | [mex watch](https://github.com/mex-memory/mex#commands) |
| Pattern index sync | Detect when patterns/INDEX.md (external tool convention) is out of sync with actual pattern files. The `pattern_index_drift` code is reserved but no checker is implemented yet. Low priority — our repo has no patterns/INDEX.md (external tool convention) convention. | [mex checkIndexSync](https://github.com/mex-memory/mex) |
| Rust command verification | Extend `verifyCommandClaim` to validate `cargo` subcommands against Cargo.toml dependencies (e.g., cargo install (example command for Rust projects), cargo build (example command for Rust projects) target verification). | — |

## Design Principles

1. **Deterministic only**: No AI tokens consumed. Pure regex parsing, filesystem checks, and manifest lookups.
2. **Read-only**: Never modifies files. The `elegy sync` command (future enhancement) will handle targeted fix prompts.
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

- [[documentation-structure-governance]] [documentation-structure-governance.md](documentation-structure-governance.md)
- [[commit-check-setup]] [commit-check-setup.md](commit-check-setup.md)
- [[doc-graph-spec]] [doc-graph-spec.md](doc-graph-spec.md)
- [[project-conventions-governance]] [project-conventions-governance.md](project-conventions-governance.md)
- [[repo-setup-governance]] [repo-setup-governance.md](repo-setup-governance.md)
- `contracts/src/repoContext.ts`
- `contracts/elegy/repo-context/drift-check-result.schema.json`
- `scripts/elegy-docs-check.js`
- `scripts/lib/claim-extractor.js`
- `scripts/lib/claim-verifier.js`
- `scripts/lib/checkers/todo-fixme.js`
- `scripts/lib/checkers/cross-file.js`
- `scripts/lib/checkers/tool-config-sync.js`
- [MEX drift detection](https://github.com/mex-memory/mex#drift-detection) — upstream inspiration
