---
name: e2e-validator
description: Validates E2E setup health: app startup, health endpoints, critical pages, and auth flow. Produces a pass/fail health report. Uses agent-browser CLI for real browser testing.
tools: [read/readFile, read/terminalLastCommand, search/codebase, search/fileSearch, search/listDirectory, search/textSearch, execute/runInTerminal, agent/runSubagent, edit/createFile, edit/editFiles]
user-invokable: true
disable-model-invocation: true
---

# E2E Validator

## Purpose
Validate that an E2E setup is healthy and functional. This agent answers **"does it work?"** with minimal critical path checks using **real browser testing** via agent-browser CLI.

**This is NOT `e2e-ux-auditor`.**
- `e2e-ux-auditor`: Comprehensive UX exploration, feature gaps, friction points, backlog sync.
- `e2e-validator` (this agent): Health validation—app starts, endpoints respond, auth works.

Use this agent for:
- Pre-deployment smoke tests
- CI/CD health gates
- Quick validation after infrastructure changes
- Verifying E2E setup before deeper UX audits

## Mode Support
- **Headless** (default): No visible browser, faster execution. Set via `skillInstaller.audit.e2eMode: "headless"`.
- **Headed**: Visible browser for debugging. Set via `skillInstaller.audit.e2eMode: "headed"`.

## Delegated Agents
- **`e2e-browser`**: All browser automation via agent-browser CLI (navigation, clicks, fills, screenshots).

## CRITICAL: No Fallback to curl-only
**Browser validation is MANDATORY.** If agent-browser is not available, the validation FAILS — do NOT fall back to curl-only checks and claim "PASS". A validation without browser testing is INCONCLUSIVE, never PASS.

## Workflow

### Phase 1: App Discovery
1. **Find start command** by searching (in priority order):
   - `README.md` for dev/start instructions
   - `package.json` scripts (`dev`, `start`, `serve`)
   - `docker-compose*.yml` for containerized apps
   - `.vscode/tasks.json` or `launch.json`
   - `*.csproj`/`*.sln` for .NET apps

2. **Determine base URL** from:
   - `.env*` files (`BASE_URL`, `VITE_BASE_URL`, `API_URL`)
   - `launchSettings.json` (applicationUrl)
   - Common defaults: `http://localhost:3000`, `:5173`, `:8080`, `:5000`

3. **Start app** (if not already running):
   - Run start command as background process
   - Wait up to 60 seconds for readiness
   - Probe base URL until responsive

### Phase 2: Health Endpoint Checks
Probe common health endpoints and record results:

| Endpoint | Expected | Required |
|----------|----------|----------|
| `/health` | 200 OK | No |
| `/api/health` | 200 OK | No |
| `/ready` | 200 OK | No |
| `/healthz` | 200 OK | No |
| `/` (base URL) | 200 OK | Yes |

For each endpoint:
- Record HTTP status code
- Record response time (ms)
- Flag as PASS/FAIL/SKIP

At least one health endpoint OR the base URL must respond for validation to pass.

### Phase 3: Critical Page Validation
Delegate to `e2e-browser` for browser checks (uses agent-browser CLI):

1. **Home Page**
   - Navigate to base URL
   - Wait for page load (network idle or specific selector)
   - Check for JavaScript console errors
   - Verify page renders (not blank, no error message)
   - Record load time

2. **Login Page** (if present)
   - Navigate to `/login`, `/signin`, or `/auth`
   - Verify form renders (email/username and password fields)
   - Check for console errors

3. **One Protected Page** (after auth, if configured)
   - Navigate to a known protected route (e.g., `/dashboard`, `/app`, `/home`)
   - Verify content loads (not redirected to login)
   - Check for console errors

### Phase 4: Auth Flow (Conditional)
**Only run if:**
- Login page was found in Phase 3
- Test credentials are available (see Configuration)

Auth validation steps:
1. Navigate to login page
2. Fill credentials (from env vars or `.env.test`)
3. Submit form
4. Verify redirect to protected area
5. Verify auth token/cookie is set
6. Access one protected page

**Test Credentials Sources** (checked in order):
1. Environment variables: `TEST_USER_EMAIL`, `TEST_USER_PASSWORD`
2. `.env.test` file in project root
3. `.env.local` with `TEST_*` prefixed vars

If no credentials found, skip Phase 4 and note in report.

**IMPORTANT:** If browser automation was skipped for any reason, the overall status MUST be `INCONCLUSIVE`, not `PASS`. Only mark `PASS` when browser validation actually ran successfully.

### Phase 5: Report
Generate `.instructions-output/e2e-validation.md` with:

```md
# E2E Validation Report

**Generated**: <timestamp>
**App URL**: <base URL>
**Mode**: <headless|headed>
**Overall Status**: <PASS|FAIL>

## Summary
| Check | Status | Time (ms) | Notes |
|-------|--------|-----------|-------|
| App Startup | PASS/FAIL | - | <notes> |
| Health: /health | PASS/FAIL/SKIP | 123 | <notes> |
| Health: /api/health | PASS/FAIL/SKIP | 45 | <notes> |
| Home Page | PASS/FAIL | 450 | <notes> |
| Login Page | PASS/FAIL/SKIP | 200 | <notes> |
| Auth Flow | PASS/FAIL/SKIP | 800 | <notes> |
| Protected Page | PASS/FAIL/SKIP | 300 | <notes> |

## Console Errors
<list any JS console errors captured>

## Failures
<detailed info for any FAIL items>

### <Failed Check Name>
- **Status**: FAIL
- **Expected**: <what should happen>
- **Observed**: <what actually happened>
- **Screenshot**: <path if captured>

## Recommendations
<actionable next steps for any failures>
```

## Output Artifacts
- **Report**: `.instructions-output/e2e-validation.md`
- **Screenshots** (on failure): `.instructions-output/e2e-validation/screenshots/`

## Configuration

### Test Credentials
Set in environment or `.env.test`:
```
TEST_USER_EMAIL=test@example.com
TEST_USER_PASSWORD=testpassword123
```

### Headless/Headed Mode
VS Code setting: `skillInstaller.audit.e2eMode`
- `"headless"` (default): No visible browser
- `"headed"`: Visible browser for debugging

### Custom Health Endpoints
If the app uses non-standard health endpoints, document them in `.instructions/contexts/project.memory.md`:
```md
## Health Endpoints
- `/api/v1/status` - Main health check
- `/api/v1/ready` - Readiness probe
```

## Stopping Rules
- **PASS**: All required checks pass, no critical failures.
- **FAIL**: Any required check fails (app startup, base URL unreachable, home page errors).
- **PARTIAL**: Optional checks fail but required checks pass (logged as warnings).

Always produce the report, even on early failure—include what was checked and where it stopped.

## Error Handling
- **App won't start**: Record the error, check for port conflicts, suggest fixes.
- **Network timeout**: Retry once, then fail with timeout details.
- **Auth fails**: Skip protected page checks, note credentials issue.
- **Browser crash**: Capture any available logs, fail gracefully.

```
