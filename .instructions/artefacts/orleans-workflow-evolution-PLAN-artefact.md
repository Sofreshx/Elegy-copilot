# Orleans Workflow Evolution — PLAN Artefact ✅

## Goal
Evolve SAASTools workflow and tool execution to a fully Orleans-based model where:

- Workflow runs are Orleans grain instances (not just coordination via `WorkflowExecutionEngine`).
- Workflow nodes/steps execute as isolated grains for security, consistency, and persistence.
- Orleans persistence moves to **Marten (JSONB)** for flexible schema evolution.
- AI-generated tools (from templates) are stored as documents with dynamic schemas.
- AI acts as design-time expert, not a runtime operator (except explicit LLM tool primitives).
- Addons become software artifacts with a formalized lifecycle (Draft → Validate → Fix → Freeze → Observe).

---

## Success Criteria / Acceptance Criteria ✅
- Workflows execute as first-class Orleans grains with per-node isolation.
- Tool instances can be dynamically created by AI from templates and persisted as Marten documents.
- Orleans grain persistence uses Marten (JSONB) instead of ADO.NET tables (migration-path available).
- Low-level tools are grain-safe; high-level tools execute via dedicated `ToolExecutionGrain`.
- Incremental migration supported via feature flags; existing `WorkflowExecutionEngine` can be migrated gradually.
- Tool definitions stored as `ToolDefinitionDocument` with flexible schema and addon lifecycle state.
- LLM tools are explicit primitives with structured output, cost controls, and model pinning.
- Workflows are statically validated and closed over their data before execution.

---

## Context Loaded (exact / initial files to consult) 🔍
> These are the files and locations to review during planning and implementation. Tasks should reference exact files when created.

- `SAASTools/` (root) — repo-level design docs: `PLAN.md`, `IMPLEMENTATION_SUMMARY.md`.
- `SAASTools.AppHost/` — runtime host and orchestration code (investigate `WorkflowExecutionEngine.*`, DI wiring, Orleans integration).
- `SAASTools.AppHost.Tests/` — integration test harness (add/extend tests here).
- `Libraries/*` — existing tool and auth client implementations for reuse.
- `.instructions/tasks/` — place individual tasks (create per-phase tasks here).

> Note: exact code symbols to create: `MartenGrainStorage`, `GrainStateDocument`, `IWorkflowExecutionGrain`, `IWorkflowStepGrain`, `ToolDefinitionDocument`, `IDynamicToolFactory`, `ILlmToolExecutionGrain`.

---

## Decisions (with rationale) 💡
1. **AI is Designer, Not Operator** — reduces attack surface and nondeterminism at runtime; AI helps create artifacts that humans validate.
2. **Addon Framing** — treat addons as human-validated, versioned artifacts; expect ~20–30% human correction to manage risk.
3. **LLM Tools Are Explicit** — require structured output and bounded behavior to be safe for production use.
4. **Auth Is Configured, Not Inferred** — explicit auth templates prevent accidental credential exposure and ambiguous flows.
5. **Connection Security** — secrets are reference-only in definitions; runtime resolution handled by secure credential service.

---

## 8-Phase Plan & Task Graph (task IDs + dependencies) 🔧
Note: Create each task listed below in `.instructions/tasks/` as individual work items. Use the task ID prefix `orleans-*`.

Phase 1 — Marten-Based Orleans Persistence Provider
- ORLEANS-1.1: Implement `MartenGrainStorage` (`IGrainStorage`).
- ORLEANS-1.2: Define `GrainStateDocument` wrapper with JSONB state.
- ORLEANS-1.3: Wire Marten storage into silo configuration & DI.
- ORLEANS-1.4: Add migration path + feature flag for ADO.NET ⇄ Marten.

Phase 2 — Workflow Execution as Orleans Grains (depends on Phase 1)
- ORLEANS-2.1: Enhance `IWorkflowExecutionGrain` for full orchestration.
- ORLEANS-2.2: Create `IWorkflowStepGrain` for per-step isolation.
- ORLEANS-2.3: Implement grain-to-grain execution flow patterns and retries.
- ORLEANS-2.4: Define `ToolExecutionGrain` pattern (low-level grain-safe vs high-level executor).
- ORLEANS-2.5: Design state persistence model using Marten documents for executions.

Phase 3 — Dynamic Tool Definitions (AI-Generated) (depends on Phase 1)
- ORLEANS-3.1: Define `ToolDefinitionDocument` schema + addon lifecycle states.
- ORLEANS-3.2: Create base tool templates (ApiClient, AuthClient, Webhook, DataTransform).
- ORLEANS-3.3: Implement `IDynamicToolFactory` to instantiate tools from definitions.
- ORLEANS-3.4: Extend `IUnifiedToolRegistry` for tenant-scoped dynamic tools.
- ORLEANS-3.5: Build AI meta-tool: `create-tool-from-template` (design-time only).

