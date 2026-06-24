---
created: 2026-06-24
updated: 2026-06-24
category: research
status: current
doc_kind: node
id: enhancement-target-01-architecture-rules-as-tests
summary: Plan for architecture-rules-as-tests — dependency/layer/cycle/naming rules validated as deterministic checks, hosted as an Elegy plugin with seed rules for instruction-engine.
tags: [research, enhancement-targets, architecture-rules, dependency-cruiser, archunit, validation]
related: [enhancement-targets-index, enhancement-target-03-codegraph-v0-dependency-boundary-graph, enhancement-target-05-review-agent-evidence-workflow]
---

# Theme 01 — Architecture Rules as Tests

> **Status:** Research plan. Promote to `docs/specs/architecture-rules-as-tests/spec.md` before implementation.
> **Provenance:** Proven and immediately practical.
> **First-slice cost:** Days.
> **Dependencies:** None.

## Why this direction

### The problem

Agentic development across multiple harnesses (Copilot, OpenCode, Codex,
Antigravity, Claude Code) produces structural drift: forbidden imports creep in,
layer boundaries blur, cycles form, naming conventions rot. LLM review catches
some of this, but inconsistently and at high token cost — it re-derives the
rules from context every time instead of checking a defined invariant.

This repo already enforces a handful of structural rules, but they are
**scattered, ad-hoc, and ununified**:

| Existing validator | What it enforces | Form |
|---|---|---|
| `scripts/vue-free-guard.js` | No Vue.js in copilot-ui | Standalone script + test |
| `scripts/validate-doc-graph.js` | Doc frontmatter + cross-refs (406 lines) | Standalone script |
| `scripts/validate-elegy-command-refs.js` | project.md uses only documented CLI commands | Standalone script |
| `scripts/validate-manifest.js` | Shipped asset manifest completeness (518 lines) | Standalone script |
| `scripts/validate-lane-doc-refs.js` | No lane agents classified as skills | Standalone script |
| `scripts/validate-profile-role-coverage.js` | Every agentRoles key maps to an installed agent | Standalone script |

These are **architecture rules in spirit** — each validates an invariant about
structure — but they have no shared schema, no shared runner, no severity model,
no rationale documentation, and no uniform JSON output. A reviewer agent cannot
consume them as a coherent evidence pack. Critically, **none of them enforce
dependency-level invariants** (forbidden imports, layer boundaries, cycles),
which is where most structural rot happens.

### Why this is the proven slice

The research landscape is unambiguous:

- **ArchUnit** validates structure, dependencies, layers, cycles, naming, and
  project-specific rules through unit-test-style checks on Java bytecode.
- **dependency-cruiser** validates and visualizes JS/TS dependency rules,
  reports violations, and emits graph output — directly mapping to CI and agent
  evidence packs.
- **jQAssistant** stores structural information in Neo4j and validates
  project-specific rules at build time.

All three prove that **architecture rules as deterministic, machine-checkable
tests** is the most immediately practical slice of the code-quality control
plane. It is measurable from day one: rule violations, cycle count, forbidden
imports, module-boundary breaches, unstable dependencies, and CI-blocking
regressions.

For Elegy, this suggests a first-class concept:

```
architecture_rule
  id
  scope
  forbidden_edges
  allowed_edges
  severity
  rationale_doc
  verification_command
```

### Why it is independent

Architecture rules do not require a code graph index. They run against the
source tree directly (dependency-cruiser for TS/JS, cargo metadata + custom
walkers for Rust). They produce boolean findings, not a graph. This means
Theme 01 can ship and prove value **before** the codegraph work (Theme 03),
and its rule pack format can be hosted as `architecture_findings` rows once the
graph exists.

## What this is

A **rule engine** that validates structure — forbidden imports, layer
boundaries, cycles, naming, and project-specific custom rules — and emits JSON
findings with provenance, severity, and rationale. Not a graph index; a boolean
per-rule validator.

### Components

