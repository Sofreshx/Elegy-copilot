# Windows E2E Testing Setup Guide

Complete guide for setting up E2E browser testing on Windows.

## Local App Host (Mobile Companion)

1. `cd mobile-companion`
2. `npm install`
3. `npm run dev`

The default base URL is `http://localhost:5173` (tracked in [.instructions/contexts/project.memory.md](../.instructions/contexts/project.memory.md)).
Override it with one of the following:
- Change the Vite port: `npm run dev -- --port 5175`
- For scripts, pass a URL arg or set `E2E_BASE_URL`
- For extension-driven runs, set `skillInstaller.e2e.url`

## E2E Tools

### Agent-Browser CLI (Exploratory / Agent-Driven)

**Best for**: Exploratory testing driven by AI agents, snapshot-ref interaction

```bash
# Install Chromium (first time)
npx agent-browser install

# Open headed browser
npx agent-browser open http://localhost:5173 --headed --ignore-https-errors

# Snapshot accessibility tree (get @refs for interaction)
npx agent-browser snapshot -i --json

# Take screenshot
npx agent-browser screenshot ./screenshots/test.png
```

Use the `e2e-browser` agent for automated exploratory flows.
Use the `e2e-live-observer` agent for live, user-visible browser sessions.

### Playwright CLI (Scripted Regression)

**Best for**: CI/CD pipelines, deterministic test suites, reproducible tests

```bash
# Install browsers
npx playwright install chromium

# Run all tests
npx playwright test

# Run with visible browser
npx playwright test --headed

# Interactive UI mode
npx playwright test --ui
```

## CI Workflow (GitHub Actions)

A manual GitHub Actions workflow runs the E2E smoke checks in CI at
`.github/workflows/e2e-smoke.yml`.

To trigger it: GitHub Actions -> "E2E Smoke (Mobile Companion)" -> Run workflow.
The workflow uploads artifacts from `.instructions-output/e2e-health`.

Optional login checks are disabled by default. To enable them, run with the
`run_login` input and set the `E2E_ALLOW_EXTERNAL` secret to `1`.
Scheduled runs are intentionally disabled unless the team signs off.

## Prerequisites

### Node.js
- **Minimum**: Node.js >= 20.19
- **Recommended**: Latest LTS version

### Browsers
- `@playwright/mcp` downloads Chromium automatically via `npx playwright install chromium`.
- You can also install other browsers if needed: `npx playwright install firefox webkit`.

## E2E Setup Verification

The repo already includes `scripts/e2e-setup-verify.js` for a quick smoke check:

```javascript
const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const outputDir = path.join(repoRoot, '.instructions-output', 'e2e-health');
const reportPath = path.join(outputDir, 'setup-verify-report.json');
const screenshotPath = path.join(outputDir, 'verify-screenshot.png');

function ensureOutputDir() {
  fs.mkdirSync(outputDir, { recursive: true });
}

async function verify(url) {
  const checks = [];
  let browser;

  const check = (name, passed, details) => {
    checks.push({ name, passed, details });
    console.log(`${passed ? '✓' : '✗'} ${name}${details ? `: ${details}` : ''}`);
  };

  try {
    ensureOutputDir();

    browser = await chromium.launch({ headless: true });
    check('Browser launch', true);

    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    check('Page creation', true);

    // Avoid 'networkidle' for apps that keep long-lived connections (SignalR/SSE).
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    check('Page navigation', true, url);

    const title = await page.title();
    check('Page title', title.length > 0, title);

    await page.screenshot({ path: screenshotPath });
    check('Screenshot', fs.existsSync(screenshotPath));

    const elements = await page.locator('button, a, input').count();
    check('Interactive elements', elements > 0, `${elements} found`);
  } catch (error) {
    check('Error', false, error?.message ?? String(error));
  } finally {
    if (browser) await browser.close();
  }

  const passed = checks.filter((c) => c.passed).length;
  const report = {
    url,
    passed,
    total: checks.length,
    checks
  };

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n${passed}/${checks.length} checks passed`);
  console.log(`Report written to ${reportPath}`);
}

