---
created: 2026-06-24
updated: 2026-06-24
category: research
status: current
doc_kind: index
id: enhancement-targets-index
summary: Index of enhancement-target plans for agentic code quality, codegraph, and review-evidence work.
tags: [research, enhancement-targets, code-quality, codegraph, review, index]
---

# Enhancement Targets — Index

Seven separately-workable themes for making agentic development more consistent,
trustworthy, and measurable. Each file is a standalone plan with rationale,
design, scope, sequencing, risks, and follow-ups.

Themes are research-direction artifacts, not implementation-ready specs. When a
theme is picked up, promote it to `docs/specs/<slug>/spec.md` via the
spec-authoring skill before implementation.

## Themes

| # | Theme | Ownership | Proven? | First-slice cost | Dependencies |
|---|-------|-----------|---------|------------------|--------------|
| 01 | [Architecture rules as tests](01-architecture-rules-as-tests.md) | Elegy plugin + this repo + copilot-ui | Very proven | Days | None |
| 02 | [Structural search & codemods](02-structural-search-codemods.md) | Elegy plugin + this repo + copilot-ui | Very practical | Days | None |
| 03 | [Codegraph V0: dependency & boundary graph](03-codegraph-v0-dependency-boundary-graph.md) | Elegy plugin + this repo + copilot-ui | Proven, harder | Weeks | Theme 5a schema (soft) |
| 04 | [Codegraph V1: symbols & references](04-codegraph-v1-symbols-references.md) | Elegy plugin + this repo | Proven, harder | Weeks | Theme 03 |
| 05 | [Review-agent evidence workflow](05-review-agent-evidence-workflow.md) | This repo | Foundational | Days (5a schema) → weeks (5b workflow) | 5a: none; 5b: Themes 01-04 produce evidence |
| 06 | [Evaluation protocol & metrics](06-evaluation-protocol-metrics.md) | This repo + copilot-ui | Independent | Days (6a corpus) → weeks (6b baseline) | 6a: none; 6b: Themes 01-05 to evaluate |
| 07 | [Security & dataflow backend](07-security-dataflow-backend.md) | Elegy plugin + this repo | Proven in security, heavy | Weeks | Themes 03-04; defer until 01-05 prove value |

## Dependency graph

```
01 (arch rules) ──────────────┐
02 (patterns)   ──────────────┤
                               ├──► 05 (evidence workflow) ──► 06 (evaluation)
03 (codegraph V0) ──► 04 (V1) ─┘

07 (security) — deferred, depends on 03+04
```

Themes 01, 02, 03, 05a (schema), 06a (corpus) can all start in parallel.
Themes 04, 05b (workflow), 06b (measurement), 07 are sequential.

## Coexistence boundary

All themes respect the QCP ↔ commit-check boundary from
`docs/specs/code-quality-control-plane-research/spec.md`:

- Commit-check owns (exclusively): test, coverage, lint, format, typecheck.
- These themes own (additively): architecture rules, structural patterns,
  codegraph, evidence workflow, evaluation, security dataflow.
- Nothing here duplicates or overrides a commit-check lane.

## Origin

Derived from research into ArchUnit, dependency-cruiser, jQAssistant, GitHub
stack graphs, Kythe, CodeQL, Joern, Semgrep, ast-grep, OpenRewrite, and the
Codebase-Memory LLM-graph paper (2026). See per-theme files for evidence.

## How to use these plans

1. Read the index to understand the landscape and sequencing.
2. Open the smallest relevant theme file for the direction you want to pursue.
3. Promote a theme to `docs/specs/<slug>/spec.md` when ready to implement.
4. Record durable planning state in elegy-planning (goal/roadmap/plan/work-point).
