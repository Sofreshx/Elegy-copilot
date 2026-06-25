---
created: 2026-06-24
updated: 2026-06-24
category: research
status: current
doc_kind: node
id: enhancement-target-03-codegraph-v0-dependency-boundary-graph
summary: Plan for codegraph V0 — a rebuildable SQLite dependency/boundary index with changed-file impact and review-pack output, hosted as an Elegy plugin. Foundational primitive for Themes 04, 05, 07.
tags: [research, enhancement-targets, codegraph, dependency-cruiser, sqlite, impact-analysis, qcp-006]
related: [enhancement-targets-index, enhancement-target-04-codegraph-v1-symbols-references, enhancement-target-05-review-agent-evidence-workflow, enhancement-target-01-architecture-rules-as-tests]
---

# Theme 03 — Codegraph V0: Dependency & Boundary Graph

> **Status:** Research plan. Promote to `docs/specs/elegy-codegraph-v0/spec.md` before implementation.
> **Provenance:** Proven, but harder than Themes 01/02.
> **First-slice cost:** Weeks.
> **Dependencies:** Theme 05a evidence schema (soft). This is the QCP-006 deferred item.

## Why this direction

### The problem

When an agent (or human) reviews a PR, the central question is **impact**:

> "This PR changed file X. Who imports it? What tests cover it? What docs
> describe it? Does it cross a forbidden boundary? Is a public API affected?"

Today, this question is answered by **grepping the whole repo** — expensive,
incomplete, and inconsistent. The reviewer agent re-derives the dependency
structure from scratch every review, burning tokens and tool calls. There is
no durable, queryable index of files, imports, module groups, cycles, and
boundaries.

The `code-quality-control-plane-research` spec explicitly **defers** codegraph
extraction to "elegy-codegraph CLI maturity (QCP-006)." Theme 03 is the work
that unblocks that deferral.

### Why a rebuildable SQLite index

The research points to a specific architecture (GitHub stack graphs, Kythe,
Codebase-Memory). The key design lesson across all of them: **you do not need a
perfect universal code model; you need enough reliable edges for agent review
and impact analysis.**

The recommended architecture is **Option C+** from the GPT research:

> Rebuildable SQLite index + JSON evidence packs + bridge tables into the
> planning/doc graph. **Not** "extend elegy-planning DB directly." Keep
> lifecycle separation.

Rationale for SQLite over extending the planning DB:

- **Lifecycle separation:** The codegraph is rebuilt per git SHA; the planning
  DB is long-lived durable state. Mixing them couples rebuild cadence to
  planning persistence.
- **Reproducibility:** A codegraph SQLite file is content-addressable by SHA;
  the planning DB is not.
- **Tooling:** SQLite is universally queryable; the planning DB has a specific
  entity model not suited to graph queries.
- **Portability:** A codegraph SQLite file can be shipped as an artifact for
  offline review; the planning DB cannot.

### Why V0 is dependency/boundary only

The GPT research is explicit:

> Do not start with universal AST, full call graph, or perfect semantic
> analysis. Start with: files, imports, module groups, cycles, forbidden edges,
> changed-file impact, dependency graph export.

Symbol/reference resolution (Theme 04) is harder — TypeScript name binding and
Rust macros are painful. V0 delivers **80% of the review value** (impact
analysis, boundary checks, cycle detection) with **20% of the complexity**.
V1 adds symbol precision when V0 has proven the index is worth maintaining.

### Why an Elegy plugin (not a prototype in this repo)

The QCP spec and GPT research both conclude the extraction engine should be
host-neutral and Elegy-owned. The `Sofreshx/Elegy` repo already has a crate
pattern (planning, skills, obsidian, memory, mcp, documentation,
configuration). A new `elegy-codegraph` crate fits that pattern:

- **Host-neutral:** Works for any repo, not just instruction-engine.
- **Managed-binary distribution:** Reuses the `~/.copilot/managed-cli/` install
  path alongside `elegy-planning`.
