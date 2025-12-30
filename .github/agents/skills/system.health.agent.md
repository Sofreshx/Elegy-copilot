---
name: system-health
description: "System health diagnostic. Validates file integrity, references, and configuration. Internal system skill."
tools: ['read', 'search']
infer: false
---

# System Health Agent

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
  - `.github/tasks.md`
  - `.github/raw.tasks.md`
  - `.github/warnings.md`
  - `.github/contexts/project.patterns.md`
  - `.github/contexts/security.context.md`

### 2. Agent Validation
Iterate through all `.github/agents/*.agent.md`:
- **Frontmatter**: Ensure valid YAML header with `description`.
- **Skill References**: Extract `skills/*.agent.md` references and verify the files exist.
- **Context References**: Extract `contexts/*.md` references and verify the files exist.
- **Path Logic**: Check for incorrect relative paths (e.g., `../../tasks.md` vs `../tasks.md`). Since agents are in `.github/agents/`, paths to root artifacts should be `../[file]`.

### 3. Executive Routing
- Read `.github/copilot-instructions.md`.
- Verify that every agent listed under "Executive Agents" exists on disk.

### 4. Context Validity
Iterate through `.github/contexts/*.md`:
- **Empty Contexts**: Flag contexts that are empty or contain only template text.

## Output
- **Health Report**: A summary of the scan.
  - ✅ **Pass**: System is healthy.
  - ⚠️ **Warning**: Minor issues (empty contexts, deprecated fields).
  - ❌ **Error**: Broken links, missing core files, invalid YAML.
- **Fix Tasks**: If errors are found, generate `raw.tasks.md` entries to fix them.

## Example Report
```markdown
# System Health Report
Status: ⚠️ Warning

## Errors
- [ ] Agent `planner.agent.md` references missing skill `skills/unknown.skill.md`.
- [ ] `copilot-instructions.md` points to non-existent agent `ghost.agent.md`.

## Warnings
- [ ] `react.context.md` appears to be empty.
```
