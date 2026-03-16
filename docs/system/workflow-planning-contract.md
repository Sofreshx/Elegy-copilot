---
created: 2026-02-28
updated: 2026-03-16
category: system
status: current
doc_kind: node
id: workflow-planning-contract
summary: Shared type contracts that connect local-tracker workflow execution with copilot-ui planning records.
tags: [contracts, planning, workflow]
---

# Workflow-Planning Contract

This document describes the shared type contracts that connect the **workflow engine** (`local-tracker`) to the **planning system** (`copilot-ui`) and how they are versioned across the monorepo.

## Package: `@instruction-engine/contracts`

Location: `contracts/`

A TypeScript-only package that emits compiled CommonJS `.js` + `.d.ts` declarations. It has no runtime dependencies, only type definitions.

### Modules

| Module | Exports | Purpose |
|---|---|---|
| `workflow` | `WorkflowStep`, `WorkflowDefinition`, `WorkflowStepResult`, `WorkflowRunResult`, `ExecutorRiskLevel` | DAG step/definition shapes and execution results |
| `planning` | `PlanningRecord`, `ResearchNote`, `PlanningDiagram`, `PlanningPersistenceHealth`, `RuntimeProvider` | Planning API record shapes plus legacy planning-artifact compatibility fields |
| `bridge` | `WorkflowPlanningBridge`, `ExecutorPolicyRequest`, `ExecutorPolicyResponse` | Connects workflow outcomes to planning state |

### Planning Artifact Export Shape

`planning` exports include planning record fields used by the planning API routes, including
backward-compatible legacy planning-artifact surfaces that remain exported for older records.

```ts
export interface ResearchNote {
	id: string;
	phase: string;
	title: string;
	content: string;
	sources?: string[];
	createdAt: string;

	// Legacy aliases (optional)
	noteId?: string;
	summary?: string;
	source?: string;
	updatedAt?: string;
}

export interface PlanningDiagram {
	id: string;
	type: string;
	title: string;
	content: string;
	format: string;
	createdAt: string;

	// Legacy alias (optional)
	diagramId?: string;
	updatedAt?: string;
}
```

### Deprecated Planning-Artifact Compatibility Surfaces

The following `planning` exports remain available for backward-compatible reads/writes of older
planning records, but they are deprecated for new planning workflows:

- `PlanningRecord.researchNotes`
- `PlanningRecord.diagrams`
- `ResearchNote.noteId`, `ResearchNote.summary`, `ResearchNote.source`, `ResearchNote.updatedAt`
- `PlanningDiagram.diagramId`, `PlanningDiagram.updatedAt`

New planning flows should prefer repo-backed Repository Backlog and Roadmap docs, while session
execution state remains in session-state artifacts such as `plan.md`.

### Consumption

- `local-tracker` (TypeScript) imports contracts directly. Compile-time conformance assertions in `workflowSchema.conformance.ts` verify that Zod-inferred types remain assignable to contract interfaces.
- `copilot-ui` (plain JS) uses JSDoc `@typedef {import('@instruction-engine/contracts').X}` for editor intellisense. No runtime `require()` is needed.

### Schema Versioning

The workflow types include v2 extension fields (all optional with defaults):

| Field | Added to | Default | Purpose |
|---|---|---|---|
| `type` | `WorkflowStep` | `'action'` | Step classification |
| `condition` | `WorkflowStep` | (none) | Pre-execution condition expression |
| `outputs` | `WorkflowStep` | (none) | Named output declarations for chaining |
| `streaming` | `WorkflowStep` | `false` | Whether step emits streaming events |
| `schemaVersion` | `WorkflowDefinition` | `'1.0'` | Enables migration detection |

All v2 fields are optional, so existing v1 workflow templates parse without changes.

### Drift Detection

If the contracts package changes a required field or removes an optional one, the conformance assertions in `local-tracker/src/messagingGateway/workflows/workflowSchema.conformance.ts` produce a compile-time TypeScript error before runtime.

### Build Order

```text
contracts (tsc) -> local-tracker (tsc) -> copilot-ui (no build for server.js)
```

The root `package.json` provides `npm run build:contracts` to build the contracts package. npm workspace dependency ordering ensures `contracts` builds first when using `npm run build --workspaces`.
