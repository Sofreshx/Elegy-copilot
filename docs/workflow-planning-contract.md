---
created: 2026-02-28
updated: 2026-02-28
category: system
status: current
doc_kind: node
---

# Workflow-Planning Contract

This document describes the shared type contracts that connect the **workflow engine** (local-tracker) to the **planning system** (copilot-ui) and how they are versioned across the monorepo.

## Package: `@instruction-engine/contracts`

Location: `contracts/`

A TypeScript-only package that emits compiled CommonJS `.js` + `.d.ts` declarations. It has **no runtime dependencies** — just type definitions.

### Modules

| Module | Exports | Purpose |
|---|---|---|
| `workflow` | `WorkflowStep`, `WorkflowDefinition`, `WorkflowStepResult`, `WorkflowRunResult`, `ExecutorRiskLevel` | DAG step/definition shapes and execution results |
| `planning` | `PlanningRecord`, `PlanningPersistenceHealth`, `RuntimeProvider` | Planning API record shapes |
| `bridge` | `WorkflowPlanningBridge`, `ExecutorPolicyRequest`, `ExecutorPolicyResponse` | Connects workflow outcomes to planning state |

### Consumption

- **local-tracker** (TypeScript): imports contracts directly. Compile-time conformance assertions in `workflowSchema.conformance.ts` verify that Zod-inferred types remain assignable to contract interfaces.
- **copilot-ui** (plain JS): uses JSDoc `@typedef {import('@instruction-engine/contracts').X}` for editor intellisense. No runtime `require()` needed.

### Schema Versioning

The workflow types include **v2 extension fields** (all optional with defaults):

| Field | Added to | Default | Purpose |
|---|---|---|---|
| `type` | `WorkflowStep` | `'action'` | Step classification |
| `condition` | `WorkflowStep` | (none) | Pre-execution condition expression |
| `outputs` | `WorkflowStep` | (none) | Named output declarations for chaining |
| `streaming` | `WorkflowStep` | `false` | Whether step emits streaming events |
| `schemaVersion` | `WorkflowDefinition` | `'1.0'` | Enables migration detection |

All v2 fields are optional, so existing v1 workflow templates parse without changes.

### Drift Detection

If the contracts package changes a required field or removes an optional one, the conformance assertions in `local-tracker/src/messagingGateway/workflows/workflowSchema.conformance.ts` will produce a compile-time TypeScript error — catching drift before it reaches runtime.

### Build Order

```
contracts (tsc) → local-tracker (tsc) → copilot-ui (no build for server.js)
```

The root `package.json` provides `npm run build:contracts` to build the contracts package. npm workspace dependency ordering ensures `contracts` builds first when using `npm run build --workspaces`.
