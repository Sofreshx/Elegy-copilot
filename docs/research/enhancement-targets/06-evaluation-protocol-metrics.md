---
created: 2026-06-24
updated: 2026-06-24
category: research
status: current
doc_kind: node
id: enhancement-target-06-evaluation-protocol-metrics
summary: Plan for the evaluation protocol — graph-quality, review-quality (seeded-PR corpus), and agent-efficiency metrics to measure whether code-quality tooling actually improves agentic development.
tags: [research, enhancement-targets, evaluation, metrics, seeded-prs, benchmark, codebase-memory]
related: [enhancement-targets-index, enhancement-target-05-review-agent-evidence-workflow, enhancement-target-03-codegraph-v0-dependency-boundary-graph]
---

# Theme 06 — Evaluation Protocol & Metrics

> **Status:** Research plan. Promote to `docs/specs/code-quality-evaluation-protocol/spec.md` before implementation.
> **Provenance:** Independent to start; depends on Themes 01-05 to have something to evaluate.
> **First-slice cost:** Days (corpus) → weeks (baseline measurement).
> **Dependencies:** Themes 01-05 produce the systems to evaluate. The corpus + metric definitions ship first.

## Why this direction

### The problem

You cannot improve what you cannot measure. The GPT research is explicit:

> Score the graph itself: import edge precision/recall, symbol extraction
> coverage, reference resolution confidence, stale index detection,
> changed-file → affected-test recall, architecture-rule runtime, false-positive
> rate per rule. **This is important: the graph must be evaluated independently
> from the LLM, or you will not know whether improvement comes from better
> structure or just a stronger model.**

Without an evaluation protocol, every theme (01-05, 07) ships on vibes. You
cannot tell whether arch-rules reduce regressions, whether the codegraph
narrows impact correctly, whether the evidence workflow makes reviews more
trustworthy, or whether agent efficiency actually improved. A stronger model
might mask a broken graph; a weaker model might hide a good one.

### Why three metric families

The research identifies three distinct things to measure, and they must be
measured separately:

1. **Graph-quality metrics** — evaluate the graph/index **without the LLM**.
   Is the index correct? Does it have false edges? Does it miss real edges?
   This isolates extraction quality from review quality.

2. **Review-quality metrics** — use **seeded PRs with known issues**. Does the
   review (LLM + evidence) catch the seeded defect? Does it hallucinate? Does
   it cite evidence? This measures the end-to-end review system.

3. **Agent-efficiency metrics** — measure tokens, tool calls, file reads,
   wall-clock. Did the evidence pack reduce exploration cost? This measures
   whether the tooling makes agents faster, not just more correct.

The Codebase-Memory paper (2026) gives a useful target class: it claims 10×
fewer tokens and 2.1× fewer tool calls with slightly lower answer quality
versus file exploration, across 31 repositories. Your internal target could be
less aggressive but still measurable: **30-60% fewer file reads/tool calls
without lower review quality.**

### Why the corpus ships first

The seeded-PR corpus is the foundation. Without it, review-quality metrics have
no ground truth. The corpus is cheap to author (days) and independent of the
graph/index — it is just a set of branches with known injected defects. Once
the corpus exists, any theme can be evaluated against it.

## What this is

Three metric families plus the seeded-PR corpus that grounds them.

### Components

| Layer | Owner | What |
|---|---|---|
| Seeded-PR corpus | This repo (`docs/research/eval-corpus/` or a branch set) | Branches with known injected defects |
| Graph-quality metrics | This repo (`scripts/eval-graph-quality.js`) | Precision/recall/coverage measurements against the index |
| Review-quality metrics | This repo (`scripts/eval-review-quality.js`) | TP/FP/missed-defect scoring against the corpus |
| Agent-efficiency metrics | This repo (`scripts/eval-agent-efficiency.js`) | Token/tool-call/file-read/wall-clock measurement |
| Baseline dashboard | copilot-ui | Metrics dashboard in a new "Evaluation" tab |
| Canonical doc | This repo (`docs/system/`) | `evaluation-protocol.md` |

### Non-goals

- Do not build a generic LLM benchmark — this is specific to code-quality
  tooling on this repo (and eventually other Elegy-managed repos).
- Do not make evaluation a commit gate — it is a research/quality instrument,
  not a CI blocker (QCP coexistence).
- Do not conflate graph quality with review quality — measure them separately.
- Do not measure model capability in isolation — the goal is to measure the
  **system** (graph + evidence + review), which is what ships.

## Design

### Seeded-PR corpus

A set of branches, each with one known injected defect. Each branch is
documented with: defect type, location, expected detection signal, expected
evidence source.

