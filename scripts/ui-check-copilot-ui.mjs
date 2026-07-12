#!/usr/bin/env node
/**
 * ui-check-copilot-ui.mjs — Playwright browser adapter for the copilot-ui dashboard
 *
 * Environment variables (set by the ui-check runner):
 *   UI_CHECK_RUN_ID        — unique run identifier
 *   UI_CHECK_TARGET_ID     — target being executed (settings, catalog, workspace, etc.)
 *   UI_CHECK_EVIDENCE_DIR  — directory to write evidence into
 *
 * Writes: <UI_CHECK_EVIDENCE_DIR>/runtime-report.json
 *
 * Invoked by the ui-check runner (ui-check.mjs) as a validation command.
 * Designed to run standalone for debugging as well:
 *   node scripts/ui-check-copilot-ui.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { chromium } from '@playwright/test';

// ---------------------------------------------------------------------------
// CONSTANTS
// ---------------------------------------------------------------------------

const PORT = 3211; // isolated port, different from dev default
const HOST = '127.0.0.1';
const BASE_URL = `http://${HOST}:${PORT}`;
const DESKTOP_UI_TOKEN = 'ui-check-pilot';
const DESKTOP_UI_QUERY = `desktop-ui-token=${DESKTOP_UI_TOKEN}`;
const SERVER_START_TIMEOUT_MS = 120000;
const PAGE_READY_TIMEOUT_MS = 30000;
const HEALTH_POLL_INTERVAL_MS = 2000;
const WORKSPACE_TABS_STORAGE_KEY = 'elegy-copilot-workspace-tabs';
const ACTIVE_WORKSPACE_STORAGE_KEY = 'elegy-copilot-active-workspace';
const WORKSPACE_TAB_TARGETS = {
  'workspace-git': {
    routeId: 'workspace-git-default',
    tabId: 'git',
    tabSelector: '[data-testid="workspace-local-tab-git"]',
    surfaceSelectors: [
      '[data-testid="workspace-git-tab"]',
      '[data-testid="workspace-operation-banner"]',
    ],
  },
  'workspace-checks': {
    routeId: 'workspace-checks-default',
    tabId: 'checks',
    tabSelector: '[data-testid="workspace-local-tab-checks"]',
    surfaceSelectors: [
      '[data-testid="workspace-checks-tab"]',
      '[data-testid="workspace-operation-banner"]',
    ],
  },
  'workspace-assets': {
    routeId: 'workspace-assets-default',
    tabId: 'assets',
    tabSelector: '[data-testid="workspace-local-tab-assets"]',
    surfaceSelectors: [
      '[data-testid="workspace-assets-center"]',
    ],
  },
};

const EVIDENCE_VIEWPORTS = [
  { id: 'wide', width: 1440, height: 900 },
  { id: 'desktop', width: 1280, height: 800 },
  { id: 'compact', width: 960, height: 720 },
];

function getEvidenceViewports() {
  return EVIDENCE_VIEWPORTS.map((viewport) => ({ ...viewport }));
}

function deriveSurfaceStatus({ ready, consoleErrors, pageErrors, networkFailures }) {
  return ready
    && consoleErrors.length === 0
    && pageErrors.length === 0
    && networkFailures.length === 0
    ? 'pass'
    : 'fail';
}

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Create a require function to load the CJS server module from the ESM context.
 */
const _require = createRequire(import.meta.url);

/**
 * Resolve engine root: two levels up from scripts/
 * @returns {string}
 */
function resolveEngineRoot() {
  return path.resolve(__dirname, '..');
}

/**
 * Resolve the repository opened for workspace evidence.
 * UI_CHECK_REPO_PATH can point at any real repo; the engine root is the
 * deterministic fallback for local and CI runs.
 *
 * @param {string} engineRoot
 * @returns {string}
 */
function resolveWorkspaceEvidenceRepoPath(engineRoot = resolveEngineRoot()) {
  const configuredPath = process.env.UI_CHECK_REPO_PATH;
  if (configuredPath && configuredPath.trim()) {
    return path.resolve(configuredPath.trim());
  }
  return path.resolve(engineRoot);
}

