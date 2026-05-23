---
name: instruction-quality
description: "Research-backed check rules for auditing agent instruction file quality. Triggers on: instruction quality, agent audit, audit instructions, instruction best practices, agent quality."
---

# Instruction Quality

## Purpose

Check rules for evaluating agent instruction files against empirical research on LLM instruction effectiveness.
Loaded by `instruction-auditor` agent. Not a standalone workflow.

## Osmani Gate (Master Filter)

Before including any instruction, ask: **"Can the agent discover this by reading code?"** If yes, don't include it.
This gate is a prerequisite — every other check rule assumes it has been applied first.

## Check Rules

| ID | Principle | Rule | Severity |
|----|-----------|------|----------|
| IQ-01 | Osmani Gate | Every instruction must fail "Can the agent discover this from code?" to be included | Critical |
| IQ-02 | Redundancy | Flag sections restating what code, filenames, or existing docs already convey | Critical |
| IQ-03 | Attention Tax | Flag files >120 lines; critical rules not in first/last 20% of file get positional warning | High |
| IQ-04 | Anchoring Trap | Flag explicit tool/library mentions — agents use mentioned tools 1.6× more; deprecated mentions = Critical | High |
| IQ-05 | Landmines Not Maps | Verify instructions focus on non-obvious hazards, not architectural overviews or file maps | Medium |
| IQ-06 | Living List | Flag instructions reading as static documentation rather than active hazard list; look for staleness indicators | Medium |
| IQ-07 | Cost Awareness | Flag verbose patterns: >3 sentences per rule, embedded examples >5 lines, repeated concepts across sections | Medium |
| IQ-08 | No Codebase Overviews | Flag any section titled or functioning as "Architecture", "Project Structure", "Codebase Overview", "Directory Layout" | Critical |
| IQ-09 | File Discovery | Flag instructions telling the agent where to find files — agents find files equally fast without guidance | Low |
| IQ-10 | Dynamic > Static | Advisory: note when instructions could be replaced by per-task context generation; not a fail condition | Low |

## Scoring Rubric

| Metric | Pass | Warn | Fail |
|--------|------|------|------|
| Total lines | ≤80 | 81–120 | >120 |
| Critical findings | 0 | — | ≥1 |
| High findings | ≤1 | 2–3 | >3 |
| Medium findings | ≤3 | 4–6 | >6 |
| Osmani Gate violations | 0 | — | ≥1 (auto-fail) |
| Redundancy ratio (redundant / total sections) | <10% | 10–25% | >25% |
| Positional compliance (critical rules in top/bottom 20%) | ≥90% | 70–89% | <70% |

## Anti-Patterns & False Positives

| Rule | Anti-Pattern (flag this) | When NOT to Flag |
|------|--------------------------|------------------|
| IQ-01 | "Use dependency injection for services" (agent reads Startup.cs) | Domain hazards invisible in code: "auth module uses custom middleware, don't refactor" |
| IQ-02 | "This repo uses React + TypeScript + Vite" (agent reads package.json) | Cross-repo conventions not inferable from single-repo code |
| IQ-03 | 200-line agent file with critical rules buried at line 100 | Files >80 lines where ALL content is non-redundant hazard warnings |
| IQ-04 | "Always use lodash for utilities" (anchors agent to lodash) | Tool mentions in "When NOT to use" sections (negative anchoring is intentional) |
| IQ-05 | "The src/ folder contains components, utils, and services" | Dependency graphs with known breaking-change paths |
| IQ-06 | Instructions referencing Node 16 patterns when project uses Node 22 | Stable long-term constraints: "never use ORM X due to licensing" |
| IQ-07 | 10-line embedded code example for a simple naming convention | Multi-step hazard procedures where brevity would lose critical detail |
| IQ-08 | `## Architecture` section explaining clean architecture layers | Tiny section (<3 lines) explaining genuinely non-obvious structural decision |
| IQ-09 | "Config files are in /config, tests are in /tests" | Paths that violate convention: "tests are in /src/__checks__ not /tests" |
| IQ-10 | Any static instruction that a code grep could replace | Regulatory/compliance rules that must be statically guaranteed |

## Creation Checklist

When generating new agent instruction files:

1. Apply Osmani Gate to each candidate instruction — remove what agents can discover from code
2. Start with zero instructions; add only after observing agent failure on a real task
3. Use terse format: one line per hazard, no prose paragraphs
4. Place critical rules in the first or last 20% of the file (U-shaped attention)
5. Never include codebase overviews, directory layouts, or architecture summaries
6. Avoid mentioning specific tools/libraries unless warning against them
7. Target ≤80 lines; warn at 120; fail above 120

## Source & Version

Research version: 2026-02-24

| ID | Source | Covers |
|----|--------|--------|
| S1 | Gloaguen et al., ETH Zurich, Feb 2026 — "Do Code Agents Benefit from Context Files?" (AGENTBENCH, 138 tasks, 12 repos, 4 agents) | IQ-01 through IQ-09 |
| S2 | Lulla et al., Jan 2026 — efficiency study (29% runtime reduction, no correctness gains) | Cost awareness context |
| S3 | Osmani, A. (Google), 2026 — practical synthesis | Osmani Gate filter, "landmines not maps" framing |
| S4 | ACE Framework, ICLR 2026 — Agentic Context Engineering | IQ-10: Dynamic > Static (12.3% improvement) |

Refresh trigger: update when new AgentBench results or follow-up studies are published.
