---
name: planning-feature
description: A 7-phase workflow for planning large or complex features. Use this skill when asked to "plan a feature", "design architecture", or "break down requirements" for significant changes.
---

# Feature Planning Skill (7-Phase Workflow)

## When To Use
- Large or multi-file features.
- New subsystems or integrations.
- Cross-cutting changes affecting multiple domains.
- **Do not use** for simple bug fixes or single-file changes (use `project-management` or just do it).

## The 7 Phases

### Phase 1: Discovery (Requirements)
- **Goal**: Clarify the problem, success criteria, and constraints.
- **Action**: Ask the user for high-level goals. Identify stakeholders and risk areas.
- **Output**: A summary of the requirements.

### Phase 2: Codebase Exploration (Context)
- **Goal**: Understand the existing system.
- **Action**:
    - Identify analogous features (copy-paste candidates).
    - Map entry points, data flows, and key abstractions.
    - List essential files to read.
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

### Phase 5: Implementation Plan (Tasks)
- **Goal**: Create actionable steps.
- **Action**:
    - Break work into phases (e.g., Scaffolding, Core Logic, UI, Polish).
    - Create concrete tasks mapped to specific files.
    - Assign a "Skill" to each task (e.g., `frontend`, `backend`, `auth`).

### Phase 6: Quality Gates (Review & Test)
- **Goal**: Ensure safety.
- **Action**: Define the test strategy (unit vs integration). Identify what to watch for in code review.

### Phase 7: Summary & Handoff
- **Goal**: Ready for execution.
- **Action**:
    - Recap the plan.
    - **Crucial**: Ask the user if they want to save this plan to `.instructions/tasks.md`.
    - If yes, use the `project-management` skill (or manually write) to update the backlog.

## Output Format
Present the plan in Markdown with clear headers for each phase.
