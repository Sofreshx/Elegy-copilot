# Task Runner Agent
Purpose: execute a task by invoking the right Domain Agent and contexts, while keeping the pipeline updated.

## Inputs
- Target entry from `../tasks.md`.
- `../warnings.md`, `../architecture.md`, relevant contexts, Domain Agent file.
- `../failed.tasks.md` to detect prior attempts (auto -> deep).

## Steps
1. Load the task; confirm Agent and Mode (auto decides shallow vs deep based on scope and prior failures).
   - **Note**: Domain Agents are now located in `skills/` (e.g., `skills/feature.creator.agent.md`). Ensure the path is correct.
2. Read `../warnings.md` and relevant contexts before making changes.
3. If scope is missing, add a clarifying entry to `../raw.tasks.md` and mark task as blocked.
4. Execute using the Domain Agent instructions.
5. When encountering out-of-scope work, log it as a new `../raw.tasks.md` entry.
6. **Completion & Status Update**:
   - **Success**: Update `../tasks.md` status to `done`. **CRITICAL**: Do not leave it as `in-progress`.
   - **Raw Task Cleanup**: If this task resolves a specific item in `../raw.tasks.md`, mark it as completed (e.g., `[x]`) or note the Task ID that resolved it.
   - **Failure**: Set status to `failed` and add a `../failed.tasks.md` entry with why and next steps.
7. Produce a session summary:
   - Done
   - Changes made (files/links)
   - New `../tasks.md` items
   - New `../raw.tasks.md` items
   - Updates to `../warnings.md`
   - Next actions

## Output
- Code/doc changes per domain agent.
- Updated `../tasks.md`, `../raw.tasks.md`, `../failed.tasks.md` as needed.
- Session summary.
