---
schema: task/v1
id: task-000433
title: "Add GitHub Actions workflow: E2E smoke checks for mobile companion"
type: chore
status: in-progress
priority: medium
owner: "lolzi"
skills: ["frontend", "testing-frontend-unit", "docs"]
depends_on: []
next_tasks: []
created: "2026-02-05"
updated: "2026-02-05"
---

## Context

- The repo already contains Playwright-based E2E smoke checks for the mobile companion.
- Relevant files:
  - `docs/e2e-setup-guide.md`
  - `scripts/e2e-setup-verify.js`
  - `scripts/e2e-health-check-simple.js`
  - `mobile-companion/package.json`
- Goal: Add a GitHub Actions workflow to run the Playwright E2E smoke checks in CI, upload artifacts, and document how to trigger it.

## Acceptance Criteria

1. A new workflow file exists at `.github/workflows/e2e-smoke.yml` with:
   - `workflow_dispatch` trigger (manual). A scheduled `cron` trigger may be added only after team signoff (low-risk schedule).
   - Node 20 setup and `npm ci` executed in `mobile-companion`.
   - Playwright browser install (chromium) via `npx playwright install chromium` (or an equivalent npm script).
   - Start the dev server in background from `mobile-companion` using: `npm run dev -- --host 127.0.0.1 --port 5173`.
   - Wait until `http://127.0.0.1:5173` is reachable (using `npx wait-on` or a curl/retry loop).
   - Run `npm run e2e:verify` and `npm run e2e:health` with `E2E_BASE_URL` set to `http://127.0.0.1:5173`.
   - Upload artifacts from `.instructions-output/e2e-health` using `actions/upload-artifact`.
2. The workflow avoids GitHub OAuth external flows: **do not** run `e2e:login` by default. If login is required, make it opt-in and gated by a workflow input and required secrets (explicit enablement only).
3. Documentation: `docs/e2e-setup-guide.md` is updated with a short note describing the new workflow and how to trigger it manually (and how to enable schedule if agreed).
4. Manual validation: running the workflow in Actions produces artifacts that include screenshots and JSON reports.

## Plan / Approach

1. Add `.github/workflows/e2e-smoke.yml` with a job that:
   - checks out the repo (`actions/checkout`), sets up Node 20 (`actions/setup-node@v4`).
   - runs `npm ci` in `mobile-companion` (`npm --prefix mobile-companion ci`).
   - installs Playwright browsers: `npx playwright install chromium` (and `npx playwright install-deps` if necessary on the runner).
   - starts the dev server in the background: `npm --prefix mobile-companion run dev -- --host 127.0.0.1 --port 5173 &`.
   - waits for the URL with `npx wait-on http://127.0.0.1:5173` (with a timeout).
   - runs `E2E_BASE_URL=http://127.0.0.1:5173 npm --prefix mobile-companion run e2e:verify` and `E2E_BASE_URL=http://127.0.0.1:5173 npm --prefix mobile-companion run e2e:health`.
   - uploads the `.instructions-output/e2e-health` folder as `e2e-health` artifact using `actions/upload-artifact@v4`.
   - include an optional, gated step to run `npm run e2e:login` only when `inputs.run_login` is `true` and required secrets are present.
2. Update `docs/e2e-setup-guide.md` with a short section describing:
   - the workflow name and location (`.github/workflows/e2e-smoke.yml`),
   - how to manually trigger it from the Actions UI (workflow_dispatch),
   - where artifacts will be found on success,
   - instructions for enabling a scheduled run (if agreed).
3. Open a PR with the workflow + docs changes and request an infra/frontend reviewer to verify.
4. After merge, run the workflow manually and validate artifacts (screenshots + JSON reports) are uploaded and contain expected outputs.

## Attempts / Log

- 2026-02-05: Added the E2E smoke workflow with verify/health steps, wait-on, and
   optional login gated by `run_login` + `E2E_ALLOW_EXTERNAL`. Updated
   `docs/e2e-setup-guide.md` with a short CI workflow note. Manual workflow run
   still needed to confirm artifacts.

## Failures

(none yet)

## Notes / Discoveries

- Playwright on `ubuntu-latest` may require `npx playwright install-deps` in addition to browser install.
- Ensure `npm ci` runs before `npx playwright install` so the `playwright` binary and scripts are present.
- Confirm `mobile-companion` dev server accepts `--host 127.0.0.1 --port 5173` arguments (Vite supports these by default; confirm script shape in `mobile-companion/package.json`).
- Keep scheduled runs off by default; add schedule only after team signoff to avoid unnecessary runs and cost.
- Related archived task: `task-000425--document-e2e-playwright-mcp-vscode-integrated-browser`.
- VS Code diagnostics may warn about the `E2E_ALLOW_EXTERNAL` secret reference in the workflow until the secret is configured.

## Next Steps

1. Who should own this task? (Assign an owner so it can be picked up.)
2. Implement the workflow + docs on a branch and open a PR.
3. Run the workflow in Actions and verify artifacts include screenshots + JSON reports.

**Suggested Adjacent Work:**
- Add an optional scheduled run (if agreed) and track as a follow-up.
- Add a test-task to harden E2E scripts for CI (retries, timeouts, ensure exit codes cause job failure).
