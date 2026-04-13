---
created: 2026-04-12
updated: 2026-04-12
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

See `structured-analysis-output` skill for severity mapping (Critical/High/Medium/Low) and confidence definitions (high/medium/low).

## Canonical References

- Skill: `engine-assets/skills/structured-analysis-output/SKILL.md`
- Audit specialization: `engine-assets/skills/audit-report-formats/SKILL.md`
- Reviewer lanes: `docs/system/reviewer-lane-governance.md`
