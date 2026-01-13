---
name: planning-refactor
description: >
    A 7-phase workflow for planning large or complex refactors. Use this skill when asked to "refactor X", "restructure code", or "clean up technical debt" for significant areas.
    Triggers on: "plan refactor", "restructure", "refactor plan", "technical debt plan".
---

# Refactor Planning Skill (7-Phase Workflow)

## When To Use
- Large or risky refactors.
- Architecture reshaping or module extraction.
- Untangling shared code or legacy systems.
- **Do not use** for simple renames or single-file cleanups.

## The 7 Phases

### Phase 1: Target & Goals (Discovery)
- **Goal**: Define scope and non-goals.
- **Action**:
    - Identify exactly what code is changing.
    - Define the desired outcome (e.g., "Decouple A from B", "Improve performance").
    - **Strict Non-Goals**: Explicitly state what *won't* change (e.g., "No new features").

### Phase 2: Baseline Exploration (Current State)
- **Goal**: Understand the "Before" picture.
- **Action**:
    - Map entry points and call graphs.
    - Identify stateful interactions and side effects.
    - Check existing test coverage.

### Phase 3: Clarifying Questions (Gaps)
- **Goal**: Assess risk.
- **Action**: Ask about backward compatibility, downtime constraints, and hidden dependencies.
- **Output**: A list of risks to verify.

### Phase 4: Refactor Strategy (Decisive)
- **Goal**: Choose a safe path.
- **Action**:
    - Select a strategy: Strangler Fig, Branch by Abstraction, Interface-First, or Parallel Change.
    - Explain *why* this strategy minimizes risk.

### Phase 5: Implementation Plan (Staged Tasks)
- **Goal**: Incremental execution.
- **Action**:
    - Break work into small, safe stages (e.g., "1. Extract Interface", "2. Add Adapter", "3. Migrate Consumers").
    - Ensure the system remains buildable/runnable at every stage.

### Phase 6: Safety Nets & Quality Gates
- **Goal**: Prevent regression.
- **Action**:
    - Plan "Characterization Tests" (Snapshot tests) before touching code.
    - Define metrics or logs to watch during rollout.

### Phase 7: Summary & Handoff
- **Goal**: Ready for execution.
- **Action**:
    - Recap the strategy and risks.
    - **Crucial**: Ask the user if they want to save this plan as a task file under `.instructions/tasks/`.
    - If yes, create a task file with `owner` + `skills`, and include the plan as the initial content.

## Output Format
Present the plan in Markdown with clear headers for each phase.