- **Clean boundaries:** This repo consumes via CLI + OpenCode plugin bridge;
  copilot-ui displays via API. The extraction engine never depends on
  instruction-engine internals.
- **Consistent with existing authority:** `docs/specs/code-quality-control-plane-research/spec.md`
  §Ownership: "Elegy-copilot should not own the core elegy-codegraph extraction
  engine."

## What this is

A **rebuildable SQLite index** of files, imports, module groups, cycles, and
architecture findings, plus a **changed-file impact** computation and
**review-pack** JSON output. V0 does **not** resolve symbols or references
(that is Theme 04).

### Components

| Layer | Owner | What |
|---|---|---|
| Extraction CLI | Elegy plugin (`elegy-codegraph` crate) | `build`, `diff-impact`, `review-pack`, `explain-symbol` (V0: file/module-level only), `query` |
| SQLite schema | Elegy plugin | Tables below; every edge has a `confidence` column |
| TS backend | Elegy plugin | dependency-cruiser + tsserver for imports |
| Rust backend | Elegy plugin | cargo metadata + rough module graph (no name resolution in V0) |
| Evidence packs | This repo (`.elegy/codegraph/runs/<sha>/`) | JSON output artifacts |
| Consumption skill | This repo | `elegy-codegraph-review` skill |
| OpenCode plugin bridge | This repo (`opencode-assets/plugins/`) | `codegraph.js` plugin wrapping CLI tools |
| Dashboard | copilot-ui | "Graph Diff" tab in Workspace view |
| Contract | This repo (`contracts/elegy/`) | `review-pack.schema.json` (shared with Theme 05) |

### Non-goals (V0)

- Do not resolve symbols, references, or calls (Theme 04).
- Do not run taint/dataflow analysis (Theme 07).
- Do not build a graph UI as the first deliverable — the core primitive is
  `query → evidence → review/check/fix obligation`, not visualization.
- Do not hand-roll TypeScript or Rust name resolution — lean on existing
  analyzers (tsserver, rust-analyzer) in V1.
- Do not make MCP the source of truth. MCP is a serving protocol, not the
  authority. The authoritative layer is a reproducible CLI/index with
  machine-readable outputs. (MCP adapter is a future follow-up.)

## Design

### SQLite schema

