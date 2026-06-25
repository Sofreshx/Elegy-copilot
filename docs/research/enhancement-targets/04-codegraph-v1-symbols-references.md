---
created: 2026-06-24
updated: 2026-06-24
category: research
status: current
doc_kind: node
id: enhancement-target-04-codegraph-v1-symbols-references
summary: Plan for codegraph V1 — extends the V0 index with symbols, references, calls, and tests for symbol-level impact analysis and dead-export detection.
tags: [research, enhancement-targets, codegraph, symbols, references, tsserver, rust-analyzer, impact-analysis]
related: [enhancement-targets-index, enhancement-target-03-codegraph-v0-dependency-boundary-graph, enhancement-target-05-review-agent-evidence-workflow, enhancement-target-06-evaluation-protocol-metrics]
---

# Theme 04 — Codegraph V1: Symbols & References

> **Status:** Research plan. Promote to `docs/specs/elegy-codegraph-v1/spec.md` before implementation.
> **Provenance:** Proven, but harder than V0.
> **First-slice cost:** Weeks (after Theme 03 ships).
> **Dependencies:** Theme 03 (V0 index must exist).

## Why this direction

### The problem

V0 (Theme 03) answers impact at the **file/module** level: "who imports the
file that changed?" But the review question is often **symbol-level**:

> "This PR changed the `nextRunnable` function. Who calls it? What tests cover
> it? Is it exported? Did its signature change? Is it now dead code?"

File-level impact over-reports (an importer may not use the changed symbol) and
under-reports (a symbol may be referenced via re-exports V0 cannot trace).
Symbol-level resolution narrows the impact set and unlocks dead-export
detection and changed-public-API detection — two high-value review signals.

### Why V1 is harder

Symbol/reference resolution is language-specific and hard. The research is
explicit:

- **GitHub stack graphs** exist precisely because "definition/reference"
  resolution is language-specific and hard. They model name binding so
  jump-to-definition and find-references work without a full project build.
- **Kythe** defines a language-agnostic graph schema for cross-reference data
  and expects analyzers/indexers to emit it. It positions itself as a shared
  graph format for interesting semantic subsets, **not** a universal compiler IR.

The design lesson: **do not hand-roll TypeScript or Rust name resolution.**
Lean on existing analyzers:

- **TypeScript:** tsserver / TypeScript compiler API / dependency-cruiser. Add
  SCIP or stack-graph-compatible output later if needed.
- **Rust:** cargo metadata + rust-analyzer-style symbol info. **Do not try to
  hand-roll Rust name resolution first.** Rust macros will hurt quickly.

### Why V1 follows V0 (not parallel)

V1 builds on the V0 schema (`files`, `imports`, `analysis_runs`). The
extraction CLI, SQLite store, and review-pack contract are already proven by
V0. V1 adds tables and a more precise `explain-symbol` and `diff-impact`
without re-architecting. Starting V1 before V0 risks building symbol resolution
on an unproven index foundation.

## What this is

V1 extends the V0 index with **exported functions/classes/types, public APIs,
references to exported symbols, basic caller/callee for direct calls, dead
exported symbols, and changed public API detection.** Unlocks the review
question: "this PR changed symbol X — who imports/calls it? What tests and docs
are implicated?"

### Components (additive to Theme 03)

| Layer | Owner | What |
|---|---|---|
| Extraction CLI | Elegy plugin (extends `elegy-codegraph`) | Symbol/reference extraction; updated `explain-symbol` (symbol-level), `diff-impact` (symbol-level) |
| TS backend | Elegy plugin | tsserver / TypeScript compiler API for exported symbols + references |
| Rust backend | Elegy plugin | rust-analyzer symbol info (no macro resolution in V1) |
| SQLite schema | Elegy plugin | New tables: `symbols`, `references`, `calls`, `tests` |
| Consumption skill | This repo | Updated `elegy-codegraph-review` skill with symbol-level queries |
| Dashboard | copilot-ui | Symbol detail panel; dead-export view; changed-API view |

### Non-goals (V1)

- Do not resolve Rust macros or proc-macro-generated symbols (defer to V2).
- Do not build a full cross-language call graph (TS ↔ Rust IPC tracing is deferred).
- Do not run taint/dataflow analysis (Theme 07).
- Do not chase perfect reference resolution — store `confidence` and let the
  reviewer judge. Some references are compiler-accurate; some are heuristic.
- Do not hand-roll name resolution for either language.

## Design

