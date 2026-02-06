# Kubernetes MCP Integration (Future)

This note captures a future-facing concept for integrating a Kubernetes-backed MCP
server into Instruction Engine. It aligns with the general MCP enable/disable
workflow in [../../docs/mcp-workflow.md](../../docs/mcp-workflow.md).

## Status (Future Work)

This is future work only. No implementation is required or scheduled now. Treat
this as a draft guide for later evaluation and security review.

## Intended Use Cases

- Cluster inspection and inventory (namespaces, workloads, nodes, versions).
- Troubleshooting and read-only diagnostics (events, pod logs, resource status).
- Narrow, explicitly approved operational actions (scoped rollouts or restarts).
- Targeted, time-boxed support sessions with manual tool-call approval.

## Connection Options

### Local clusters (kind/minikube)

- Run a local MCP server and point it at the local kubeconfig.
- Use non-production clusters and isolated contexts for experimentation.
- Prefer read-only RBAC roles even in local setups.

### Provider-hosted clusters (Vultr VKE)

- Use a dedicated service account with least-privilege RBAC.
- Prefer read-only access for discovery. Escalate only with explicit approval.
- For Vultr infrastructure access patterns, see
  [../../.github/skills/vultr-mcp/SKILL.md](../../.github/skills/vultr-mcp/SKILL.md).

### Remote or other clusters

- Mount a kubeconfig into the MCP server container or use an API endpoint with
  explicit auth and a restricted service account.
- Keep kubeconfig files out of source control and limit their lifetime.

## Security Constraints

- Read-only by default. Any write-capable tool must be explicitly approved.
- Use least-privilege RBAC roles (list/get/watch only for discovery).
- Store kubeconfig as a secret and mount it read-only.
- Enable audit logging on the cluster and retain logs for investigation.
- Prefer non-production clusters and sanitized data for MCP-driven workflows.
- Require manual review for destructive or production-impacting actions.

## Required Environment Variables

Common env vars for a containerized Kubernetes MCP server:

- K8S_CONTEXT: required. Selects the kubeconfig context to target.
- KUBECONFIG: path to kubeconfig inside the container (example: /run/secrets/kubeconfig).
- KUBECONFIG_PATH: host path used to mount the kubeconfig into the container.
  This is used by the wrapper command, not necessarily by the MCP server itself.

If a specific server uses a different env var name for the kubeconfig path,
prefer the server's documented variable and keep the mount path consistent.

## Example MCP Server Config (Containerized)

Minimal mcpServers entry that runs a containerized Kubernetes MCP server and
passes the required env vars:

```json
{
  "mcpServers": {
    "kubernetes": {
      "command": "docker",
      "args": [
        "run",
        "--rm",
        "-i",
        "-v",
        "${env:KUBECONFIG_PATH}:/run/secrets/kubeconfig:ro",
        "-e",
        "KUBECONFIG=/run/secrets/kubeconfig",
        "-e",
        "K8S_CONTEXT=${env:K8S_CONTEXT}",
        "ghcr.io/acme/k8s-mcp-server:latest"
      ]
    }
  }
}
```

Replace the image with an approved MCP server and prefer pinned tags or digests.
Keep manual tool approval enabled for all write-capable operations.

## References

- [../../docs/mcp-workflow.md](../../docs/mcp-workflow.md)
- [../../.github/skills/vultr-mcp/SKILL.md](../../.github/skills/vultr-mcp/SKILL.md)
