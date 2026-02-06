---
schema: task/v1
id: task-000426
title: "Document MCP config: Vultr & Supabase secure defaults and approval guidance"
type: docs
status: archived
priority: medium
owner: "dev-infra"
skills: ["vultr-mcp", "supabase-mcp", "docs", "security"]
depends_on: []
next_tasks: []
created: "2026-02-05"
updated: "2026-02-05"
---

## Context

The project supports MCP providers via the Skill Installer and the central MCP workflow doc at `instruction-engine/docs/mcp-workflow.md`.

There are existing skill docs with provider-specific examples and guidance:
- `instruction-engine/.github/skills/vultr-mcp/SKILL.md`
- `instruction-engine/.github/skills/supabase-mcp/SKILL.md`

This task covers adding clear, secure, and reviewable configuration guidance for Vultr and Supabase MCP integration in the repository documentation.

## Acceptance Criteria

- `instruction-engine/docs/mcp-workflow.md` (or a clearly linked new doc) contains:
  - MCP server example entries for **vultr** and **supabase** (config snippets)
  - Explicit env var mapping for **VULTR_API_KEY**, **SUPABASE_PROJECT_REF**, and **SUPABASE_ACCESS_TOKEN**
  - A clear note to **keep manual tool approval enabled** and to prefer **read-only/minimal scopes** for tokens
  - Guidance on **local development** vs **CI** secrets (how to set local env vars, how to inject CI secrets, and which scopes to prefer)

- Validation steps are described so the reviewer can confirm the doc contains the above snippets and mappings.

## Plan / Approach

1. Update `instruction-engine/docs/mcp-workflow.md` to include a short `Vultr` and `Supabase` subsection (or link to a new provider-specific doc) with the following:
   - Example `mcpServers` entries showing where `VULTR_API_KEY`, `SUPABASE_PROJECT_REF`, and `SUPABASE_ACCESS_TOKEN` are used.
   - Example CI snippet showing Authorization header for Supabase and a note about passing `VULTR_API_KEY` via environment in CI.
   - Security guidance (manual approval, read-only scope, avoid committing tokens).
   - Local dev notes: use `.env` or shell exports and local secret storage; prefer ephemeral dev tokens and non-prod projects for discovery.

2. Cross-reference the skill docs (`.github/skills/*`) and reuse the existing config examples, making them explicit in the central docs so they are discoverable by new contributors.

3. Add a short validation checklist to the doc so reviewers can confirm the acceptance criteria.

4. Optionally: if the doc becomes large, extract provider-specific sections into `docs/mcp-providers.md` and link from `mcp-workflow.md`.

## Attempts / Log

- 2026-02-05: Updated docs/mcp-workflow.md with Vultr and Supabase config examples,
  env var mapping, manual approval note, local vs CI secrets guidance, and a
  validation checklist.
- 2026-02-05: Validated env var presence via search for VULTR_API_KEY,
  SUPABASE_PROJECT_REF, and SUPABASE_ACCESS_TOKEN in docs/mcp-workflow.md.

## Failures

- N/A

## Notes / Discoveries

- The `vultr-mcp` and `supabase-mcp` skill docs already have useful examples; this task should consolidate and slightly expand them for discoverability and clarity.
- No `.instructions/artefacts/x-PLAN-artefact.md` file exists in the repo.

## Next Steps

- Assign to an owner (suggestion: `dev-infra`) and implement the doc changes.
- After implementation, run a quick review to confirm the presence of the three env vars and the manual approval guidance.

**Validation command for reviewer**

- Search `instruction-engine/docs/mcp-workflow.md` for `VULTR_API_KEY`, `SUPABASE_PROJECT_REF`, and `SUPABASE_ACCESS_TOKEN` and verify the config snippets are present.

---
