---
created: 2026-04-12
updated: 2026-04-12
category: system
status: current
doc_kind: node
id: model-capability-profile
summary: Canonical model capability profiles for routing and delegation decisions in model-specific orchestrator variants.
tags: [models, routing, capabilities, orchestration]
related: [search-execute-workflow, reviewer-lane-governance]
---

# Model Capability Profiles

## Purpose

Track model-family strengths and weaknesses so orchestrator variants and delegation logic can make evidence-based routing decisions. This is a living document — update when new model versions or observed behaviors materially change routing tradeoffs.

## Profile Schema

Each model family entry uses:

| Field | Description |
|---|---|
| **model_family** | Canonical name (e.g., `Claude Opus 4.x`, `GPT-5.4`) |
| **tier** | `primary` (orchestrator-capable) or `utility` (leaf/reviewer only) |
| **strengths** | 3–6 bullet capabilities where this model outperforms alternatives |
| **weaknesses** | 2–4 bullet areas where this model underperforms or needs mitigation |
| **best_as** | Recommended orchestration roles |
| **delegation_notes** | How to craft effective prompts/payloads for this model |
| **known_limits** | Hard constraints (context window, tool support, latency) |

## Profiles

### Claude Opus / Sonnet 4.x

- **tier:** primary
- **strengths:**
  - Interpreting ambiguous, conversational, or underspecified user input
  - Nuanced multi-step reasoning across long contexts
  - Following complex, layered instructions with many constraints
  - Maintaining coherent session state over extended conversations
  - Empathetic and calibrated user interaction
- **weaknesses:**
  - Can over-interpret or hallucinate intent when input is genuinely sparse
  - Occasionally verbose when concise structured output is needed
  - May defer rather than commit on edge-case judgment calls
- **best_as:** orchestrator (especially for messy/ambiguous input), prompt-refiner, reviewer
- **delegation_notes:** Responds well to open-ended prompts with rich context. Benefits from explicit "stop and ask" instructions when input is genuinely insufficient.
- **known_limits:** Update per version.

### GPT-5.4 (including xHigh)

- **tier:** primary
- **strengths:**
  - Deep scoped research with systematic file-by-file analysis
  - Structured problem-solving and formal reasoning
  - Precise, schema-conformant output generation
  - Exhaustive comparative option analysis
  - Strong at following explicit, well-scoped prompts
- **weaknesses:**
  - Struggles with ambiguous or multi-intent input (tends to pick one interpretation)
  - Less effective at conversational back-and-forth for disambiguation
  - May miss implicit context that wasn't explicitly stated
- **best_as:** deep-researcher, orchestrator (for well-scoped work), reviewer
- **delegation_notes:** Pre-structure prompts with explicit scope, success criteria, and expected output shape. Avoid open-ended "figure out what the user meant" delegation.
- **known_limits:** xHigh mode available for complex tasks. Update per version.

### GPT-5-mini / Haiku 4.5

- **tier:** utility
- **strengths:**
  - Fast, low-cost triage and advisory checks
  - Adequate for heuristic scans (remaining work, quick status)
- **weaknesses:**
  - Not suitable for complex reasoning or orchestration
- **best_as:** remaining-work, fast advisory, triage, exploration
- **delegation_notes:** Keep prompts short and well-scoped. Expect best-effort quality.
- **known_limits:** Update per version.

## When to Use Mini vs Full Models

Route to **mini** (gpt-5-mini, haiku 4.5) for:
- Status checks: git status, "is there remaining work?", session health
- Log analysis: CI failure triage, error classification
- Listing/scanning: enumerate files, find patterns, quick search
- Summarization: condense existing content without deep reasoning

Route to **full** (gpt-5.4, claude sonnet/opus) for:
- Implementation: writing or modifying code
- Design and architecture: multi-file changes, API design, data modeling
- Deep research: comparative analysis, systematic exploration
- Review: code review, logic validation, consistency checking
- Ambiguous input: anything requiring intent interpretation or disambiguation

**Rule of thumb**: If the task needs judgment, creativity, or multi-step reasoning, use full. If it needs speed and the answer is mostly lookup/scan, use mini.

## Integration with Routing

Orchestrator variants should:
1. Use `strengths` and `weaknesses` to decide when to delegate cross-model vs self-serve.
2. Use `delegation_notes` to craft effective prompts for sub-agents on different model families.
3. Update this doc when observed behavior diverges from documented profiles.

This doc is advisory. It does not override orchestrator non-negotiables or canonical workflow docs.
