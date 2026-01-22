# Windows E2E Testing Setup Guide

Complete guide for setting up E2E browser testing via MCP on Windows.

## MCP Server Options

### Option A: @playwright/mcp (Recommended for E2E Testing)

**Best for**: Automated E2E tests, CI/CD pipelines, cross-browser testing

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["-y", "@playwright/mcp", "--browser=chromium", "--headless"]
    }
  }
}
```

**Setup**:
```bash
npm install -D @playwright/mcp @playwright/test
npx playwright install chromium
```

### Option B: chrome-devtools-mcp (For DevTools Inspection)

**Best for**: Performance audits, network inspection, deep debugging

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["-y", "chrome-devtools-mcp@latest", "--isolated", "--viewport", "1280x720"]
    }
  }
}
```

**Requires**: Chrome Stable installed on system

## Prerequisites

### Node.js
- **Minimum**: Node.js >= 20.19
- **Recommended**: Latest LTS version

### Browser
- `@playwright/mcp`: Downloads Chromium automatically via `npx playwright install chromium`
- `chrome-devtools-mcp`: Uses system Chrome installation

## E2E Setup Verification

Create `scripts/e2e-setup-verify.js`:

```javascript
const { chromium } = require('@playwright/test');
const fs = require('fs');

async function verify(url = 'http://localhost:5174') {
  const checks = [];
  let browser;

  const check = (name, passed, details) => {
    checks.push({ name, passed, details });
    console.log(`${passed ? '✓' : '✗'} ${name}${details ? `: ${details}` : ''}`);
  };

  try {
    browser = await chromium.launch({ headless: true });
    check('Browser launch', true);

    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    check('Page creation', true);

    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    check('Page navigation', true);

    const title = await page.title();
    check('Page title', title.length > 0, title);

    await page.screenshot({ path: 'verify.png' });
    check('Screenshot', fs.existsSync('verify.png'));

    const elements = await page.locator('button, a, input').count();
    check('Interactive elements', elements > 0, `${elements} found`);

  } catch (e) {
    check('Error', false, e.message);
  } finally {
    if (browser) await browser.close();
  }

  const passed = checks.filter(c => c.passed).length;
  console.log(`\n${passed}/${checks.length} checks passed`);
}

verify(process.argv[2]);
```

Run: `node scripts/e2e-setup-verify.js http://localhost:5174`

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
    "e2e:verify": "node scripts/e2e-setup-verify.js",
    "e2e:login": "node scripts/e2e-login-flow.js",
    "e2e:health": "node scripts/e2e-health-check-simple.js"
  }
}
```

## Output Structure

```
.instructions-output/
└── e2e-health/
    ├── setup-verify-report.json
    ├── health-report.json
    ├── login-flow-report.json
    ├── verify-screenshot.png
    └── console-logs.json
```
