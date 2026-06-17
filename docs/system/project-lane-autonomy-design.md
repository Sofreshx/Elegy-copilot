# Project Lane Autonomy Design

**Status:** Superseded. Project lane was removed in `docs/specs/agentic-lanes-quality-v2/spec.md`.
Autonomous continuation, evidence chains, and questioning policy now live in:
- `docs/system/calibrated-questioning-and-depth-governance.md` — questioning ladder
- `docs/system/project-lane-autonomy-design.md` — archived
- `elegy-planning` project-run lifecycle — lease/release/evidence API via `opencode-assets/plugins/planning.js`

## Phase Autonomy Defaults

| Phase | Autonomy | Feedback Required |
|---|---|---|
| **Discovery/exploration** | Full auto | None — explore codebases, trace dependencies |
| **Implementation** | Full auto within plan | None — edit, test, retry inside a work point |
| **Validation (cheap)** | Full auto | None — lint, unit tests, typecheck per edit |
| **Validation (session-boundary)** | Auto-execute, report | Report findings; pause only on failure |
| **Review gates** | Auto-delegate to reviewer | Reviewer verdict is blocking |
| **Git commit** | Propose | Explicit user approval required |
| **Git merge** | Propose | Explicit user approval required |
| **Git push** | Never auto | Explicit user request required |
| **Worktree delete** | Auto if clean | Pause if dirty (pending changes) |
| **Plan completion** | Auto | Report evidence summary |
| **Next work point** | Auto | Proceed without re-confirmation |
| **Roadmap completion** | Pause | Present validation summary, ask about next steps |

## Feedback Gates

**Pause for user input ONLY when:**
1. Clarification would change scope, architecture, or acceptance criteria and cannot be inferred from evidence.
2. Blocking issue discovered (plan/work point status: blocked, validation failure with no obvious fix, missing input only the user can supply, destructive operation needed, or unresolved review verdict: blocked).
3. Full roadmap is complete — present the validation summary and ask the user about next steps.
4. User explicitly asked to pause.

**Never pause for:**
- Between work points in the same plan
- On successful validation
- On pre-existing `planning_validate()` findings from other scopes
- When the next action is discoverable from the plan

## Deferred: What NOT To Build Yet

| Feature | Why Deferred |
|---|---|
| DB settings table/schema | Evidence capture must work first; don't add schema until workflow is proven |
| DB compaction/VACUUM policy | Premature optimization; DB is small and low-traffic |
| Autonomy-level UI controls (slider, presets) | No evidence that users need runtime tuning; defaults cover the workflow |
| Per-phase autonomy toggles | Phase defaults documented above are sufficient until evidence shows otherwise |
| "Auto-commit" mode | Violates Git Workflow safety rules; explicit approval is the contract |

## When To Revisit

Trigger: Evidence capture is reliable across 3+ complete project-lane sessions with:
- Review points recorded per gate
- Issues/worries tracked
- Missed objectives documented
- Validation summaries captured
- Project-run evidence appended

Then revisit:
1. Do users want runtime autonomy tuning?
2. Do DB size/schema warrant compaction?
3. Does any phase default need adjustment based on evidence?

## Related

- `opencode-assets/agents/project.md` — Autonomous Continuation Policy, Reevaluation Policy
- `docs/system/calibrated-questioning-and-depth-governance.md` — Evidence-bound questioning ladder
- Goal: `GOAL-PROJECT-LANE-PLANNING-EVIDENCE-CONTROL-20260613`
