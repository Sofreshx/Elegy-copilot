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
