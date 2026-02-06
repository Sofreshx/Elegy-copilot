---
schema: task/v1
id: task-000425
title: "Document E2E workflow: Playwright MCP & VS Code Integrated Browser"
type: docs
status: archived
priority: medium
owner: "lolzi"
skills: ["docs", "frontend"]
depends_on: []
next_tasks: []
created: "2026-02-05"
updated: "2026-02-05"
---

## Context

We need a clear, runnable local dev E2E workflow for the project using Playwright MCP and VS Code's Integrated Browser. The existing `docs/e2e-setup-guide.md` covers Playwright MCP and a verification script, but it currently:

- Uses `http://localhost:5174` in examples (project default is `http://localhost:5173` per project memory)
- Lacks an explicit "Integrated Browser" section with tips for auth flows, storage capture, and element snapshots
- Should include a concise validation checklist and clear artifact/output locations

Relevant links:
- `docs/e2e-setup-guide.md`
- `.instructions/contexts/project.memory.md` (contains default base URL and outputs)
- VS Code Integrated Browser docs: https://code.visualstudio.com/docs/debugtest/integrated-browser
- Playwright MCP constraints & notes: https://docs.github.com/en/copilot/concepts/agents/coding-agent/mcp-and-coding-agent


## Acceptance Criteria

- [ ] Update `instruction-engine/docs/e2e-setup-guide.md` (or add a clearly linked new doc) to include:
  - [ ] How to run the app host locally (document the dev command / note the default base URL `http://localhost:5173` and how to override it)
  - [ ] How to run E2E via Playwright MCP using the test-runner workflow (include example `mcpServers` config and example `playwright`/`package.json` commands)
  - [ ] Where outputs/artifacts go (example: `.instructions-output/e2e-health/` and `.instructions-output/e2e-validation.md`) and how to change the output path
  - [ ] Integrated Browser tips for auth flows and UI debugging (how to capture storage state, recommended settings for element capture and screenshots, using Integrated Browser to perform OAuth flows and export storage to Playwright's `storageState`)
- [ ] Include a small validation checklist in the doc with concrete commands to run and what to verify in the run
- [ ] Reference `.instructions/contexts/project.memory.md` (explicitly cite default base URL `http://localhost:5173` and outputs)
- [ ] Add at least one runnable example command/snippet that a contributor can copy/paste to validate the workflow


## Plan / Approach

1. Update `docs/e2e-setup-guide.md`:
   - Replace/standardize the base URL examples to `http://localhost:5173` and add a short note on where this is defined/overridden
   - Add a short subsection "Local E2E with Playwright MCP (test-runner)" with example `mcpServers` configuration and `package.json` scripts (e.g., `mcp:playwright`, `e2e:test`)
   - Provide example `playwright.config.*` snippets for `use.storageState`, trace/screenshot settings, and artifacts path
2. Add an "Integrated Browser (manual debugging & auth)" subsection:
   - Link to VS Code docs
   - Explain how to run the Integrated Browser to complete OAuth redirect flows, then export persistent storage and use it in Playwright tests (`storageState`)
   - Add quick tips for capturing element screenshots and console logs
3. Add an "Artifacts & Outputs" section listing `.instructions-output/e2e-health/` and a recommended directory layout and naming for reports/screenshots
4. Add a short "Validation checklist" with commands and expected outcomes (page reachable, test-runner runs tests, artifacts produced, auth persisted when `storageState` used)
5. Add a short note referencing `.instructions/contexts/project.memory.md` and the MCP localhost constraint link above
6. Validate by running the verification script and a sample Playwright test locally (manual validation step)


## Validation Checklist (example to include in doc)

- [ ] Start app host (dev server) and confirm `http://localhost:5173` responds with the expected app shell (200 and page title)
- [ ] Start Playwright MCP server and run `npx playwright test` (or `npm run e2e:test`) and confirm tests run end-to-end
- [ ] Confirm artifacts appear in `.instructions-output/e2e-health/` (report JSON, screenshots, traces) after test run
- [ ] Use VS Code Integrated Browser to complete an OAuth redirect, export storage, then re-run tests with `use.storageState` to confirm auth is reused


## Notes / Discoveries

- Project memory already documents the default base URL (`http://localhost:5173`) and output paths under E2E (see `.instructions/contexts/project.memory.md`)
- Playwright MCP has a localhost constraint for certain setups — include a short note and link to the GitHub docs
- Assumed defaults from project memory for base URL and output paths; plan artefact `x-PLAN-artefact.md` not present

## Attempts / Log

- 2026-02-05: Updated E2E setup guide with standardized 5173 base URL, MCP workflow, integrated browser guidance (storage state export + screenshots), output paths, and a validation checklist.
- 2026-02-05: Validation not run (docs-only change; no test-runner invocation).


## Next Steps

- Implement the doc updates and add runnable snippets
- (Optional) Create a test task under `.instructions/test-tasks/` to exercise the verification and record artifacts as part of CI or nightly runs


---

**Suggested Adjacent Work:**
- Add a `test-task` to automate verification and artifact upload
- Add a CI job for nightly E2E validation (if desired)
