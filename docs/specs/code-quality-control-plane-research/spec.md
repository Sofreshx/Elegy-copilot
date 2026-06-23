---
spec_id: code-quality-control-plane-research
title: Code Quality Control Plane Research
status: draft
type: feature
updated: 2026-06-23
---

# Code Quality Control Plane Research

## Intent

Define the Elegy-copilot research contract for running, configuring, and visualizing code quality systems for agentic development: static analyzers, rule packs, graph extraction plugins, graph diffs, and agent review launches. This is a research and product-shaping spec, not an implementation-ready feature.

## Context Evidence

- `docs/system/index.md`: identifies elegy-copilot/Elegy Copilot as the shared-asset and control-plane workspace for Copilot, Codex, OpenCode, Antigravity, and Claude Code.
- `docs/system/copilot-ui-guide.md`: current `copilot-ui` responsibilities include local UI/API, repo registration, workspace views, planning graph surfaces, execution views, settings, and diagnostics.
- `docs/system/catalog-control-plane.md`: catalog control plane manages install/search/external sources and projects file-backed state; it is not a second source of truth.
- `docs/system/commit-validation-governance.md`: current commit-validation governance already covers test, coverage, lint, format, and typecheck lanes across TypeScript and Rust workspaces.
- `docs/specs/assets-tools-management-v1/spec.md`: current assets/tools direction should be reconciled with any analyzer install and status UI.
- External candidate tools:
  - Semgrep for custom static analysis rule packs and CI-friendly findings.
  - ast-grep for fast structural TypeScript/Rust-adjacent pattern checks and rewrites.
  - CodeQL for deeper query-based security/correctness analysis.
  - Joern for code-property-graph research, if later proven valuable.
  - Tree-sitter, rust-analyzer, and SCIP-style indexes as possible inputs from the future Elegy codegraph plugin.

## Requirements

### Allowed Behavior

- Researching an agentic code quality control surface for installing, running, and displaying code quality systems
- Orchestrating installed tools, showing status, running commands, displaying results, and launching agent reviews
- Supporting both TypeScript and Rust repos in the research scope
- Investigating Semgrep, ast-grep, CodeQL, Joern, and `elegy-codegraph` integration as candidates
- Persisting operator configuration and last-run state for analyzers
- Designing an operator dashboard as the first UI with analyzer inventory, policy view, run history, and finding detail
- Distinguishing proven analyzer output from inferred graph/agent summaries in the UI
- Existing commit-check lanes remaining the narrow commit gate

### Forbidden Behavior

- Implementing analyzer installation or graph UI in this research spec
- Making Elegy-copilot the portable source of truth for Semgrep, ast-grep, CodeQL, Joern, or codegraph rules
- Claiming graph findings replace tests, typechecks, lint, or review
- Forcing every repo to install heavy analyzers by default
- Hiding analyzer cost, stale indexes, partial language support, or confidence levels from users
- Replacing existing commit-check lanes with the code quality control plane

### Ownership And Product Boundary

- Elegy-copilot owns the local operator experience for code quality systems.
- Elegy-copilot should not own the core `elegy-codegraph` extraction engine or portable analyzer rule packs.
- Elegy-copilot should orchestrate installed tools, show status, run commands, display results, manage configuration, and launch agent reviews.
- Portable analyzers, rule packs, plugin manifests, and graph extractors should remain Elegy-owned where they are host-neutral.

### Research Scope

- Research an "agentic code quality" control surface that can:
  - install or locate analyzers
  - run configured validation lanes
  - display Semgrep, ast-grep, CodeQL, and future codegraph findings
  - show graph diffs before and after changes
  - compare changed files to affected symbols/tests/docs
  - manage project rule packs and quality policies
  - launch agent review with relevant structural evidence
- Both TypeScript and Rust repos must be handled directly in the research scope.
- The UI must distinguish proven analyzer output from inferred graph/agent summaries.

### Analyzer And Plugin Integration

- Semgrep is useful for custom project rules, forbidden patterns, and CI-oriented findings.
- ast-grep is useful for fast structural search/linting/rewrite checks over syntax trees.
- CodeQL is useful for deeper semantic/security queries when the target repo can support it.
- Joern is useful as a research candidate for graph-heavy analysis, not a default dependency.
- `elegy-codegraph`, if created, should be consumed as a plugin/tool that exposes commands and machine-readable output.
- Elegy-copilot should persist operator configuration and last-run state, but not become the authority for portable rule definitions.

### UX Direction

