# Lazy Loading Pattern for Instruction Engine
> **Purpose**: Minimize context window usage by loading only what's needed, when it's needed.

## Problem
Loading all skills, contexts, and agents at once overwhelms the context window and reduces response quality. The full engine is ~38 skills + 7 executives + contexts = significant token cost.

## Solution: Staged Loading

### Stage 1: Kernel Boot (Always Loaded)
```
copilot-instructions.md     (~100 lines)
├── Executive routing table
├── Workspace model overview
└── Skill expansion rule
```

### Stage 2: Executive Selection (On Demand)
When user intent is classified, load ONE executive:
```
user: "create a plan for..."
→ Load: project-planner.agent.md
→ Skip: all other executives
```

### Stage 3: Skill Discovery (Index First)
```
1. Load: skills/index.md (lightweight, ~150 lines)
2. Match user request to "Triggers" column
3. Load: only matched skill(s)
```

### Stage 4: Context Loading (Selective)
```
# Only load contexts relevant to the task
if task.domain == "auth":
    load(".instructions/contexts/auth.context.md")
if task.has_warnings:
    load(".instructions/warnings.md")
```

---

## Implementation

### In Executive Agents
Add this Pre-Flight pattern:

```markdown
## Pre-Flight (Lazy Loading)
1. Read `.instructions/project.index.md` for:
   - Active skills (only load checked items)
   - Local overrides in `.instructions/skills/`
2. Read `skills/index.md` to match task → skill
3. Load ONLY the matched skill file(s)
4. Load contexts ONLY if skill requires them
```

### In Skill Index
Skills marked with `(lazy)` should only be loaded when explicitly matched:
```markdown
| Skill | File | Triggers | Load |
|-------|------|----------|------|
| Firebase Auth | `firebase.auth.agent.md` | "Firebase" | lazy |
| Orleans | `orleans.agent.md` | "grain", "Orleans" | lazy |
```

### In Project Index
```markdown
## Active Skills
- [x] feature.creator.agent.md  <!-- Always loaded -->
- [x] testing.agent.md           <!-- Always loaded -->
- [ ] terraform.agent.md         <!-- Only if triggered -->
- [ ] orleans.agent.md           <!-- Only if triggered -->
```

---

## Loading Hierarchy

```
┌─────────────────────────────────────────┐
│ 1. copilot-instructions.md (Kernel)     │  ← Always
├─────────────────────────────────────────┤
│ 2. .instructions/project.index.md       │  ← If exists
├─────────────────────────────────────────┤
│ 3. Selected Executive Agent             │  ← One at a time
├─────────────────────────────────────────┤
│ 4. skills/index.md (discovery)          │  ← For skill routing
├─────────────────────────────────────────┤
│ 5. Matched Skill(s)                     │  ← Only what's needed
├─────────────────────────────────────────┤
│ 6. Relevant Context(s)                  │  ← Only if required
└─────────────────────────────────────────┘
```

---

## Anti-Patterns (Avoid)

❌ Loading all skills at session start
❌ Including full skill content in executive agents
❌ Loading all contexts "just in case"
❌ Embedding large examples in skill files

## Best Practices

✅ Keep skill files under 100 lines
✅ Use `extends:` to inherit from base skills
✅ Reference external docs via `sources:` URLs
✅ Defer context loading until task execution
✅ Use project.index.md to disable unused skills

---

## Metrics Target

| Metric | Before | After |
|--------|--------|-------|
| Initial load | ~15,000 tokens | ~1,500 tokens |
| Per-task load | +5,000 tokens | +500-1,000 tokens |
| Max concurrent skills | All | 2-3 |

---

## Version
- **Created**: 2025-12-30
- **Pattern Version**: 1.0
