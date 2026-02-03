# Project Memory

## Testing Workflow
- For any feature or bug fix, add or update unit tests in the touched package before marking work complete.
- After code edits, run get_errors to catch compile or type issues before running tests.
- End each implementation session with integration or E2E validation using `test-executive` and `test-runner`.
- Never run tests directly; always use `test-runner`.

## E2E (Playwright)
- E2E runs use Playwright against the web UI (mobile companion) unless explicitly scoped elsewhere.
- Default base URL: http://localhost:5173. Override with `skillInstaller.e2e.url` or script args.
- Outputs go under `.instructions-output/e2e-health/` and `.instructions-output/e2e-validation.md`.

## Test Task Backlog
- Add new test tasks under `.instructions/test-tasks/` with owner and relevant skills.
