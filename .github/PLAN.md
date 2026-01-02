# Skills-First Agentic Pattern: Architectural Plan

## 1. Vision
Provide a lightweight, repo-native way to make Copilot reliable:
- Use **repository custom instructions** (`.github/copilot-instructions.md`) for always-on, short guidance.
- Use **Agent Skills** (`.github/skills/*/SKILL.md`) for repeatable, domain-specific workflows.
- Use **Plan Mode** for non-trivial planning.
- Use **Subagents** only when explicitly requested or when research would clutter the main context.

## 2. Core Architecture

### Repository Custom Instructions
* **`.github/copilot-instructions.md`**: Always-on, concise rules for how to work in the repo (structure, do/don't, where to store notes).

### Skills (Auto-Loaded)
* **`.github/skills/<skill>/SKILL.md`**: Detailed, reusable procedures that Copilot auto-loads based on the user request.
* Shared skills can live in `instruction-engine/.github/skills/` as a source-of-truth, but must be copied into the active repo to be auto-loaded.

### Local Planning & Backlog (`.instructions/`)
Use `.instructions/` for developer-local context and task tracking (usually gitignored):
- `tasks.md` (active backlog)
- `raw.tasks.md` (inbox)
- `failed.tasks.md` (post-mortems)
- `contexts/*` (project patterns/memory)

The `project-management` skill defines the schema and how to keep these files clean.

## 3. Optional Custom Agents
Custom agents are optional and invoked directly when you want a different perspective:
- `assistant` for read-only Q&A
- `debugger` for investigation reports
- `auditor` for audits/quality checks
- `merger` for conflict resolution
- `onboarding` for scaffolding `.instructions/`
- `skill-builder` for creating new repo-local skills (when docs must be fetched)

## 4. Implementation Phases
1. Add/maintain `.github/copilot-instructions.md` in each repo.
2. Create repo-local skills for repeatable workflows.
3. Use Plan Mode for large work; save plans into `.instructions/tasks.md` (optional).
4. Iterate by adding skills when you notice repeated mistakes or missing context.
