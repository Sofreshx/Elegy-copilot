# Code Quality Control Plane Research Plan

## Purpose

Research the feature enough to decide whether Elegy-copilot should build a code quality control plane and which parts should remain in Elegy plugins.

## Phases

1. Inventory current control-plane surfaces for asset install, repo checks, settings, workspace tabs, and planning graph UI.
2. Compare candidate analyzers for TypeScript and Rust: Semgrep, ast-grep, CodeQL, Joern, Tree-sitter, rust-analyzer, and future `elegy-codegraph`.
3. Define the minimum result contract for analyzer findings, graph evidence, stale index state, provenance, confidence, and agent review launch.
4. Prototype a read-only operator flow for one TypeScript repo and one Rust repo.
5. Decide whether the next implementation spec should cover analyzer inventory, graph diff display, rule-pack management, or agent-review launch first.

## Research Outputs

- Ownership map between Elegy, Elegy-copilot, and consuming repos.
- Tool comparison table with cost, install complexity, language support, and output shape.
- Prototype evidence for TypeScript and Rust.
- Recommendation for the first implementation-ready slice, or a decision to stop if the codegraph/plugin direction is not useful enough.
