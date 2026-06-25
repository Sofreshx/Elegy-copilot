---
created: 2026-06-24
updated: 2026-06-24
category: research
status: current
doc_kind: node
id: enhancement-target-02-structural-search-codemods
summary: Plan for structural search and codemods — pattern-graph rules (Semgrep/ast-grep) plus deterministic rewrite recipes for project conventions and migrations.
tags: [research, enhancement-targets, semgrep, ast-grep, openrewrite, codemod, patterns]
related: [enhancement-targets-index, enhancement-target-01-architecture-rules-as-tests, enhancement-target-05-review-agent-evidence-workflow]
---

# Theme 02 — Structural Search & Codemods

> **Status:** Research plan. Promote to `docs/specs/structural-search-codemods/spec.md` before implementation.
> **Provenance:** Very practical.
> **First-slice cost:** Days.
> **Dependencies:** None.

## Why this direction

### The problem

A large class of convention violations is **syntactic/structural**, not
dependency-based. Examples in this repo:

- Every skill's `SKILL.md` frontmatter must have `name` and `description`.
- Every shipped tool contract must follow a specific shape.
- CLI command registration must follow a convention.
- SQLite migrations must follow a naming/schema convention.
- Error handling must use a project-specific pattern.
- Certain API calls (e.g., `fs.readFile` with a user-supplied path) are
  forbidden outside a sanitized wrapper.

Architecture rules (Theme 01) catch **edges** (imports, cycles, layer
boundaries). They cannot catch **patterns** — "this function constructs a
command with string concatenation" or "this skill is missing its `description`
field." That is a different tool family.

### Why this is the practical slice

The research is unambiguous:

- **Semgrep** supports syntactic patterns, negative patterns, metavariables,
  and flow-sensitive options. It is the standard for custom static-analysis
  rule packs with low false-positive rates.
- **ast-grep** provides syntax-aware search/rewrite over Tree-sitter ASTs and
  supports linting, structural search, large-scale replacement, and
  programmatic use.
- **OpenRewrite** is the more mature "refactoring as recipes" pattern: recipes
  are structured search/refactoring operations applied to lossless semantic
  trees, composable for larger migrations.

The design lesson is to **separate concerns**:

```
codegraph = facts        (Theme 03/04)
rules     = invariants   (Theme 01 — dependency; Theme 02 — pattern)
recipes   = deterministic transformations  (Theme 02 — codemods)
skills    = how agents use facts/rules/recipes
```

Pattern rules and dependency rules are **complementary, not overlapping**.
Dependency rules ask "does A import B?"; pattern rules ask "does this code
match a forbidden shape?". Both produce findings; both feed the evidence
workflow (Theme 05). Keeping them in separate themes preserves the clean
tool-family boundary.

### Why codemods matter for agentic dev

LLM-driven refactors are non-deterministic and expensive. For known, repeatable
migrations (rename a symbol everywhere, change a function signature, migrate an
API), a **deterministic codemod recipe** is faster, cheaper, and auditable.
OpenRewrite-style recipes applied to lossless trees produce diffs the agent can
verify rather than author. This turns the code graph from a review-only tool
into a **fix-generating** tool.

## What this is

A **pattern rule engine** (Semgrep + ast-grep) for project-specific conventions
plus a **codemod recipe runner** (ast-grep rewrite / OpenRewrite-style) for
deterministic migrations. Emits JSON findings and dry-run rewrite diffs.

### Components

| Layer | Owner | What |
|---|---|---|
| Pattern CLI | Elegy plugin (`elegy-patterns` crate) | `run`, `rewrite`, `list`, `validate` commands; Semgrep + ast-grep backends; JSON findings + diff output |
| Pattern pack | This repo (`.elegy/patterns.yml`) | Seed patterns for instruction-engine conventions |
| Commit-check integration | This repo | Advisory `patterns` lane (non-blocking) |
| Review skill | This repo | `convention-patterns` skill consuming findings |
| Dashboard | copilot-ui | Pattern findings tab; codemod dry-run preview |
| Contract | This repo (`contracts/elegy/`) | `pattern-rule.schema.json`, `pattern-finding.schema.json`, `codemod-recipe.schema.json` |

### Non-goals

- Do not build a dependency/cycle engine (that is Theme 01).
- Do not resolve cross-file references (that is Theme 04).
- Do not run taint/dataflow analysis (that is Theme 07).
- Do not replace ESLint/stylelint for style rules — patterns target
  project-specific conventions, not generic style.
- Do not make LLM-driven refactors the primary migration path; recipes are
  deterministic first, LLM-assisted only when no recipe matches.

## Design

### Pattern rule schema

