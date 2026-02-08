# Project Memory

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
