---
name: planning-feature
description: "7-phase workflow for planning large or complex features and refactors. Triggers on: plan a feature, design a feature, break down requirements, feature plan, plan refactor, restructure, refactor plan, technical debt plan."
---

# Feature Planning Skill (7-Phase Workflow)

## When To Use
- Large or multi-file features.
- New subsystems or integrations.
- Cross-cutting changes affecting multiple domains.
- **Do not use** for simple bug fixes or single-file changes (use the standard `/plan` flow only if the work still needs explicit planning; otherwise just do it).

## The 7 Phases

### Phase 1: Discovery (Requirements)
- **Goal**: Clarify the problem, success criteria, and constraints.
- **Action**: Ask the user for explicit high-level goals. Identify stakeholders, success criteria, constraints, and risk areas.
- **Output**: A summary of the requirements plus a stable bullet list of high-level goals that the plan should satisfy.

### Phase 2: Codebase Exploration (Context)
- **Goal**: Understand the existing system.
- **Action**:
    - Identify analogous features (copy-paste candidates).
    - Map entry points, data flows, and key abstractions.
    - List essential files to read.
- **Output**: Emit a structured `ResearchNote` summary for exploration findings.
- **Tool Usage**: Use `file_search` and `read_file` to gather context.

### Phase 3: Clarifying Questions (Gaps)
- **Goal**: Eliminate ambiguity.
- **Action**: List unanswered questions about edge cases, performance, security, or migration.
- **Output**: A numbered list of questions for the user. **Pause here** if critical info is missing.

### Phase 4: Architecture Design (Decisive)
- **Goal**: Choose a technical approach.
- **Action**:
    - Propose an architecture that aligns with project patterns.
    - Define component boundaries, data models, and API contracts.
    - Explain *why* this approach was chosen (trade-offs).
- **Output**: Include at least one `PlanningDiagram` (Mermaid preferred) representing key architecture/data flow.

### Phase 5: Implementation Plan (Tasks)
- **Goal**: Create actionable steps.
- **Action**:
    - Keep the high-level goals visible and map implementation phases back to them.
    - Break work into phases (e.g., Scaffolding, Core Logic, UI, Polish).
    - Create concrete tasks mapped to specific files.
    - Assign a "Skill" to each task (e.g., `frontend`, `backend`, `auth`).

### Phase 6: Quality Gates (Review & Test)
- **Goal**: Ensure safety.
- **Action**: Define the test strategy (unit vs integration). Identify what to watch for in code review.
- **Acceptance Criteria Rule**: Require at least 2 bullet Acceptance Criteria per work unit.
- **Acceptance Criteria Rule**: Reject vague criteria (for example: quality, good, proper, etc.) and require measurable language.

### Phase 7: Summary & Handoff
- **Goal**: Ready for execution.
- **Action**:
    - Recap the plan.
    - If the plan needs persistence or handoff, prefer the host/session artifact surfaces already used by the current workflow (for example orchestrator or session-state planning artifacts such as the active session `plan.md` / plan pack).
    - If the user wants durable repo-level planning instead of session-only execution planning, direct that persistence to the approved planning surfaces (for example backlog/roadmap docs) rather than ad hoc task files.
    - Do **not** direct users to save plans under `.instructions/tasks/`.

## Output Format
Present the plan in Markdown with clear headers for each phase. Include the explicit high-level goals before detailed task decomposition.