```sql
-- Lifecycle/run tracking
analysis_runs (
  id            TEXT PRIMARY KEY,
  git_sha       TEXT,
  tool_versions TEXT,          -- JSON: { dependency-cruiser, tsserver, cargo, ... }
  started_at    TEXT,
  completed_at  TEXT,
  status        TEXT           -- running | completed | failed
)

-- Files
files (
  id            TEXT PRIMARY KEY,
  path          TEXT,
  language      TEXT,          -- typescript | rust | yaml | markdown | ...
  hash          TEXT,
  package       TEXT,          -- module/package grouping
  module        TEXT,
  last_seen_run TEXT,
  FOREIGN KEY (last_seen_run) REFERENCES analysis_runs(id)
)

-- Imports (file → file)
imports (
  id            TEXT PRIMARY KEY,
  from_file_id  TEXT,
  to_file_id    TEXT,
  import_text   TEXT,
  kind          TEXT,          -- static | dynamic | type-only | re-export
  is_type_only  INTEGER,
  confidence    REAL,          -- 1.0 = compiler-accurate; <1.0 = heuristic
  FOREIGN KEY (from_file_id) REFERENCES files(id),
  FOREIGN KEY (to_file_id) REFERENCES files(id)
)

-- Module groups (for cycle detection)
module_groups (
  id            TEXT PRIMARY KEY,
  name          TEXT,
  root_path     TEXT
)

-- Cycles
cycles (
  id            TEXT PRIMARY KEY,
  run_id        TEXT,
  group_id      TEXT,
  member_files  TEXT,          -- JSON array of file ids
  severity      TEXT,
  FOREIGN KEY (run_id) REFERENCES analysis_runs(id),
  FOREIGN KEY (group_id) REFERENCES module_groups(id)
)

-- Architecture findings (hosted from Theme 01 rule runs)
architecture_findings (
  id            TEXT PRIMARY KEY,
  run_id        TEXT,
  rule_id       TEXT,
  file_id       TEXT,
  symbol_id     TEXT,          -- NULL in V0 (no symbols yet)
  message       TEXT,
  evidence_json TEXT,          -- JSON: conforms to evidence schema (Theme 05)
  severity      TEXT,
  FOREIGN KEY (run_id) REFERENCES analysis_runs(id),
  FOREIGN KEY (file_id) REFERENCES files(id)
)

-- Pattern findings (hosted from Theme 02 pattern runs)
pattern_findings (
  id            TEXT PRIMARY KEY,
  run_id        TEXT,
  rule_id       TEXT,
  file_id       TEXT,
  symbol_id     TEXT,          -- NULL in V0 (no symbols yet)
  message       TEXT,
  evidence_json TEXT,          -- JSON: conforms to evidence schema (Theme 05)
  severity      TEXT,
  FOREIGN KEY (run_id) REFERENCES analysis_runs(id),
  FOREIGN KEY (file_id) REFERENCES files(id)
)

---- Bridge tables to planning/doc graph
doc_links (
  id              TEXT PRIMARY KEY,
  code_entity_id  TEXT,        -- file_id (V0) or symbol_id (V1)
  doc_id          TEXT,        -- path to doc file
  relation_kind   TEXT         -- describes | documents | references | ...
)

planning_links (
  id              TEXT PRIMARY KEY,
  code_entity_id  TEXT,        -- file_id (V0) or symbol_id (V1)
  work_point_id   TEXT,        -- elegy-planning work point id
  relation_kind   TEXT         -- implements | affects | blocked-by | ...
)
```

**Key principle: store confidence.** Some edges are compiler-accurate
(`confidence = 1.0`); some are heuristic (`confidence < 1.0`). Agents must know
the difference. Every edge table has a `confidence` column.

### CLI shape

```
elegy codegraph build --languages ts,rust --out .elegy/codegraph/codegraph.sqlite
elegy codegraph diff-impact --base main --head HEAD --json > .elegy/codegraph/runs/latest/impact.json
elegy codegraph review-pack --base main --head HEAD --rules <pack> --json > .elegy/codegraph/runs/latest/review-pack.json
elegy codegraph explain-symbol "src/planning/workGraph.ts#nextRunnable" --callers --refs --tests --docs
elegy codegraph query --sql "SELECT ..." --json     # ad-hoc SQL for debugging
```

In V0, `explain-symbol` returns file/module-level information only (which files
import the file containing the symbol). Symbol-level resolution is V1.

### Review-pack output

```json
{
  "$schema": "elegy-review-pack/v1",
  "run": { "id", "git_sha_base", "git_sha_head", "tool_versions", "status" },
  "changed_symbols": [{ "symbol", "file", "kind", "public", "change_kind" }],
  "impacted": {
    "direct_importers": ["src/cli/commands/planning.ts"],
    "transitive_importers": [...],
    "likely_tests": ["test/planning/workGraph.test.ts"],
    "docs": ["docs/planning.md"]
  },
  "architecture_findings": [
    {
      "rule": "cli-must-not-import-db-directly",
      "severity": "error",
      "evidence": [{
        "provenance": "deterministic-tool",
        "confidence": 1.0,
        "source": { "kind": "file:line", "ref": "src/cli/commands/planning.ts:12", "tool": "dependency-cruiser@4.x" }
      }]
    }
  ],
  "review_questions": [
    "Changed file imports 3 modules; verify no new forbidden edges.",
    "Public module boundary touched; check downstream importers."
  ]
}
```

The `review_questions` are deterministic heuristics, not LLM output — they
surface structural signals the reviewer should address.

### Backend selection

