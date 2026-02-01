---
schema: task/v1
id: task-000007
title: "ORLEANS-P8-4: AI Guard Rails for Workflow Creation"
type: feature
status: not-started
priority: high
owner: "unassigned"
skills: ["feature-creator","openai-compatible","security","testing-dotnet-unit"]
depends_on: ["ORLEANS-P8-1","ORLEANS-P8-3"]
next_tasks: []
created: "2026-01-30"
updated: "2026-01-30"
---

## Context
- AI agents may suggest or create workflows; these automated creations must pass the same design-time validation rules.
- AI-generated workflows must be prevented from saving invalid or non-deterministic constructs (e.g., free-form LLM conditionals).

## Acceptance Criteria
- [ ] Validator runs before AI-created workflows are persisted
- [ ] Validation errors returned in a machine-readable form suitable for AI interpretation and retry
- [ ] AI can receive structured error feedback and re-submit corrected workflows
- [ ] Document blocked patterns for AI (e.g., no LLM-based conditionals without schema-validated outputs)
- [ ] Audit log of AI workflow creation attempts (success/failure, errors)

## Plan / Approach
1. Integrate `IWorkflowValidator` into the AI workflow creation path under `Libraries/AI/Agent/` so generated workflows are validated before save.
2. Define a machine-friendly error payload (structured list of errors with codes and locations) that AI agents can consume to auto-correct.
3. Add an audit log that records AI attempts to create workflows including the validation outcome and error details.
4. Add documentation for blocked patterns and examples of valid vs invalid AI-generated workflows.
5. Add tests to ensure AI-created workflows are rejected on invalid constructs and that error payloads are usable for automated retries.

## Files to Modify
- `Libraries/AI/Agent/*` (where workflow creation logic lives)
- Integration points to `IWorkflowValidator` and workflow save endpoint

## Next Steps
- Implement validator integration in the AI agent and add E2E tests simulating AI retries.
- Update AI docs/guidelines and add audit tooling to monitor attempts.