### New SQLite tables (additive to V0)

```sql
symbols (
  id            TEXT PRIMARY KEY,
  file_id       TEXT,
  name          TEXT,
  fq_name       TEXT,          -- fully-qualified name
  kind          TEXT,          -- function | class | type | interface | const | method | ...
  start_line    INTEGER,
  end_line      INTEGER,
  exported      INTEGER,       -- 1 if exported/public
  visibility    TEXT,          -- public | private | protected | crate | pub(crate) | ...
  confidence    REAL,          -- 1.0 = compiler-accurate; <1.0 = heuristic
  FOREIGN KEY (file_id) REFERENCES files(id)
)

references (
  id              TEXT PRIMARY KEY,
  from_file_id    TEXT,
  from_symbol_id  TEXT,        -- the symbol containing the reference
  to_symbol_id    TEXT,        -- the referenced symbol
  kind            TEXT,        -- import | call | type-ref | property-access | ...
  line            INTEGER,
  confidence      REAL,
  FOREIGN KEY (from_file_id) REFERENCES files(id),
  FOREIGN KEY (from_symbol_id) REFERENCES symbols(id),
  FOREIGN KEY (to_symbol_id) REFERENCES symbols(id)
)

calls (
  id                TEXT PRIMARY KEY,
  caller_symbol_id  TEXT,
  callee_symbol_id  TEXT,
  confidence        REAL,      -- direct calls = 1.0; indirect/virtual = <1.0
  line              INTEGER,
  FOREIGN KEY (caller_symbol_id) REFERENCES symbols(id),
  FOREIGN KEY (callee_symbol_id) REFERENCES symbols(id)
)

tests (
  id                TEXT PRIMARY KEY,
  test_file_id      TEXT,
  target_file_id    TEXT,
  target_symbol_id  TEXT,      -- NULL if target is file-level
  confidence        REAL,      -- convention-based = <1.0; explicit = 1.0
  basis             TEXT,      -- naming-convention | explicit-import | co-location | ...
  FOREIGN KEY (test_file_id) REFERENCES files(id),
  FOREIGN KEY (target_file_id) REFERENCES files(id),
  FOREIGN KEY (target_symbol_id) REFERENCES symbols(id)
)
```

**Key principle (carried from V0): store confidence.** Direct calls are
`confidence = 1.0`. Indirect/virtual calls, convention-based test mapping, and
heuristic references are `< 1.0`. The reviewer must know which edges are
certain.

### Updated CLI

```
elegy codegraph explain-symbol "src/planning/workGraph.ts#nextRunnable" \
  --callers --refs --tests --docs --json
elegy codegraph diff-impact --base main --head HEAD --symbol-level --json
elegy codegraph dead-exports --json
elegy codegraph changed-public-api --base main --head HEAD --json
```

### `explain-symbol` V1 output

```json
{
  "symbol": {
    "name": "nextRunnable",
    "fq_name": "src/planning/workGraph.ts#nextRunnable",
    "file": "src/planning/workGraph.ts",
    "kind": "function",
    "exported": true,
    "visibility": "public",
    "start_line": 42,
    "end_line": 88
  },
  "callers": [
    { "symbol": "runPlanning", "file": "src/cli/commands/planning.ts", "line": 12, "confidence": 1.0 }
  ],
  "refs": [
    { "from_symbol": "renderPlan", "file": "src/cli/commands/planning.ts", "line": 24, "kind": "call", "confidence": 1.0 }
  ],
  "likely_tests": [
    { "file": "test/planning/workGraph.test.ts", "confidence": 0.9, "basis": "naming-convention + explicit-import" }
  ],
  "docs": [
    { "doc": "docs/planning.md", "relation": "documents" }
  ]
}
```

### Changed-public-API detection

`changed-public-api` diffs the `symbols` table between base and head, flagging:

- Public/exported symbol removed (breaking).
- Public symbol signature changed (heuristic — based on parameter/return type
  text diff).
- New public symbol added (non-breaking, but worth noting for review).
- Export removed from a still-existing symbol (API surface shrinkage).

This is the signal that turns "you changed a public function" from an LLM guess
into a deterministic finding.

### Dead-export detection

`dead-exports` finds exported symbols with zero incoming `references` or
`calls` across the index. `confidence` on the "dead" verdict depends on
reference-resolution completeness — heuristic in V1 for Rust (macros), higher
for TS (tsserver).

## Implementation phases