| Layer | Owner | What |
|---|---|---|
| Rule engine CLI | Elegy plugin (`elegy-arch-rules` crate) | `run`, `list`, `validate` commands; dependency-cruiser + cargo backends; custom rule runner; JSON findings |
| Rule pack | This repo (`.elegy/arch-rules.yml`) | Seed rules for instruction-engine itself |
| Commit-check integration | This repo | Advisory `arch-rules` lane in commit-check trilogy |
| Review skill | This repo (`catalog-assets/shared-skills/`) | `architecture-rules` skill consuming findings |
| Dashboard | copilot-ui | Architecture findings tab in Workspace view |
| Contract | This repo (`contracts/elegy/`) | `architecture-rule.schema.json`, `architecture-finding.schema.json` |

### Non-goals

- Do not build a code graph index (that is Theme 03).
- Do not resolve symbols or references (that is Theme 04).
- Do not run taint/dataflow analysis (that is Theme 07).
- Do not replace the commit-check trilogy's test/coverage/lint/format/typecheck lanes.
- Do not force every repo to install the rule engine by default.
- Do not make the rule engine the source of truth for rule definitions that
  belong to portable analyzer packs (Semgrep/ast-grep rules stay in Theme 02).

## Design

### Rule pack schema

```yaml
# .elegy/arch-rules.yml
schema: elegy-arch-rules/v1
rules:
  - id: cli-must-not-import-db-directly
    name: CLI layer must not import DB layer directly
    scope: src/cli/**
    kind: forbidden-import          # forbidden-import | forbidden-edge | cycle | naming | custom
    forbidden: ["src/db/raw*", "src/db/internal*"]
    severity: error                  # error | warning | info
    rationale_doc: docs/system/architecture-overview.md
    verification_command: elegy-arch-rules run --rule cli-must-not-import-db-directly
    language: typescript             # typescript | rust | any
  - id: no-cross-harness-asset-imports
    name: Harness asset dirs must not cross-import
    kind: forbidden-edge
    forbidden:
      - from: "engine-assets/**"
        to: "opencode-assets/**"
      - from: "opencode-assets/**"
        to: "engine-assets/**"
    severity: error
    rationale_doc: docs/system/harness-asset-flow.md
    language: any
  - id: no-cycles-per-module-group
    name: No import cycles within a module group
    kind: cycle
    scope: "**"
    severity: error
    rationale_doc: docs/system/architecture-overview.md
    language: typescript
```

### Finding schema

```json
{
  "rule_id": "cli-must-not-import-db-directly",
  "severity": "error",
  "file": "src/cli/commands/planning.ts",
  "line": 12,
  "import_text": "src/db/raw.ts",
  "message": "CLI layer imports DB layer directly at src/cli/commands/planning.ts:12",
  "rationale_doc": "docs/system/architecture-overview.md",
  "evidence": {
    "provenance": "deterministic-tool",
    "confidence": 1.0,
    "source": { "kind": "rule_id", "ref": "arch-rule:cli-must-not-import-db-directly", "tool": "dependency-cruiser@4.x" }
  }
}
```

The `evidence` block conforms to the shared evidence schema (Theme 05a). When
Theme 05a has not shipped yet, the block is optional and findings are treated
as `provenance: "deterministic-tool"` implicitly.

### CLI shape

```
elegy-arch-rules run --rules <pack> [--rule <id>] [--language ts,rust] [--json]
elegy-arch-rules list --rules <pack> [--json]
elegy-arch-rules validate --rules <pack>            # validate rule pack schema
```

Output envelope (machine mode):

```json
{
  "run": { "tool": "elegy-arch-rules", "version": "0.1.0", "rules_pack": ".elegy/arch-rules.yml", "started_at": "...", "completed_at": "...", "status": "completed" },
  "summary": { "rules_run": 13, "findings": 3, "errors": 1, "warnings": 2, "exit_code": 1 },
  "findings": [ { ...finding } ]
}
```

### Backend selection

| Rule kind | TS backend | Rust backend |
|---|---|---|
| `forbidden-import` | dependency-cruiser | cargo metadata + custom import walker |
| `forbidden-edge` | dependency-cruiser | cargo metadata |
| `cycle` | dependency-cruiser | cargo metadata |
| `naming` | regex / ast-grep | regex |
| `custom` | pluggable script runner | pluggable script runner |