const url = process.argv[2] || process.env.E2E_BASE_URL || 'http://localhost:5173';
verify(url);
```

Run from mobile-companion: `npm run e2e:verify -- http://localhost:5173`
or `E2E_BASE_URL=http://localhost:5173 npm run e2e:verify`.

Hang-proofing:
- All helper scripts enforce a global deadline via `E2E_DEADLINE_MS` (default: 60000).
- Set `E2E_DEADLINE_MS=180000` for slower machines or first-run browser installs.

To exercise the external OAuth redirect during `e2e:login`, set `E2E_ALLOW_EXTERNAL=1`.

## Integrated Browser (manual debugging and auth)

Use VS Code's Integrated Browser for OAuth flows and UI debugging:
- Command Palette: `Open Integrated Browser`
- Navigate to `http://localhost:5173`
- Complete the OAuth flow and validate the UI in the built-in DevTools

Storage state export (for Playwright):
1. Open DevTools (Ctrl+Shift+I) and run this in the Console:

```javascript
(() => {
  const origin = window.location.origin;
  const storageState = {
    cookies: [],
    origins: [
      {
        origin,
        localStorage: Object.entries(localStorage).map(([name, value]) => ({ name, value }))
      }
    ]
  };
  console.log(JSON.stringify(storageState, null, 2));
})();
```

2. Save the JSON to `.instructions-output/e2e-auth/storageState.json`.
3. In Playwright config, set:

```javascript
use: {
  storageState: '.instructions-output/e2e-auth/storageState.json'
}
```

Notes:
- This captures localStorage and non-HttpOnly cookies. If you rely on HttpOnly
  cookies, prefer `npx playwright codegen --save-storage=...` or a small
  Playwright script to save `storageState`.
- For element capture, DevTools supports "Capture node screenshot" in the
  Elements panel. For automated runs, keep `screenshot: 'only-on-failure'` and
  `trace: 'retain-on-failure'` in Playwright config.

See VS Code docs: https://code.visualstudio.com/docs/debugtest/integrated-browser

## Windows Optimizations

### Performance
- Keep browser profiles and npm cache on a fast local disk
- Use `--headless` for faster execution in CI

### Antivirus
- Consider excluding temp profile directories from real-time scanning
- This can significantly reduce intermittent timeouts

### Viewport Consistency
- Always set a fixed viewport: `{ width: 1280, height: 720 }`
- Test mobile viewport: `{ width: 375, height: 667 }`

## Common Issues

| Issue | Solution |
|-------|----------|
| Browser not launching | Run `npx playwright install chromium` |
| Timeout on navigation | Check dev server is running, increase timeout |
| Click intercepted by modal | Implement modal dismissal before interactions |
| Flaky element selectors | Use more specific selectors, add waits |

## package.json Scripts

```json
{
  "scripts": {
    "playwright:install": "playwright install chromium",
    "e2e:verify": "node ../scripts/e2e-setup-verify.js",
    "e2e:login": "node ../scripts/e2e-login-flow.js",
    "e2e:health": "node ../scripts/e2e-health-check-simple.js"
  }
}
```

## Outputs and Artifacts

```
.instructions-output/
├── e2e-health/
│   ├── setup-verify-report.json
│   ├── health-report.json
│   ├── login-flow-report.json
│   ├── verify-screenshot.png
│   ├── health-screenshot.png
│   └── login-flow-screenshot.png
└── e2e-validation.md
```

To change the output path, update `outputDir` in:
- `scripts/e2e-setup-verify.js`
- `scripts/e2e-health-check-simple.js`
- `scripts/e2e-login-flow.js`

## Validation Checklist

- [ ] Start the dev server and confirm `http://localhost:5173` loads the app.
- [ ] Run `npm run e2e:verify -- http://localhost:5173` and confirm a report is written.
- [ ] Run `E2E_BASE_URL=http://localhost:5173 npm run e2e:health` and confirm health report + screenshot.
- [ ] Optional: run `E2E_ALLOW_EXTERNAL=1 npm run e2e:login` to verify OAuth redirect flow.
- [ ] Verify artifacts exist under `.instructions-output/e2e-health/` and record notes in `.instructions-output/e2e-validation.md`.
