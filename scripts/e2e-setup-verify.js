const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const outputDir = path.join(repoRoot, '.tmp', 'llm-output', 'e2e-health');
const reportPath = path.join(outputDir, 'setup-verify-report.json');
const screenshotPath = path.join(outputDir, 'verify-screenshot.png');

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
withDeadline(() => verify(url)).catch((error) => {
  console.error(error?.message ?? String(error));
  process.exitCode = 1;
});