- The first UI should be an operator dashboard, not a marketing or abstract graph page.
- Core views to research:
  - analyzer inventory and install health
  - project quality policy/rule-pack view
  - run history and latest findings
  - graph diff or impact view for changed files
  - finding detail with file/symbol/test/doc links
  - agent review launch with selected evidence
- Graph visualization should be used only where it clarifies impact or debugging. Dense tables and scoped detail panes may be better for first versions.

### Relationship To Commit Checks

- Existing commit-check lanes remain the narrow commit gate.
- The code quality control plane may suggest or generate commit-check configuration later, but that requires a separate implementation spec.
- Expensive or optional analyzers should be explicit operator actions until cost, runtime, and reliability are understood.

## Gate Inventory

### Gate Inventory Table

| Gate | Deterministic? | Blocks Merge? | Cost Class | Provenance Class | Why It Exists | First-Slice? |
|------|---------------|---------|------------|-----------------|---------------|-------------|
| commit-check (test) | yes | score | cheap | deterministic-tool | Narrows the pre-commit gate: fast deterministic test pass/fail with scoring | yes |
| commit-check (coverage) | yes | score | cheap | deterministic-tool | Enforces test coverage thresholds without heavy suite runs | yes |
| commit-check (lint) | yes | score | cheap | deterministic-tool | Catches style/error patterns before review; commit-check owns lint | yes |
| commit-check (format) | yes | score | cheap | deterministic-tool | Enforces consistent formatting before commit; commit-check owns format | yes |
| commit-check (typecheck) | yes | yes | cheap | deterministic-tool | Blocks commits with type errors; zero-tolerance hard gate | yes |
| Semgrep | yes | no | moderate | deterministic-tool | Custom pattern-based static analysis with low false-positive rate | yes |
| ast-grep | yes | no | moderate | deterministic-tool | Structural code pattern search; complements Semgrep for AST-level rules | defer — requires rule-pack design (QCP-003) |
| CodeQL | yes | no | expensive | deterministic-tool | Deep semantic analysis for security and correctness; requires build | defer — heavy install, needs database build |
| Dependency audit (npm/cargo) | yes | no | cheap | deterministic-tool | Detects known vulnerabilities in dependencies; already available via npm/cargo | yes |
| Codegraph extraction | yes | no | expensive | deterministic-tool | Structural graph for impact analysis and cross-reference queries | defer — depends on elegy-codegraph CLI maturity (QCP-006) |
| UI runtime signals | no | no | variable | heuristic-tool | Captures browser/desktop UI regressions during agent exploration | defer — requires UI test infrastructure (tauri-driver, QCP-007) |
| Specs/docs validators | yes | no | cheap | deterministic-tool | Validates spec and documentation structure, links, and freshness | yes |
| Waivers | no | no | cheap | llm-assisted | Documented exceptions to blocking gates with reason and expiry | yes |
| LLM review | no | no | variable | llm-only | Agentic review augmenting deterministic findings; cites tool evidence; non-blocking | yes |
| Secrets scanning | yes | no | cheap | deterministic-tool | Detects hardcoded secrets before they reach remote history | defer — no tool configured in repo; add when integrated |
| CSS/SCSS lint (stylelint) | yes | no | cheap | deterministic-tool | Catches CSS/SCSS style violations; stylelint already configured in repo | yes |

### Controlled Vocabulary Definitions

- **Deterministic?**: `yes` = reproducible machine output with stable fingerprints; same input always produces same finding. `no` = heuristic or LLM-augmented output that may vary across runs.
- **Blocks Merge?**: `yes` = hard gate; merge blocked until pass. `no` = advisory; findings reported but do not block. `score` = contributes to composite score; threshold-gated.
- **Cost Class**: `cheap` = local CLI, &lt;5s typical runtime. `moderate` = local tool, &lt;30s typical runtime. `expensive` = external install required, &gt;30s runtime, requires index build, or heavyweight process. `variable` = runtime depends on repo size or configuration.
- **Provenance Class**: `deterministic-tool` = reproducible machine output from a pinned tool version. `heuristic-tool` = tool output with documented false-positive rate; may need human triage. `llm-assisted` = LLM augments deterministic findings but always cites underlying tool evidence. `llm-only` = pure LLM analysis; non-blocking; never treated as a deterministic pass/fail gate.
- **First-Slice?**: `yes` = included in initial QCP deployment. `defer` = deferred to a future slice with stated reason. Deferral criteria: (a) requires external tool install not yet integrated, (b) requires infrastructure not yet built (e.g., codegraph, UI test harness), (c) benefit unclear without upstream QCP components, (d) heavy runtime cost disproportionate to signal.

### Coexistence Boundary