| Defect type | Example injection | Expected signal | Expected evidence |
|---|---|---|---|
| Forbidden import introduced | CLI file imports `src/db/raw.ts` | arch-rule `cli-no-db-direct` | deterministic-tool |
| Cycle introduced | A→B→A import cycle | arch-rule `no-cycles-per-module-group` | deterministic-tool |
| Public API changed without test update | Rename exported fn, no test change | `changed-public-api` (Theme 04) + test coverage gap | deterministic-tool |
| Doc claim stale after code change | Change a function signature; doc still describes old shape | `doc_links` staleness (Theme 03) | deterministic-tool |
| Pattern copied incorrectly | Skill frontmatter missing `description` | pattern `skill-frontmatter-required-fields` (Theme 02) | deterministic-tool |
| Dead exported symbol introduced | Add an exported fn, never called | `dead-exports` (Theme 04) | heuristic-tool |
| Test no longer covers changed branch | Modify a conditional; test still passes but branch uncovered | coverage gap (advisory) | deterministic-tool |
| Unsafe command construction introduced | `exec(req.body.cmd)` | security skill + semgrep pattern (Theme 02) | deterministic-tool |
| Path traversal introduced | `fs.readFile(req.body.path)` | semgrep `forbidden-fs-readfile-user-path` (Theme 02) | deterministic-tool |
| Auth bypass introduced | Middleware not wired on new route | security skill | llm-only (no deterministic rule yet) |

Each seeded PR has a manifest:

```yaml
# docs/research/eval-corpus/01-forbidden-import.yml
defect_id: 01-forbidden-import
defect_type: forbidden-import
branch: eval/01-forbidden-import
injection:
  file: src/cli/commands/planning.ts
  change: "add import { rawQuery } from '../../db/raw'"
expected_signal:
  source: arch-rule
  rule_id: cli-must-not-import-db-directly
  provenance: deterministic-tool
expected_verdict: revise
```

### Graph-quality metrics

Measure the graph/index **without the LLM**:

| Metric | Definition | Target |
|---|---|---|
| Import edge precision | True imports / total detected imports | ≥0.98 |
| Import edge recall | Detected imports / true imports | ≥0.95 |
| Symbol extraction coverage | Extracted exported symbols / true exported symbols | ≥0.95 (TS) |
| Reference resolution precision | Correct references / detected references | ≥0.90 |
| Reference resolution recall | Detected references / true references | ≥0.85 |
| Stale index detection | Correctly flags stale index when HEAD moves | 100% |
| Changed-file → affected-test recall | Detected affected tests / true affected tests | ≥0.90 |
| Architecture-rule runtime | Wall-clock per rule | <5s per rule (cheap class) |
| False-positive rate per rule | FP findings / total findings per rule | <5% per rule |

These run against a known-good hand-labeled subset of the repo (the eval
corpus provides the ground truth). The script outputs a JSON report:

```json
{
  "graph_quality": {
    "import_precision": 0.99,
    "import_recall": 0.97,
    "symbol_coverage_ts": 0.96,
    "reference_precision": 0.92,
    "affected_test_recall": 0.91,
    "rule_runtime_ms": { "cli-no-db-direct": 120, "no-cycles": 340 },
    "fp_rate_per_rule": { "cli-no-db-direct": 0.0, "no-cycles": 0.02 }
  }
}
```

### Review-quality metrics

Run the review system (LLM + evidence pack) against each seeded PR and score:

| Metric | Definition |
|---|---|
| True positives | Seeded defects correctly detected |
| False positives | Non-defects flagged as defects |
| Missed defects | Seeded defects not detected |
| Explanation quality | Does the review explain the defect correctly? (rubric-scored) |
| Evidence citation quality | Does the review cite `deterministic-tool` evidence for structural claims? |
| Fix correctness | Is the suggested fix correct? (rubric-scored) |
| Verdict correctness | Does the verdict match `expected_verdict`? |

Scoring is partly automated (TP/FP/missed via expected-signal match) and partly
rubric-scored (explanation, fix correctness) — the rubric can be LLM-graded
with human spot-checks, but the ground truth is the corpus manifest.

### Agent-efficiency metrics

Run the same review task with and without the evidence pack (same model, same
repo state) and measure:

| Metric | Without pack | With pack | Target |
|---|---|---|---|
| Tokens used | baseline | ? | 30-60% reduction |
| Tool calls | baseline | ? | 30-60% reduction |
| Files read | baseline | ? | 30-60% reduction |
| Grep/search calls | baseline | ? | reduction |
| Wall-clock time | baseline | ? | neutral or reduction |
| Context reloads | baseline | ? | reduction |
| Failed exploratory paths | baseline | ? | reduction |

The Codebase-Memory paper's 10×/2.1× claim is the aggressive reference; the
internal target is 30-60% reduction without lower review quality.

### Critical: isolate graph quality from model quality

The protocol must run the same review task across:

- Different models (hold graph constant) — does a stronger model mask a broken graph?
- Different graph states (hold model constant) — does a better graph help a weaker model?
- With/without evidence pack (hold model + graph constant) — does the pack add value?

Without this isolation, you cannot attribute improvement to the right cause.

