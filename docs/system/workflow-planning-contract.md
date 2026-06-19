---
created: 2026-02-28
updated: 2026-05-18
category: system
status: current
doc_kind: node
id: workflow-planning-contract
summary: Shared contracts for workflow definitions, roadmap workflow artifacts, and planning compatibility payloads in `@elegy-copilot/contracts`.
tags: [contracts, planning, workflow]
---

# Workflow-Planning Contract

## Purpose

Define the planning-adjacent contract surfaces exported by `@elegy-copilot/contracts` and used by
`local-tracker`, `copilot-ui`, and the workflow-artifact bridge.

## Package: `@elegy-copilot/contracts`

Location: `contracts/`

A shared package that emits CommonJS plus `.d.ts` declarations for use across the monorepo.

## Planning-Adjacent Modules

| Module | Key exports | Current role |
| --- | --- | --- |
| `workflow` | `WorkflowStep`, `WorkflowDefinition`, `WorkflowStepResult`, `WorkflowRunResult`, `ExecutorRiskLevel` | Workflow template and run-result shapes |
| `roadmapWorkflow` | `ROADMAP_WORKFLOW_ARTIFACT_SCHEMA_VERSION`, `ROADMAP_WORKFLOW_ARTIFACT_KINDS`, `RoadmapWorkflowStructuredArtifact`, `parseRoadmapWorkflowMarkdownArtifact`, `computeRoadmapWorkflowArtifactChecksum` | Live workflow-artifact contract consumed by `/api/planning/workflow-artifacts` |
| `planning` | `PlanningRecord`, `ResearchNote`, `PlanningDiagram`, `PlanningPersistenceHealth`, `PlanningIntakeArtifact`, synced-note and Obsidian types, `PLANNING_API_CONTRACT_VERSION` | Compatibility and admin planning payloads still used by `copilot-ui` |
| `bridge` | `WorkflowPlanningBridge`, `ExecutorPolicyRequest`, `ExecutorPolicyResponse` | Legacy workflow-to-planning-record bridge types plus executor policy payloads |

This document focuses on the planning-adjacent modules. The package also exports non-planning
contracts such as catalog, provider-catalog, and agentic types.

## Roadmap Workflow Artifact Contract

The live planning cutover uses `contracts/src/roadmapWorkflow.ts` as the structured workflow-artifact
contract.

Each artifact is markdown with a required `## Structured State` JSON block. The parser and
normalizer for that contract live in the shared package so both write and read paths agree on the
same shape.

```ts
export interface RoadmapWorkflowStructuredArtifact {
	schemaVersion: '1';
	kind: RoadmapWorkflowArtifactKind;
	roadmapId: string;
	sliceId?: string;
	phase: RoadmapWorkflowPhase;
	status: RoadmapWorkflowStatus;
	followUps: string[];
	requiresUserDecision: boolean;
	repoId?: string;
	sessionId?: string;
	acceptance?: RoadmapWorkflowAcceptanceState;
	memoryCandidates?: RoadmapWorkflowMemoryCandidate[];
	metadata?: Record<string, unknown>;
}
```

Current enumerations in that module:

- kinds: `roadmap.definition`, `roadmap.plan.result`, `roadmap.implementation.result`, `roadmap.review.result`, `roadmap.reevaluation.result`, `roadmap.session.recap`, `roadmap.completion.result`
- phases: `definition`, `plan`, `implementation`, `review`, `reevaluation`, `recap`, `completion`
- statuses: `draft`, `proposed`, `in_progress`, `pass`, `fail`, `blocked`, `done`, `completed`, `cancelled`

The shared helpers that enforce the live contract are:

- `parseRoadmapWorkflowMarkdownArtifact()`
- `normalizeRoadmapWorkflowStructuredArtifact()`
- `computeRoadmapWorkflowArtifactChecksum()`

`copilot-ui/routes/planning.js` uses that contract for `POST /api/planning/workflow-artifacts` and
`GET /api/planning/workflow-artifacts`.

## Planning Compatibility Contract

`contracts/src/planning.ts` still exports the planning-persistence and compatibility shapes used by
`copilot-ui`.

Key families in that module:

- planning records: `PlanningRecord`, `ResearchNote`, `PlanningDiagram`, `PlanningPersistenceHealth`
- typed intake artifacts: `PlanningIntakeArtifact` and related category constants
- synced-note source contracts and source-id helpers
- Obsidian note and representation types
- planning API envelope helpers and `PLANNING_API_CONTRACT_VERSION`

These exports remain necessary because `copilot-ui` still ships compatibility and admin APIs for:

- planning persistence lifecycle and export/import
- planning records, search, compare, merge, suggestions, and recaps
- record-scoped research notes and diagrams
- external Obsidian notes, source selection, and representations

Deprecated compatibility fields that remain exported for older data:

- `PlanningRecord.researchNotes`
- `PlanningRecord.diagrams`
- `ResearchNote.noteId`, `ResearchNote.summary`, `ResearchNote.source`, `ResearchNote.updatedAt`
- `PlanningDiagram.diagramId`, `PlanningDiagram.updatedAt`

New live planning flows should use workflow-artifact sync into `elegy-planning`. Session execution
state still lives in `~/.copilot/session-state/<SESSION_ID>/plan.md`.

## Consumption

- Runtime packages import shared workflow contracts directly.
- `copilot-ui` imports runtime constants, envelope helpers, and artifact parsers directly from `@elegy-copilot/contracts` in JS route modules such as `routes/planning.js`.
- The planning bridge and the planning API therefore share one artifact parser, one schema-version value, and one set of kind/phase/status enumerations.

## Versioning And Drift Detection

`workflow.ts` still carries additive optional fields so older workflow templates keep parsing:

| Field | Added to | Default | Purpose |
| --- | --- | --- | --- |
| `type` | `WorkflowStep` | `'action'` | Step classification |
| `condition` | `WorkflowStep` | (none) | Pre-execution condition expression |
| `outputs` | `WorkflowStep` | (none) | Named output declarations for chaining |
| `streaming` | `WorkflowStep` | `false` | Whether step emits streaming events |
| `schemaVersion` | `WorkflowDefinition` | `'1.0'` | Enables migration detection |

Current planning-adjacent version anchors:

- `RoadmapWorkflowStructuredArtifact.schemaVersion` is fixed at `'1'`
- `PLANNING_API_CONTRACT_VERSION` is `planning_api_v1`

Primary drift checks:

- `copilot-ui/routes/planning.test.js`
- `copilot-ui/tests/api-contract.test.js`
- `copilot-ui/scripts/validate-roadmap-workflow-e2e.js`

## Build Order

```text
contracts (tsc) -> local-tracker (tsc) -> copilot-ui (no build for server.js)
```

The root `package.json` provides `npm run build:contracts` to build the contracts package. npm workspace dependency ordering ensures `contracts` builds first when using `npm run build --workspaces`.
