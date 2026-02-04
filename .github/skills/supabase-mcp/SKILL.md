---
name: supabase-mcp
description: >
  Supabase MCP server integration for project management, schema discovery, and SQL operations. Use this when asked to connect MCP to Supabase, manage Supabase projects via MCP, or query Supabase using MCP. Triggers on: Supabase, Supabase MCP, supabase mcp, supabase project, supabase database.
---

# Supabase MCP Skill

## Purpose
Enable safe, scoped access to Supabase projects via MCP for discovery, schema work, and targeted data tasks.

## Recommended Setup

Hosted MCP server (recommended):

```json
{
  "mcpServers": {
    "supabase": {
      "url": "https://mcp.supabase.com/mcp"
    }
  }
}
```

Optional: project scoping and read-only mode are strongly recommended when available.

## Security Defaults

- Use non-production projects and sanitized data.
- Keep manual approval of tool calls enabled.
- Limit access to a single project and minimal tool groups.
- Avoid committing tokens or headers in repo files.

## Common Workflows

- List tables and schemas for discovery.
- Run targeted SQL queries for reports.
- Generate schema types for app use.
- Pause, restore, or inspect project configuration.

## CI Authentication

Use a PAT in CI only, passed via headers (do not store in repo):

```json
{
  "mcpServers": {
    "supabase": {
      "type": "http",
      "url": "https://mcp.supabase.com/mcp?project_ref=${SUPABASE_PROJECT_REF}",
      "headers": {
        "Authorization": "Bearer ${SUPABASE_ACCESS_TOKEN}"
      }
    }
  }
}
```

## When NOT to Use

- Production data access or destructive database operations.
- Bulk migrations without a plan or review.