## Implementation phases

### Phase 06a-1 — Seeded-PR corpus (days)

- Author 10 seeded-PR branches with manifests.
- Document the corpus in `docs/research/eval-corpus/README.md`.
- Each branch is a single-defect injection off `main`.

### Phase 06a-2 — Metric definitions (days)

- Author `docs/system/evaluation-protocol.md` defining all metrics.
- Author metric scripts: `scripts/eval-graph-quality.js`,
  `scripts/eval-review-quality.js`, `scripts/eval-agent-efficiency.js`.
- Scripts output JSON reports to `docs/research/eval-results/<date>/`.

### Phase 06b-1 — Graph-quality baseline (weeks, after Theme 03)

- Run graph-quality metrics against the V0 index.
- Capture baseline precision/recall/coverage.
- Identify rules with high FP rates for tuning.

### Phase 06b-2 — Review-quality baseline (weeks, after Themes 01-05)

- Run the review system against all 10 seeded PRs.
- Capture TP/FP/missed-defect rates.
- Capture evidence-citation quality.
- Compare: review without evidence pack vs. review with evidence pack.

### Phase 06b-3 — Agent-efficiency baseline (weeks)

- Run the same review task with/without evidence pack.
- Capture token/tool-call/file-read metrics.
- Verify the 30-60% reduction target (or document why it is not met).

### Phase 06c — Dashboard

- Add "Evaluation" tab in copilot-ui.
- Show: corpus status, latest graph-quality report, latest review-quality
  report, latest agent-efficiency report, trend over time.
- Flag rules with FP rate >5% for tuning.

## Coexistence boundary

- Evaluation is a **research/quality instrument**, not a commit gate.
- It does not block commits or PRs.
- It does not duplicate the commit-check trilogy's scoring.
- Results inform tuning of Themes 01-05 but do not override their authority.

## Follow-ups & future work

- **Regression tracking:** Run the evaluation on each theme release and track
  metrics over time. Detect regressions in graph quality or review quality.
- **Cross-repo evaluation:** Extend the corpus to other Elegy-managed repos to
  test portability of rules and graph extraction.
- **Model sweep:** Run the review-quality metrics across multiple models to
  build a model-vs-system quality map. Identifies where a stronger model
  compensates for a weaker graph.
- **Automated corpus generation:** An agent could generate new seeded PRs from
  the rule set (inject a violation of each rule), expanding the corpus
  automatically. Human-validates the injection.
- **Public benchmark contribution:** If the corpus and protocol prove useful,
  consider publishing as a benchmark for agentic code-quality tooling.
- **Tie to Theme 05 evidence-citation quality:** The core trust metric — does
  the reviewer cite `deterministic-tool` evidence for structural claims, or
  hallucinate? — is measured here and feeds back into reviewer prompt tuning.

## Dependencies & sequencing

- **06a (corpus + definitions):** No hard dependencies. Ships first.
- **06b (baselines):** Depends on Themes 01-05 producing systems to evaluate.
  Graph-quality baseline needs Theme 03; review-quality baseline needs Themes
  01-05; agent-efficiency baseline needs the evidence pack (Theme 05).
- **06c (dashboard):** Depends on 06b producing data.
- **Unblocks:** Nothing hard, but it **enables trust** in all other themes.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Corpus too small to be statistically meaningful | Start with 10; expand to 30+; document confidence intervals |
| Rubric-scoring is subjective | LLM-grade with human spot-checks; publish the rubric; track inter-rater agreement |
| Model improvements mask graph regressions | Isolate: hold model constant when testing graph changes; run model sweeps separately |
| Evaluation is slow/expensive | Cache results per (model, graph-sha, corpus-version); run nightly, not per-PR |
| Corpus defects drift from real-world defects | Periodically refresh from real review findings; tag corpus entries by source |
| Agent-efficiency metrics vary by harness | Record harness in metrics; compare within-harness, not across |

## Acceptance criteria (for the eventual spec)

- 10 seeded-PR branches exist with manifests in `docs/research/eval-corpus/`.
- `scripts/eval-graph-quality.js` outputs a JSON report with all defined metrics.
- `scripts/eval-review-quality.js` scores TP/FP/missed against the corpus.
- `scripts/eval-agent-efficiency.js` measures tokens/tool-calls/file-reads with/without pack.
- A baseline report exists in `docs/research/eval-results/` for each metric family.
- The evaluation dashboard renders the latest reports.
- `node scripts/validate-specs.js --strict` passes for the promoted spec.

## Related artifacts

- `docs/specs/code-quality-control-plane-research/spec.md` — QCP context
- `docs/research/enhancement-targets/05-review-agent-evidence-workflow.md` — evidence-citation quality metric
- `docs/research/enhancement-targets/03-codegraph-v0-dependency-boundary-graph.md` — graph to evaluate
- External: Codebase-Memory paper (2026) — target class reference
