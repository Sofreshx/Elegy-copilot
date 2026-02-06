---
schema: task/v1
id: task-000425
title: "Inventory: MCP & infra secrets (Vultr, Supabase, SSH, Relay)"
type: docs
status: archived
priority: medium
owner: "lolzi"
skills: ["secrets-auditor", "docs", "generic-infra.secrets-and-naming", "infra-settings"]
depends_on: []
next_tasks: []
created: "2026-02-05"
updated: "2026-02-05"
---

## Context

Produce a clear, runnable inventory of MCP (Vultr, Supabase), infra, and app secrets. The inventory should say where each secret lives (which repo or infra secret manager or GitHub Actions), which workflows/configs reference them, and whether they are present or missing.

Reference docs and locations:
- `instruction-engine/docs/mcp-workflow.md`
- `instruction-engine/mobile-companion/`
- `GenericInfrastructure/traefik/`
- `GenericInfrastructure/.github/workflows/`

The deliverable is a new canonical doc at `.instructions/contexts/mcp-infra-secrets.md` (see Acceptance Criteria).

## Acceptance Criteria

- [ ] Create `.instructions/contexts/mcp-infra-secrets.md` containing all sections below:
  - **Required secrets list** with at least the following entries and clear descriptions:
    - Vultr MCP: `VULTR_API_KEY`
    - Supabase MCP: `SUPABASE_PROJECT_REF`, `SUPABASE_ACCESS_TOKEN`
    - SSH diagnostics: `SERVER_IP`, `SSH_USER`, `SSH_KEY`
    - Mobile companion / relay OAuth: `OAUTH_CLIENT_ID`, `RELAY_HTTP_URL`, `RELAY_WS_URL`, `RELAY_JWT_SECRET`
  - **Current vs Missing**: a comparison that indicates which secrets are present in GitHub Actions (or other secret stores) and which are missing — based on the provided GitHub secrets screenshot or live verification (GH API / GH CLI). If a screenshot is not available, document what access is required.
  - **Repo ownership**: for each secret, specify which repository owns the configuration and/or workflow that consumes it (e.g., `instruction-engine`, `GenericInfrastructure`) and list the referring files/workflows.
  - **References**: list the code/workflow/config files (lines or filenames) that reference each secret.
  - **Per-app .env placement guidance**: note recommended placement for secrets to avoid infra-wide collisions (examples, namespacing, `.env.example` updates).
- [ ] Add a short link/reference to the new doc in `instruction-engine/docs/mcp-workflow.md` (or note where it should be referenced) so it’s discoverable from existing MCP docs.
- [ ] If feasible, annotate the GitHub secrets screenshot (or include an exported table from the GH API) and attach or link it in the new doc.
- [ ] Create follow-up issues or PR suggestions for missing or mis-scoped secrets (list them in the doc and this task’s completion notes).
- [ ] Update this task with a link to the created doc and short validation notes confirming the sections above exist.

## Plan / Approach

1. Seed the inventory with the required secrets listed above.
2. Search the repo for environment variable references (grep for common patterns: `VULTR_API_KEY`, `SUPABASE`, `RELAY`, `OAUTH`, `SSH_KEY`, etc.).
3. Audit `GenericInfrastructure/.github/workflows/`, `instruction-engine/.github/workflows/`, and other workflow files for `secrets` usage and list which repo-level secrets are required by which workflows.
4. Inspect `GenericInfrastructure/traefik/` and relevant deployment/config directories for embedded secrets or references.
5. Check for `.env.example` and deployment docs in each repo and note any inconsistencies or collision risks.
6. If access is available, run GH API calls (or `gh secret list`) to enumerate repo-level secrets for `instruction-engine` and `GenericInfrastructure`; otherwise ask the infra owner for the screenshot or a secrets export.
7. Produce `.instructions/contexts/mcp-infra-secrets.md` with tables and explicit mapping (secret → description → owner repo → referenced files/workflows → present? → recommended action).
8. Add suggested follow-up tasks (e.g., create missing secrets, tighten scope, add CI checks to fail if required secrets are not present).

## Attempts / Log

- 2026-02-05: Created .instructions/contexts/mcp-infra-secrets.md with required sections (required secrets, current vs missing, repo ownership, references, per-app .env guidance, follow-up suggestions).
- 2026-02-05: Added link to secrets inventory in docs/mcp-workflow.md.
- 2026-02-05: GitHub secrets listing not accessible in this run; status marked unknown pending screenshot or gh secret list.

## Failures

(Record any blockers: missing GitHub access, missing screenshots, unclear ownership.)

## Notes / Discoveries

- Check with infra owners if GH repo access is needed to list secrets. If no access, request an exported list or screenshot of "Settings → Secrets" for each repo.
- Consider standardizing namespacing for secrets that are consumed by multiple apps (e.g., `RELAY__JWT_SECRET` or `MCP_SUPABASE_ACCESS_TOKEN`).
- Follow-up suggestions listed in .instructions/contexts/mcp-infra-secrets.md (verify secrets list, clarify VITE_ public config, add CI check for required secrets).

## Next Steps

1. Start the audit and create `.instructions/contexts/mcp-infra-secrets.md` with the inventory and sections above.
2. If access is unavailable, ask the infra team for a screenshot or have them run `gh secret list` and share results.
3. Create follow-up tasks to add missing secrets (or owners) and add `.env.example` updates where appropriate.

**Suggested Adjacent Work:**
- Create a short CI check or GitHub Action that validates required secrets exist before deployment.
- Add a docs task to standardize secret naming conventions across repos.
