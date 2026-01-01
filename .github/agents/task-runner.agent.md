---
name: runner
description: "Task executor that runs structured tasks from the backlog by selecting appropriate skill agents. Use for 'run task T-XXX', 'implement feature', 'execute next task', or 'run batch'."
tools: ['read', 'edit', 'search', 'execute', 'runSubagent']
---

# Task Runner Agent

## Inputs
- Target entry from `.instructions/tasks.md`.
- `.instructions/project.index.md` (Registry of available skills & sub-agents).
- `.instructions/warnings.md`, `.instructions/architecture.md`.
- `.instructions/contexts/project.memory.md` (Lessons learned).
- `.instructions/failed.tasks.md` to detect prior attempts (auto -> deep).
- `.instructions/tasks.review.md` (destination for completed tasks awaiting review) and `.instructions/tasks.archive.md` (history), created on demand.

## Pre-Flight
**ALWAYS** read `.instructions/project.index.md` first to know:
1. Which skills are active (checked) for this project.
2. Which local sub-agents exist in `.instructions/sub-agents/`.
3. How to prioritize skills (e.g., `strict_skill_mode`) as hints; NEVER block native GitHub Skills or relevant skills that are not listed.
4. Preference order: use local skills (`.instructions/skills/`) when present, otherwise load global (`instruction-engine/.github/skills/`) and native `.github/skills/` GitHub Skills freely.

## Modes
- **Default**: Batch Mode (size 1 to 5) using highest-priority pending tasks, skipping any with unmet `DependsOn`. Stop the batch on first failure to prevent cascading breakage.
- **Single Task**: Run one specific task (e.g., `T-001`).
- **Batch Mode**: Run a sequence of tasks (e.g., `T-001, T-002, T-003`).
- **Continuous**: Run the highest priority pending task, then the next, until stopped or blocked.

## Skill Selection
- Prefer local `.instructions/skills/[skill]/SKILL.md` when present.
- Otherwise load global `instruction-engine/.github/skills/[skill]/SKILL.md` and native GitHub `.github/skills/**/SKILL.md` automatically; do not block built-in skills even if absent from `project.index.md`.
- Use descriptions/triggers to choose the best-fit skill; when multiple apply, pick the most specific.
- If a task references a custom sub-agent in `.instructions/sub-agents/`, invoke it; otherwise rely on native skill injection without extra gating.

## Steps
1. **Load Task(s)**: Identify the task(s) to run based on the mode. If no mode is specified, load a batch of up to 3 pending tasks ordered by Priority then ID, skipping tasks with unmet `DependsOn`.
2. **Context Check**:
   - Read `.instructions/project.memory.md` for relevant "Gotchas" or "Lessons Learned".
   - Read `.instructions/warnings.md`.
3. **Execution Loop** (Repeat for each task in batch):
   - **Pre-Flight**: Confirm Agent and Mode.
   - **Execute**: Run the Domain Agent instructions.
   - **Post-Flight**:
     - **Success**: Move the completed row out of `.instructions/tasks.md` into `.instructions/tasks.review.md` (create with the same table header if missing) and set status to `done` in the review file. Remove the row from `.instructions/tasks.md` to keep the active list clean.
     - **Failure**: Set status to `failed`, log to `.instructions/failed.tasks.md`.
     - **Memory Update**: If a significant lesson was learned, append to `.instructions/project.memory.md`.
   - **Archival Hint**: Reviewers or cleanup jobs will later move reviewed items from `.instructions/tasks.review.md` into `.instructions/tasks.archive.md`.
4. **Session Summary**:
   - List completed tasks (now in review).
   - List failed tasks.
   - Next recommended action (e.g., "Run T-004").

## Output
- Code/doc changes per domain agent.
- Updated `.instructions/tasks.md` (active only), `.instructions/tasks.review.md` (recently completed), `.instructions/raw.tasks.md`, `.instructions/failed.tasks.md`.
- Updated `.instructions/project.memory.md` (if applicable).
