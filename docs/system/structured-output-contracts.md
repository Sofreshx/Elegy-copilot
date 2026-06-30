---
created: 2026-04-12
updated: 2026-06-30
category: system
status: current
doc_kind: node
id: structured-output-contracts
summary: Convention for when and how agents must define structured output contracts.
tags: [conventions, output, agents]
related: [project-conventions-governance]
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

Refer to each agent's frontmatter description and `## Output` section for field-level contracts.

## Canonical References

- Reviewer: `docs/system/reviewer-lane-governance.md`