`custom` rules wrap existing standalone validators (`vue-free-guard.js`,
`validate-doc-graph.js`, etc.) so they can be unified under the rule pack
without rewriting them. The custom runner shells out to the verification
command and parses exit code + stdout.

## Seed rules for instruction-engine

Phase 2 ports the 6 existing validators into rule pack format and adds 6 new
dependency-level rules that do not exist today.

| Rule | Kind | New or ported from | Severity |
|---|---|---|---|
| `vue-free` | custom | `vue-free-guard.js` | error |
| `doc-graph-integrity` | custom | `validate-doc-graph.js` | error |
| `elegy-commands-documented` | custom | `validate-elegy-command-refs.js` | error |
| `manifest-complete` | custom | `validate-manifest.js` | error |
| `lane-classification` | custom | `validate-lane-doc-refs.js` | error |
| `profile-role-coverage` | custom | `validate-profile-role-coverage.js` | error |
| `cli-no-db-direct` | forbidden-import | **new** | error |
| `skills-no-runtime` | forbidden-import | **new** | error |
| `contracts-no-copilot-ui` | forbidden-import | **new** | error |
| `no-cross-harness-imports` | forbidden-edge | **new** | error |
| `scripts-no-copilot-ui-lib` | forbidden-import | **new** | warning |
| `local-tracker-no-copilot-ui` | forbidden-import | **new** | warning |
| `no-cycles-per-module-group` | cycle | **new** | error |

The new rules encode the intended layering documented in
`docs/system/architecture-overview.md` and `docs/system/harness-asset-flow.md`:

- CLI commands must go through services, not the raw DB layer.
- Skills are documentation/instruction artifacts; they must not import runtime code.
- Contracts are shared, host-neutral types; they must not depend on a specific harness UI.
- Harness asset directories are install sources; cross-imports create hidden coupling.
- Scripts are build-time tooling; they must not depend on copilot-ui runtime libraries.
- local-tracker is a sidecar; it must not depend on copilot-ui internals.

## Implementation phases

### Phase 1 — Rule engine CLI (Elegy plugin)

- Author `elegy-arch-rules` crate in `Sofreshx/Elegy`.
- Implement rule pack schema parser + validator.
- Implement dependency-cruiser backend for TS `forbidden-import` / `forbidden-edge` / `cycle`.
- Implement cargo metadata backend for Rust.
- Implement `custom` rule runner (shell-out + exit-code/stdout parse).
- Implement `run`, `list`, `validate` commands with `--json --non-interactive` machine mode.
- Ship managed binary alongside `elegy-planning`.

### Phase 2 — Seed rules (this repo)

- Author `.elegy/arch-rules.yml` with all 13 rules above.
- Port 6 existing validators as `custom` rules (keep originals until parity proven).
- Validate rule pack against schema.
- Run `elegy-arch-rules run` against this repo and capture baseline findings.

### Phase 3 — Integration (this repo)

- Add `arch-rules` as an **advisory** commit-check lane (non-blocking score,
  respects QCP coexistence boundary — does not touch test/lint/format/typecheck).
- Author `catalog-assets/shared-skills/architecture-rules/SKILL.md` that loads
  findings and surfaces them to the reviewer agent.
- Update `reviewer-lane-contract` spec R5: when architecture findings are
  present, `approved` verdicts on PRs touching cross-module boundaries must
  cite the findings (or explicitly note the rule was satisfied).
- Update reviewer agent prompt (`opencode-assets/agents/reviewer.md`) to accept
  architecture findings as optional input.
- Add copilot-ui "Architecture Findings" tab in Workspace view: rule inventory,
  per-rule findings, run history, severity filtering.

### Phase 4 — Validation

- Existing 6 validators still pass (no regression from porting).
- New 6 dependency rules catch ≥3 seeded violations in a test branch.
- Commit-check composite score includes `arch-rules` lane without breaking existing lanes.
- `architecture-rules` skill loads findings and a reviewer agent cites them in a
  review output block.
