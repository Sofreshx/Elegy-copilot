---
schema: task/v1
id: task-000004
title: "ORLEANS-P8-1: Design-Time Workflow Validation Rules"
type: feature
status: not-started
priority: high
owner: "unassigned"
skills: ["feature-creator","orleans","security","testing-dotnet-unit"]
depends_on: ["ORLEANS-P2-1","ORLEANS-P6-3"]
next_tasks: ["ORLEANS-P8-2"]
created: "2026-01-30"
updated: "2026-01-30"
---

## Context
- See plan artefact: `.instructions/artefacts/orleans-workflow-evolution-PLAN-artefact.md` for Phase 8 overview.
- Workflows must be statically resolvable; no "figure it out" steps at runtime.
- Design-time validation prevents invalid workflows from being saved/executed.

## Acceptance Criteria
- [ ] `IWorkflowValidator` interface implemented
- [ ] Rules to enforce:
  - All inputs have explicit sources (user input, previous step, constant)
  - All conditionals are boolean expressions (no free-form LLM reasoning)
  - All referenced tools exist and are Frozen (or system tools)
  - No circular dependencies among steps
  - No unbounded loops without termination conditions
  - LLM tools used in conditionals have schema-validated outputs
- [ ] `ValidationResult` with clear, actionable error messages and location info
- [ ] Validation integrated with the workflow save endpoint (reject or surface issues before persist)

## Plan / Approach
1. Define `IWorkflowValidator` contract with a `Validate(WorkflowDefinition)` API that returns `WorkflowValidationResult`.
2. Implement core rules as individual `IWorkflowValidationRule` implementations for testability and clear error locations.
3. Create `WorkflowValidationResult` model capturing errors, severity, and location (step id / port / expression).
4. Wire validation into the API layer so the save endpoint invokes the validator and rejects invalid workflows with 4xx and a structured payload.
5. Add unit tests for each rule and end-to-end tests for API integration.
6. Add docs describing blocked patterns and guidance for authors (including AI-created workflows).

## Files to Create
- `Libraries/Workflow/Validation/IWorkflowValidator.cs`
- `Libraries/Workflow/Validation/WorkflowValidator.cs`
- `Libraries/Workflow/Validation/WorkflowValidationResult.cs`
- `Libraries/Workflow/Validation/WorkflowValidationRule.cs`

## Next Steps
- Assign owner and start with `IWorkflowValidator` and a small set of rule implementations for inputs & conditionals.
- Add automated tests and an integration test for the save endpoint.
