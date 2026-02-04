---
name: firebase-mcp
description: >
  Firebase MCP server integration for Firebase project management and tooling via the official Firebase CLI MCP server. Use this when asked to connect MCP to Firebase, manage Firebase projects via MCP, or automate Firebase tasks through MCP. Triggers on: Firebase MCP, firebase mcp, firebase tools mcp, firebase cli mcp, firebase management.
---

# Firebase MCP Skill

## Purpose
Provide MCP access to Firebase projects using the official Firebase CLI MCP server.

## Recommended Setup

```json
{
  "mcpServers": {
    "firebase": {
      "command": "npx",
      "args": ["-y", "firebase-tools@latest", "mcp", "--only", "auth,firestore"]
    }
  }
}
```

Optional flags:
- `--dir /absolute/path` to pin the Firebase project directory.
- `--only auth,firestore,storage` to limit the tool surface area.

## Authentication

- Uses Firebase CLI auth or Application Default Credentials.
- Ensure the CLI is authenticated in the environment where MCP runs.

## Security Defaults

- Use non-production projects where possible.
- Keep tool call approvals enabled.
- Limit features with `--only`.

## Common Workflows

- List projects and apps.
- Manage Auth users and claims.
- Retrieve security rules and configs.
- Fetch logs and diagnose failures.

## When NOT to Use

- Bulk destructive operations without a plan or review.
- Production access without explicit approval.
