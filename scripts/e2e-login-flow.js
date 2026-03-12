const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const outputDir = path.join(repoRoot, '.tmp', 'llm-output', 'e2e-health');
const reportPath = path.join(outputDir, 'login-flow-report.json');
const screenshotPath = path.join(outputDir, 'login-flow-screenshot.png');

const DEADLINE_MS = Number.parseInt(process.env.E2E_DEADLINE_MS ?? '60000', 10);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function closeBrowserBestEffort(browser) {
  if (!browser) return;
  try {
    await Promise.race([browser.close(), sleep(5000)]);
  } catch {
    // Best effort only
  }
}

async function withDeadline(fn) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`E2E deadline exceeded (${DEADLINE_MS}ms)`)), DEADLINE_MS);
  });

  try {
    return await Promise.race([fn(), timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }
}

function ensureOutputDir() {
  fs.mkdirSync(outputDir, { recursive: true });
}

async function run(url) {
  const checks = [];
  let browser;

  const check = (name, passed, details) => {
    checks.push({ name, passed, details });
    console.log(`${passed ? '✓' : '✗'} ${name}${details ? `: ${details}` : ''}`);
  };

  try {
    ensureOutputDir();

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    check('Page navigation', true, url);

    const loginButton = page.getByRole('button', { name: /sign in with github/i });
    const loginVisible = await loginButton.isVisible({ timeout: 5000 }).catch(() => false);
    check('Login button visible', loginVisible);

    const allowExternal = process.env.E2E_ALLOW_EXTERNAL === '1';
    if (!allowExternal) {
      check('External auth flow', true, 'skipped (E2E_ALLOW_EXTERNAL not set)');
    } else if (loginVisible) {
      await loginButton.click();
      await page.waitForURL(/github\.com/i, { timeout: 10000 });
      check('Redirect to GitHub', true, page.url());
    } else {
      check('External auth flow', false, 'login button not found');
    }

    await page.screenshot({ path: screenshotPath });
    check('Screenshot', fs.existsSync(screenshotPath));
  } catch (error) {
    check('Error', false, error?.message ?? String(error));
  } finally {
    await closeBrowserBestEffort(browser);
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

  process.exitCode = passed === checks.length ? 0 : 1;
}

const url = process.argv[2] || process.env.E2E_BASE_URL || 'http://localhost:5173';
withDeadline(() => run(url)).catch((error) => {
  console.error(error?.message ?? String(error));
  process.exitCode = 1;
});