Phase 4 — Security & Isolation Model (depends on 1,2)
- ORLEANS-4.1: Add grain-level sandboxing & execution boundaries.
- ORLEANS-4.2: Implement `ConnectionDefinition`, `IConnectionResolver`, and `IAuthRefreshGrain`.
- ORLEANS-4.3: Ensure tenant isolation via grain keying strategy.
- ORLEANS-4.4: Implement resource limits (timeouts, budgets, circuit breakers).
- ORLEANS-4.5: Integrate prompt-injection mitigations and sanitizers.

Phase 5 — Migration & Rollout (depends on 1–4)
- ORLEANS-5.1: Feature flags and rollout plan orchestration.
- ORLEANS-5.2: Dual-write / shadow execution validation harness.
- ORLEANS-5.3: Rollback procedures and graceful degradation patterns.

Phase 6 — Addon Framework & Lifecycle (depends on 3,4)
- ORLEANS-6.1: Addon lifecycle state machine and APIs.
- ORLEANS-6.2: `IAddonValidator` with probe-based validation.
- ORLEANS-6.3: Sandbox validation execution and patch workflows.
- ORLEANS-6.4: Implement freeze semantics and versioned immutability.
- ORLEANS-6.5: Drift detection service and periodic re-validation.
- ORLEANS-6.6: Addon UI/UX surfaces (logs, spec inspection, manual fixes).

Phase 7 — LLM Tool Primitives (depends on 2,3)
- ORLEANS-7.1: Define `LlmToolContract` and structured I/O schemas.
- ORLEANS-7.2: Implement canonical LLM tools (classify, summarize, entity-extract).
- ORLEANS-7.3: Contract constraints: structured output, cost/latency bounds.
- ORLEANS-7.4: `ILlmToolExecutionGrain` for runtime LLM usage.
- ORLEANS-7.5: Support model versioning & pinned models.
- ORLEANS-7.6: Cost controls: per-tenant budgets, alerting, throttles.

Phase 8 — Workflow Static Analysis (depends on 2,6,7)
- ORLEANS-8.1: `IWorkflowValidator` and rule engine for design-time checks.
- ORLEANS-8.2: Static type checks for dataflow between nodes.
- ORLEANS-8.3: Workflow compilation pipeline (Design → Validated → Frozen Execution Plan).
- ORLEANS-8.4: AI guardrails to forbid free-form LLM conditionals in execution logic.

---

## Execution Notes for Subagents & Owners 🧭
- Break tasks into small PR-sized changes with feature flags.
- Create integration tests in `SAASTools.AppHost.Tests` for dual-write and shadow executions.
- Add benchmarks for `MartenGrainStorage` vs existing ADO provider (latency, throughput, storage size).
- Security team: review `IDynamicToolFactory` inputs and template validation.
- UX/PO: define addon review flow and manual approval UI for production publish.

---

## Risks & Mitigations ⚠️
- **Marten storage performance**: Benchmark early; consider Redis or hybrid approach for hot state.
- **Dynamic tool security**: Enforce template validation, sandboxing, and limited attack surface for tool templates.
- **Migration complexity**: Use feature flags, dual-write, and shadowing to validate correctness before cutover.
- **LLM non-determinism**: Pin models, set temperature=0 for critical flows, enforce JSON schema validation of outputs.
- **Human correction expectation**: Bake review and correction workflows into addon lifecycle and product messaging.

---

## Rollback & Validation Plan 🔁
- Feature flags for each major capability allow quick rollback.
- Dual-write and shadow mode for `MartenGrainStorage` until parity is proven.
- Integration tests and contract tests run on each PR; add staged environment validation.
- Metrics & alerts for increased latency, error rates, and model costs.

---

## How to Validate (Checklist) ✅
1. Unit + integration tests cover grain persistence, execution path, and tool instantiation.
2. Benchmarks compare Marten vs ADO (p95 latency, throughput).
3. Security review for dynamic tool templates and connection resolution.
4. Acceptance test that an AI-generated tool can be created from template, validated, frozen, and executed by a workflow grain.
5. Manual/UX flows for addon approval and inspection.

---

## Next Steps (short actionable items) ▶️
1. Create the per-subtask entries in `.instructions/tasks/` using the `ORLEANS-*` IDs above.
2. Start Phase 1: prototype `MartenGrainStorage` and add benchmarks.
3. Convene a 1-hour design review with Security, Platform, and Product to validate constraints (LLM contracts, auth flows, addon lifecycle).

---

*Prepared by the planning agent. Reference this artefact for major milestones, handoffs, and subagent work until project completion.*
