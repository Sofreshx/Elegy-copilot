# Agentic Pattern: Architectural Plan

## 1. Vision
To create a "installable" Operating System for coding agents that can be dropped into any repository. It acts as a central source of truth, coordinating specialized sub-agents to perform tasks with high precision. It is designed to adapt to existing codebases, analyzing current patterns to generate tailored instructions and flagging inconsistencies.

## 2. Core Architecture

### The Kernel
*   **`.github/copilot-instructions.md`**: The central coordinator.
    *   **Responsibility**: The entry point for the AI. It determines intent, routes requests to the correct Meta-Agent or Domain Agent, and enforces the "Agentic Protocol".
    *   **Behavior**: "I am the Kernel. I do not write code directly. I delegate to Agents."

### System Documentation & Health
*   **`architecture.md`**: High-level map of the system.
    *   **Responsibility**: Explains *what* the system is, *why* it exists, and links to specific Contexts.
*   **`warnings.md`** (New): The System Health Monitor.
    *   **Responsibility**: A living log of inconsistencies, anti-patterns, or "technical debt" detected during onboarding or daily tasks.
    *   **Usage**: Agents must check this before proposing architectural changes to avoid exacerbating known issues.

### The Task Pipeline
A structured flow to move from "vague idea" to "shippable code".
1.  **`raw.tasks.md`**: The Inbox. Unrefined user dumps, brain dumps, or quick requests.
2.  **`tasks.md`**: The Backlog. Structured tasks with:
    *   ID
    *   Priority
    *   Assigned Agent
    *   Run Mode (Shallow vs. Deep)
    *   Status (Pending, In-Progress, Done)
3.  **`failed.tasks.md`**: The Post-Mortem.
    *   **Responsibility**: Logs failed attempts with a "Why" analysis. Used as negative context for future attempts.

## 3. Agents (`/agents`)

### Meta-Agents (The Management Layer)
These agents manage the process, not the code.

*   **`onboarding.agent.md`** (New): The Installer.
    *   **Role**: Scans an existing codebase.
    *   **Actions**:
        *   Detects tech stack (C#, TS, Firebase, etc.).
        *   Generates/Customizes Domain Agents to match *existing* patterns.
        *   Populates `warnings.md` with detected inconsistencies.
*   **`task-creator.agent.md`**: The Analyst.
    *   **Role**: Reads `raw.tasks.md`, scopes them, selects the right Domain Agent, and moves them to `tasks.md`.
*   **`task-priority-planner.agent.md`**: The Manager.
    *   **Role**: Reorders `tasks.md`, handles dependencies, and tracks state.
*   **`task-runner.agent.md`**: The Executor.
    *   **Role**: Loads a specific task + Domain Agent + Context and executes the work.
*   **`instruction-editor.agent.md`**: The Architect.
    *   **Role**: Updates the agents and contexts themselves when the system evolves.

### Domain Agents (The Worker Layer)
Specialized experts. The `onboarding.agent` will generate these based on the target repo.

*   **`auth.agent.md`**: Authentication & Identity (e.g., Firebase, Auth0).
*   **`feature.creator.agent.md`**: Backend logic, patterns, and API wiring.
*   **`aspire.tests.integration.agent.md`**: .NET Aspire integration testing.
*   **`quality.csharp.agent.md`**: C# linting, patterns, and smell detection.
*   **`quality.ts.agent.md`**: TypeScript standards.
*   **`deployment.compose.agent.md`**: Docker Compose & Aspire deployment generation.
*   **`terraform.agent.md`**: Infrastructure as Code.

## 4. Contexts (`/contexts`)
Pure knowledge bases referenced by agents.
*   `terraform.context.md`
*   `aspire.context.md`
*   `project.patterns.md` (Generated during onboarding)

## 5. Task Execution Modes
*   **Shallow**: "Fix it locally." (e.g., typo, color change, simple logic fix).
*   **Deep**: "Fix the root cause." (e.g., refactor class hierarchy, change data flow).
    *   *Note*: Deep mode often triggers the `instruction-editor` to update documentation if the architecture changes.

## 6. Implementation Phases
1.  **Scaffolding**: Create the folder structure and Core files (`copilot-instructions.md`, `architecture.md`).
2.  **Meta-Agents**: Implement the Task Pipeline agents.
3.  **Onboarding Logic**: Create the `onboarding.agent` to generate the rest.
4.  **Domain Templates**: Create the templates that the onboarding agent will use.
