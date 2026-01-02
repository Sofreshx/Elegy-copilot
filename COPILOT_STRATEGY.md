# Instruction Engine: Copilot Integration Strategy & Upgrade Path

## 1. Executive Summary
The current `instruction-engine` uses a **File-Based Agent Architecture** where "Agents" and "Skills" are Markdown files loaded into the context. This is highly effective for flexibility but relies heavily on the user manually invoking the right context or the "Kernel" (`copilot-instructions.md`) successfully routing the request.

To upgrade this system for **GitHub Copilot**, we should move from a "Passive File System" to an "Active Context System" that leverages Copilot's native features (Chat Participants, Slash Commands, and Context Variables).

## 2. Current Architecture Review
- **Strengths**:
  - **Decoupled**: Skills are separate from the core logic.
  - **Portable**: Works in any editor that can read Markdown, though optimized for VS Code.
  - **Self-Documenting**: The instructions *are* the documentation.
- **Weaknesses**:
  - **Context Window Pressure**: Loading all skills or large agent definitions consumes tokens.
  - **Discovery**: Users must know which agent to ask for (or rely on the Kernel).
  - **Manual Handoffs**: The "Kernel" is a prompt, not code. It cannot force a context switch; it can only suggest it.

## 3. Upgrade Strategy: Copilot Native Integrations

### A. VS Code Chat Participants (The "North Star")
Instead of just Markdown files, we can wrap the Executive Agents in a lightweight VS Code Extension.
- **Concept**: Create a `sastools.instruction-engine` extension.
- **Implementation**:
  - Register `@planner`, `@runner`, `@debugger` as real Chat Participants.
  - **Benefit**:
    - **Native UI**: Users type `@planner create a plan` instead of "Act as the planner...".
    - **Context Control**: The extension programmatically loads the `planner.agent.md` content only when invoked, saving context for other tasks.
    - **Slash Commands**: Implement `/fix`, `/test`, `/refactor` mapped to specific Skills.

### B. Dynamic Skill Injection (RAG-Lite)
Currently, we rely on the user or the Kernel to "read" the skill file.
- **Upgrade**: Use a local vector index or a simple keyword matcher in the VS Code extension to find relevant skills.
- **Workflow**:
  1. User asks: "Fix the Marten query."
  2. Extension detects "Marten".
  3. Extension silently loads `skills/marten.documents/SKILL.md` into the prompt context.
  4. Copilot answers with perfect domain knowledge without the user manually adding the file.

### C. Structured Output Enforcement
Copilot is chatty. We need it to be transactional for backlog/workflow automation.
- **Upgrade**: Define strict JSON schemas for Task definitions.
- **Implementation**:
  - Define a table schema for `.instructions/tasks.md` and keep it stable (IDs, Priority, Status, DependsOn).
  - In the `project-management` skill, document the schema and require consistent formatting.
  - When a strict payload is needed, instruct Copilot to output *only* the JSON block for tool consumption.

### D. Task Lifecycle Hygiene (Active vs. Review)
- **Separation**: Keep `.instructions/tasks.md` and `.instructions/raw.tasks.md` for active/untriaged items only. Route completed work to `.instructions/tasks.review.md`; archive reviewed items into `.instructions/tasks.archive.md`.
- **Runner Behavior**: On success, move rows from tasks to tasks.review to keep the active backlog clean.
- **Cleanup Behavior**: System cleanup promotes reviewed items into tasks.archive and removes stragglers from raw/tasks.

## 4. Unexplored Directions

### A. "Chain of Thought" Recursion
The current system allows 1 level of sub-agent (Kernel -> Subagent).
- **Idea**: Allow the main session to spawn a temporary researcher subagent when the prompt would otherwise overflow the context window.
- **Mechanism**: Copilot outputs a specific tool call (e.g., `runSubagent` with a research prompt). The system executes it in a separate context window and feeds the summary back.

> Note: GitHub Copilot subagents cannot spawn subagents; keep delegation to one level.

### B. Automated Memory Management
- **Idea**: A background process (or `@auditor` running on file save) that updates `project.memory.md`.
- **Trigger**: When a build fails 3 times with the same error, the system prompts: "I see you're stuck. Shall I record this solution in `project.memory.md`?"

### C. "Shadow Mode" Validation
- **Idea**: When the user writes code, a "Shadow Auditor" (running on a separate thread/agent) checks it against `project.patterns.md` and gently nudges via a Code Lens or comment if it violates a pattern.

## 5. Potential Issues & Risks

### A. Context Window Fragmentation
- **Risk**: As we add more "Skills", the `copilot-instructions.md` (Kernel) might become too large to fit alongside the active file code.
- **Mitigation**: Aggressive pruning. The Kernel should only contain the *names* and *descriptions* of agents, never their full instructions. Full instructions are loaded only on demand.

### B. "Prompt Drift"
- **Risk**: As Copilot models update (e.g., GPT-4 to GPT-4o to Next-Gen), the optimal prompting strategy changes.
- **Mitigation**: Version the Agent files (e.g., `planner.v2.agent.md`). Add a "System Check" task that verifies if the agents are still performing well with the current model version.

### C. Over-Engineering
- **Risk**: Turning a simple "helper" into a complex bureaucracy of agents.
- **Mitigation**: Keep the "Raw Mode". Always allow the user to just ask a question without invoking an agent. The Agents are for *Complex Tasks*, not simple queries.

## 6. Roadmap Recommendation

1.  **Phase 1 (Immediate)**: Refine the `runSubagent` tool usage. Ensure it's used for *all* multi-file edits.
    - Set runner default to batch execution (3 tasks, priority-ordered, stop-on-failure) to reduce repeated context loads while keeping dependency safety.
2.  **Phase 2 (Short Term)**: Implement "Skill Auto-Loading" via a simple script or naming convention (e.g., if file is `.cs`, auto-load `csharp.skill.md`).
3.  **Phase 3 (Long Term)**: Build the `instruction-engine` VS Code Extension to provide first-class `@agent` support.