| Capability | TS backend | Rust backend |
|---|---|---|
| File inventory | fs walk | fs walk |
| Imports (static) | dependency-cruiser | cargo metadata + custom walk |
| Imports (dynamic) | tsserver (heuristic) | (deferred — rare in Rust) |
| Module groups | tsconfig paths / package.json | cargo workspace |
| Cycles | dependency-cruiser | cargo metadata |
| Likely tests | convention: `*.test.ts` proximity | convention: `#[test]` / `tests/` dir |
| Doc links | frontmatter `related` + path heuristics | doc comments + path heuristics |

### Staleness detection

The index records `git_sha` and `tool_versions` per run. Before consuming a
review-pack, the skill checks:

- `git_sha_head` matches current HEAD (else: stale index warning).
- `tool_versions` match installed tool versions (else: rebuild recommended).
- `index_age_seconds` (derived) — warn if > threshold (configurable).

Staleness is surfaced in the review-pack `run` block, not hidden.

## Implementation phases

### Phase 1 — Extraction CLI (Elegy plugin)

- Author `elegy-codegraph` crate in `Sofreshx/Elegy`.
- Implement SQLite schema creation + migrations.
- Implement TS backend: dependency-cruiser for imports/cycles; fs walk for files.
- Implement Rust backend: cargo metadata for crates/modules; rough import walk.
- Implement `build`, `query` commands.
- Implement `diff-impact`: compute changed files from git diff, map to
  importers (file-level), likely tests, docs.
- Implement `review-pack`: assemble diff-impact + architecture_findings (from
  Theme 01 rule runs) + pattern_findings (from Theme 02 pattern runs) +
  review_questions into the JSON contract.
- Implement `explain-symbol` V0 (file/module-level only).
- Ship managed binary.

### Phase 2 — Consumption (this repo)

- Author `catalog-assets/shared-skills/elegy-codegraph-review/SKILL.md` that
  runs the fixed review sequence:
  1. Build graph for current git SHA.
  2. Compute changed files from git diff.
  3. Map changed files → changed modules (V0) / symbols (V1).
  4. Compute impacted files/tests/docs.
  5. Run architecture rules on affected subgraph (Theme 01).
  6. Produce review evidence pack.
  7. LLM reviews the diff WITH the evidence pack, not the whole repo.
  8. LLM must cite graph evidence when making structural claims.
- Author `opencode-assets/plugins/codegraph.js` OpenCode plugin wrapping the
  CLI tools (mirroring `planning.js` pattern).
- Add `.elegy/codegraph/` to `.gitignore` (run artifacts are local).

### Phase 3 — Dashboard (copilot-ui)

- Add "Graph Diff" tab in Workspace view.
- Views: changed files, impacted importers (file-level), likely tests, docs,
  architecture findings, review questions.
- Stale-index banner when `git_sha_head` ≠ HEAD.
- "Rebuild graph" action button.
- Keep visualization scoped — dense tables and detail panes first, not a
  graph-rendering UI. Graph viz is a debugging aid, not the core primitive.

### Phase 4 — Validation

- `elegy codegraph build` produces a SQLite file for this repo.
- `diff-impact` correctly identifies importers of a changed file (precision/recall measured in Theme 06).
- `review-pack` conforms to `review-pack.schema.json`.
- Staleness detection fires when HEAD moves past the indexed SHA.
- The review skill produces a review citing graph evidence for ≥1 structural claim.

## Coexistence boundary

- Commit-check owns: test, coverage, lint, format, typecheck.
- Codegraph owns (additively): structural impact analysis, graph evidence.
- Codegraph does **not** block commits — it is advisory evidence for review.
- Codegraph findings about test coverage gaps are advisory; they do not replace
  the coverage commit-check lane (QCP §Non-overlap guarantee).
- Codegraph is the QCP-006 deferred item; it unblocks the QCP graph-diff view.

## Follow-ups & future work

- **Theme 04 (V1):** Add `symbols`, `references`, `calls`, `tests` tables.
  Enables symbol-level impact analysis and dead-export detection. This is the
  direct next step.
