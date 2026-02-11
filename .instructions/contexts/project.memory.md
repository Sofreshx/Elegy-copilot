# Project Memory

## E3 Database Access (2026-02-11)
- `vscode/runCommand` does NOT return values to agents — all `executive3.*` commands were broken.
- **Fix**: CLI bridge at `vscode-skill-installer/scripts/e3-cli.js`. Agents use `run_in_terminal` to invoke it.
- DB location: `.e3-local/executive3.db` in the first workspace folder (NOT VS Code's `context.storageUri`).
- Extension writes `.e3-local/db-path.txt` on startup for CLI discovery.
- Agent instructions (`executive3.agent.md`, `e3-task-creator.agent.md`) updated to use CLI.
- `vscode/runCommand` removed from Executive3's tool dependencies entirely.

## Relay System Status (2026-02-11)
- Auth working: GitHub OAuth → HS256 JWTs (1h access, 30d refresh). 42 auth tests passing. WS auth bugfix applied.
- SQLite persistence complete: 6 tables, migrations, WAL mode via better-sqlite3.
- REST APIs complete: sessions, tasks, push endpoints with full test coverage (183 tests / 11 suites).
- Mobile companion: REST client with auto-refresh, push notifications, tasks/git/sessions pages.
- Local tracker: scaffolded with file watchers, git monitor, extension bridge (port 9821), status dashboard (port 9822).
- E2E verification: `scripts/e2e-relay-flow.js`.
- Branch: `e3/relay-system-redesign` (pushed to origin).
- Full architecture: `.instructions/architecture.md`. Design research: `.instructions/research/e3-tooling-and-relay-redesign.md`.

## Testing Workflow
- For any feature or bug fix, add or update unit tests in the touched package before marking work complete.
- After code edits, run get_errors to catch compile or type issues before running tests.
- Use `unit-test-runner` at checkpoints; ask before running long integration or E2E tests.
- Default integration testing approach is **Alba** for in-process HTTP tests.
- If long tests are declined, record the skip in `.instructions/testing/skipped-validation.md`.

## E2E (Playwright)
- E2E runs use Playwright against the web UI (mobile companion) unless explicitly scoped elsewhere.
- Default base URL: http://localhost:5173. Override with `skillInstaller.e2e.url` or script args.
- Outputs go under `.instructions-output/e2e/` (reports, screenshots, logs).

## Test Task Backlog
- Add new test tasks under `.instructions/test-tasks/` with owner and relevant skills.
