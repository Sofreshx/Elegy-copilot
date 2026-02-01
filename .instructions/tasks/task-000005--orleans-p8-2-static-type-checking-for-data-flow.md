---
schema: task/v1
id: task-000005
title: "ORLEANS-P8-2: Static Type Checking for Data Flow"
type: feature
status: not-started
priority: high
owner: "unassigned"
skills: ["feature-creator","csharp-expert","marten-documents","testing-dotnet-unit"]
depends_on: ["ORLEANS-P8-1"]
next_tasks: ["ORLEANS-P8-3"]
created: "2026-01-30"
updated: "2026-01-30"
---

## Context
- Ensure data type compatibility between step output ports and subsequent step input ports at design time.
- Prevent runtime type coercion and schema mismatches by validating schemas (JsonSchema) during design/save time.

## Acceptance Criteria
- [ ] Port type compatibility checking implemented
- [ ] Schema compatibility validation using `JsonSchema` (or equivalent)
- [ ] Detect and surface type coercion issues at design time
- [ ] Clear error messages indicating incompatible connections (including port names and step ids)
- [ ] Support optional ports and default values

## Plan / Approach
1. Add schema support to `Libraries/Abstractions/Tools/ToolPort.cs` so ports carry a JsonSchema or equivalent descriptor.
2. Extend `WorkflowValidator` to include port compatibility and schema validation rules.
3. Implement a composable schema-compatibility checker that understands optional fields and default values.
4. Add unit tests to cover compatible/incompatible cases, optional/default behaviors, and clear error localization.
5. Update workflow UI/save flow to surface type errors prominently to users.

## Files to Modify
- `Libraries/Workflow/Validation/WorkflowValidator.cs` (extend with type/schema checks)
- `Libraries/Abstractions/Tools/ToolPort.cs` (add schema property, validation helpers)

## Next Steps
- Prototype JsonSchema-based checking on a few common tool port types and add tests.
- Coordinate with UI team to ensure error messages map to UI validation errors.
