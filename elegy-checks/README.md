# Elegy Checks

Rust-first local check registry, runner, SQLite evidence store, and CI-parity mapper for Elegy Copilot.

V1 is local-only:

- no MCP server
- no GitHub Actions API calls
- no remote run or log fetching
- repo-tracked config at `.elegy/checks.json`
- local state at `~/.elegy/repo-state/<repoId>/checks/checks.sqlite`
- private binary release metadata follows `assets/schemas/binary-release-manifest.schema.json`

## Commands

```text
elegy-checks init --repo <path> [--import-copilot]
elegy-checks validate --repo <path> --json
elegy-checks discover --repo <path> --json
elegy-checks register --repo <path> --check <id> --command <cmd> --profile <name>
elegy-checks run --repo <path> [--profile <name>] [--check <id>] --json
elegy-checks state --repo <path> --json
elegy-checks logs --repo <path> --run-id <id> [--check <id>] --json
elegy-checks ci-map --repo <path> --scope pr|main-push --json
elegy-checks stats --repo <path> --json
```
