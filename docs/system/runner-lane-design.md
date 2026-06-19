---
created: 2026-06-19
updated: 2026-06-19
category: system
status: current
doc_kind: node
id: runner-lane-design
summary: Design and contract for the runner and runner-flash lane agents. Text-plan-driven execution without elegy-planning.
tags: [runner, lane, orchestration, agents]
related: [orchestration-and-agents, reviewer-lane-governance, project-conventions-governance]
---

# Runner Lane Design

## Purpose

Runner lanes execute a text plan from the user's prompt by parsing it into
discrete tasks and delegating each to sub-agents with a full review chain.
No elegy-planning dependency.

## Variants

| Lane | Orchestration | Implementation | Use |
|---|---|---|---|
| `runner` | Pro | Pro (`impl-pro`) | Complex work, higher-quality implementation |
| `runner-flash` | Pro | Flash (`impl`) | Lower-cost, same orchestration rigor |

## Dependencies

Runner lanes require no elegy-planning. Required sub-agents:
- `explorer` (Flash, read-only)
- `impl` or `impl-pro` (Flash or Pro, write-capable)
- `reviewer` (Pro, read-only)
- `scout` (Pro, read-only, external research)

Required skills: `runner-workflow`, `worktree`, `rubberduck-plan-review`,
`implementation-review`.

## Workflow

```
Parse → Plan review → Execute (per task) → Complete
                         │
                         ├─ explorer (pre-impl discovery)
                         ├─ impl(-pro) (bounded implementation + pre-submission checklist)
                         └─ reviewer (code review; retry up to 2x on changes-requested)
```

## Review Policy

| Verdict | Action |
|---|---|
| `approved` | Proceed to next task |
| `changes-requested` | Auto-fix up to 2 retries; escalate after exhaustion |
| `blocked` | Escalate to user immediately |

## Pre-Submission Checklist (on impl/impl-pro)

Before returning `done`, impl must:
1. Pass all validation commands
2. Inspect `git diff`: no debug code, commented-out code, secrets, unrelated changes
3. Confirm scope matches task description

## Worktree

Default: current workspace. Worktree only on explicit user request.

## Contrast with elegy-runner

| | runner | elegy-runner (project) |
|---|---|---|
| Plan source | Prompt text | elegy-planning DB |
| Multi-session | No | Yes |
| Worktree | Optional | Required |
| Lease tracking | No | Yes |
| Review hardening | Pre-submission checklist + 2-retry auto-fix | Standard review gates |

## Files

- `opencode-assets/agents/runner.md` — Runner lane agent
- `opencode-assets/agents/runner-flash.md` — Runner-flash lane agent
- `opencode-assets/agents/impl-pro.md` — Strong implementation subagent
- `opencode-assets/skills/runner-workflow/SKILL.md` — Shared workflow skill