- `validate-evidence-schema.js` (from Theme 05a) validates finding evidence blocks.

## Coexistence boundary

Respects `docs/specs/code-quality-control-plane-research/spec.md` §Coexistence Boundary:

- Commit-check owns (exclusively): test, coverage, lint, format, typecheck.
- Arch-rules owns (additively): structural invariants. Advisory, non-blocking.
- Arch-rules does not duplicate lint (lint = style; arch-rules = structure).
- Existing standalone validators remain as-is until ported (no forced migration).

## Follow-ups & future work

- **Theme 03 hosting:** Once the codegraph V0 index exists, arch-rules findings
  can be stored as `architecture_findings` rows keyed by `run_id`, enabling
  "find all arch-rule violations in the changed subgraph" queries.
- **Theme 02 complement:** Structural patterns (Semgrep/ast-grep) catch
  convention violations that dependency rules cannot (e.g., "every skill
  frontmatter must have a `name` field"). The two are complementary, not
  overlapping.
- **Theme 06 measurement:** The evaluation protocol measures false-positive
  rate per rule and rule runtime — arch-rules is the first system to be
  measured.
- **Rule pack distribution:** Portable rule packs could be shared across repos
  via the external-sources subsystem in `copilot-ui/lib/externalSources.js`,
  but this is deferred until the rule format stabilizes.
- **ADL promotion:** If the rule pack format proves durable, promote an ADR
  documenting `elegy-arch-rules/v1` as the canonical architecture-rule format.
- **Visualizer:** dependency-cruiser emits DOT/SVG cycle graphs. A dashboard
  cycle visualizer is a low-cost follow-up once findings are displayed.

## Dependencies & sequencing

- **Hard dependencies:** None. Can start immediately.
- **Soft dependency:** Theme 05a evidence schema — if it ships first, findings
  embed `evidence` blocks from day one. If not, evidence is implicit.
- **Unblocks:** Theme 03 (rule pack format reused for graph findings), Theme 05
  (findings are a primary evidence source), Theme 06 (first system to measure).

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Rule pack fragments across repos, drift between packs | Keep one canonical pack per repo at `.elegy/arch-rules.yml`; schema-versioned; validate in CI |
| False positives erode trust in advisory lane | Severity model (error/warning/info); per-rule FP tracking in Theme 06; waivable rules |
| Elegy CLI build burden (another managed binary) | Reuse existing managed-CLI install path (`~/.copilot/managed-cli/`); ship alongside `elegy-planning` release |
| Porting existing validators breaks them | Keep originals until parity proven; run both during Phase 2; retire originals only after Theme 06 confirms parity |
| dependency-cruiser version drift | Pin tool version in finding `evidence.source.tool`; record in `analysis_runs.tool_versions` when Theme 03 lands |
| Custom rules escape sandbox via verification_command | Restrict to relative paths within repo root; no shell metacharacters; document trust boundary |

## Acceptance criteria (for the eventual spec)

- `elegy-arch-rules run --rules .elegy/arch-rules.yml --json` exits non-zero when
  error-severity findings exist, zero otherwise.
- All 13 seed rules run against this repo; baseline findings captured.
- Existing 6 validators still pass after porting (no regression).
- `arch-rules` commit-check lane contributes to composite score without
  overriding test/lint/format/typecheck.
- A reviewer agent, given architecture findings, cites them in a review output
  block per R5.
- `node scripts/validate-specs.js --strict` passes for the promoted spec.

## Related artifacts

- `docs/specs/code-quality-control-plane-research/spec.md` — QCP coexistence boundary
- `docs/system/architecture-overview.md` — layering rules encode its intent
- `docs/system/harness-asset-flow.md` — cross-harness boundary rules
- `docs/system/commit-validation-governance.md` — commit-check lane contract
- `docs/specs/reviewer-lane-contract/spec.md` — R5 evidence citation
- `scripts/vue-free-guard.js`, `scripts/validate-doc-graph.js`, etc. — existing rules to port
- External: ArchUnit, dependency-cruiser, jQAssistant
