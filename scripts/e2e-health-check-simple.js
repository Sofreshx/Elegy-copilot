const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const outputDir = path.join(repoRoot, '.instructions-output', 'e2e-health');
const reportPath = path.join(outputDir, 'health-report.json');
const screenshotPath = path.join(outputDir, 'health-screenshot.png');

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
  const consoleErrors = [];
  let browser;

  const check = (name, passed, details) => {
    checks.push({ name, passed, details });
    console.log(`${passed ? '✓' : '✗'} ${name}${details ? `: ${details}` : ''}`);
  };

  try {
    ensureOutputDir();

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    check('Page navigation', true, url);

    const loginVisible = await page
      .getByRole('button', { name: /sign in with github/i })
      .isVisible({ timeout: 5000 })
      .catch(() => false);
    const dashboardVisible = await page
      .getByRole('heading', { name: /dashboard/i })
      .isVisible({ timeout: 5000 })
      .catch(() => false);

    check(
      'Login prompt or dashboard',
      loginVisible || dashboardVisible,
      loginVisible ? 'login prompt' : dashboardVisible ? 'dashboard' : 'not found'
    );

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
    checks,
    consoleErrors
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
