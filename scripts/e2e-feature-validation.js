const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const outputDir = path.join(repoRoot, '.tmp', 'llm-output', 'e2e-features');
const reportPath = path.join(outputDir, 'feature-report.json');

fs.mkdirSync(outputDir, { recursive: true });

const url = process.argv[2] || process.env.E2E_BASE_URL || 'http://localhost:5173';
const DEADLINE_MS = parseInt(process.env.E2E_DEADLINE_MS || '120000', 10);
const NAV_SETTLE_MS = 2000;
const SELECTOR_TIMEOUT = 10000;

async function run(targetUrl) {
  const checks = [];
  const consoleErrors = [];
  let browser;

  const check = (name, passed, details) => {
    checks.push({ name, passed, details: details || null });
    console.log(`${passed ? '✓' : '✗'} ${name}${details ? `: ${details}` : ''}`);
  };

  const screenshot = async (page, filename) => {
    const filePath = path.join(outputDir, filename);
    await page.screenshot({ path: filePath });
    return filePath;
  };

  const waitFor = (page, selector) =>
    page.waitForSelector(selector, { timeout: SELECTOR_TIMEOUT });

  const exists = async (page, selector) => {
    try {
      const el = await page.$(selector);
      return el !== null;
    } catch {
      return false;
    }
  };

  const clickSidebar = async (page, label) => {
    await page.click(`text="${label}"`);
    await page.waitForTimeout(NAV_SETTLE_MS);
  };

  const hasConsoleError = (substring) =>
    consoleErrors.some((e) => e.includes(substring));

  const deadline = setTimeout(() => {
    console.error(`\n✗ DEADLINE exceeded (${DEADLINE_MS}ms). Aborting.`);
    process.exit(1);
  }, DEADLINE_MS);

  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 30000 });
    check('Page navigation', true, targetUrl);

    // ── Phase 1A: Projects list no-crash ──────────────────────────────
    try {
      const errBefore1a = consoleErrors.length;
      await clickSidebar(page, 'Projects');

      let projectsView = false;
      try {
        await waitFor(page, '[data-testid="projects-list-view"]');
        projectsView = true;
      } catch {
        projectsView = (await page.$('main')) !== null;
      }
      check('Phase 1A – Projects view renders', projectsView);

      const newErrors1a = consoleErrors.slice(errBefore1a);
      const hasToLower1a = newErrors1a.some((e) => e.includes('toLowerCase'));
      check('Phase 1A – No toLowerCase errors', !hasToLower1a,
        hasToLower1a ? `Found: ${newErrors1a.filter((e) => e.includes('toLowerCase')).join('; ')}` : 'clean');

      await screenshot(page, 'phase-1a-projects.png');
      check('Phase 1A – Screenshot captured', true);
    } catch (err) {
      check('Phase 1A – Projects list', false, err.message);
    }

    // ── Phase 1B: Skills catalog no-crash ─────────────────────────────
    try {
      const errBefore1b = consoleErrors.length;
      await clickSidebar(page, 'Catalog');
      await page.click('[data-testid="catalog-section-skills"]');
      await page.waitForTimeout(NAV_SETTLE_MS);

      let skillsView = false;
      try {
        await waitFor(page, '[data-testid="skills-preview-view"]');
        skillsView = true;
      } catch {
        skillsView = false;
      }
      check('Phase 1B – Skills preview view renders', skillsView);

      const newErrors1b = consoleErrors.slice(errBefore1b);
      const hasToLower1b = newErrors1b.some((e) => e.includes('toLowerCase'));
      check('Phase 1B – No toLowerCase errors', !hasToLower1b,
        hasToLower1b ? `Found: ${newErrors1b.filter((e) => e.includes('toLowerCase')).join('; ')}` : 'clean');

      await screenshot(page, 'phase-1b-skills.png');
      check('Phase 1B – Screenshot captured', true);
    } catch (err) {
      check('Phase 1B – Skills catalog', false, err.message);
    }

    // ── Phase 2: Workflow pipeline ────────────────────────────────────
    try {
      await clickSidebar(page, 'Workflows');

      const hasPipeline = await exists(page, '.workflow-pipeline');
      const hasTemplateCards = (await page.$$('.template-card, [data-testid*="template"]')).length > 0;
      check('Phase 2 – Workflow pipeline or templates', hasPipeline || hasTemplateCards,
        hasPipeline ? 'pipeline found' : hasTemplateCards ? 'template cards found' : 'neither found');

      await screenshot(page, 'phase-2-workflows.png');
      check('Phase 2 – Screenshot captured', true);
    } catch (err) {
      check('Phase 2 – Workflow pipeline', false, err.message);
    }

    // ── Phase 3: Todo improvements ────────────────────────────────────
    try {
      await clickSidebar(page, 'Todo');

      const hasAddBtn = await exists(page, '[data-testid="todo-add-button"]');
      const hasNoReposMsg = await exists(page, '[data-testid="todo-no-repos"]');
      const hasRepoPrompt = (await page.textContent('body') || '').includes('Register a repository');
      check('Phase 3 – Todo add button or no-repo state', hasAddBtn || hasNoReposMsg || hasRepoPrompt,
        hasAddBtn ? 'add button found' : hasNoReposMsg ? 'no-repos message shown' : hasRepoPrompt ? 'register prompt shown' : 'neither found');

      const hasRepoSelector = await exists(page, '[data-testid="todo-repo-selector"]');
      const bodyText = await page.textContent('body');
      const hasEmptyState = /no (todos|items|tasks)|empty|get started/i.test(bodyText);
      check('Phase 3 – Repo selector or empty state', hasRepoSelector || hasEmptyState,
        hasRepoSelector ? 'repo selector found' : hasEmptyState ? 'empty state message found' : 'neither found');

      await screenshot(page, 'phase-3-todo.png');
      check('Phase 3 – Screenshot captured', true);
    } catch (err) {
      check('Phase 3 – Todo improvements', false, err.message);
    }

    // ── Phase 4: Superpowers removed ──────────────────────────────────
    try {
      await clickSidebar(page, 'Catalog');
      await page.click('[data-testid="catalog-section-overview"]');
      await page.waitForTimeout(NAV_SETTLE_MS);

      let overviewRendered = false;
      try {
        await waitFor(page, '[data-testid="catalog-overview-view"]');
        overviewRendered = true;
      } catch {
        overviewRendered = false;
      }
      check('Phase 4 – Catalog overview renders', overviewRendered);

      const overviewText = await page.textContent('body');
      const overviewHasSuperpowers = /superpowers/i.test(overviewText);
      check('Phase 4 – No "superpowers" in overview', !overviewHasSuperpowers,
        overviewHasSuperpowers ? 'FOUND superpowers text' : 'clean');

      await page.click('[data-testid="catalog-section-agents"]');
      await page.waitForTimeout(NAV_SETTLE_MS);

      let agentsRendered = false;
      try {
        await waitFor(page, '[data-testid="catalog-agents-view"]');
        agentsRendered = true;
      } catch {
        agentsRendered = false;
      }
      check('Phase 4 – Catalog agents view renders', agentsRendered);

      const agentsText = await page.textContent('body');
      const agentsHasSuperpowers = /superpowers/i.test(agentsText);
      check('Phase 4 – No "superpowers" in agents', !agentsHasSuperpowers,
        agentsHasSuperpowers ? 'FOUND superpowers text' : 'clean');

      const hasSummaryPanel = await exists(page, '[data-testid="catalog-agents-summary-panel"]');
      check('Phase 4 – Agents summary panel exists', hasSummaryPanel);

      await screenshot(page, 'phase-4-catalog.png');
      check('Phase 4 – Screenshot captured', true);
    } catch (err) {
      check('Phase 4 – Superpowers removed', false, err.message);
    }

    // ── Phase 5: Asset creation wizard ────────────────────────────────
    try {
      // 5a – Open wizard from Agents tab
      const hasCreateAgent = await exists(page, '[data-testid="catalog-create-agent"]');
      check('Phase 5 – Create Agent button exists', hasCreateAgent);

      if (hasCreateAgent) {
        await page.click('[data-testid="catalog-create-agent"]');
        await page.waitForTimeout(NAV_SETTLE_MS);

        let wizardVisible = false;
        try {
          await waitFor(page, '[data-testid="asset-creation-wizard"]');
          wizardVisible = true;
        } catch {
          wizardVisible = false;
        }
        check('Phase 5A – Wizard opens', wizardVisible);

        const hasKindStep = await exists(page, '[data-testid="asset-wizard-kind-step"]');
        check('Phase 5A – Kind step renders', hasKindStep);

        const hasAgentOption = await exists(page, '[data-testid="asset-wizard-kind-agent"]');
        check('Phase 5A – Agent option card present', hasAgentOption);

        const hasSkillOption = await exists(page, '[data-testid="asset-wizard-kind-skill"]');
        check('Phase 5A – Skill option card present', hasSkillOption);

        await screenshot(page, 'phase-5a-wizard-kind.png');
        check('Phase 5A – Screenshot captured', true);

        // 5b – Advance to identity step
        const hasNext = await exists(page, '[data-testid="asset-creation-wizard-stepped-next"]');
        if (hasNext) {
          await page.click('[data-testid="asset-creation-wizard-stepped-next"]');
          await page.waitForTimeout(NAV_SETTLE_MS);

          await screenshot(page, 'phase-5b-wizard-identity.png');
          check('Phase 5B – Identity step screenshot captured', true);
        } else {
          check('Phase 5B – Next button not found', false, 'skipped');
        }

        // 5c – Cancel wizard
        const hasCancel = await exists(page, '[data-testid="asset-creation-wizard-stepped-cancel"]');
        if (hasCancel) {
          await page.click('[data-testid="asset-creation-wizard-stepped-cancel"]');
          await page.waitForTimeout(NAV_SETTLE_MS);

          const wizardGone = !(await exists(page, '[data-testid="asset-creation-wizard"]'));
          check('Phase 5C – Wizard closed after cancel', wizardGone);

          await screenshot(page, 'phase-5c-wizard-closed.png');
          check('Phase 5C – Screenshot captured', true);
        } else {
          check('Phase 5C – Cancel button not found', false, 'skipped');
        }
      } else {
        check('Phase 5 – Wizard tests skipped (no create button)', false, 'skipped');
      }

      // Ensure wizard is closed before testing skills tab
      const wizardStillOpen = await exists(page, '[data-testid="asset-creation-wizard"]');
      if (wizardStillOpen) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(NAV_SETTLE_MS);
      }
      // Navigate back to catalog if needed
      await clickSidebar(page, 'Catalog');

      // 5d – Skills "Create Skill" button
      await page.click('[data-testid="catalog-section-skills"]');
      await page.waitForTimeout(NAV_SETTLE_MS);

      const hasCreateSkill = await exists(page, '[data-testid="catalog-create-skill"]');
      check('Phase 5D – Create Skill button exists', hasCreateSkill);

      await screenshot(page, 'phase-5d-skills-create-button.png');
      check('Phase 5D – Screenshot captured', true);
    } catch (err) {
      check('Phase 5 – Asset creation wizard', false, err.message);
    }

  } catch (error) {
    check('Fatal error', false, error?.message ?? String(error));
  } finally {
    clearTimeout(deadline);
    if (browser) {
      await browser.close();
    }
  }

  // ── Report ──────────────────────────────────────────────────────────
  const passed = checks.filter((c) => c.passed).length;
  const failed = checks.length - passed;
  const report = {
    url: targetUrl,
    timestamp: new Date().toISOString(),
    passed,
    failed,
    total: checks.length,
    checks,
    consoleErrors
  };

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log('\n══════════════════════════════════════');
  console.log(`  ${passed}/${checks.length} checks passed` + (failed ? ` (${failed} failed)` : ''));
  console.log(`  Report: ${reportPath}`);
  console.log('══════════════════════════════════════\n');

  if (failed > 0) {
    process.exitCode = 1;
  }
}

run(url);
