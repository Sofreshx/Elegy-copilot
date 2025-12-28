# Tasks (Backlog)
Structured tasks ready for execution.

Columns:
- ID: T-###
- Title
- Priority: P0/P1/P2
- Agent: domain agent to run
- Mode: shallow | deep | auto (auto = agent decides based on context/prior failures)
- Status: pending | in-progress | done | blocked | failed
- DependsOn: optional IDs
- Notes/Context

Example:
| ID    | Title                          | Priority | Agent                    | Mode | Status    | DependsOn | Notes |
|-------|--------------------------------|----------|--------------------------|------|-----------|-----------|-------|
| T-001 | Implement profile update API   | P1       | feature.creator.agent.md | auto | pending   |           | use Firebase auth |
