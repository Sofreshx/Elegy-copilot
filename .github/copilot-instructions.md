# Copilot Instructions (Shared)

## Purpose
Provide shared guidance for working in a multi-repo workspace where `instruction-engine` is a library alongside the active project.

The main goal is consistent, correct work by grounding decisions in the project's own architecture and conventions.

These instructions focus on:
- Where to look first (architecture, warnings, patterns)
- How we track work (`.instructions/tasks.md` and `.instructions/raw.tasks.md`)

## Read This First (Project Truth Sources)
When working in any project repo, preferentially consult these files before making structural changes:

1. `.instructions/architecture.md` (project architecture map)
2. `.instructions/warnings.md` (known risks, pitfalls, “don’t touch” areas)
3. `.instructions/contexts/project.patterns.md` (coding conventions, folder layout)
4. `.instructions/contexts/project.memory.md` (gotchas and lessons learned)
5. Repo documentation (if present): `README.md`, `PLAN.md`, `docs/`, `documentation/`, and any `architecture.*.md`

If these files are missing or stale, treat it as a first-class task to update them before large refactors.

## 📂 Workspace Structure
- **Global Engine**: `instruction-engine/.github/` (Agents, Generic Skills, Templates)
  - `instruction-engine/.github/agents/` - Optional custom agent prompt files (manual invocation)
  - `instruction-engine/.github/skills/` - Shared/reference skills (not auto-loaded unless copied into the active repo)
  - `instruction-engine/.github/templates/` - Templates for initialization
- **Local Project**: `.instructions/` (Project-specific contexts, tasks, prompts)
- **Repo Skills**: `.github/skills/` (Project skills in SKILL.md format — hyphenated, lowercase)
- **Local Output**: `.instructions-output/` (Reports, Logs, Debug info)

### ⚠️ CRITICAL: What Lives Where

| Asset Type | Location | Can Duplicate Locally? | Git Tracked? |
|------------|----------|------------------------|--------------|
| **Custom Agents (optional)** | `instruction-engine/.github/agents/` | ✅ If repo-local | ✅ Yes (Shared) |
| **Generic Skills** | `instruction-engine/.github/skills/` | ✅ Override only | ✅ Yes (Shared) |
| **Project Skills** | `.github/skills/` | ✅ Create new | ✅ Yes (Repo) |
| **Legacy Overrides** | `.instructions/skills/` | ✅ Temporary override | ❌ **NO** (Local) |
| **Tasks & Context** | `.instructions/` | ✅ Always local | ❌ **NO** (Local) |

**Why .gitignore local instructions?**
- Allows different developers to have different context/tasks.
- Prevents merge conflicts on task pipeline files like `tasks.md` and `raw.tasks.md`.
- Keeps the repository clean of "meta-work".

**Minimum recommended `.gitignore` entries (per project):**
```gitignore
# Instruction Engine task pipeline (developer-local)
.instructions/tasks.md
.instructions/raw.tasks.md
```

**Common additional ignore (recommended):**
```gitignore
# Instruction Engine generated outputs (developer-local)
.instructions-output/
```

### Local Project Structure (`.instructions/`)
```
.instructions/
├── project.index.md        <-- Optional catalog of skills/sub-agents (advisory, not gating)
├── architecture.md         <-- Project architecture overview
├── warnings.md             <-- Active warnings and risks
├── tasks.md                <-- Structured task backlog
├── raw.tasks.md            <-- Raw task inbox
├── failed.tasks.md         <-- Failed task log
├── contexts/
│   ├── project.patterns.md <-- Coding conventions
│   └── project.memory.md   <-- Lessons learned & gotchas
├── skills/                 <-- Legacy skill overrides (use .github/skills instead)
└── sub-agents/             <-- Project-specific agent wrappers
```

## Task Workflow (How We Work)

### `raw.tasks.md` (Inbox)
- Use for untriaged work: quick ideas, bugs, rough notes.
- Keep it one line per item; don’t write essays here.
- Suggested format:
  `- [ ] ID: temp-XXX | Title: short phrase | Source: user/agent | Notes: link or minimal context`

### `tasks.md` (Active Backlog)
- Use for structured, prioritized tasks that are ready to execute.
- Keep it actionable: no completed items; no long narratives.
- Recommended table schema:
  `| ID | Title | Priority | Status | DependsOn | Notes |`

### `failed.tasks.md` (Post-mortems)
- When something fails repeatedly, log the failure mode and why.
- Also record reusable lessons in `.instructions/contexts/project.memory.md`.

### `tasks.review.md` and `tasks.archive.md`
- `tasks.review.md`: completed items awaiting review/QA.
- `tasks.archive.md`: historical record (post-review).

## Conventions (How To Operate)

### Execution (Do Not Stop Early)
- **Complete the full task**: Do not stop early to ask for confirmation if the path forward is clear.
- **Chain tools**: If a task requires multiple steps (e.g., read -> edit -> verify), perform them in sequence without yielding control back to the user unless absolutely necessary.
- **Resolve all items**: If given a list of tasks, work through them until all are complete or blocked.

### Architecture-first behavior
- Before changing a system boundary, read `.instructions/architecture.md` and locate the relevant modules/services.
- Before broad changes, scan `.instructions/warnings.md` for known breakpoints.
- When unsure about conventions, use `.instructions/contexts/project.patterns.md` as the tie-breaker.

### Keeping knowledge healthy
- If you discover a recurring failure mode, add it to `.instructions/contexts/project.memory.md`.
- If you introduce a new convention, update `.instructions/contexts/project.patterns.md`.

### Planning
- For non-trivial work, prefer VS Code **Plan Mode** and use the architecture/context files above to ground the plan.

## Safeguards
- Always check `.instructions/warnings.md` before structural changes.
- Respect patterns in `.instructions/contexts/project.patterns.md`.
- If `.instructions/` is missing, run the **Onboarding Agent**.

## Manual-Only Guidance
- Treat destructive scaffolding as opt-in (e.g., onboarding/bootstrapping tasks).
- Prefer small, verifiable steps; keep changes close to established patterns.
