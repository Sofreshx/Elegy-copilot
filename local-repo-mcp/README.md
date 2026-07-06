# Local Repo MCP

OAuth-protected read-only MCP server for exposing selected Elegy-registered repos to ChatGPT Web.

## Run

```powershell
npm --prefix local-repo-mcp install
npm --prefix local-repo-mcp run build
npm --prefix local-repo-mcp start
```

Required OAuth environment:

```text
LOCAL_REPO_MCP_PUBLIC_BASE_URL=https://mcp.example.com
LOCAL_REPO_MCP_AUTH_ISSUER=https://your-tenant.auth0.com/
LOCAL_REPO_MCP_AUTH_AUDIENCE=https://mcp.example.com
```

Roots come from `~/.elegy/catalog/local-repo-reader/access.json`, which is managed by Elegy-Copilot.
