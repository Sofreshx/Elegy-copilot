const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const outputDir = path.join(repoRoot, '.tmp', 'llm-output', 'e2e-health');
const reportPath = path.join(outputDir, 'login-flow-report.json');
const screenshotPath = path.join(outputDir, 'login-flow-screenshot.png');

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

    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    check('Page navigation', true, url);

    const loginButton = page.getByRole('button', { name: /sign in with github/i });
    const loginVisible = await loginButton.isVisible();
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
    if (browser) {
      await browser.close();
    }
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
run(url);
