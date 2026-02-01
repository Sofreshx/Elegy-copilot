# Dynamic External API Client System — PLAN Artefact

## 🎯 Goal
Build a Dynamic External API Client System that enables AI agents to discover, authenticate, and interact with external APIs on behalf of users — with permission handling, traceability, and modular deterministic components.

---

## ✅ Success Criteria
- AISkills and AIModules are available, discoverable, and tenant-customizable via a Marten-backed store.
- Dynamic API definitions are first-class entities with health tracking and validation rules.
- `IDynamicApiClientFactory` can instantiate clients for APIs with OAuth2, API-Key, and basic auth, and clients are unit-tested and integration-tested.
- AI Permission System can request and persist user consent and pause/resume workflows while preserving context.
- Reasoning traces are recorded for all agent decisions and accessible via an API and persisted storage for audits.
- End-to-end demo: agent performs OAuth flow, discovers an external API, makes an authenticated request, stores trace, and presents results to user.

---

## 📁 Context Loaded (Target Files / Locations)
All work targets the **SAASTools** repo. Primary locations:
- `SAASTools/Libraries/AI/Skills/` (AISkill types + `MartenAISkillStore`)
- `SAASTools/Libraries/AI/Modules/` (AIModule implementations + `IAIModule`)
- `SAASTools/Libraries/ExternalApis/Definitions/` (External API definitions model)
- `SAASTools/Libraries/ExternalApis/Health/` (endpoint health monitoring)
- `SAASTools/Libraries/AI/Permissions/` (permission model + request flow)
- `SAASTools/Services/OAuth2FlowService` (extend for AI-driven OAuth flows)
- `SAASTools/Libraries/AI/Reasoning/` (reasoning trace models + storage)
- Frontend components: `SAASTools/Frontend/*` (permission UI, trace viewer)

Note: Persisted stores use Marten conventions and `ICredentialVault` for secret handling.

---

## 📦 Phase Breakdown & Acceptance Criteria

### Phase 1: Core Infrastructure - AISkills & AIModules ✅
**Steps**: 1.1 AISkill System; 1.2 AIModule System; 1.3 integrate into `ToolCallingAgent`.
**Acceptance Criteria**:
- `AISkill` model + `MartenAISkillStore` implemented and covered by unit tests.
- `IAIModule` interface and at least two deterministic modules with unit tests (form builder, HTTP request builder).
- `ToolCallingAgent` can load and invoke skills/modules in unit tests and a small integration demo.

---

### Phase 2: Dynamic HTTP Client System ✅
**Steps**: 2.1 External API Definition Model; 2.2 `IDynamicApiClientFactory`; 2.3 `IApiDiscoveryService`.
**Acceptance Criteria**:
- External API definition persists (schemas, auth metadata, sample routes) and validates on ingest.
- `IDynamicApiClientFactory` can create clients configured for OAuth2, API keys, and unsigned requests; covered by unit tests and integration tests (mock external service).
- `IApiDiscoveryService` can ingest OpenAPI/Swagger snippets and produce validated `ExternalApiDefinition` entries.

---

### Phase 3: User Interaction & Consent Flow ✅
**Steps**: 3.1 Permission Request System; 3.2 Extend `OAuth2FlowService` for AI; 3.3 Workflow pause/resume.
**Acceptance Criteria**:
- Permission requests are recorded, consent flow implemented, and states persisted.
- `OAuth2FlowService` supports programmatic initiation and callbacks for agent-initiated flows; tests simulate user consent and token issuance.
- Workflow Pause/Resume: agent workflow can be paused pending user consent and resumed by restoring conversation + reasoning context.

---

### Phase 4: AI Reasoning & Traceability ✅
**Steps**: 4.1 Reasoning trace model; 4.2 Enhanced conversation context; 4.3 Context persistence.
**Acceptance Criteria**:
- `ReasoningTrace` model captures decisions, tool calls, prompts, timestamps, and user approvals.
- Traces are persisted, queryable, and exportable for audits.
- Long-running workflows persist context securely and can be resumed deterministically.

---

### Phase 5: API Reliability & Health ✅
**Steps**: 5.1 Endpoint health monitoring; 5.2 Dynamic endpoint updates.
**Acceptance Criteria**:
- Periodic health checks and health records per `ExternalApiDefinition` with alertable thresholds.
- Client factory adapts to endpoint updates (re-validation + safe rollout), with integration tests simulating endpoint changes.

---

### Phase 6: Built-in AI Skills for Common APIs ✅
**Steps**: 6.1 Create core skills (reddit-auth, oauth2-standard, api-key-auth); 6.2 Skill Builder integration.
**Acceptance Criteria**:
- A minimum set of core AISkills implemented and documented.
- Skill Builder can create and register tenant-specific skills; end-to-end tests demonstrating an agent using a built-in skill.

---

### Phase 7: Frontend Integration ✅
**Steps**: 7.1 Permission Request UI; 7.2 Reasoning Trace Viewer.
**Acceptance Criteria**:
- UI components for permission request and trace viewing implemented and wired to backend APIs.
- UX flows tested manually and via component tests; security review performed for consent surfaces.

---

## 🧭 Dependency Map
```
Phase 1 (Skills/Modules) ─┬─→ Phase 2 (HTTP Client) ─→ Phase 5 (Health)
                         │
                         └─→ Phase 3 (Permissions) ─→ Phase 4 (Traceability)
                                                              │
                                                              └─→ Phase 6 (Core Skills)
                                                                        │
                                                                        └─→ Phase 7 (Frontend)
```