/**
 * Build the localStorage payload that makes the workspace floating card
 * expose one deterministic opened repository.
 *
 * @param {string} repoPath
 * @param {number} openedAt
 * @returns {{ tabs: Array<{ repoPath: string, repoLabel: string, openedAt: number }>, activeWorkspaceId: string }}
 */
function buildWorkspaceStorageSeed(repoPath, openedAt = Date.now()) {
  const resolvedRepoPath = path.resolve(repoPath);
  const repoLabel = path.basename(resolvedRepoPath) || resolvedRepoPath;
  return {
    tabs: [
      {
        repoPath: resolvedRepoPath,
        repoLabel,
        openedAt,
      },
    ],
    activeWorkspaceId: resolvedRepoPath,
  };
}

/**
 * Return the tab routing contract for real opened-workspace targets.
 *
 * @param {string} targetId
 * @returns {{ routeId: string, tabId: string, tabSelector: string, surfaceSelectors: string[] }}
 */
function getWorkspaceTabTarget(targetId) {
  const target = WORKSPACE_TAB_TARGETS[targetId];
  if (!target) {
    throw new Error(`Unknown workspace tab target: "${targetId}". Supported: ${Object.keys(WORKSPACE_TAB_TARGETS).join(', ')}`);
  }
  return target;
}

function isWorkspaceTabTarget(targetId) {
  return Object.hasOwn(WORKSPACE_TAB_TARGETS, targetId);
}

/**
 * Seed localStorage before the app boots so the floating workspace card can
 * open the real workspace without relying on repository inventory timing.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} repoPath
 * @returns {Promise<ReturnType<typeof buildWorkspaceStorageSeed>>}
 */
async function seedWorkspaceLocalStorage(page, repoPath) {
  const seed = buildWorkspaceStorageSeed(repoPath);
  await page.addInitScript(({ tabsKey, activeKey, tabs, activeWorkspaceId }) => {
    window.localStorage.setItem(tabsKey, JSON.stringify(tabs));
    window.localStorage.setItem(activeKey, activeWorkspaceId);
  }, {
    tabsKey: WORKSPACE_TABS_STORAGE_KEY,
    activeKey: ACTIVE_WORKSPACE_STORAGE_KEY,
    tabs: seed.tabs,
    activeWorkspaceId: seed.activeWorkspaceId,
  });
  return seed;
}

/**
 * Poll a health endpoint until it returns 200 or timeout expires.
 *
 * @param {string} healthUrl  - Full health endpoint URL
 * @param {number} timeoutMs  - Max time to wait in ms
 * @returns {Promise<void>}   - Resolves when healthy, rejects on timeout
 */
async function waitForServer(healthUrl, timeoutMs) {
  const startTime = Date.now();
  const maxTime = startTime + timeoutMs;

  while (Date.now() < maxTime) {
    try {
      const response = await fetch(healthUrl);
      if (response.ok) {
        return;
      }
    } catch {
      // Server not ready yet — continue polling
    }
    await new Promise((resolve) => setTimeout(resolve, HEALTH_POLL_INTERVAL_MS));
  }

  throw new Error(
    `Server did not become healthy within ${timeoutMs}ms at ${healthUrl}`
  );
}

// ---------------------------------------------------------------------------
// SERVER LIFECYCLE
// ---------------------------------------------------------------------------

/**
 * Start the copilot-ui server with test-appropriate settings.
 *
 * Loads the CJS server module via createRequire, starts the server with
 * an isolated port and explicit desktop-ui token, then polls the health
 * endpoint until it responds.
 *
 * @returns {Promise<{ close: () => Promise<void> }>}  Server handle
 */
async function startServer() {
  const serverModule = _require('../copilot-ui/server.js');
  const { startServer: serverStart } = serverModule;

  const serverHandle = await serverStart({
    port: PORT,
    host: HOST,
    desktopUiToken: DESKTOP_UI_TOKEN,
    quiet: true,
    managedAssetSyncOnStart: false,
    engineRoot: resolveEngineRoot(),
  });

  // Wait for the server to be healthy
  const healthUrl = `http://${HOST}:${PORT}/api/health`;
  await waitForServer(healthUrl, SERVER_START_TIMEOUT_MS);

  return serverHandle;
}

// ---------------------------------------------------------------------------
// BROWSER LIFECYCLE
// ---------------------------------------------------------------------------

