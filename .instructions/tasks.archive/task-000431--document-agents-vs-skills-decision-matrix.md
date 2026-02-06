---
schema: task/v1
id: task-000431
title: "Document: Agents vs Skills decision matrix (MCP & operational tasks)"
type: docs
status: archived
priority: medium
owner: "dev-docs"
skills: ["docs", "semantic-kernel-agents", "system-editor"]
depends_on: ["task-000430"]
next_tasks: []
created: "2026-02-05"
updated: "2026-02-05"
---

## Context

Contributors and reviewers need a concise, actionable guide that explains when to use agents vs skills when interacting with MCP-backed external resources and operational tasks. While `mcp-workflow.md` covers MCP provider setup and safety defaults, there is no dedicated guidance that clearly defines MCP vs agents vs skills and provides concrete examples showing which pattern to choose.

Relevant files and references:
- `instruction-engine/docs/mcp-workflow.md`
- `instruction-engine/.github/skills/*/SKILL.md` (examples of provider skills)
- Existing task: `task-000430--document-mcp-access-strategy-supabase-vultr.md`
- Copilot docs: https://docs.github.com/en/copilot/concepts/agents/coding-agent/mcp-and-coding-agent

## Acceptance Criteria

- Add a short doc (or a section in `instruction-engine/docs/mcp-workflow.md`) that includes:
  - **Definitions** (clear, one-line definitions):
    - **MCP** = access layer / tools (how external services are exposed to agents/skills)
    - **Agents** = doers (orchestrators that perform multi-step operations and make decisions)
    - **Skills** = playbooks (repeatable, idempotent operations—usually small, well-scoped, often read-only)
  - **Decision matrix** that maps common scenarios to a recommended pattern (agent vs skill) and short rationale. Must contain 3–5 concrete examples such as:
    - Infra debugging (e.g., collect logs, run checks, optionally restart instance) → **Agent** (multi-step, stateful, may require manual approval)
    - DB schema lookup (e.g., list tables/columns, return schema) → **Skill** (read-only, repeatable)
    - Deployment checks (pre-flight checks and canary runs) → **Agent** (multi-step, orchestration)
    - Read-only discovery / metadata queries (e.g., list buckets, inventory) → **Skill**
    - Emergency incident recovery (runbook-driven rollback) → **Agent**
  - **Default recommendation**: agents for multi-step, stateful operations; skills for repeatable, well-scoped patterns (prefer idempotence and read-only where possible).
  - Guidance on safety and approval: encourage manual approval gating for write/scoped operations and least-privilege tokens for MCP access.
  - A one-paragraph rule-of-thumb summarizing the decision logic.
- Link the new doc or section from `instruction-engine/docs/mcp-workflow.md` (or a relevant index page) so it's discoverable by contributors.
- Validation checklist in the doc or PR that confirms the doc contains: the three definitions, the decision matrix with at least 3 examples, and the default recommendation statement.

## Plan / Approach

1. Audit `instruction-engine/docs/mcp-workflow.md` and relevant `*.github/skills/*/SKILL.md` files to collect examples and wording conventions.
2. Draft the content as either:
   - a short section inside `mcp-workflow.md` (if the content is <~300–500 words), or
   - a new `instruction-engine/docs/agents-vs-skills.md` doc linked from `mcp-workflow.md` (if the content needs a standalone page).
3. Include a clear decision matrix (table or bullet list) with 3–5 concrete examples and short rationale lines.
4. Add safety guidance: approval gating, least-privilege, and examples of when to prefer manual review.
5. Add a validation checklist (searchable phrases) and a one-line rule-of-thumb.
6. Open a PR, request reviews from `dev-infra`, `dev-docs`, and `security`.
7. After merge, verify by searching for the three key definitions and the example rows (or table entries) to complete the checklist.

## Attempts / Log

- 2026-02-05: Added docs/agents-vs-skills.md with definitions, decision matrix,
  rule of thumb, safety guidance, and checklist; linked from docs/mcp-workflow.md.

## Failures

- (To be filled if any edits are rejected or require rework)

## Notes / Discoveries

- `task-000430` covers MCP provider access strategy and references `mcp-workflow.md`. Coordinate to avoid duplication and ensure both docs link to each other where useful.
- Keep the decision matrix short and actionable—prefer examples over theory.

## Next Steps

1. Confirm owner (default: `dev-docs`) or assign another owner (e.g., `dev-infra`).
2. Implement the doc (short section or separate file) and link it from `mcp-workflow.md`.
3. Open PR and request reviewers from `dev-infra` and `security` to verify safety guidance.

---

**Validation Notes (for reviewer):**
- Confirm the doc defines MCP, agents, and skills explicitly.
- Confirm presence of a decision matrix with at least 3 concrete examples.
- Confirm the doc contains the default recommendation: "agents for multi-step ops; skills for repeatable patterns."
