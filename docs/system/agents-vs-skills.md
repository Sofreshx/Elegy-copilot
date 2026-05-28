---
created: 2026-02-23
updated: 2026-05-26
category: system
status: current
doc_kind: node
id: agents-vs-skills
summary: Decision matrix for when to use an agent vs a skill (especially with MCP-backed tools).
tags: [agents, skills, mcp]
---

# Agents vs Skills Decision Matrix

This guide clarifies when to choose an agent versus a skill when using MCP-backed tools.

## Definitions

- MCP: Access layer that exposes external services as tools for agents and skills.
- Agents: Orchestrators that perform multi-step operations and make decisions.
- Skills: Playbooks for repeatable, well-scoped operations (prefer idempotent and read-only).

## Default Recommendation

Default recommendation: use agents for multi-step, stateful operations; use skills for repeatable, well-scoped patterns (prefer idempotence and read-only where possible).

## Cross-tool portability (dedupe)

If you want something reusable across **Copilot CLI** and **VS Code**, prefer a **skill**.

Practical rule:
- Put skills in `.github/skills/<skill>/...` (single source of truth)
- Install once per machine into `~/.copilot/skills/<skill>/...` for always-installed skills, including the shared planning/spec/review lane, or `~/.copilot/skills-vault/<skill>/...` for on-demand-only skills
- Point VS Code at `~/.copilot/skills` via `chat.agentSkillsLocations` (installer does this)

Agents are still useful, but they’re more likely to diverge (tools, UX, capabilities). Keep agents tool-neutral when possible, and only fork into tool-specific variants when you have a real need.

## Decision Matrix

| Scenario | Choose | Rationale |
| --- | --- | --- |
| Infra debugging (collect logs, run checks, optionally restart) | Agent | Multi-step flow with branching and possible approvals. |
| DB schema lookup (list tables/columns, return schema) | Skill | Read-only, repeatable, and scoped to metadata. |
| Deployment checks (pre-flight checks and canary runs) | Agent | Orchestration across steps with state and decision points. |
| Read-only discovery (list buckets, inventory) | Skill | Simple queries that should be idempotent. |
| Emergency incident recovery (runbook rollback) | Agent | High impact, requires sequencing and approval gating. |

## Rule of Thumb

If the work is multi-step, stateful, or requires decisions, prefer an agent. If the work is repeatable, well-scoped, and ideally read-only, prefer a skill.

## Safety and Approval Guidance

- Keep manual approval enabled for write or scoped operations.
- Use least-privilege tokens and project-level scoping for MCP access.
- Prefer read-only skills for discovery and metadata queries.
- Require a human review for destructive or production-impacting actions.

## Validation Checklist

- [ ] Definitions for MCP, agents, and skills are present.
- [ ] Decision matrix includes at least 3 concrete examples.
- [ ] Default recommendation statement is present.
- [ ] Rule of thumb paragraph is present.
- [ ] Safety and approval guidance is present.
