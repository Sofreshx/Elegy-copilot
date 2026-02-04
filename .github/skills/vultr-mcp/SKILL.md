---
name: vultr-mcp
description: >
  Vultr MCP server integration for managing Vultr infrastructure via MCP. Use this when asked to connect MCP to Vultr, manage Vultr resources, or query Vultr infrastructure through MCP. Triggers on: Vultr, vultr mcp, vultr api, vultr server, vultr infrastructure.
---

# Vultr MCP Skill

## Purpose
Manage Vultr infrastructure via MCP with scoped access and safe defaults.

## Recommended Setup

```json
{
  "mcpServers": {
    "vultr": {
      "command": "vultr-mcp-server",
      "env": {
        "VULTR_API_KEY": "${env:VULTR_API_KEY}"
      }
    }
  }
}
```

## Security Defaults

- Use a scoped API key with minimal permissions.
- Prefer Terraform for large or repeatable changes.
- Keep manual approval enabled for tool calls.

## Common Workflows

- List instances, DNS zones, and load balancers.
- Inspect costs and usage.
- Create or scale instances with explicit approval.

## Optional Remote MCP Server

You can host a remote MCP server and connect via MCP proxy when needed.
Ensure the remote server is locked down and uses a read-only policy if possible.

## When NOT to Use

- Bulk destructive changes without a plan and approval.
- Production changes outside of a change window.
