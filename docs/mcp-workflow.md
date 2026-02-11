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
4. Store MCP secrets outside the repo (for example, `~/.config/instruction-engine/mcp.env`) or set `MCP_ENV_FILE`.
5. Launch VS Code from `scripts/mcp-env.sh` (macOS/Linux) or
  `scripts/mcp-env.ps1` (Windows) so MCP env vars are loaded.
6. Review or edit provider settings in VS Code settings.
7. Sync MCP config (auto-sync is enabled by default).
8. Use the provider-specific agent or skill.
9. Disable the provider when done.

## MCP Config Location

The extension writes to the path configured in:

- `skillInstaller.mcp.configPath` (default: `.vscode/mcp.json`)

## Local MCP Env

Store local MCP secrets outside the repo (for example, `~/.config/instruction-engine/mcp.env`).
Use the helper scripts to load env vars before opening VS Code:

- macOS/Linux: `./scripts/mcp-env.sh`
- Windows (PowerShell): `./scripts/mcp-env.ps1`

Set `MCP_ENV_FILE` to override the default location.

You can also pass a command to the scripts to run tools in the same env.

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

## Supabase MCP

Hosted MCP server URL example: `https://mcp.supabase.com/mcp`.
Scope access to a single project using `SUPABASE_PROJECT_REF` and prefer read-only
tokens for discovery or metadata operations.

For CI, use a PAT via the Authorization header and keep secrets out of repo files.

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

Env var mapping:

- `SUPABASE_PROJECT_REF`: Supabase project ref to scope the MCP server.
- `SUPABASE_ACCESS_TOKEN`: PAT with minimal scope (read-only when possible).

CI snippet (example GitHub Actions):

```yaml
env:
  SUPABASE_PROJECT_REF: ${{ secrets.SUPABASE_PROJECT_REF }}
  SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
```

For quick local discovery, you can use the hosted URL without headers, but prefer
project scoping and read-only tokens for anything beyond metadata.

## Vultr MCP

Local MCP server example using `vultr-mcp-server`:

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

Env var mapping:

- `VULTR_API_KEY`: Vultr API key with minimal scope (read-only when possible).

Review any third-party or remote MCP servers before trusting them. Prefer
Terraform for large or repeatable infrastructure changes and use MCP for
discovery or targeted updates.

## Copilot / Coding Agent Constraints

- Copilot coding agents can only use MCP tools (no unattended external browsing
  or OAuth flows). See GitHub docs: https://docs.github.com/en/copilot/concepts/agents/coding-agent/mcp-and-coding-agent
- Playwright MCP setups assume a local MCP/test server (for example, localhost).
  See the Playwright/E2E guidance in [e2e-setup-guide.md](e2e-setup-guide.md).
- Remote OAuth flows are not reliably automatable for remote agents. Prefer
  CI PATs or pre-authorized non-interactive tokens for CI or remote use.

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

Env var mapping:

- `SUPABASE_PROJECT_REF`: Supabase project ref to scope the MCP server.
- `SUPABASE_ACCESS_TOKEN`: PAT with minimal scope (read-only when possible).

## Local vs CI Secrets Guidance

- Local development: store MCP secrets outside the repo and load them with the
  helper scripts before launching VS Code. Prefer non-production projects and
  short-lived tokens.
- CI: inject secrets via the CI secret store and map them to env vars. Do not
  commit tokens or headers to repo files; use least-privilege scopes.

## Secrets Inventory

For a full inventory of MCP and infra secrets (including ownership and workflows), see:

- ../.instructions/contexts/mcp-infra-secrets.md

## Security Defaults

- Use non-production projects and sanitized data.
- Keep manual approval of tool calls enabled in your MCP client, especially for
  write or scoped operations.
- Scope access: project-level access, minimal feature groups.
- Never commit tokens or private keys. Use environment variables or SecretStorage.

## Decision Guide

Rule of thumb: use MCP for discovery and small, scoped changes when an agent
needs interactive access to metadata; use Terraform for repeatable or large
infrastructure changes; use manual, conservative review for production-impacting
operations.

For choosing between an agent and a skill when using MCP, see
[agents-vs-skills.md](agents-vs-skills.md).

Examples:

- MCP: list Supabase schemas or inspect Vultr instance details for a specific
  change request.
- Terraform: add a new VPC, load balancer, or create repeatable infra modules.
- Manual review: production data mutations or destructive changes.

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

## Validation Checklist

- Supabase and Vultr MCP sections are present.
- `VULTR_API_KEY`, `SUPABASE_PROJECT_REF`, and `SUPABASE_ACCESS_TOKEN` are listed.
- Manual tool approval guidance is stated explicitly.
- Copilot coding agent constraints and OAuth limitations are documented.
- Decision guide is present.
- Local vs CI secrets guidance is included.