/**
 * Launch a headless Chromium browser, create a context with a standard
 * viewport, and set up error-collection listeners.
 *
 * Collects:
 *   - Browser console errors
 *   - Page-level JavaScript exceptions (pageerror)
 *   - Failed network requests
 *
 * @returns {Promise<{
 *   browser: import('@playwright/test').Browser,
 *   context: import('@playwright/test').BrowserContext,
 *   page: import('@playwright/test').Page,
 *   consoleErrors: string[],
 *   pageErrors: string[],
 *   networkFailures: Array<{ url: string, status: number|null, statusText: string }>
 * }>}
 */
async function setupBrowser() {
  const consoleErrors = [];
  const pageErrors = [];
  const networkFailures = [];

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-gpu'],
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });

  const page = await context.newPage();

  // Collect console errors
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  // Collect page-level errors (unhandled exceptions)
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });

  // Collect failed network requests
  page.on('requestfailed', (request) => {
    const failure = request.failure();
    networkFailures.push({
      url: request.url(),
      status: 0,
      statusText: failure?.errorText || 'Request failed',
    });
  });

  return { browser, context, page, consoleErrors, pageErrors, networkFailures };
}

// ---------------------------------------------------------------------------
// NAVIGATION
// ---------------------------------------------------------------------------

/**
 * Navigate to a copilot-ui view, using the desktop-ui-token query param
 * for authentication.
 *
 * View mapping:
 *   settings       → sidebar-item-settings, then app-layout
 *   catalog        → sidebar-item-settings, then settings-nav-catalog
 *   workspace      → seeded opened workspace docs tab
 *   workspace-git  → seeded opened workspace Git tab
 *   workspace-checks → seeded opened workspace Checks tab
 *   workspace-notes → seeded opened workspace Notes tab
 *   repositories   → sidebar-item-repositories
 *   remote         → sidebar-item-remote
 *
 * @param {import('@playwright/test').Page} page
 * @param {string}   viewId  - One of: settings, catalog, workspace, workspace-git, workspace-checks, workspace-notes, repositories, remote, lexicon
 * @returns {Promise<void>}
 */
async function navigateToView(page, viewId) {
  const validViews = new Set(['settings', 'catalog', 'workspace', 'workspace-git', 'workspace-checks', 'workspace-assets', 'repositories', 'remote', 'pattern-atlas']);
  if (!validViews.has(viewId)) {
    throw new Error(`Unknown viewId: "${viewId}". Valid: ${[...validViews].join(', ')}`);
  }

  let workspaceSeed = null;
  if (viewId === 'workspace' || isWorkspaceTabTarget(viewId)) {
    const repoPath = resolveWorkspaceEvidenceRepoPath();
    workspaceSeed = await seedWorkspaceLocalStorage(page, repoPath);
  }

  // Start at the base URL with the desktop-ui-token
  await page.goto(`${BASE_URL}/?${DESKTOP_UI_QUERY}`, {
    waitUntil: 'domcontentloaded',
    timeout: PAGE_READY_TIMEOUT_MS,
  });

  // Wait for sidebar to be rendered
  await page.waitForSelector('[data-testid="sidebar"]', {
    timeout: PAGE_READY_TIMEOUT_MS,
  });

  if (viewId === 'settings') {
    // Click the settings sidebar item
    await page.click('[data-testid="sidebar-item-settings"]');
    // Wait for the app layout to appear
    await page.waitForSelector('[data-testid="app-layout"]', {
      timeout: PAGE_READY_TIMEOUT_MS,
    });
  } else if (viewId === 'catalog') {
    // Click the settings sidebar item first
    await page.click('[data-testid="sidebar-item-settings"]');
    await page.waitForSelector('[data-testid="app-layout"]', {
      timeout: PAGE_READY_TIMEOUT_MS,
    });
    // Then click the Assets & Tools section within settings
    await page.click('[data-testid="settings-nav-catalog"]');
    await page.waitForTimeout(500); // Allow content transition
  } else if (viewId === 'workspace' || isWorkspaceTabTarget(viewId)) {
    if (!workspaceSeed) {
      throw new Error(`Workspace navigation for "${viewId}" did not receive a workspace seed.`);
    }
    await page.waitForSelector('[data-testid^="sidebar-workspace-"]', {
      timeout: PAGE_READY_TIMEOUT_MS,
    });
    await page.locator('[data-testid^="sidebar-workspace-"]').first().click();
    await page.waitForSelector('[data-testid="workspace-view"]', {
      timeout: PAGE_READY_TIMEOUT_MS,
    });

    if (isWorkspaceTabTarget(viewId)) {
      const tabTarget = getWorkspaceTabTarget(viewId);
      await page.click(tabTarget.tabSelector);
      for (const selector of tabTarget.surfaceSelectors) {
        await page.waitForSelector(selector, {
          timeout: PAGE_READY_TIMEOUT_MS,
        });
      }
    }
  } else {
    // repositories, remote, lexicon
    await page.click(`[data-testid="sidebar-item-${viewId}"]`);
    await page.waitForSelector('[data-testid="app-layout"]', {
      timeout: PAGE_READY_TIMEOUT_MS,
    });
  }

}

