# Copilot Instructions (Shared)

## Purpose
Provide shared guidance for working in a multi-repo workspace where `instruction-engine` is a library alongside the active project.

The main goal is consistent, correct work by grounding decisions in the project's own architecture and conventions.

These instructions focus on:
- Where to look first (architecture + context memory)
- How we track work (task files under `.instructions/tasks/`)
- Remember to use related SKILL files when relevant (prefer the active/target project repo’s `.github/skills/` if present; otherwise fall back to `instruction-engine/.codex/skills/`).

## Skills (Load, Don’t Assume)
The “skills list” provided to the agent only includes **metadata** (name/description/path). To actually apply a skill’s guidance, the agent must **read** the corresponding `SKILL.md`.

When a user request clearly matches a skill domain (e.g., React Query usage, .NET unit testing, refactors, planning workflows):
- **MUST** read the most relevant `SKILL.md` early (before planning or making code changes).
- Prefer repo-local skills first: `.github/skills/<skill>/SKILL.md`.
- If not present, fall back to: `instruction-engine/.codex/skills/<skill>/SKILL.md`.
- If multiple skills apply, read the top 1–2 most relevant and follow them.

## Read This First (Project Truth Sources)
When working in any project repo, preferentially consult these files before making structural changes:

1. `.instructions/architecture.md` (project architecture map, patterns/conventions)
2. `.instructions/contexts/*.md` (ALL context files: lessons, risks, and domain knowledge)
3. Repo documentation (if present): `README.md`, `PLAN.md`, `docs/`, `documentation/`, and any `architecture.*.md`

If these files are missing or stale, treat it as a first-class task to update them before large refactors.

## 📂 Workspace Structure
- **Global Engine**: `instruction-engine/.github/` (agents + templates)
- **Local Project**: `.instructions/` (project-specific contexts, tasks, prompts)
- **Local Output**: `.instructions-output/` (reports, logs, debug info)

### ⚠️ CRITICAL: What Lives Where

| Asset Type | Location | Can Duplicate Locally? | Git Tracked? |
|------------|----------|------------------------|--------------|
| **Custom Agents (optional)** | `instruction-engine/.github/agents/` | ✅ If repo-local | ✅ Yes (Shared) |
| **Generic Skills** | `instruction-engine/.codex/skills/` | ✅ Override only | ✅ Yes (Shared) |
| **Tasks** | `.instructions/tasks/` | ✅ Yes | ✅ **YES** |
| **Task Archive/History** | `.instructions/tasks.archive/` + `.instructions/tasks.history.md` | ✅ Yes | ✅ **YES** |
| **Project Context** | `.instructions/contexts/` | ✅ Yes | ⚠️ Project decision |


**Recommended `.gitignore` entries (per project):**
```gitignore
# Instruction Engine session RAM (developer-local)
.instructions/active-tasks.md

# Instruction Engine generated outputs (developer-local)
.instructions-output/
```

### Local Project Structure (`.instructions/`)
```
.instructions/
├── project.index.md        <-- Optional catalog of skills/sub-agents (advisory)
├── architecture.md         <-- Architecture overview + patterns/conventions
├── tasks/                  <-- ONE FILE PER TASK (tracked)
├── tasks.archive/          <-- Archived/completed task files (tracked)
├── tasks.history.md        <-- Append-only task recap log (tracked)
├── raw.tasks.md            <-- Optional inbox for untriaged ideas
├── active-tasks.md         <-- Session RAM (recommended gitignored)
├── contexts/
│   └── project.memory.md   <-- Lessons, gotchas, active warnings/risks
└── sub-agents/             <-- Project-specific agent wrappers
```

Use `.instructions/contexts/project.memory.md` for deep context that helps future agents: capture lessons, pitfalls, and any current warnings. Keep entries concise and scoped to recurring or high-impact topics to avoid context bloat.

## Task Workflow (How We Work)

### Task Files (`.instructions/tasks/`)
- One task = one markdown file.
- A task file is both a plan + a durable memory log for iterative attempts.
- Tasks MUST include:
  - `owner` (developer responsible)
  - `skills` (skill names to load when working the task)
  - `depends_on` / `next_tasks` (task graph links; empty arrays for isolated tasks)
  - Attempt log sections (what was tried, why it failed, next attempt)

**Filename convention**
- `task-000123--short-slug.md`

**Front matter (required, YAML)**
```yaml
---
schema: task/v1
id: task-000123
title: "Short, specific title"
type: feature | bug | chore | docs | research
status: not-started | in-progress | blocked | done | archived
priority: low | medium | high | critical
owner: "dev-handle"
skills: ["skill-one", "skill-two"]
depends_on: []
next_tasks: []
created: "YYYY-MM-DD"
updated: "YYYY-MM-DD"
---
```

**Sections (recommended)**
- `## Context`
- `## Acceptance Criteria`
- `## Plan / Approach`
- `## Attempts / Log`
- `## Failures`
- `## Notes / Discoveries`
- `## Next Steps`

### `raw.tasks.md` (Inbox, optional)
- Use for untriaged ideas that are not ready to become a task file.
- Keep it one line per item.
- Suggested format: `- [ ] ID: temp-XXX | Title: short phrase | Source: user/agent | Notes: link or minimal context`

### `active-tasks.md` (Work Memory)
- Use for the *currently active* session context.
- Treat this as "RAM": detailed context, scratchpad, immediate next steps for the active task.
- **Context Loading**: Explicitly list relevant skills (from `.github/skills/`) and context files (from `.instructions/contexts/`) to keep them in focus.
- Allows hopping back into work after context loss.

### `.instructions/tasks.history.md` (History)
- Append-only log of completed tasks (small recap + link/path to the archived file).

### `.instructions/tasks.archive/` (Archive)
- Completed task files are moved here and marked `status: archived`.
- This keeps `.instructions/tasks/` focused on active work.

## Conventions (How To Operate)

### Execution (Do Not Stop Early)
- **Complete the full task**: Do not stop early to ask for confirmation if the path forward is clear.
- **Chain tools**: If a task requires multiple steps (e.g., read -> edit -> verify), perform them in sequence without yielding control back to the user unless absolutely necessary.
- **Resolve all items**: If given a list of tasks, work through them until all are complete or blocked.

### Architecture-first behavior
- Before changing a system boundary, read `.instructions/architecture.md` (includes patterns/conventions) and locate the relevant modules/services.
- Before broad changes, scan `.instructions/contexts/project.memory.md` for known breakpoints or active warnings.

### Keeping knowledge healthy
- If you discover a recurring failure mode or new warning, add it to `.instructions/contexts/project.memory.md`.
- If you adjust patterns/conventions, update `.instructions/architecture.md` in the Patterns section.

### Planning
- For non-trivial work, prefer VS Code **Plan Mode** and use the architecture/context files above to ground the plan.

### Documentation Strategy
- **Succinct & Targeted**: Documentation should be concise and consolidated in key documents.
- **Avoid Bloat**: Do not create many fragmented files.
- **Update, Don't Create**: Prefer updating existing architecture/context files over creating new ones unless well-justified.

## Safeguards
- Always check `.instructions/contexts/project.memory.md` for active warnings before structural changes.
- Keep `.instructions/architecture.md` aligned with the current structure and conventions.
- If `.instructions/` is missing, run the **Onboarding Agent**.

## Manual-Only Guidance
- Treat destructive scaffolding as opt-in (e.g., onboarding/bootstrapping tasks).
- Prefer small, verifiable steps; keep changes close to established patterns.