```yaml
# .elegy/patterns.yml
schema: elegy-patterns/v1
rules:
  - id: skill-frontmatter-required-fields
    name: Skill frontmatter must have name and description
    backend: ast-grep                  # semgrep | ast-grep
    language: yaml
    pattern: |
      frontmatter without ($NAME, $DESCRIPTION)
    severity: error
    rationale_doc: catalog-assets/shared-skills/skill-authoring/SKILL.md
    verification_command: elegy-patterns run --rule skill-frontmatter-required-fields
  - id: forbidden-fs-readfile-user-path
    name: Do not call fs.readFile with a user-supplied path
    backend: semgrep
    language: typescript
    pattern: |
      - pattern: fs.readFile($USER_INPUT, ...)
        - pattern-not: fs.readFile(sanitizePath($USER_INPUT), ...)
    severity: error
    rationale_doc: docs/system/security-model.md
  - id: cli-command-registration-shape
    name: CLI commands must register via the command registry
    backend: ast-grep
    language: typescript
    pattern: |
      command not registered via registerCommand(...)
    severity: warning
    rationale_doc: docs/system/architecture-overview.md
```

### Codemod recipe schema

```yaml
# .elegy/recipes.yml
schema: elegy-codemod-recipes/v1
recipes:
  - id: migrate-old-planning-cli-call
    name: Migrate legacy elegyPlanningCliResolver calls to the new resolver
    backend: ast-grep               # ast-grep | openrewrite
    language: typescript
    find: |
      resolveElegyCli($OLD_ARGS)
    replace: |
      resolveElegyCli({ ...$OLD_ARGS, useManagedPath: true })
    rationale_doc: docs/system/harness-asset-flow.md
    safe: true                       # deterministic, no behavior change
  - id: rename-symbol-next-runnable
    name: Rename nextRunnable to nextRunnableWorkPoint
    backend: ast-grep
    language: typescript
    find: nextRunnable
    replace: nextRunnableWorkPoint
    safe: false                      # requires review; may touch public API
```

### Finding schema

```json
{
  "rule_id": "forbidden-fs-readfile-user-path",
  "severity": "error",
  "file": "src/cli/commands/import.ts",
  "line": 42,
  "match": "fs.readFile(req.body.path, ...)",
  "message": "fs.readFile called with user-supplied path without sanitization",
  "rationale_doc": "docs/system/security-model.md",
  "evidence": {
    "provenance": "deterministic-tool",
    "confidence": 1.0,
    "source": { "kind": "rule_id", "ref": "pattern:forbidden-fs-readfile-user-path", "tool": "semgrep@1.50" }
  }
}
```

### CLI shape

```
elegy-patterns run --rules <pack> [--rule <id>] [--language ts,rust] [--json]
elegy-patterns rewrite --recipe <id> --dry-run [--diff]
elegy-patterns rewrite --recipe <id> [--apply]         # applies the rewrite
elegy-patterns list --rules <pack> [--json]
elegy-patterns validate --rules <pack>
```

The `rewrite --dry-run` output is a unified diff the agent or dashboard can
preview before `--apply`. `safe: true` recipes can be auto-applied by an agent;
`safe: false` recipes require explicit approval.

### Backend selection

| Rule kind | Backend | Notes |
|---|---|---|
| Syntactic pattern (TS) | ast-grep | Tree-sitter; fast; supports rewrite |
| Syntactic pattern (Rust) | ast-grep | Tree-sitter; supports rewrite |
| Flow-sensitive pattern | semgrep | taint-lite, metavariables, pattern-not |
| Recipe (TS) | ast-grep rewrite | Deterministic; diff-based |
| Recipe (Rust) | ast-grep rewrite | Deterministic; diff-based |
| Complex migration | OpenRewrite (deferred) | Lossless semantic trees; composable recipes |

OpenRewrite is deferred — it is heavier and the first slice does not need
composable recipe graphs. ast-grep rewrite covers 80% of migrations.

## Seed patterns for instruction-engine

| Pattern | Backend | Severity | Source of truth |
|---|---|---|---|
| `skill-frontmatter-required-fields` | ast-grep | error | `skill-authoring/SKILL.md` |
| `skill-description-min-length` | ast-grep | warning | `skill-authoring/SKILL.md` |
| `tool-contract-shape` | ast-grep | error | `contracts/elegy/skill-definition.schema.json` |
| `cli-command-registration-shape` | ast-grep | warning | `docs/system/architecture-overview.md` |
| `forbidden-fs-readfile-user-path` | semgrep | error | `docs/system/security-model.md` |
| `forbidden-res-sendfile-user-path` | semgrep | error | `docs/system/security-model.md` |
| `no-raw-sql-outside-db-layer` | semgrep | error | `docs/system/architecture-overview.md` |
| `migration-naming-convention` | ast-grep | warning | (when migrations exist) |
| `no-console-in-lib` | ast-grep | warning | convention |

The security-adjacent patterns (`forbidden-fs-readfile-user-path`,
`forbidden-res-sendfile-user-path`, `no-raw-sql-outside-db-layer`) overlap with
the `security` skill's checklist but are **deterministic** — they catch what
the LLM skill might miss. They are pattern rules, not dataflow analysis
(Theme 07); they flag the syntactic shape, not the taint path.

## Implementation phases

### Phase 1 — Pattern CLI (Elegy plugin)

