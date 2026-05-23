---
name: audit-report-formats
description: "Standard audit report schema: frontmatter, severity definitions, finding format, stats, and trends. Triggers on: audit report, report format, audit findings, severity definitions, audit schema."
---

# Audit Report Formats

## Report Frontmatter Schema

Required YAML frontmatter for all audit reports:
- `type`: audit type (e.g., `security`, `deploy`, `stack`)
- `timestamp`: ISO 8601 (`YYYY-MM-DDTHH:MM:SSZ`)
- `duration_ms`: scan duration in milliseconds
- `repo`: target repository name
- `stats.pass`: count of passing checks
- `stats.warn`: count of warnings
- `stats.fail`: count of failures

## Severity Definitions

| Severity | Definition |
|----------|------------|
| Critical | Causes runtime failure, data loss, or security breach |
| High | Likely to cause bugs, outages, or operational issues |
| Medium | Best practice violation; may cause issues at scale |
| Low | Style, convention, or minor improvement opportunity |

## Required Report Sections
1. **Summary** — brief overview of findings
2. **Findings** — grouped by severity (Critical → High → Medium → Low)
3. **Stats table** — counts by severity
4. **Recommendations** — prioritized action items

## Standard Finding Format (6 fields)
- **Severity**: Critical / High / Medium / Low
- **Category**: classification tag (see below)
- **Location**: file path and line number
- **Description**: what was found
- **Recommendation**: how to fix
- **Status**: `Open` | `Fixed` | `Accepted-Risk`

## Stats Table Format

| Severity | Count | Fixed | Remaining |
|----------|-------|-------|-----------|
| Critical | N | N | N |
| High | N | N | N |
| Medium | N | N | N |
| Low | N | N | N |

## Trends Format
When a previous audit exists, include:
- New issues: +N
- Resolved: −N
- Net change: ±N
- Recurring unresolved: list critical items if any

## Finding Categories by Audit Type

| Audit Type | Categories |
|------------|------------|
| security | vulnerability, dependency, secrets, compliance |
| deploy | drift, config, env-vars, infrastructure, networking |
