# Elegy Planning Capability Index

| id | side-effect | purpose |
| -- | -- | -- |
| `planning-goal-create` | disk_write | Create a durable goal with acceptance and rejection criteria |
| `planning-goal-show` | read-only | Show one goal plus linked context |
| `planning-goal-list` | read-only | List goals in the active scope |
| `planning-goal-update-status` | disk_write | Transition a goal to a new lifecycle state |
| `planning-roadmap-create` | disk_write | Create a roadmap under a goal |
| `planning-roadmap-add-section` | disk_write | Add a section to a roadmap |
| `planning-roadmap-add-work-point` | disk_write | Attach a work point with file scopes and effort tier |
| `planning-roadmap-show` | read-only | Show one roadmap with sections and work points |
| `planning-roadmap-list` | read-only | List roadmaps in the active scope |
| `planning-roadmap-update-status` | disk_write | Transition a roadmap |
| `planning-plan-create` | disk_write | Create a plan under a roadmap section |
| `planning-plan-show` | read-only | Show one plan with todos and evidence |
| `planning-plan-list` | read-only | List plans in the active scope |
| `planning-plan-revise` | disk_write | Revise a plan; use `--clear-routing-hint` / `--clear-file-scopes` to remove |
| `planning-plan-update-status` | disk_write | Transition a plan |
| `planning-work-point-list` | read-only | List work points in the active scope |
| `planning-work-point-show` | read-only | Show one work point with file scopes |
| `planning-work-point-update-status` | disk_write | Transition a work point |
| `planning-work-point-next-runnable` | read-only | List runnable work points ordered by effort and readiness |
| `planning-work-point-work-graph` | read-only | Render the work graph for the active scope |
| `planning-todo-create` | disk_write | Create a todo under a plan |
| `planning-todo-list` | read-only | List todos in the active scope |
| `planning-todo-update-status` | disk_write | Transition a todo |
| `planning-issue-record` | disk_write | Record an issue tied to a planning entity |
| `planning-issue-list` | read-only | List issues in the active scope |
| `planning-issue-update-status` | disk_write | Transition an issue |
| `planning-review-point-record` | disk_write | Record a review point on a planning entity |
| `planning-review-point-update-status` | disk_write | Transition a review point |
| `planning-insight-record` | disk_write | Record a reasoning insight attached to any planning entity |
| `planning-events-list` | read-only | List the planning event log for the active scope |
| `planning-scope-list` | read-only | List all known scopes |
| `planning-scope-show` | read-only | Show one scope with its entities |
| `planning-scope-create` | disk_write | Create a new scope |
| `planning-tags-list` | read-only | List all indexed tags across entities |
| `planning-search-extended` | read-only | Title / tag / status / FTS search |
| `planning-context-entity` | read-only | Progressive disclosure bundle for one entity |
| `planning-context-session` | read-only | Progressive disclosure bundle for a session |
| `planning-validate-all` | read-only | Run referential integrity and freshness validation |
| `planning-health` | read-only | Surface database health, FTS5 index drift, lease state |
| `planning-project-export` | disk_write | Export a scope to JSON |
| `planning-project-render` | disk_write | Render a scope to Markdown |
| `planning-project-run-claim` | disk_write | Claim a durable execution lease on a work point |
| `planning-project-run-activate` | disk_write | Activate a claimed run |
| `planning-project-run-release` | disk_write | Release a lease |
| `planning-project-run-add-evidence` | disk_write | Append immutable evidence to a run |
| `planning-project-run-list` | read-only | List active project runs |
| `planning-project-run-show` | read-only | Show one project run with full evidence trail |
