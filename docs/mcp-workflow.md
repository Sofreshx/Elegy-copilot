# MCP Workflow Guide

This guide explains how Instruction Engine integrates MCP providers without loading them all the time.

## Core Idea

- MCP providers are disabled by default and only enabled per repo when needed.
- The Skill Installer writes a minimal MCP config file for enabled providers only.
- Secrets stay out of source control; use environment variables or CI secrets.

## Recommended Workflow

1. Open the Skill Installer sidebar.
2. Go to Operations -> MCP Providers.
3. Enable only the provider you need for the current task.
4. Review or edit provider settings in VS Code settings.
5. Sync MCP config (auto-sync is enabled by default).
6. Use the provider-specific agent or skill.
7. Disable the provider when done.

## MCP Config Location

The extension writes to the path configured in:

- `skillInstaller.mcp.configPath` (default: `.vscode/mcp.json`)

## Provider Defaults

The extension ships with safe defaults in `skillInstaller.mcp.providers`.
Adjust any provider config through VS Code settings.

### Supabase

- Default: hosted MCP server via URL.
- Use project scoping and read-only mode when possible.
- For CI, use PAT with an Authorization header (no secrets in repo files).

### Firebase

- Default: official Firebase CLI MCP server via `npx firebase-tools@latest mcp`.
- Use `--dir` to pin the project folder and `--only` to limit features.
- Auth is handled by Firebase CLI credentials or ADC.

### Vultr

- Default: local MCP server via `vultr-mcp-server` with `VULTR_API_KEY`.
- Prefer Terraform for large changes; use MCP for discovery or targeted updates.

### Cloudflare

- No default MCP server is assumed.
- Use Terraform or `wrangler` for deployments until a preferred MCP server is selected.

## Security Defaults

- Use non-production projects and sanitized data.
- Keep manual approval of tool calls enabled in your MCP client.
- Scope access: project-level access, minimal feature groups.
- Never commit tokens or private keys. Use environment variables or SecretStorage.

## Example MCP Config (Supabase + Firebase)

```json
{
  "mcpServers": {
    "supabase": {
      "url": "https://mcp.supabase.com/mcp"
    },
    "firebase": {
      "command": "npx",
      "args": ["-y", "firebase-tools@latest", "mcp", "--only", "auth,firestore"]
    }
  }
}
```
