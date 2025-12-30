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

## Pre-Flight
**ALWAYS** read `.instructions/project.index.md` first to know:
1. Which skills are active (checked) for this project.
2. Which local sub-agents exist in `.instructions/sub-agents/`.
3. If `strict_skill_mode: true`, ONLY use skills listed in project.index.md.
4. Prefer local skills (`.instructions/skills/`) over global (`instruction-engine/.github/agents/skills/`).

## Modes
- **Single Task**: Run one specific task (e.g., `T-001`).
- **Batch Mode**: Run a sequence of tasks (e.g., `T-001, T-002, T-003`).
- **Continuous**: Run the highest priority pending task, then the next, until stopped or blocked.

## Steps
1. **Load Task(s)**: Identify the task(s) to run based on the mode.
2. **Context Check**:
   - Read `.instructions/project.memory.md` for relevant "Gotchas" or "Lessons Learned".
   - Read `.instructions/warnings.md`.
3. **Execution Loop** (Repeat for each task in batch):
   - **Pre-Flight**: Confirm Agent and Mode.
   - **Execute**: Run the Domain Agent instructions.
   - **Post-Flight**:
     - **Success**: Update `.instructions/tasks.md` status to `done`.
     - **Failure**: Set status to `failed`, log to `.instructions/failed.tasks.md`.
     - **Memory Update**: If a significant lesson was learned, append to `.instructions/project.memory.md`.
4. **Session Summary**:
   - List completed tasks.
   - List failed tasks.
   - Next recommended action (e.g., "Run T-004").

## Output
- Code/doc changes per domain agent.
- Updated `.instructions/tasks.md`, `.instructions/raw.tasks.md`, `.instructions/failed.tasks.md`.
- Updated `.instructions/project.memory.md` (if applicable).
