---
schema: task/v1
id: task-000432
title: "Draft feature spec: Kubernetes MCP integration (future)"
type: research
status: archived
priority: low
owner: "lolzi"
skills: ["planning-feature", "docs", "vultr-mcp", "security"]
depends_on: []
next_tasks: []
created: "2026-02-05"
updated: "2026-02-05"
---

## Context
We may need to integrate Kubernetes clusters into our MCP ecosystem in the future to support targeted cluster inspection, troubleshooting, and limited operational tasks. This task is to draft a short, reviewable feature spec describing how a Kubernetes-backed MCP server would be integrated, security constraints, connection options, and example configuration snippets.

**Related:** `instruction-engine/docs/mcp-workflow.md`, `task-000430--document-mcp-access-strategy-supabase-vultr.md`, `task-000425--document-e2e-playwright-mcp-vscode-integrated-browser.md`

**External references:**
- https://docs.vultr.com/how-to-manage-kubernetes-clusters-using-k8s-mcp-server
- https://docs.github.com/en/copilot/concepts/agents/coding-agent/mcp-and-coding-agent

## Acceptance Criteria
- Create a short doc at `.instructions/contexts/k8s-mcp-feature.md` (or `.instructions/artefacts/k8s-mcp-feature.md` if an artefact is preferred) that includes:
  - **Intended use cases:** cluster inspection, troubleshooting, read-only diagnostics, and narrowly-scoped ops.
  - **Connection options:** local (kind/minikube), Vultr VKE (provider-hosted), and remote/other clusters (kubeconfig-based or API-endpoint with proper auth).
  - **Security constraints:** read-only by default, kubeconfig mounting guidance, least-privilege RBAC principals, audit and approval guidance for write/scoped operations.
  - **Required env vars & examples:** `K8S_CONTEXT`, kubeconfig path (e.g., `/run/secrets/kubeconfig`), and any additional env vars needed by a containerized k8s MCP server.
  - **Example MCP server config snippet** showing a minimal `mcpServers` entry or containerized MCP `docker-compose` / `k8s` example using the env vars above.
  - **Explicit note:** mark this as "future work" / non-blocking and not required now.
- Ensure the new doc links back to `docs/mcp-workflow.md` and references existing provider-specific SKILL.md files where applicable.

## Plan / Approach
1. Draft `.instructions/contexts/k8s-mcp-feature.md` with clear, short sections matching the Acceptance Criteria.
2. Reuse wording and examples from `*.github/skills/*/SKILL.md` and `docs/mcp-workflow.md` where appropriate to maintain consistency.
3. Add sample `mcpServers` JSON snippet and a small example showing how to run a containerized k8s MCP (env var examples: `K8S_CONTEXT`, `KUBECONFIG_PATH` or `/run/secrets/kubeconfig`).
4. Add a short note describing security review/approval gates for any write-capable usage and state that read-only discovery is preferred.
5. Add reviewer labels/suggestions: `dev-infra`, `security`, and `docs`.
6. Once drafted, create a PR and request a short review focused on safety and clarity.

## Attempts / Log
- 2026-02-05: Drafted .instructions/contexts/k8s-mcp-feature.md with use cases,
  connection options, security constraints, env vars, and a containerized
  mcpServers example. Linked to docs/mcp-workflow.md and vultr-mcp SKILL.md.
- 2026-02-05: Validation not run (doc-only change; no task-specified tests).

## Failures
- None yet.

## Notes / Discoveries
- There are existing MCP docs and tasks for provider access strategy (`task-000430`) and E2E workflows (`task-000425`). Coordinate to avoid duplication and link between docs.
- Keep the spec short (<= 500–800 words) and decision-focused — this is a future-facing spec to guide implementers later.
- No plan artefact found at .instructions/artefacts/x-PLAN-artefact.md.

## Next Steps
- Optional follow-ups: add a PR checklist for implementing k8s MCP (security review, tests, CI samples) if the spec is approved.