---

## 🔧 Key Design Decisions & Rationale
- **Skills as DB-stored prompt fragments**: tenant-customizable and auditable; store in `MartenAISkillStore` to enable per-tenant overrides and versioning.
- **Modules as deterministic components**: minimizes hallucination and enables unit-testing of non-probabilistic behavior via `IAIModule`.
- **External API definitions as first-class entities**: enables discovery, validation, and health monitoring.
- **AI Permission System pauses workflows**: prevents unauthorized actions and captures a clear consent record for traceability.
- **All credentials via `ICredentialVault`**: centralized secret management reduces risk of exposure and simplifies auditing.

---

## ⚠️ Risks & Mitigation Strategies
- **Credential exposure** → Use `ICredentialVault`, encrypted storage, strict logging redaction, and key rotation guidance.
- **AI hallucinating endpoints** → Validate definitions against OpenAPI where possible; require explicit schema verification before issuing real requests; use `MaxToolCalls` and a per-session budget.
- **Infinite tool loops** → Enforce `MaxToolCalls` and detect suspicious loop patterns; include watchdog timers.
- **Prompt injection & skill tampering** → Sanitize skills on ingest, add signing/versioning of tenant skill overrides, and review UI inputs.
- **Long-running state drift** → Snapshot context, include verifiers on resume, and store ticks for deterministic replay.

---

## 🗂 Task Graph (top-level tasks)
- TASK-1.1: Implement `AISkill` model + `MartenAISkillStore` (depends: none)
- TASK-1.2: Implement `IAIModule` + core deterministic modules (depends: TASK-1.1)
- TASK-1.3: Integrate skills & modules into `ToolCallingAgent` (depends: TASK-1.1, TASK-1.2)

- TASK-2.1: Create `ExternalApiDefinition` model + validators (depends: TASK-1.1)
- TASK-2.2: Implement `IDynamicApiClientFactory` (depends: TASK-2.1)
- TASK-2.3: Implement `IApiDiscoveryService` (depends: TASK-2.1)

- TASK-3.1: Implement `AI Permission` domain and persistence (depends: TASK-1.1, TASK-2.1)
- TASK-3.2: Extend `OAuth2FlowService` for AI flows and callbacks (depends: TASK-3.1)
- TASK-3.3: Implement workflow pause/resume capabilities (depends: TASK-3.1, TASK-4.1)

- TASK-4.1: Implement `ReasoningTrace` model, storage, and query API (depends: TASK-1.1)
- TASK-4.2: Enhance conversation context model + persistence (depends: TASK-4.1)
- TASK-4.3: End-to-end trace + resume tests (depends: TASK-3.3, TASK-4.2)

- TASK-5.1: Implement endpoint health monitoring service (depends: TASK-2.1, TASK-2.2)
- TASK-5.2: Add dynamic endpoint update & safe rollout (depends: TASK-5.1)

- TASK-6.1: Implement built-in core AISkills (depends: TASK-1.1)
- TASK-6.2: Integrate Skill Builder UI and registration (depends: TASK-6.1, TASK-7.1)

- TASK-7.1: Build permission request frontend components (depends: TASK-3.1)
- TASK-7.2: Build reasoning trace viewer frontend (depends: TASK-4.1)

---

## 🧪 Validation & Rollback
**Validation**:
- Unit tests for domain models and services; integration tests simulating external APIs and OAuth flows.
- e2e demo: agent does discovery → consent → perform request → store trace.
- Security review for credential handling, UI consent surfaces, and data retention policies.

**Rollback**:
- Feature flags for runtime toggles (disable AI-driven external API actions if needed).
- DB migration scripts should be reversible; provide migration rollbacks.
- Alerting on abnormal error rates to trigger temporary disablement of the dynamic client system.

---

## 📈 Progress Tracking
| Phase | Status | Owner | Estimated Effort |
|---|---:|---|---:|
| Phase 1 — Skills & Modules | Not Started |  | 3w |
| Phase 2 — Dynamic HTTP Client | Not Started |  | 4w |
| Phase 3 — Permissions & Consent | Not Started |  | 3w |
| Phase 4 — Reasoning & Traceability | Not Started |  | 3w |
| Phase 5 — API Reliability & Health | Not Started |  | 2w |
| Phase 6 — Built-in Core Skills | Not Started |  | 2w |
| Phase 7 — Frontend Integration | Not Started |  | 2w |

> Use the `Status` column to track progress; update owners and effort estimates as planning progresses.

---

## 🔧 Execution Notes (for subagents / implementers)
- Create per-task issue cards and small PRs; prefer incremental, test-driven changes.
- Add unit tests for every interface and mock external services for integration tests.
- Use feature flags for runtime switches; keep toggle defaults **off** until end-to-end validation.
- Store skills in Marten with versioning and include a schema for basic validation/sanitization.
- Use `ICredentialVault` everywhere credentials are needed and do not log secrets.

---

## 📎 References & Next Steps
- Place final artefact under `.instructions/artefacts/` (this file).
- Next operational step: create `TASK-1.1` and add an explicit task file at `.instructions/tasks/TASK-1.1-AISkill-System.md` with acceptance tests and API contracts.

---

*Created for the SAASTools workspace — target: `SAASTools`.*
