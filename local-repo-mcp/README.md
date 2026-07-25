# Local Repo MCP

OAuth-protected read-only MCP server for exposing selected Elegy-registered repos to ChatGPT Web.

## Run

```powershell
npm --prefix local-repo-mcp install
npm --prefix local-repo-mcp run build
npm --prefix local-repo-mcp start
```

For built-in OAuth, the public origin and canonical MCP resource are distinct:

```text
LOCAL_REPO_MCP_PUBLIC_BASE_URL=https://mcp.example.com
LOCAL_REPO_MCP_AUTH_PROVIDER=builtin
LOCAL_REPO_MCP_AUTH_ISSUER=https://mcp.example.com
LOCAL_REPO_MCP_AUTH_AUDIENCE=https://mcp.example.com/mcp
LOCAL_REPO_MCP_AUTH_MODE=oauth
```

Roots come from `~/.elegy/catalog/local-repo-reader/access.json`, which is managed by Elegy-Copilot.

## Persistent ChatGPT access

Use the desktop MCP page to configure an existing Cloudflare named tunnel. Its `config.yml` must
route the stable hostname to the loopback MCP port and finish with a catch-all rule:

```yaml
tunnel: <TUNNEL_UUID>
credentials-file: C:\Users\<user>\.cloudflared\<TUNNEL_UUID>.json

ingress:
  - hostname: repo-mcp.example.com
    service: http://127.0.0.1:3333
  - service: http_status:404
```

The Persistent OAuth Tunnel workflow is:

1. Save the HTTPS public origin, tunnel name, config path, and optional credentials path.
2. Validate the configuration.
3. Start Persistent Access.
4. Run **Test OAuth Connection**.
5. When the test reports ChatGPT-ready, register the displayed `/mcp` endpoint in ChatGPT with
   OAuth authentication.
6. Approve pending requests in Elegy Copilot by matching the displayed approval code.

The built-in server implements Protected Resource Metadata, authorization-server metadata,
dynamic public-client registration, exact redirect URI matching, PKCE S256, mandatory resource
indicators, audience-bound JWT access tokens, rotating refresh tokens with replay-family
revocation, and RFC-style token revocation. OAuth state files and signing keys are written with
owner-only file modes where supported.

Quick Tunnel remains the recovery path. Stopping or repairing Persistent Access never removes
Cloudflare resources or OAuth state. Start Temporary Quick Tunnel to regain temporary access while
leaving the stable profile intact.

## Reader guarantees

- Generic tree, search, and file access rejects `.git`, generated directories, and common secret
  files. Symlinks may be listed as metadata but are never followed or read.
- `repo_tree` supports bounded depth, include/exclude globs, tracked-file filtering, cursors, and
  explicit truncation metadata.
- `repo_read_file` accepts one-based inclusive line ranges and returns UTF-8, SHA-256, and line
  metadata. Large files can be read by bounded range without whole-file loading.
- `repo_read_many` reads up to 20 related files with bounded per-file and aggregate output.
- `repo_search` supports literal queries, case control, globs, context lines, limits, and cursors.
- `repo_git_changed_files` reports staged, unstaged, deleted, renamed, binary, and untracked work.
- `repo_git_diff` returns bounded structured patches for staged or unstaged current-worktree changes.
- `repo_capabilities` reports the supported bounded-reader features.

Recommended review flow:

```text
repo_roots
repo_tree
repo_git_changed_files
repo_git_diff
repo_search
repo_read_file / repo_read_many
```

The MVP is current-worktree focused. Historical commits, branch comparisons, snapshots, and
structural code indexing are intentionally outside this reader.

Limits are bounded server-side even when callers request larger values: 500 tree entries, 500
search matches, 20 batch files, 200 KB per file, 500 KB per batch, and 500 KB per diff.

Repository paths are exposed by root ID and label only; local absolute paths are not returned to
remote clients.
