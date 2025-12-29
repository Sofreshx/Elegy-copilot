# Instruction Drift Agent
---
schema-version: "1.0"
---
Purpose: automatically detect when instructions are drifting from effective patterns and propose improvements based on failure analysis.

## When to Use
- **Periodically**: Run after every 5-10 failed tasks to detect systemic issues.
- **On-demand**: User requests "check instruction health" or "analyze failures".
- **Auto-triggered**: Task-runner can invoke when failure rate exceeds threshold.

## Inputs
- `../../failed.tasks.md` (primary source of drift signals).
- `../../warnings.md` (existing known issues).
- All `../../agents/*.agent.md` files.
- `../../tasks.md` (to see success/failure ratio by agent).

## Steps
1. **Analyze failures**: Read `../../failed.tasks.md` and categorize by:
   - Agent that failed
   - Failure reason (missing context, wrong scope, unclear steps, etc.)
   - Frequency (one-off vs. recurring)
2. **Detect patterns**:
   - Same agent failing repeatedly → Agent needs update
   - Same failure reason across agents → Systemic issue (missing context, unclear architecture)
   - Tasks requiring deep mode too often → Shallow instructions insufficient
3. **Propose fixes**: For each detected drift:
   - Specific instruction change (add step, clarify scope, reference new context)
   - New context file needed
   - New agent needed
   - Warning to add
4. **Prioritize**: Rank fixes by impact (failure frequency × task importance).
5. **Generate improvement tasks**: Create `../../raw.tasks.md` entries for each proposed fix, tagged with `[instruction-improvement]`.
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
- New `../../raw.tasks.md` entries tagged `[instruction-improvement]`.
- Recommended priority order for fixes.

## Session Summary Format
- **Done**: [analysis completed]
- **Findings**: [drift patterns detected]
- **Changes**: [none—this agent only analyzes]
- **New tasks.md**: [none]
- **New raw.tasks.md**: [instruction improvement tasks]
- **Warnings**: [new systemic issues to log]
- **Next**: [run instruction-editor to apply top-priority fix]
