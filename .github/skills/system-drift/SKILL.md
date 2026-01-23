---
name: system-drift
description: "Instruction drift detection. Analyzes failed tasks to find systematic issues in agent instructions. Triggers on: system drift, pattern drift, fix drift."
---

# System Drift Detection Skill

## When to Use
- **Periodically**: Run after every 5-10 failed tasks to detect systemic issues.
- **On-demand**: User requests "check instruction health" or "analyze failures".
- **Auto-triggered**: Task-runner can invoke when failure rate exceeds threshold.

## Inputs
- Task files under `.instructions/tasks/` and `.instructions/tasks.archive/` (primary source of drift signals; read `## Failures` + `## Attempts / Log`).
- `../../.instructions/warnings.md` (existing known issues).
- All `.github/skills/*/SKILL.md` files (or `.instructions/skills/` for local overrides).
- `../../.instructions/tasks.history.md` (optional summary signal).

## Steps
1. **Analyze failures**: Read task files and categorize by:
   - Agent that failed
   - Failure reason (missing context, wrong scope, unclear steps, etc.)
   - Frequency (one-off vs. recurring)
2. **Detect patterns**:
   - Same agent failing repeatedly ? Agent needs update
   - Same failure reason across agents ? Systemic issue (missing context, unclear architecture)
   - Tasks requiring deep mode too often ? Shallow instructions insufficient
3. **Propose fixes**: For each detected drift:
   - Specific instruction change (add step, clarify scope, reference new context)
   - New context file needed
   - New agent needed
   - Warning to add
4. **Prioritize**: Rank fixes by impact (failure frequency � task importance).
5. **Generate improvement tasks**: Create task files under `.instructions/tasks/` for each proposed fix, tagged with `[instruction-improvement]` in `title` or `tags`.
6. **Report**: Summary of drift findings and proposed improvements.

## Drift Detection Rules
| Signal | Drift Type | Suggested Fix |
|--------|------------|---------------|
| Agent fails 3+ times on similar tasks | Agent scope unclear | Add clarifying steps, examples |
| "Missing context" in failure reasons | Context gap | Create new context file |
| Tasks always escalate to deep mode | Shallow instructions weak | Strengthen shallow-mode guidance |
| Same warning keeps appearing | Unresolved systemic issue | Prioritize fix or accept as known limitation |
| New stack detected but no agent | Coverage gap | Generate new agent via onboarding |
| User overrides agent selection often | Routing logic incorrect | Update kernel routing rules |

## Output
- Drift analysis report (in session summary).
- New task files under `.instructions/tasks/` tagged `[instruction-improvement]`.
- Recommended priority order for fixes.

## Session Summary Format
- **Done**: [analysis completed]
- **Findings**: [drift patterns detected]
- **Changes**: [none�this agent only analyzes]
- **New tasks**: [instruction improvement task files]
- **Warnings**: [new systemic issues to log]
- **Next**: [run system.editor to apply top-priority fix]



