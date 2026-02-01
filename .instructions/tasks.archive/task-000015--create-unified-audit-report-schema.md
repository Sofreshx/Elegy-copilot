---
id: task-000015
title: "Create Unified Audit Report Schema"
status: done
priority: medium
owner: agent
depends_on: []
skills: []
created: 2026-01-31
updated: 2026-01-31
---

# task-000015: Create Unified Audit Report Schema

## Summary
Define a standardized report format that all auditors must follow, enabling the extension to parse and display results consistently.

## Acceptance Criteria
- [x] Template file `.github/templates/audit-report.schema.md` created
- [x] Defines YAML front matter schema (type, timestamp, stats)
- [x] Defines standard sections: Summary, Findings, Stats, Recommendations
- [x] Documents severity levels and finding format
- [x] Includes example report

## Implementation Notes
- Front matter: `type`, `timestamp`, `pass`, `warn`, `fail`, `duration`
- Findings format: severity, category, location, description, recommendation
- Stats section: counts by severity, by category
- Must be parseable by TypeScript (extension)