### Phase 1 — Symbol extraction (Elegy plugin)

- Extend `elegy-codegraph` with `symbols` table population.
- TS: tsserver / TypeScript compiler API for exported symbols, visibility,
  start/end lines.
- Rust: rust-analyzer symbol info (skip macro-generated symbols in V1; mark
  `confidence < 1.0`).
- Implement `explain-symbol` V1 (symbol + callers + refs + tests + docs).

### Phase 2 — References & calls

- Populate `references` and `calls` tables.
- TS: tsserver find-references for exported symbols; direct call edges from
  compiler API.
- Rust: rust-analyzer references (best-effort; mark macro-affected edges
  `confidence < 1.0`).
- Implement `diff-impact --symbol-level`.

### Phase 3 — Tests & dead exports

- Populate `tests` table via conventions (naming, explicit imports, co-location).
- Implement `dead-exports` and `changed-public-api`.
- Update `review-pack` to include symbol-level `changed_symbols` and
  symbol-level `impacted`.

### Phase 4 — Consumption & dashboard

- Update `elegy-codegraph-review` skill: symbol-level impact queries.
- Update reviewer lane contract R5: changed-public-API findings must be cited
  in `approved` verdicts.
- Add copilot-ui symbol detail panel, dead-export view, changed-API view.

### Phase 5 — Validation

- Symbol extraction coverage ≥95% for TS exported symbols (measured in Theme 06).
- Reference resolution precision ≥90% for direct references.
- `dead-exports` false-positive rate <10% (measured).
- `changed-public-api` catches a seeded breaking change.

## Coexistence boundary

- Same as Theme 03: advisory, non-blocking, additive to commit-check.
- Symbol findings about test coverage are advisory; coverage commit-check lane
  remains authoritative (QCP §Non-overlap guarantee).

## Follow-ups & future work

- **Macro resolution (V2):** Rust proc-macro-generated symbols. Requires
  rust-analyzer macro expansion. Defer until a real need arises.
- **Cross-language tracing:** TS ↔ Rust IPC edges (Tauri commands). Valuable
  for the copilot-ui desktop app; complex; defer.
- **SCIP / stack-graph output:** Emit SCIP-compatible or stack-graph-compatible
  indexes for interop with other tools (Sourcegraph, LSIF consumers). The
  internal schema stays SQLite; an emitter is a thin adapter.
- **Incremental symbol indexing:** Only re-extract symbols in changed files +
  their dependents. Performance follow-up for large repos.
- **Theme 07 security:** Dataflow analysis (CodeQL/Joern) consumes the symbol
  graph for taint/source/sink tracing. V1 is the prerequisite.

## Dependencies & sequencing

- **Hard dependency:** Theme 03 (V0 index + CLI + schema must exist).
- **Soft dependency:** Theme 05a evidence schema — symbol findings embed
  `evidence` blocks.
- **Unblocks:** Theme 07 (security dataflow needs the symbol graph), advanced
  Theme 05 review questions (changed-public-API, dead-export).

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| tsserver is slow/heavy on large repos | Run as a background process; cache results per SHA; incremental extraction |
| rust-analyzer macro expansion breaks references | V1 skips macro-generated symbols; mark `confidence < 1.0`; defer macro support to V2 |
| Reference resolution false positives | `confidence` column; Theme 06 measures precision/recall; skills surface confidence |
| Dead-export false positives (re-exported transitively) | Trace re-exports in V1.1; conservative `confidence` until verified |
| Symbol extraction coverage gaps | Theme 06 measures coverage; surface "unindexed symbols" in review-pack |

## Acceptance criteria (for the eventual spec)

- `symbols` table populated for this repo with ≥95% TS exported-symbol coverage.
- `explain-symbol` returns callers, refs, tests, docs for a sampled symbol.
- `dead-exports` lists exported symbols with zero incoming references.
- `changed-public-api` detects a seeded breaking change (removed export).
- `diff-impact --symbol-level` narrows impact vs file-level (fewer false
  positives, measured in Theme 06).
- `node scripts/validate-specs.js --strict` passes for the promoted spec.

## Related artifacts

- `docs/research/enhancement-targets/03-codegraph-v0-dependency-boundary-graph.md` — V0 foundation
- `docs/specs/code-quality-control-plane-research/spec.md` — QCP context
- `docs/specs/reviewer-lane-contract/spec.md` — R5 evidence citation
- External: GitHub stack graphs, Kythe, SCIP, tsserver, rust-analyzer
