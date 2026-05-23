---
name: structured-analysis-output
description: "Reusable output contract patterns for agents producing categorized, rated, or comparative analysis. Triggers on: structured output, analysis format, rated overview, categorized findings, output contract."
---

# Structured Analysis Output

## When to Use

Apply structured output when your response includes:
- 5+ distinct findings, options, or evaluation items
- Comparative analysis across multiple areas
- Risk/quality/readiness assessment
- Any deliverable another agent or human must parse reliably

Do NOT apply to: simple answers, single-item responses, or conversational replies.

## Output Block Convention

End your analysis with a named UPPERCASE block. Use `key: value` pairs with pipe-delimited enums.

```text
ANALYSIS_NAME
- scope: <what was analyzed>
- status: pass|partial|fail|needs-revision
- confidence: high|medium|low
- finding_count: <N>
- key_finding: <one-sentence summary of most important result>
- next_action: <recommended human or agent action>
```

Choose a descriptive block name matching your domain: `CI_DIAGNOSIS`, `EXPLORATION_RESULT`, `DEEP_RESEARCH`, `TEST_QUALITY`, etc.

## Severity Mapping

When findings have varying importance, classify each:

| Severity | Use When |
|----------|----------|
| Critical | Blocks progress, causes failure, data loss, or security breach |
| High | Likely to cause bugs or operational issues if unaddressed |
| Medium | Best practice gap; risk at scale or over time |
| Low | Minor improvement opportunity |

Group findings by severity (Critical first). Include counts.

## Confidence Signal

Always include confidence when making judgments:
- **high**: Strong evidence, verified through multiple sources
- **medium**: Reasonable evidence, some assumptions
- **low**: Limited evidence, significant uncertainty

## Categorization Patterns

**By severity** (audits, reviews):
```text
Critical (2): [findings]
High (3): [findings]
Medium (1): [findings]
```

**By domain** (exploration, architecture):
```text
Authentication: [findings]
Data layer: [findings]
API surface: [findings]
```

**By status** (goal review, pipeline check):
```text
Complete: [items]
Partial: [items]
Not started: [items]
```

## Existing Contracts (Reference)

These agents already follow this pattern — use them as examples:

| Agent | Block Name | Key Fields |
|-------|-----------|------------|
| ci-watcher | `CI_DIAGNOSIS` | failure_class, root_cause, confidence, repair_branch |
| deep-researcher | `DEEP_RESEARCH` | reasoning_chain, findings, gaps, confidence |
| code-explorer | `EXPLORATION_RESULT` | scope, layers, patterns, dependencies |
| final-reviewer | `FINAL_REVIEW` | requested, delivered, validation_gaps, confidence |
| goal-reviewer | `GOAL_REVIEW` | goals with completion states, carryover_goals |
| working-reviewer | `WORKING_REVIEW` | evidence_reviewed, missing_validation, confidence |

## Relationship to audit-report-formats

The `audit-report-formats` skill is a specialized subset for formal audit reports (YAML frontmatter, stats tables, trends). Use it for auditors. Use this skill for the broader pattern — any agent that produces categorized analysis.