async function waitForTargetReadiness(page, targetId) {
  try {
    await page.waitForFunction((id) => {
      const exists = (selector) => Boolean(document.querySelector(selector));
      const text = (selector) => document.querySelector(selector)?.textContent || '';

      if (id === 'workspace' || id.startsWith('workspace-')) {
        const loadingMessage = [...document.querySelectorAll('.state-message')]
          .some((element) => /^(Loading|Scanning|Checking|Analyzing)/i.test((element.textContent || '').trim()));
        return exists('[data-testid="workspace-context-header"]')
          && !exists('[data-testid="github-auth-checking"]')
          && !text('.workspace-context-status').includes('Checking status')
          && !loadingMessage;
      }
      if (id === 'pattern-atlas') {
        return exists('[data-testid="pattern-atlas-view"]')
          && !exists('[data-testid="atlas-loading"]')
          && exists('[data-testid="atlas-gallery-grid"]');
      }
      if (id === 'catalog') {
        return exists('[data-testid="catalog-shell-view"]')
          && !exists('[data-testid="catalog-actionable-error"]');
      }
      if (id === 'settings') return exists('[data-testid="settings-view"]');
      return exists('[data-testid="app-layout"]');
    }, targetId, { timeout: PAGE_READY_TIMEOUT_MS });
    return { ready: true, reason: null };
  } catch (error) {
    return { ready: false, reason: error.message };
  }
}

// ---------------------------------------------------------------------------
// STATE CAPTURE
// ---------------------------------------------------------------------------

/**
 * Capture a screenshot of the current page state.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} viewport  - Viewport label (e.g. 'desktop', 'mobile')
 * @param {string} state     - State label (e.g. 'default', 'loading', 'empty')
 * @param {string} evidenceDir - Directory to write the screenshot into
 * @param {string} prefix    - Filename prefix for the screenshot
 * @returns {Promise<string>}  Relative path to the screenshot
 */
async function captureState(page, viewport, state, evidenceDir, prefix) {
  const filename = `${prefix}-${viewport}.png`;
  const filePath = path.join(evidenceDir, filename);

  await page.screenshot({
    path: filePath,
    fullPage: true,
  });

  return filename;
}

