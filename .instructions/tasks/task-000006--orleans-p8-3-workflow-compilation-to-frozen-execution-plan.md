---
schema: task/v1
id: task-000006
title: "ORLEANS-P8-3: Workflow Compilation to Frozen Execution Plan"
type: feature
status: not-started
priority: high
owner: "unassigned"
skills: ["feature-creator","orleans","refactor","testing-dotnet-unit"]
depends_on: ["ORLEANS-P8-1","ORLEANS-P8-2"]
next_tasks: ["ORLEANS-P8-4"]
created: "2026-01-30"
updated: "2026-01-30"
---

## Context
- After a workflow definition passes validation, it must be compiled to an immutable, versioned execution plan (the Frozen Execution Plan).
- Runtimes must only execute the frozen plan and not rely on live definitions.

## Acceptance Criteria
- [ ] `WorkflowCompiler` that transforms a validated definition into a frozen execution plan
- [ ] `WorkflowExecutionPlan` model (immutable, versioned artifact)
- [ ] Execution plan includes snapshots of all referenced addons and tool metadata
- [ ] Version tracking between definition and plan (plan includes source definition id + version)
- [ ] Plans are persisted as immutable artifacts and cannot be modified after creation

## Plan / Approach
1. Implement `WorkflowCompiler` responsible for resolving references, normalizing steps, and producing `WorkflowExecutionPlan`.
2. Define `WorkflowExecutionPlan` as an immutable, versioned DTO; include snapshots of tools/addons and any required artifacts.
3. Add `CompiledStep` model capturing resolved inputs/outputs, tool version ids, and static evaluation of conditionals.
4. Persist plans (e.g., `Documents/WorkflowPlans`) and ensure API surfaces `CreatePlan` and `GetPlan` endpoints.
5. Add migration tests, schema compatibility tests, and tests asserting immutability.

## Files to Create
- `Libraries/Workflow/Compilation/WorkflowCompiler.cs`
- `Libraries/Workflow/Compilation/WorkflowExecutionPlan.cs`
- `Libraries/Workflow/Compilation/CompiledStep.cs`

## Next Steps
- Implement a small end-to-end flow: validated definition → compile → persist plan → load plan for read-only execution.
- Add integration tests and verify runtime uses the plan, not the live definition.
