```skill
---
name: playwright-mcp
description: "Browser E2E via Playwright MCP. Official Playwright-based browser automation through MCP. Triggers on: playwright, playwright mcp, E2E testing, browser automation, headless testing."
---

# Skill: playwright-mcp (Browser E2E via Playwright MCP)

Sources:
- https://www.npmjs.com/package/@playwright/mcp
- https://playwright.dev/

Last processed: 2026-01-22

## Purpose
Enable an agent to control a **headless browser** through the official **Playwright MCP server** (`@playwright/mcp`).

Use this when you need:
- E2E testing with reliable browser automation
- Headless testing in CI/CD pipelines
- UI testing with Playwright's robust selectors
- Cross-browser testing (Chromium, Firefox, WebKit)

## Setup (VS Code / Copilot)

### MCP Server Configuration
Add to your `mcp_config.json`:

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": [
        "-y",
        "@playwright/mcp",
        "--browser=chromium",
        "--headless"
      ]
    }
  }
}
```

### Project Dependencies
Install in your project:
```bash
npm install -D @playwright/mcp @playwright/test
npx playwright install chromium
```

### package.json Scripts
```json
{
  "scripts": {
    "playwright:install": "playwright install chromium",
    "e2e:verify": "node scripts/e2e-setup-verify.js"
  }
}
```

## CLI Flags
Supported flags for `@playwright/mcp`:
- `--browser=chromium|firefox|webkit`: browser to use (default: chromium)
- `--headless`: run without UI (recommended for CI)
- `--viewport=1280x720`: fixed viewport size
- `--no-sandbox`: disable sandbox (required in some Docker environments)

## Core Usage Patterns

### Standalone Scripts
For direct Playwright usage (without MCP), create test scripts:

```javascript
const { chromium } = require('@playwright/test');

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  
  // Navigate
  await page.goto('http://localhost:5174', { waitUntil: 'networkidle' });
  
  // Interact
  await page.fill('input[type="email"]', 'user@example.com');
  await page.click('button[type="submit"]');
  
  // Capture evidence
  await page.screenshot({ path: 'screenshot.png', fullPage: true });
  
  await browser.close();
}

main();
```

### Modal/Overlay Handling
```javascript
async function dismissModals(page) {
  const dismissSelectors = [
    'button[aria-label="Close"]',
    'button:has-text("Close")',
    'button:has-text("Dismiss")',
    '.modal-close'
  ];
  
  for (const selector of dismissSelectors) {
    try {
      const element = page.locator(selector).first();
      if (await element.isVisible({ timeout: 1000 })) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
        if (await element.isVisible({ timeout: 500 })) {
          await element.click({ force: true, timeout: 2000 });
        }
      }
    } catch {
      // Ignore - not found
    }
  }
}
```

### Evidence Collection
```javascript
// Console logs
const consoleLogs = [];
page.on('console', msg => consoleLogs.push({ type: msg.type(), text: msg.text() }));

// Network requests
const networkRequests = [];
page.on('request', req => networkRequests.push({ url: req.url(), method: req.method() }));

// Screenshot
await page.screenshot({ path: 'evidence.png', fullPage: true });
```

## E2E Setup Verification Script

Create `scripts/e2e-setup-verify.js` to validate your setup:

```javascript
const { chromium } = require('@playwright/test');
const fs = require('fs');

async function verify(url = 'http://localhost:5174') {
  let browser, passed = 0, total = 0;
  
  const check = (name, result) => {
    total++;
    if (result) passed++;
    console.log(`${result ? '✓' : '✗'} ${name}`);
  };

  try {
    browser = await chromium.launch({ headless: true });
    check('Browser launch', true);
    
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    check('Page creation', true);
    
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    check('Page navigation', true);
    
    const title = await page.title();
    check('Page title', title.length > 0);
    
    await page.screenshot({ path: 'verify-screenshot.png' });
    check('Screenshot capture', fs.existsSync('verify-screenshot.png'));
    
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    if (browser) await browser.close();
  }
  
  console.log(`\n${passed}/${total} checks passed`);
  process.exitCode = passed === total ? 0 : 1;
}

verify(process.argv[2]);
```

## Best Practices

1. **Always use `waitUntil: 'networkidle'`** for reliable page loads
2. **Set fixed viewport** for consistent screenshots: `{ width: 1280, height: 720 }`
3. **Handle modals/overlays** before interacting with page elements
4. **Use `force: true`** for clicks when elements might be covered
5. **Capture evidence** (screenshots, console logs, network) before assertions
6. **Use specific selectors** to avoid flaky tests

## Common Failure Modes

- **Browser not installed**: Run `npx playwright install chromium`
- **Port conflict**: Check if dev server is running on expected port
- **Modal blocking clicks**: Implement modal dismissal before interactions
- **Timeout issues**: Increase timeouts or use `waitFor` conditions
- **Viewport differences**: Set consistent viewport in all tests

## Output Directory Structure

```
.instructions-output/
└── e2e-health/
    ├── health-report.json
    ├── login-flow-report.json
    ├── login-basic.png
    ├── home.png
    └── console-logs.json
```

```