async function captureApprovedViewports(page, routeId, evidenceDir, prefix, diagnostics, readiness) {
  const results = [];
  for (const viewport of EVIDENCE_VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const theme = viewport.id === 'desktop' ? 'light' : 'dark';
    await page.evaluate((nextTheme) => {
      window.localStorage.setItem('elegy-copilot-theme', nextTheme);
      document.documentElement.dataset.theme = nextTheme;
    }, theme);
    await page.waitForFunction((nextTheme) => document.documentElement.dataset.theme === nextTheme, theme);
    if (viewport.id === 'desktop') {
      const launcher = page.locator('.workspace-launch-trigger:not([disabled])');
      if (await launcher.count()) {
        await launcher.first().click();
        await page.waitForSelector('[data-testid="workspace-launch-menu"]');
      }
    }
    const screenshot = await captureState(page, viewport.id, 'default', evidenceDir, `${prefix}-${theme}`);
    const readinessErrors = readiness.reason ? [`Readiness failed: ${readiness.reason}`] : [];
    const resultPageErrors = [...diagnostics.pageErrors, ...readinessErrors];
    results.push({
      routeId,
      viewport: viewport.id === 'compact' ? 'mobile' : 'desktop',
      state: 'default',
      status: deriveSurfaceStatus({
        ready: readiness.ready,
        consoleErrors: diagnostics.consoleErrors,
        pageErrors: resultPageErrors,
        networkFailures: diagnostics.networkFailures,
      }),
      ready: readiness.ready,
      screenshot,
      consoleErrors: [...diagnostics.consoleErrors],
      pageErrors: resultPageErrors,
      networkFailures: [...diagnostics.networkFailures],
    });
    if (viewport.id === 'desktop' && await page.locator('[data-testid="workspace-launch-menu"]').count()) {
      await page.locator('.workspace-launch-trigger').first().click();
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// RUNTIME REPORT
// ---------------------------------------------------------------------------

/**
 * Generate a runtime-report.json file in the evidence directory.
 *
 * The report follows ui-check-runtime-report.schema.json:
 *   - schemaVersion, runId, targetId, timestamp, surfaceResults
 *   - Each surfaceResult: routeId, viewport, state, status, screenshot,
 *     consoleErrors, pageErrors, networkFailures
 *
 * @param {string}   targetId       - Target identifier (e.g. 'settings', 'catalog')
 * @param {Array}    surfaceResults - Array of surface result objects
 * @param {string}   evidenceDir    - Evidence directory path
 * @returns {{ reportPath: string }}  Path to the written report
 */
function generateRuntimeReport(targetId, surfaceResults, evidenceDir) {
  const report = {
    schemaVersion: 1,
    runId: process.env.UI_CHECK_RUN_ID || 'manual',
    targetId,
    timestamp: new Date().toISOString(),
    surfaceResults: surfaceResults.map((sr) => ({
      routeId: sr.routeId,
      viewport: sr.viewport,
      state: sr.state,
      status: sr.status,
      screenshot: sr.screenshot || null,
      consoleErrors: sr.consoleErrors || [],
      pageErrors: sr.pageErrors || [],
      networkFailures: sr.networkFailures || [],
    })),
  };

  const reportPath = path.join(evidenceDir, 'runtime-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');

  return { reportPath };
}

// ---------------------------------------------------------------------------
// TARGET ROUTER
// ---------------------------------------------------------------------------

/**
 * Run a UI check target: navigate to the appropriate view(s), capture
 * screenshots, collect console/network errors, and generate a runtime report.
 *
 * Target mapping:
 *   settings   → settings view, default state
 *   catalog    → settings → Assets & Tools, default state
 *   workspace  → seeded opened workspace
 *   workspace-git/checks/notes → seeded opened workspace local tabs
 *
 * @param {string} targetId    - Target identifier
 * @param {object} browserHandle - Object with { page, consoleErrors, pageErrors, networkFailures }
 *                                from setupBrowser()
 * @param {string} evidenceDir - Evidence output directory
 * @returns {Promise<Array>}   Array of surface result objects
 */
async function runTarget(targetId, browserHandle, evidenceDir) {
  const { page, consoleErrors, pageErrors, networkFailures } = browserHandle;
  const surfaceResults = [];

  if (targetId === 'settings') {
    await navigateToView(page, 'settings');
    const readiness = await waitForTargetReadiness(page, targetId);
    const screenshot = await captureState(page, 'desktop', 'default', evidenceDir, `settings-default`);
    const resultPageErrors = [...pageErrors, ...(readiness.reason ? [`Readiness failed: ${readiness.reason}`] : [])];

    surfaceResults.push({
      routeId: 'settings-default',
      viewport: 'desktop',
      state: 'default',
      status: deriveSurfaceStatus({ ready: readiness.ready, consoleErrors, pageErrors: resultPageErrors, networkFailures }),
      ready: readiness.ready,
      screenshot,
      consoleErrors: [...consoleErrors],
      pageErrors: resultPageErrors,
      networkFailures: [...networkFailures],
    });
  } else if (targetId === 'catalog') {
    await navigateToView(page, 'catalog');
    const readiness = await waitForTargetReadiness(page, targetId);
    const screenshot = await captureState(page, 'desktop', 'default', evidenceDir, `catalog-default`);
    const resultPageErrors = [...pageErrors, ...(readiness.reason ? [`Readiness failed: ${readiness.reason}`] : [])];

    surfaceResults.push({
      routeId: 'catalog-default',
      viewport: 'desktop',
      state: 'default',
      status: deriveSurfaceStatus({ ready: readiness.ready, consoleErrors, pageErrors: resultPageErrors, networkFailures }),
      ready: readiness.ready,
      screenshot,
      consoleErrors: [...consoleErrors],
      pageErrors: resultPageErrors,
      networkFailures: [...networkFailures],
    });
  } else if (targetId === 'workspace') {
    await navigateToView(page, 'workspace');
    const readiness = await waitForTargetReadiness(page, targetId);
    surfaceResults.push(...await captureApprovedViewports(page, 'workspace-default', evidenceDir, 'workspace-default', {
      consoleErrors, pageErrors, networkFailures,
    }, readiness));
  } else if (targetId === 'workspace-git' || targetId === 'workspace-checks' || targetId === 'workspace-assets') {
    await navigateToView(page, targetId);
    const readiness = await waitForTargetReadiness(page, targetId);
    const routeId = getWorkspaceTabTarget(targetId).routeId;
    const screenshot = await captureState(page, 'desktop', 'default', evidenceDir, routeId);
    const resultPageErrors = [...pageErrors, ...(readiness.reason ? [`Readiness failed: ${readiness.reason}`] : [])];

    surfaceResults.push({
      routeId,
      viewport: 'desktop',
      state: 'default',
      status: deriveSurfaceStatus({ ready: readiness.ready, consoleErrors, pageErrors: resultPageErrors, networkFailures }),
      ready: readiness.ready,
      screenshot,
      consoleErrors: [...consoleErrors],
      pageErrors: resultPageErrors,
      networkFailures: [...networkFailures],
    });
  } else if (['repositories', 'remote', 'pattern-atlas'].includes(targetId)) {
    await navigateToView(page, targetId);
    const readiness = await waitForTargetReadiness(page, targetId);
    const screenshot = await captureState(page, 'desktop', 'default', evidenceDir, `${targetId}-default`);
    const resultPageErrors = [...pageErrors, ...(readiness.reason ? [`Readiness failed: ${readiness.reason}`] : [])];
    const routeId = targetId === 'pattern-atlas' ? 'pattern-atlas-view' : `${targetId}-default`;

    surfaceResults.push({
      routeId,
      viewport: 'desktop',
      state: 'default',
      status: deriveSurfaceStatus({ ready: readiness.ready, consoleErrors, pageErrors: resultPageErrors, networkFailures }),
      ready: readiness.ready,
      screenshot,
      consoleErrors: [...consoleErrors],
      pageErrors: resultPageErrors,
      networkFailures: [...networkFailures],
    });
  } else {
    throw new Error(`Unknown targetId: "${targetId}". Supported: settings, catalog, workspace, workspace-git, workspace-checks, workspace-assets, repositories, remote, pattern-atlas`);
  }

  return surfaceResults;
}

// ---------------------------------------------------------------------------
// SHUTDOWN
// ---------------------------------------------------------------------------

/**
 * Shutdown browser and server safely.
 *
 * Always attempts to close both, even if one fails.
 *
 * @param {import('@playwright/test').Browser} browser
 * @param {import('@playwright/test').BrowserContext} context
 * @param {{ close: () => Promise<void> }} serverHandle
 * @returns {Promise<void>}
 */
async function shutdown(browser, context, serverHandle) {
  // Close browser first (it's the faster resource)
  if (context) {
    try {
      await context.close();
    } catch {
      // Best-effort cleanup
    }
  }

  if (browser) {
    try {
      await browser.close();
    } catch {
      // Best-effort cleanup
    }
  }

  // Then shut down the server
  if (serverHandle && typeof serverHandle.close === 'function') {
    try {
      await serverHandle.close();
    } catch {
      // Best-effort cleanup
    }
  }
}

// ---------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------

/**
 * Main entry point.
 *
 * Reads environment variables set by the ui-check runner:
 *   - UI_CHECK_TARGET_ID
 *   - UI_CHECK_EVIDENCE_DIR
 *   - UI_CHECK_RUN_ID
 *
 * Flow:
 *   1. Validate evidence directory
 *   2. Start server
 *   3. Setup browser
 *   4. Run target capture
 *   5. Generate runtime report
 *   6. Shutdown
 *   7. Exit 0 on success, 1 on failure
 *
 * @returns {Promise<number>}  Exit code
 */
async function main() {
  const targetId = process.env.UI_CHECK_TARGET_ID || 'settings';
  const evidenceDir = process.env.UI_CHECK_EVIDENCE_DIR || path.resolve(__dirname, '..', 'evidence', 'ui', 'manual');
  const runId = process.env.UI_CHECK_RUN_ID || 'manual';

  // Validate / create evidence directory
  try {
    fs.mkdirSync(evidenceDir, { recursive: true });
  } catch (err) {
    console.error(`Failed to create evidence directory ${evidenceDir}: ${err.message}`);
    return 1;
  }

  let browser = null;
  let context = null;
  let serverHandle = null;

  try {
    // Start server
    console.error(`[ui-check-copilot-ui] Starting server on ${HOST}:${PORT}...`);
    serverHandle = await startServer();
    console.error(`[ui-check-copilot-ui] Server is healthy.`);

    // Setup browser
    console.error(`[ui-check-copilot-ui] Launching browser...`);
    const browserHandle = await setupBrowser();
    browser = browserHandle.browser;
    context = browserHandle.context;
    const { page, consoleErrors, pageErrors, networkFailures } = browserHandle;
    console.error(`[ui-check-copilot-ui] Browser ready.`);

    // Run target
    console.error(`[ui-check-copilot-ui] Running target "${targetId}"...`);
    const surfaceResults = await runTarget(targetId, { page, consoleErrors, pageErrors, networkFailures }, evidenceDir);

    // Consume any additional errors collected during capture
    // (surfaceResults already captured a snapshot, but we merge final state)
    const finalResults = surfaceResults.map((sr) => {
      const readinessErrors = (sr.pageErrors || []).filter((error) => error.startsWith('Readiness failed:'));
      const finalPageErrors = [...pageErrors, ...readinessErrors];
      return {
        ...sr,
        status: deriveSurfaceStatus({
          ready: sr.ready,
          consoleErrors,
          pageErrors: finalPageErrors,
          networkFailures,
        }),
        consoleErrors: [...consoleErrors],
        pageErrors: finalPageErrors,
        networkFailures: [...networkFailures],
      };
    });

    // Generate runtime report
    const reportResult = generateRuntimeReport(targetId, finalResults, evidenceDir);
    console.error(`[ui-check-copilot-ui] Runtime report written to ${reportResult.reportPath}`);

    // Log summary to stderr (stdout is reserved for JSON in CI modes)
    const failedResults = finalResults.filter((result) => result.status === 'fail');
    if (failedResults.length > 0) {
      console.error(`[ui-check-copilot-ui] FAILED: ${failedResults.length} surface(s) failed readiness or runtime diagnostics.`);
      return 1;
    }

    console.error(`[ui-check-copilot-ui] No errors detected.`);
    console.error(`[ui-check-copilot-ui] Target "${targetId}" completed successfully.`);
    return 0;
  } catch (err) {
    console.error(`[ui-check-copilot-ui] FAILED: ${err.message}`);
    console.error(err.stack);
    return 1;
  } finally {
    await shutdown(browser, context, serverHandle);
  }
}

// ---------------------------------------------------------------------------
// EXPORTS
// ---------------------------------------------------------------------------

export {
  startServer,
  setupBrowser,
  navigateToView,
  captureState,
  generateRuntimeReport,
  runTarget,
  resolveEngineRoot,
  resolveWorkspaceEvidenceRepoPath,
  buildWorkspaceStorageSeed,
  getWorkspaceTabTarget,
  isWorkspaceTabTarget,
  getEvidenceViewports,
  deriveSurfaceStatus,
  main,
};

// ---------------------------------------------------------------------------
// ENTRY POINT
// ---------------------------------------------------------------------------

const entryPath = fileURLToPath(import.meta.url);
const invokedPath = path.resolve(process.argv[1] || '');
if (invokedPath === entryPath) {
  main().then((exitCode) => process.exit(exitCode));
}
