'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const uiRoot = path.join(repoRoot, 'ui');
const uiSrcRoot = path.join(uiRoot, 'src');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  PASS: ${name}`);
  } catch (error) {
    failed += 1;
    process.exitCode = 1;
    console.error(`  FAIL: ${name}`);
    console.error(`    ${error.message}`);
  }
}

function walkFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(filePath, out);
      continue;
    }

    out.push(filePath);
  }

  return out;
}

async function run() {
  console.log('\nUI React Smoke Tests\n');

  await test('index.html mounts React entrypoint', async () => {
    const indexHtml = fs.readFileSync(path.join(uiRoot, 'index.html'), 'utf8');
    assert.ok(indexHtml.includes('/src/main.tsx'), 'Expected ui/index.html to load /src/main.tsx');
  });

  await test('main.tsx and App.tsx exist', async () => {
    assert.ok(fs.existsSync(path.join(uiSrcRoot, 'main.tsx')), 'Missing ui/src/main.tsx');
    assert.ok(fs.existsSync(path.join(uiSrcRoot, 'App.tsx')), 'Missing ui/src/App.tsx');
  });

  await test('active workspace hub view files exist for home runtime, planning, catalog, and stats', async () => {
    const expectedViews = [
      path.join(uiSrcRoot, 'tabs', 'HomeRuntime', 'HomeRuntimeView.tsx'),
      path.join(uiSrcRoot, 'tabs', 'Planning', 'PlanningView.tsx'),
      path.join(uiSrcRoot, 'tabs', 'Catalog', 'CatalogView.tsx'),
      path.join(uiSrcRoot, 'tabs', 'Stats', 'StatsView.tsx'),
    ];

    for (const expectedView of expectedViews) {
      assert.ok(fs.existsSync(expectedView), `Missing migrated tab view: ${expectedView}`);
    }

    assert.ok(
      !fs.existsSync(path.join(uiSrcRoot, 'tabs', 'State', 'StateView.tsx')),
      'Expected legacy StateView component to be retired'
    );
  });

  await test('App.tsx references the current 4-hub shell views', async () => {
    const appSource = fs.readFileSync(path.join(uiSrcRoot, 'App.tsx'), 'utf8');

    assert.ok(appSource.includes("./tabs/HomeRuntime/HomeRuntimeView"), 'Expected HomeRuntimeView import in App.tsx');
    assert.ok(appSource.includes("./tabs/Planning/PlanningView"), 'Expected PlanningView import in App.tsx');
    assert.ok(appSource.includes("./tabs/Catalog/CatalogView"), 'Expected CatalogView import in App.tsx');
    assert.ok(appSource.includes("./tabs/Stats/StatsView"), 'Expected StatsView import in App.tsx');
    assert.ok(!appSource.includes("./tabs/Sessions/SessionsWorkspaceView"), 'Did not expect legacy SessionsWorkspaceView import in App.tsx');
    assert.ok(!appSource.includes("./tabs/State/StateView"), 'Did not expect retired StateView import in App.tsx');
  });

  await test('responsive breakpoints for 1440px, 1024px, 768px, and 320px exist in app.css', async () => {
    const appCss = fs.readFileSync(path.join(uiSrcRoot, 'app.css'), 'utf8');

    assert.ok(appCss.includes('@media (max-width: 1440px)'), 'Expected explicit 1440px breakpoint in app.css');
    assert.ok(appCss.includes('@media (max-width: 1024px)'), 'Expected explicit 1024px breakpoint in app.css');
    assert.ok(appCss.includes('@media (max-width: 768px)'), 'Expected explicit 768px breakpoint in app.css');
    assert.ok(appCss.includes('@media (max-width: 320px)'), 'Expected explicit 320px breakpoint in app.css');
  });

  await test('accessibility styles include visible focus and reduced-motion handling', async () => {
    const appCss = fs.readFileSync(path.join(uiSrcRoot, 'app.css'), 'utf8');

    assert.ok(appCss.includes(':focus-visible'), 'Expected :focus-visible styles in app.css');
    assert.ok(appCss.includes('@media (prefers-reduced-motion: reduce)'), 'Expected reduced-motion media query in app.css');
  });

  await test('global layout reserves scrollbar space and runtime workspace tabs use stable nav styling', async () => {
    const globalCss = fs.readFileSync(path.join(uiSrcRoot, 'styles', 'global.css'), 'utf8');
    const appCss = fs.readFileSync(path.join(uiSrcRoot, 'app.css'), 'utf8');
    const homeRuntimeSource = fs.readFileSync(path.join(uiSrcRoot, 'tabs', 'HomeRuntime', 'HomeRuntimeView.tsx'), 'utf8');

    assert.ok(globalCss.includes('scrollbar-gutter: stable;'), 'Expected stable scrollbar gutter in global.css');
    assert.ok(appCss.includes('.workspace-nav-stable {'), 'Expected stable workspace nav selector in app.css');
    assert.ok(
      homeRuntimeSource.includes('className="workspace-nav workspace-nav-stable"'),
      'Expected HomeRuntimeView to opt into stable workspace nav styling'
    );
  });

  await test('runtime no longer exposes a standalone sandbox tab and sessions mode buttons use stable toolbar layout', async () => {
    const appCss = fs.readFileSync(path.join(uiSrcRoot, 'app.css'), 'utf8');
    const homeRuntimeSource = fs.readFileSync(path.join(uiSrcRoot, 'tabs', 'HomeRuntime', 'HomeRuntimeView.tsx'), 'utf8');
    const sessionsViewSource = fs.readFileSync(path.join(uiSrcRoot, 'tabs', 'Sessions', 'SessionsView.tsx'), 'utf8');

    assert.ok(appCss.includes('.showcase-toolbar-group-stable {'), 'Expected stable toolbar group selector in app.css');
    assert.ok(
      sessionsViewSource.includes('className="showcase-toolbar-group showcase-toolbar-group-stable"'),
      'Expected SessionsView mode toolbar to opt into stable layout styling'
    );
    assert.ok(
      !homeRuntimeSource.includes('testId="home-runtime-section-sandboxes"'),
      'Did not expect HomeRuntimeView to expose a standalone sandboxes runtime section'
    );
    assert.ok(
      homeRuntimeSource.includes('Open Executor Sandbox Mode'),
      'Expected sandbox quick action to route through the executor surface'
    );
  });

  await test('runtime sessions surface overlay workspace and overview exposes overlay resume handoff', async () => {
    const homeRuntimeSource = fs.readFileSync(path.join(uiSrcRoot, 'tabs', 'HomeRuntime', 'HomeRuntimeView.tsx'), 'utf8');
    const sessionsViewSource = fs.readFileSync(path.join(uiSrcRoot, 'tabs', 'Sessions', 'SessionsView.tsx'), 'utf8');
    const overlayWorkspaceSource = fs.readFileSync(
      path.join(uiSrcRoot, 'tabs', 'Sessions', 'OverlaySessionsWorkspace.tsx'),
      'utf8'
    );

    assert.ok(
      sessionsViewSource.includes('runtime-overlay-sessions-panel'),
      'Expected SessionsView to expose a stable overlay sessions panel test id'
    );
    assert.ok(
      sessionsViewSource.includes('OverlaySessionsWorkspace'),
      'Expected SessionsView to render the overlay sessions workspace'
    );
    assert.ok(
      overlayWorkspaceSource.includes('Open Selected in Executor'),
      'Expected overlay sessions workspace to expose selected-session executor handoff copy'
    );
    assert.ok(
      overlayWorkspaceSource.includes('Resume'),
      'Expected overlay sessions workspace to expose row-level resume handoff copy'
    );
    assert.ok(
      overlayWorkspaceSource.includes('runtime-overlay-session-open-executor-'),
      'Expected overlay sessions workspace to expose stable per-session executor handoff ids'
    );
    assert.ok(
      homeRuntimeSource.includes('Resume overlay workflow'),
      'Expected HomeRuntimeView to expose an overlay resume quick action'
    );
    assert.ok(
      homeRuntimeSource.includes('runtime-overview-overlay-action'),
      'Expected HomeRuntimeView to expose a stable overlay quick action test id'
    );
  });

  await test('planning owns the visible task board while runtime surfaces link back to it with orchestration-safe labels', async () => {
    const planningViewSource = fs.readFileSync(path.join(uiSrcRoot, 'tabs', 'Planning', 'PlanningView.tsx'), 'utf8');
    const sessionsViewSource = fs.readFileSync(path.join(uiSrcRoot, 'tabs', 'Sessions', 'SessionsView.tsx'), 'utf8');
    const executorViewSource = fs.readFileSync(path.join(uiSrcRoot, 'tabs', 'Executor', 'ExecutorView.tsx'), 'utf8');
    const taskBoardSource = fs.readFileSync(path.join(uiSrcRoot, 'tabs', 'Sessions', 'TaskBoardView.tsx'), 'utf8');
    const sessionsStoreSource = fs.readFileSync(path.join(uiSrcRoot, 'tabs', 'Sessions', 'sessionsStore.ts'), 'utf8');
    const executorStoreSource = fs.readFileSync(path.join(uiSrcRoot, 'tabs', 'Executor', 'executorStore.ts'), 'utf8');

    assert.ok(planningViewSource.includes('planning-task-board-panel'), 'Expected PlanningView to expose the visible task board panel');
    assert.ok(planningViewSource.includes('planning-task-board-open-runtime-sessions'), 'Expected PlanningView to link task board work into runtime sessions');
    assert.ok(planningViewSource.includes('planning-task-board-open-executor'), 'Expected PlanningView to link task board work into executor');
    assert.ok(!sessionsViewSource.includes('sessions-task-board-panel'), 'Did not expect SessionsView to expose a task board panel');
    assert.ok(!executorViewSource.includes('executor-task-board-panel'), 'Did not expect ExecutorView to expose a task board panel');
    assert.ok(sessionsViewSource.includes('sessions-open-planning-task-board'), 'Expected SessionsView to link back to the Planning task board');
    assert.ok(executorViewSource.includes('executor-open-planning-task-board'), 'Expected ExecutorView to link back to the Planning task board');
    assert.ok(taskBoardSource.includes('Linked live session'), 'Expected task board labels to distinguish linked live session state');
    assert.ok(taskBoardSource.includes('In-session actors'), 'Expected task board labels to distinguish in-session actors');
    assert.ok(taskBoardSource.includes('Worktree isolation'), 'Expected task board labels to distinguish worktree isolation');
    assert.ok(taskBoardSource.includes('Durable repo-state task board'), 'Expected task board copy to keep repo-state durable authority explicit');
    assert.ok(sessionsStoreSource.includes('taskBoardFilterStatus'), 'Expected sessionsStore to keep board-only presentation state');
    assert.ok(executorStoreSource.includes('taskBoardFilterStatus'), 'Expected executorStore to keep board-only presentation state');
  });

  await test('executor observes merged external CLI and VS Code sessions', async () => {
    const executorStoreSource = fs.readFileSync(
      path.join(uiSrcRoot, 'tabs', 'Executor', 'executorStore.ts'),
      'utf8'
    );
    const executorViewSource = fs.readFileSync(
      path.join(uiSrcRoot, 'tabs', 'Executor', 'ExecutorView.tsx'),
      'utf8'
    );

    assert.ok(
      executorStoreSource.includes("listSessions(undefined, { source: 'all', dedupe: 'on' })"),
      'Expected executorStore to load merged external sessions with source=all and dedupe=on'
    );
    assert.ok(
      executorStoreSource.includes('observedExternalSessions'),
      'Expected executorStore to track observedExternalSessions'
    );
    assert.ok(
      executorViewSource.includes('Observed External Sessions'),
      'Expected ExecutorView to expose the Observed External Sessions surface'
    );
    assert.ok(
      executorViewSource.includes('executor-observed-sessions-panel'),
      'Expected ExecutorView to expose a stable test id for observed external sessions'
    );
    assert.ok(
      executorViewSource.includes('executor-sandbox-mode-section'),
      'Expected ExecutorView to absorb sandbox lifecycle as an embedded execution mode section'
    );
    assert.ok(
      executorViewSource.includes('Attach Mode Foundation'),
      'Expected ExecutorView to expose the attach-first runtime overlay foundation panel'
    );
    assert.ok(
      executorViewSource.includes('executor-ui-runtime-overlay-panel'),
      'Expected ExecutorView to expose a stable test id for the attach mode foundation panel'
    );
  });

  await test('stats tab aggregates runtime, catalog, and sampled recent session telemetry', async () => {
    const appSource = fs.readFileSync(path.join(uiSrcRoot, 'App.tsx'), 'utf8');
    const navigationSource = fs.readFileSync(path.join(uiSrcRoot, 'stores', 'navigation.ts'), 'utf8');
    const statsStoreSource = fs.readFileSync(
      path.join(uiSrcRoot, 'tabs', 'Stats', 'statsStore.ts'),
      'utf8'
    );
    const statsViewSource = fs.readFileSync(
      path.join(uiSrcRoot, 'tabs', 'Stats', 'StatsView.tsx'),
      'utf8'
    );

    assert.ok(navigationSource.includes("'stats'"), 'Expected navigation.ts to register the stats tab id');
    assert.ok(
      navigationSource.includes("label: 'Stats'"),
      'Expected navigation.ts to register the Stats tab label'
    );
    assert.ok(
      appSource.includes("StatsView"),
      'Expected App.tsx to render StatsView'
    );
    assert.ok(statsStoreSource.includes('getHealth()'), 'Expected statsStore to load runtime health');
    assert.ok(statsStoreSource.includes('getRuntimeCatalogHealth()'), 'Expected statsStore to load catalog health');
    assert.ok(statsStoreSource.includes('getCatalogAssetAnalytics()'), 'Expected statsStore to load catalog telemetry');
    assert.ok(statsStoreSource.includes('getSdkHealth()'), 'Expected statsStore to load SDK health');
    assert.ok(statsStoreSource.includes('getExecutorHealth()'), 'Expected statsStore to load executor health');
    assert.ok(
      statsStoreSource.includes("listSessions(undefined, { source: 'all', dedupe: 'on' })"),
      'Expected statsStore to load merged sessions with source=all and dedupe=on'
    );
    assert.ok(
      statsStoreSource.includes('getSessionAgentUsage(session.id'),
      'Expected statsStore to sample recent per-session usage'
    );
    assert.ok(statsViewSource.includes('data-testid="stats-view"'), 'Expected StatsView root test id');
    assert.ok(statsViewSource.includes('Runtime Health'), 'Expected StatsView runtime health section');
    assert.ok(statsViewSource.includes('Catalog Telemetry'), 'Expected StatsView catalog telemetry section');
    assert.ok(statsViewSource.includes('Recent Usage'), 'Expected StatsView recent usage section');
  });

  await test('session selector contract is present in source app.css', async () => {
    const appCss = fs.readFileSync(path.join(uiSrcRoot, 'app.css'), 'utf8');
    const requiredSelectors = [
      '.session-list-items {',
      '.session-card {',
      '.session-item-actions {',
      '.detail-grid {',
      '.metadata-block {',
    ];

    for (const selector of requiredSelectors) {
      assert.ok(appCss.includes(selector), `Expected ${selector} in source app.css`);
    }
  });

  await test('session selector contract is present in ui-dist css bundles when dist exists', async () => {
    const assetsDir = path.join(repoRoot, 'ui-dist', 'assets');
    if (!fs.existsSync(assetsDir) || !fs.statSync(assetsDir).isDirectory()) {
      return;
    }

    const cssFiles = fs.readdirSync(assetsDir).filter((entry) => entry.endsWith('.css'));
    assert.ok(cssFiles.length > 0, 'Expected at least one ui-dist CSS bundle');

    const bundledCss = cssFiles
      .map((entry) => fs.readFileSync(path.join(assetsDir, entry), 'utf8'))
      .join('\n');

    for (const selector of ['.session-list-items', '.session-card', '.detail-grid', '.metadata-block']) {
      assert.ok(bundledCss.includes(selector), `Expected ${selector} in ui-dist CSS bundle`);
    }
  });

  await test('semantic landmark and tab structure is preserved in App.tsx and TabShell.tsx', async () => {
    const appSource = fs.readFileSync(path.join(uiSrcRoot, 'App.tsx'), 'utf8');
    const tabShellSource = fs.readFileSync(path.join(uiSrcRoot, 'components', 'TabShell.tsx'), 'utf8');

    assert.ok(appSource.includes('AppLayout'), 'Expected AppLayout component in App.tsx');
    assert.ok(appSource.includes('StatusBar'), 'Expected StatusBar component in App.tsx');
    assert.ok(appSource.includes('Sidebar'), 'Expected Sidebar component in App.tsx');
    assert.ok(tabShellSource.includes('role="tablist"'), 'Expected tablist role in TabShell.tsx');
    assert.ok(tabShellSource.includes('role="tabpanel"'), 'Expected tabpanel role in TabShell.tsx');
    assert.ok(tabShellSource.includes('aria-orientation="horizontal"'), 'Expected explicit tablist orientation in TabShell.tsx');
  });

  await test('WS05-I5 TabShell/Panel selector contract is present in app.css and component refs', async () => {
    const appCss = fs.readFileSync(path.join(uiSrcRoot, 'app.css'), 'utf8');
    const tabShellSource = fs.readFileSync(path.join(uiSrcRoot, 'components', 'TabShell.tsx'), 'utf8');
    const panelSource = fs.readFileSync(path.join(uiSrcRoot, 'components', 'Panel.tsx'), 'utf8');

    assert.ok(appCss.includes('.tab-shell {'), 'Expected .tab-shell selector in app.css');
    assert.ok(appCss.includes('.tab-panel {'), 'Expected .tab-panel selector in app.css');
    assert.ok(appCss.includes('.panel {'), 'Expected .panel selector in app.css');
    assert.ok(tabShellSource.includes('className="tab-shell"'), 'Expected TabShell to reference tab-shell class');
    assert.ok(tabShellSource.includes('className="tab-panel"'), 'Expected TabShell to reference tab-panel class');
    assert.ok(panelSource.includes('className="panel"'), 'Expected Panel to reference panel class');
  });

  await test('ui/src contains no .svelte files', async () => {
    const files = walkFiles(uiSrcRoot);
    const svelteFiles = files.filter((filePath) => filePath.endsWith('.svelte'));
    assert.deepStrictEqual(svelteFiles, [], `Unexpected Svelte files found: ${svelteFiles.join(', ')}`);
  });

  await test('package.json uses React and not Svelte runtime deps', async () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    const dependencies = packageJson.dependencies || {};
    const devDependencies = packageJson.devDependencies || {};

    assert.ok(dependencies.react, 'Expected react dependency');
    assert.ok(dependencies['react-dom'], 'Expected react-dom dependency');
    assert.ok(devDependencies['@vitejs/plugin-react'], 'Expected @vitejs/plugin-react devDependency');
    assert.strictEqual(dependencies.svelte, undefined, 'Did not expect svelte dependency');
    assert.strictEqual(devDependencies['@sveltejs/vite-plugin-svelte'], undefined, 'Did not expect Svelte Vite plugin devDependency');
  });

  console.log(`\n  ${passed} passed, ${failed} failed (${passed + failed} total)\n`);
}

run().catch((error) => {
  console.error(`\n  FATAL: ${error.message}\n`);
  process.exitCode = 1;
});
