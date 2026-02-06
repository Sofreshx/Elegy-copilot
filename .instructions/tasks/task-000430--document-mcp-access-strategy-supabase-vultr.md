---
schema: task/v1
id: task-000430
title: "Document MCP access strategy: Supabase & Vultr (safety & CI guidance)"
type: docs
status: done
priority: medium
owner: "dev-infra"
skills: ["docs", "supabase-mcp", "vultr-mcp", "security"]
depends_on: ["task-000426"]
next_tasks: []
created: "2026-02-05"
updated: "2026-02-05"
---

## Context

We need a short, reviewable doc (update `instruction-engine/docs/mcp-workflow.md` or add a linked provider doc) that explicitly documents how MCP access is configured and used for external resources (Supabase, Vultr), including environment variables, recommended scopes, CI patterns, and safety defaults. There are related docs and tasks:

- Existing central doc: `instruction-engine/docs/mcp-workflow.md`
- Provider skill docs:
  - `instruction-engine/.github/skills/supabase-mcp/SKILL.md`
  - `instruction-engine/.github/skills/vultr-mcp/SKILL.md`
- Related tasks: `task-000426` (archived: MCP config guidance), `task-000425` (Playwright E2E / MCP notes)
- External references: Supabase MCP docs (https://supabase.com/docs/guides/getting-started/mcp), Copilot Coding Agent MCP notes (https://docs.github.com/en/copilot/concepts/agents/coding-agent/mcp-and-coding-agent), and `rsp2k/mcp-vultr` for reference implementations.

## Acceptance Criteria

- `instruction-engine/docs/mcp-workflow.md` is updated (or a new provider-specific doc is added and linked) and contains the following clearly labeled subsections and examples:
  - **Supabase MCP**
    - Hosted MCP server URL example (`https://mcp.supabase.com/mcp`) and example `mcpServers` entry.
    - Project scoping via `SUPABASE_PROJECT_REF` and recommendation to scope to a single project.
    - Recommendation to prefer read-only tokens for discovery and metadata operations.
    - CI pattern: show PAT usage example with header `Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}` (do not store secrets in repo) and include a short CI snippet.
    - Env var mapping: `SUPABASE_PROJECT_REF`, `SUPABASE_ACCESS_TOKEN` (explicitly documented).
  - **Vultr MCP**
    - Local MCP server example using `vultr-mcp-server` and env var mapping: `VULTR_API_KEY`.
    - Note to **review** any third-party/remote MCP servers before trusting them (prefer read-only or scoped policies when possible).
    - Guidance to prefer Terraform for large or repeatable infra changes and use MCP for discovery/targeted updates.
  - **Copilot / Coding Agent constraints**
    - State that Copilot coding agents are restricted to MCP tools only (no unattended external browsing or OAuth flows).
    - Note Playwright-specific constraint: Playwright MCP setups assume a local MCP/test server (e.g., localhost) for integration and guidance link to `task-000425` and GitHub docs.
    - Document limitations for remote MCP OAuth flows (explain interactive OAuth is not reliably automatable via remote agent; recommend using CI PATs or pre-authorized non-interactive tokens for CI or remote agent use).
  - **Safety defaults**
    - Manual approval for tool calls must be kept enabled for write/scoped operations by default.
    - Use least-privilege tokens (read-only where possible), prefer non-production projects, and avoid storing secrets in repo files.
  - **Decision guide** (short): a one-paragraph rule-of-thumb and 2-3 examples describing when to use MCP vs Terraform vs manual changes (e.g., "Use MCP for discovery, small scoped changes, or when an agent needs interactive access to metadata; use Terraform for large/infra-as-code changes; prefer manual/conservative review for production-impacting changes").

- Validation checklist in the doc so reviewers can confirm presence of the critical items above (searchable items: `VULTR_API_KEY`, `SUPABASE_PROJECT_REF`, `SUPABASE_ACCESS_TOKEN`, `manual approval`).

## Plan / Approach

1. Audit `instruction-engine/docs/mcp-workflow.md` and the provider skill docs (`supabase-mcp`, `vultr-mcp`) to gather existing examples and env var names.
2. Draft additions to `mcp-workflow.md` (or a new `docs/mcp-providers.md` if the content grows) containing the subsections listed in Acceptance Criteria. Reuse the JSON/snippet examples from `*.github/skills/*/SKILL.md` where applicable.
3. Add explicit Copilot coding-agent constraints and Playwright MCP notes, linking to `task-000425` and the official Copilot docs for coding-agent MCP limitations.
4. Add a short decision guide (1 paragraph + 2 quick examples) and a simple validation checklist at the bottom.
5. Add a short CI example for Supabase showing how to inject `SUPABASE_ACCESS_TOKEN` via CI secrets and how to set the header in `mcpServers` config.
6. Create a PR with the docs changes and add a reviewer from `dev-infra`/`security`.
7. After merge, validate by searching for the key env var names and the new Copilot guidance and mark the checklist complete.

## Attempts / Log

- 2026-02-05: Updated docs/mcp-workflow.md with Supabase/Vultr MCP sections,
  Copilot constraints, CI snippet, decision guide, and validation checklist.
  Linked Playwright guidance to task-000425. No tests run (docs-only change).

## Failures

- (To be filled if any edits are rejected or require rethink)

## Notes / Discoveries

- Related archived task: `task-000426` consolidated many of these items already — this task focuses on the Copilot-specific constraints, CI snippet for Supabase, and the decision guide requested.
- Playwright / E2E specifics are covered in `task-000425` — coordinate changes to avoid duplication.

## Next Steps

1. Assign owner and implement the doc edits (owner suggestion: `dev-infra`).
2. Create a small test-task if we want CI to assert doc presence (optional) and add it to `.instructions/test-tasks/`.
3. Open PR and request a security/docs review to confirm the safety defaults and token examples are accurate.

---

**Validation Notes (for reviewer):**
- Confirm `mcp-workflow.md` (or linked provider doc) contains `VULTR_API_KEY`, `SUPABASE_PROJECT_REF`, and `SUPABASE_ACCESS_TOKEN`.
- Confirm Copilot coding agent constraints are documented and Playwright/remote OAuth limitations are referenced.

