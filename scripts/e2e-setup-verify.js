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

    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
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
verify(url);
