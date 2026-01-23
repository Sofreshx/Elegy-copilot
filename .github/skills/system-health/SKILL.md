---
name: system-health
description: "System health diagnostic. Validates file integrity, references, and configuration. Use this for internal system maintenance only. Triggers on:"system health", "verify system integrity", "health check"."
---

# System Health Skill

## Purpose
Perform a deep diagnostic scan of the instruction engine to ensure integrity, valid references, and correct configuration.

## Inputs
- Root `.github/` folder.
- All `.agent.md` and `.context.md` files.
- `copilot-instructions.md`.

## Checks

### 1. Core Integrity
- **Existence**: Verify presence of critical files:
  - `.github/copilot-instructions.md`
  - `.github/agents/` (at least one `*.agent.md`)
  - `.codex/skills/` (at least one skill)

### 2. Agent Validation
Iterate through all `.github/skills/*/SKILL.md`:
- **Frontmatter**: Ensure valid YAML header with `description`.
- **Skill References**: Extract references and verify the files exist.
- **Context References**: Extract `contexts/*.md` references and verify the files exist.
- **Path Logic**: Check for incorrect relative paths. Since skills are in `.github/skills/<name>/`, paths to root artifacts should be `../../[file]`.

### 3. Executive Routing
- Read `.github/copilot-instructions.md`.
- Verify that every agent listed under "Executive Agents" exists on disk.

### 4. Context Validity
Iterate through `.github/contexts/*.md`:
- **Empty Contexts**: Flag contexts that are empty or contain only template text.

## Output
- **Health Report**: A summary of the scan.
  - ? **Pass**: System is healthy.
  - ?? **Warning**: Minor issues (empty contexts, deprecated fields).
  - ? **Error**: Broken links, missing core files, invalid YAML.
- **Fix Tasks**: If errors are found, propose task files under `.instructions/tasks/` (or `.instructions/raw.tasks.md` if clarification is needed).

## Example Report
```markdown
# System Health Report
Status: ?? Warning

## Errors
- [ ] Agent `planner.agent.md` references missing skill `skills/unknown.skill.md`.
- [ ] `copilot-instructions.md` points to non-existent agent `ghost.agent.md`.

## Warnings
- [ ] `react.context.md` appears to be empty.
```