- **Theme 05 (evidence workflow):** The review-pack is the primary consumer of
  the shared evidence schema. Once Theme 05a ships, all `evidence` blocks in
  findings conform to it.
- **Theme 07 (security):** CodeQL/Joern findings can be stored as
  `architecture_findings` rows with a distinct `rule_source`, enabling unified
  security + architecture review packs.
- **MCP adapter (future):** An MCP server exposing codegraph queries, so any
  MCP-compatible harness can consume the index. **MCP is a serving protocol,
  not the authority** — the SQLite index + CLI remain authoritative.
- **Incremental rebuilds:** V0 rebuilds the whole index per SHA. For large
  repos, incremental rebuild (only changed files + their transitive deps) is a
  performance follow-up.
- **Holon workflow integration (later):** Holon can consume codegraph as a
  workflow capability for debugging, review, migration, and artifact analysis.
  Deferred until codegraph is stable.
- **Cross-language tracing:** V0 treats TS and Rust separately. A future
  version could trace cross-language edges (e.g., Tauri Rust → TS via IPC
  contracts) — valuable but complex; defer.
- **Bridge to planning:** `planning_links` enables "which work point touches
  this file?" queries, closing the loop between planning state and code state.

## Dependencies & sequencing

- **Hard dependencies:** None (V0 does not require Theme 04).
- **Soft dependency:** Theme 05a evidence schema — review-pack `evidence`
  blocks conform to it if shipped. If not, evidence is implicit.
- **Soft dependency:** Theme 01 arch-rules — `review-pack` includes
  `architecture_findings` from Theme 01 rule runs. If Theme 01 has not shipped,
  `architecture_findings` is empty but the pack is still useful.
- **Unblocks:** Theme 04 (builds on V0 schema), Theme 05 (review-pack is the
  primary evidence consumer), Theme 07 (security findings hosted as rows),
  QCP-006 (unblocks the deferred graph-diff view).

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Rust name resolution / macros break the Rust backend | V0 uses cargo metadata + rough module graph only; no name resolution. Defer to V1 with rust-analyzer. |
| Index staleness misleads reviewers | `git_sha` + `tool_versions` in every run; staleness banner in dashboard + skill; rebuild recommended when stale |
| Heuristic import edges have false confidence | `confidence` column on every edge; skills surface confidence to the reviewer; Theme 06 measures precision/recall |
| SQLite file bloat across runs | Run artifacts under `.elegy/codegraph/runs/<sha>/` are local + gitignored; retain only N most recent runs; pruning script |
| dependency-cruiser version drift | Pin version; record in `tool_versions`; rebuild on mismatch |
| "Pretty graph UI" distraction | Explicitly defer graph visualization; ship dense tables + detail panes first; viz is a debugging aid only |
| MCP-first implementation drift | Architecture rule: CLI + SQLite first, MCP adapter second, agent skill third, UI fourth. Document in spec. |

## Acceptance criteria (for the eventual spec)

- `elegy codegraph build --languages ts,rust` produces a SQLite file with all
  V0 tables populated for this repo.
- `diff-impact --base main --head HEAD --json` correctly identifies ≥90% of
  direct importers of changed files (measured in Theme 06).
- `review-pack` output conforms to `review-pack.schema.json`.
- Staleness detection fires when HEAD ≠ indexed `git_sha_head`.
- The review skill cites graph evidence for ≥1 structural claim in a review.
- `node scripts/validate-specs.js --strict` passes for the promoted spec.

## Related artifacts

- `docs/specs/code-quality-control-plane-research/spec.md` — QCP-006 deferral
- `docs/system/architecture-overview.md` — layering the graph validates
- `docs/system/catalog-control-plane.md` — control-plane boundaries
- `opencode-assets/plugins/planning.js` — plugin bridge pattern to mirror
- `scripts/test-ledger-core.js` — caching/evidence pattern reusable for graph caching
- External: dependency-cruiser, GitHub stack graphs, Kythe, Codebase-Memory (2026)