- Author `elegy-patterns` crate in `Sofreshx/Elegy`.
- Implement pattern pack + recipe schema parsers/validators.
- Implement ast-grep backend (run + rewrite).
- Implement semgrep backend (run).
- Implement `run`, `rewrite`, `list`, `validate` commands with `--json --non-interactive`.
- Ship managed binary alongside `elegy-planning` / `elegy-arch-rules`.

### Phase 2 — Seed patterns (this repo)

- Author `.elegy/patterns.yml` with all 9 patterns above.
- Author `.elegy/recipes.yml` with 1-2 example recipes (e.g., a safe rename).
- Validate packs against schema.
- Run `elegy-patterns run` against this repo; capture baseline findings.

### Phase 3 — Integration (this repo)

- Add `patterns` as an **advisory** commit-check lane (non-blocking).
- Author `catalog-assets/shared-skills/convention-patterns/SKILL.md`.
- Update reviewer agent prompt to accept pattern findings as optional input.
- Add copilot-ui "Pattern Findings" tab + "Codemod Preview" panel (dry-run diff).
- Wire `elegy-patterns rewrite --dry-run` into the agent workflow: when a
  pattern finding has a linked recipe, the reviewer can suggest the recipe as a
  deterministic fix.

### Phase 4 — Validation

- All 9 patterns run against this repo; baseline findings captured.
- `patterns` commit-check lane contributes to composite score without overriding existing lanes.
- A codemod recipe dry-run produces a correct unified diff on a test branch.
- Reviewer agent cites pattern findings in a review output block per R5.

## Coexistence boundary

- Commit-check owns: test, coverage, lint, format, typecheck.
- Patterns owns (additively): project-specific convention patterns + codemods.
- Patterns does **not** duplicate lint — lint catches generic style; patterns
  catch project-specific conventions (skill frontmatter, tool contract shape,
  CLI registration). If a pattern becomes generic enough, it migrates to an
  ESLint rule; otherwise it stays here.

## Follow-ups & future work

- **OpenRewrite integration:** For composable, multi-step migrations (e.g.,
  API v1 → v2 across the whole repo), add an OpenRewrite backend. Deferred
  until a real migration justifies the weight.
- **Recipe suggestions in review:** When a pattern finding has a matching
  recipe, the review skill can propose `elegy-patterns rewrite --recipe <id>`
  as the fix, turning review into fix-generation.
- **Theme 03 hosting:** Pattern findings can be stored as `pattern_findings`
  rows in the codegraph index once Theme 03 lands, enabling "find all pattern
  violations in the changed subgraph."
- **Theme 07 complement:** Semgrep's flow-sensitive patterns are a lightweight
  substitute for full dataflow analysis. When Theme 07 (CodeQL/Joern) ships,
  semgrep patterns that overlap with taint analysis can be retired in favor of
  the heavier, more precise backend.
- **Pattern pack distribution:** Share pattern packs across repos via the
  external-sources subsystem once the format stabilizes.
- **LLM-assisted pattern authoring:** An agent could draft a Semgrep/ast-grep
  rule from a natural-language convention description, then a human validates
  it. This is a skill, not a CLI feature.

## Dependencies & sequencing

- **Hard dependencies:** None. Can start immediately.
- **Soft dependency:** Theme 05a evidence schema — findings embed `evidence`
  blocks if it has shipped.
- **Unblocks:** Theme 05 (pattern findings are an evidence source), Theme 06
  (second system to measure FP rates).
- **Parallel with Theme 01:** Both are fast, independent, and complementary.
  Can be developed concurrently by different streams.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Semgrep/ast-grep version drift changes match semantics | Pin versions in `evidence.source.tool`; record in run metadata |
| Pattern false positives drown real signal | Severity model; per-pattern FP tracking (Theme 06); waivable rules |
| Codemod recipes produce incorrect rewrites on edge cases | `safe` flag; dry-run-first workflow; `safe: false` requires approval; Theme 06 seeded-PR suite includes recipe correctness tests |
| Overlap with ESLint/stylelint causes confusion | Clear ownership: generic style → ESLint/stylelint; project convention → patterns. Document the boundary. |
| Recipe safety misjudged | Default `safe: false`; promote to `safe: true` only after Theme 06 confirms zero regressions on seeded PRs |

## Acceptance criteria (for the eventual spec)

- `elegy-patterns run --rules .elegy/patterns.yml --json` exits non-zero on error findings.
- All 9 seed patterns run against this repo; baseline findings captured.
- `elegy-patterns rewrite --recipe <id> --dry-run` produces a valid unified diff.
- `patterns` commit-check lane contributes to composite score without overriding existing lanes.
- Reviewer agent cites pattern findings per R5 when present.
- `node scripts/validate-specs.js --strict` passes for the promoted spec.

## Related artifacts

- `catalog-assets/shared-skills/skill-authoring/SKILL.md` — convention source for skill patterns
- `docs/system/security-model.md` — convention source for security-adjacent patterns
- `docs/system/architecture-overview.md` — convention source for CLI/layer patterns
- `contracts/elegy/skill-definition.schema.json` — tool contract shape
- `docs/specs/code-quality-control-plane-research/spec.md` — QCP coexistence boundary
- External: Semgrep, ast-grep, OpenRewrite