> **QCP ↔ Commit-Check Boundary**
>
> **Commit-check owns (exclusively):** test, coverage, lint, format, typecheck. These five lanes are the narrow pre-commit gate. QCP must not replace, duplicate, or override them. Commit checks remain the single "safe to commit" signal.
>
> **QCP owns (additively):** deep static analysis (Semgrep, ast-grep, CodeQL), dependency auditing, codegraph extraction, UI runtime signals, specs/docs validation, waivers, secrets scanning, CSS/SCSS lint (stylelint), and LLM review. These gates run outside the commit path and enrich the quality picture without blocking commits.
>
> **Bridge (future):** QCP may suggest or generate commit-check configuration in a later slice, but this requires a separate implementation spec and must not alter commit-check scoring without operator approval.
>
> **LLM Review coexistence:** QCP-orchestrated LLM review is non-blocking, evidence-citing, and separate from the `@code-reviewer` lane. The reviewer lane remains the single read-only adversarial review surface for implementation-vs-request fit. QCP may launch agent review with structural evidence, but review verdicts belong to the reviewer lane's output contract.
>
> **Non-overlap guarantee:** No QCP gate duplicates a commit-check lane's function. QCP findings about test quality (e.g., coverage gaps, test weakening) are reported as advisory evidence, not as commit gates — the testing-quality-governance rules remain authoritative for test quality assessment.
>
> Cross-references:
> - `docs/system/commit-validation-governance.md` §Non-Goals: "Code quality beyond lint/format (separate governance surface)"
> - `docs/system/reviewer-lane-governance.md` §Coexistence Rules: single reviewer lane, read-only
> - `docs/system/testing-quality-governance.md` §What Counts As Weakening: QCP must not encourage test weakening
> - `docs/system/quality-gate-evaluation.md` §Gate Pipeline: QCP feeds into existing confidence mapping as parallel quality dimensions

### First-Slice Deferral Rationale

- **ast-grep**: requires rule-pack design (QCP-003-practice-rule-authoring)
- **CodeQL**: heavy install, requires database build; cost disproportionate without established benefit (revisit after QCP-004-run-orchestration-adapters)
- **Codegraph extraction**: depends on elegy-codegraph CLI maturity and integration (QCP-006-codegraph-evidence-integration)
- **UI runtime signals**: requires UI test infrastructure (tauri-driver/WebDriver setup, QCP-007-workspace-checks-ui)
- **Secrets scanning**: no secrets scanning tool configured in repo; add in a future slice after tool selection and integration

## Non-Goals

- Do not implement analyzer installation or graph UI in this spec.
- Do not make Elegy-copilot the portable source of truth for Semgrep, ast-grep, CodeQL, Joern, or codegraph rules.
- Do not claim graph findings replace tests, typechecks, lint, or review.
- Do not force every repo to install heavy analyzers by default.
- Do not hide analyzer cost, stale indexes, partial language support, or confidence levels from users.

## Acceptance Checks

- A later design can show where analyzer config, portable rule packs, run results, and UI state are owned.
  → verify: review the research brief ownership table against `docs/system/catalog-control-plane.md` and this spec.
- A research prototype can run at least one TypeScript check and one Rust check from the control plane without hardcoding repo-specific commands.
  → verify: run the prototype against one TypeScript repo and one Rust repo and preserve command/result evidence in the plan or validation notes.
- A future graph-diff view can display source provenance, confidence, and stale-index state.
  → verify: inspect a prototype result payload and UI detail pane for these fields.
- The UI can launch an agent review with selected findings and graph evidence while preserving the original analyzer output.
  → verify: capture the review launch payload and confirm it includes unmodified analyzer result refs plus selected graph evidence.
- The feature can coexist with the current commit-check governance without replacing it.
  → verify: confirm the implementation plan links to `docs/system/commit-validation-governance.md` and leaves commit-check commands unchanged.

## Implementation Links

- `docs/system/copilot-ui-guide.md`
- `docs/system/catalog-control-plane.md`
- `docs/system/commit-validation-governance.md`
- `docs/specs/assets-tools-management-v1/spec.md`
- External candidates: `https://semgrep.dev/docs/writing-rules/overview`, `https://ast-grep.github.io/`, `https://codeql.github.com/docs/`, `https://github.com/joernio/joern`, `https://tree-sitter.github.io/`, `https://rust-analyzer.github.io/`

## Validation Evidence

- Pending research. No UI, route, plugin integration, or analyzer orchestration has been validated.

## Drift Notes

- This spec depends on the outcome of Elegy's codegraph/plugin research. If `elegy-codegraph` is rejected or replaced by existing tools, this control-plane spec should consume the replacement rather than preserving the original name.
