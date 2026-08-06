---
created: 2026-04-12
updated: 2026-08-06
category: system
status: current
doc_kind: node
id: structured-output-contracts
summary: Convention for when and how agents must define structured output contracts.
tags: [conventions, output, agents]
related: [project-conventions-governance, session-retrospective-governance]
---

# Structured Output Contracts

## Purpose

Agents that produce categorized, rated, or comparative analysis use a common output contract pattern. This doc defines the convention so new agents adopt it consistently.

## The UPPERCASE_BLOCK Pattern

Every agent with structured output ends its response with a named block:

```text
BLOCK_NAME
- field: value
- status: pass|fail|partial
- confidence: high|medium|low
```

Rules:
- Block name is SCREAMING_SNAKE_CASE, descriptive of domain
- Fields use `key: value` format, one per line
- Enum values are pipe-delimited in the agent definition
- Include `confidence` and `next_action` in all blocks
- Use `NONE` (not empty string) for absent optional values

## When Agents Must Define Output Contracts

An agent SHOULD define `## Output (strict)` when it:
- Produces analysis consumed by other agents or automation
- Has findings that need severity classification
- Reports status that gates downstream decisions

An agent does NOT need a strict output block for:
- Conversational responses
- Single-item lookups
- Pure implementation work (code changes)

## Severity & Confidence

Use the reviewer severity vocabulary when a narrower skill or agent does not define its own mapping.

## Canonical Block Registry

The following blocks are defined in the shipped subagent prompts:

| Block | Agent | Structured-Output Contract |
|---|---|---|
| `QUICK_LANE_RESULT` | `quick` | docs/system/structured-output-contracts.md#canonical-block-registry |
| `PROJECT_LANE_RESULT` | `project` | Same |
| `IMPL_RESULT` | `impl` | Same |
| `EXPLORE_RESULT` | `explorer` | Same |
| `REVIEW_RESULT` | `reviewer` | Same |
| `SCOUT_RESULT` | `scout` | Same |
| `PLANNING_RUN_SUMMARY` | `planning.js` plugin tool | Same |
| `SESSION_RETROSPECTIVE` | Codex `evaluate-task-workflow` skill | New output uses `session-retrospective-v2` (`schemaVersion: "2"`); v1 remains parse-compatible; response-only Markdown with fenced `Structured State` JSON |
| `ELEGY_SESSION_STATE` | Codex `goal-session-workflow` skill | Hidden compact baseline or differential update for root-owned long-work continuation; the visible response remains concise |
| `AGENT_RESULT` | Codex native subagents | Common receipt envelope with role-specific payload |

Refer to each agent's frontmatter description and `## Output` section for field-level contracts.

### `SESSION_RETROSPECTIVE` contract

The Codex `evaluate-task-workflow` skill emits a `SESSION_RETROSPECTIVE` block
only when explicitly requested. The block contains the human-readable
assessment followed by a fenced JSON object labelled `Structured State`. New
results use `schemaVersion: "2"` under `session-retrospective-v2`; v1 remains
accepted for existing results. The JSON is the machine-readable
contract; prose is explanatory and must not be parsed as authority.

For this contract-specific block, `requiresUserDecision` is the action gate.
The v2 state includes an evidence-backed customization inventory and typed
proposal targets; it does not add a generic `next_action` field.

This is a response-only skill surface. It does not write session artifacts, create
UI projections, mutate planning records, or promote improvement candidates.
Any persistence or promotion requires a separate user-approved workflow and
the owning materialization/roadmap authority.

## Canonical References

- Reviewer: `docs/system/reviewer-lane-governance.md`
