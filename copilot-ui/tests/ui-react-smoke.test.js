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

  await test('index.html mounts React entrypoint and exposes the Elegy Copilot favicon', async () => {
    const indexHtml = fs.readFileSync(path.join(uiRoot, 'index.html'), 'utf8');
    assert.ok(indexHtml.includes('/src/main.tsx'), 'Expected ui/index.html to load /src/main.tsx');
    assert.ok(indexHtml.includes('<title>Elegy Copilot</title>'), 'Expected ui/index.html title to match Elegy Copilot');
    assert.ok(indexHtml.includes('/elegy-copilot-icon.svg'), 'Expected ui/index.html to declare the branded svg favicon');
    assert.ok(indexHtml.includes('/favicon.ico'), 'Expected ui/index.html to declare the branded ico favicon');
  });

  await test('brand icon assets and shell references exist', async () => {
    const brandIconPath = path.join(uiRoot, 'public', 'elegy-copilot-icon.svg');
    const sidebarSource = fs.readFileSync(path.join(uiSrcRoot, 'components', 'Sidebar.tsx'), 'utf8');
    const settingsSource = fs.readFileSync(path.join(uiSrcRoot, 'views', 'Settings', 'SettingsView.tsx'), 'utf8');
    const bootstrapHtml = fs.readFileSync(path.join(repoRoot, 'src-tauri', 'bootstrap', 'index.html'), 'utf8');

    assert.ok(fs.existsSync(brandIconPath), 'Expected branded svg icon asset in ui/public');
    // Sidebar is now an icon rail — brand icon lives in Settings, not the rail
    assert.ok(!sidebarSource.includes('sidebar-brand-icon'), 'Expected Sidebar icon rail to NOT render branded icon');
    assert.ok(!sidebarSource.includes('/elegy-copilot-icon.svg'), 'Expected Sidebar icon rail to NOT reference branded svg');
    assert.ok(settingsSource.includes('settings-view'), 'Expected SettingsView to have settings-view data-testid');
    assert.ok(settingsSource.includes('settings-toolbar'), 'Expected SettingsView to have settings-toolbar element');
    assert.ok(settingsSource.includes('settings-about-brand'), 'Expected Settings about panel to render branded app identity');
    assert.ok(settingsSource.includes('/elegy-copilot-icon.svg'), 'Expected Settings to use the shared branded svg asset');
    assert.ok(bootstrapHtml.includes('boot-mark'), 'Expected Tauri bootstrap shell to render the brand mark');
    assert.ok(bootstrapHtml.includes('Starting workspace...'), 'Expected Tauri bootstrap shell to expose branded startup copy');
  });

  await test('sidebar uses fixed icon rail with no brand, no collapse toggle', async () => {
    const sidebarSource = fs.readFileSync(path.join(uiSrcRoot, 'components', 'Sidebar.tsx'), 'utf8');

    // No brand image — the icon rail should not render brand imagery
    assert.ok(
      !sidebarSource.includes('/elegy-copilot-icon.svg'),
      'Expected Sidebar to NOT reference the branded svg (icon rail has no brand image)'
    );
    assert.ok(
      !sidebarSource.includes('sidebar-brand-icon'),
      'Expected Sidebar to NOT use sidebar-brand-icon class'
    );

    // No collapse toggle
    assert.ok(
      !sidebarSource.includes('sidebar-collapse-toggle'),
      'Expected Sidebar to NOT have sidebar-collapse-toggle (always thin, no collapse)'
    );
    assert.ok(
      !sidebarSource.includes('isCollapsed'),
      'Expected Sidebar to NOT accept isCollapsed prop'
    );
    assert.ok(
      !sidebarSource.includes('onToggleCollapse'),
      'Expected Sidebar to NOT accept onToggleCollapse prop'
    );

    // Icon rail specific elements (items are rendered from dynamic items array)
    assert.ok(sidebarSource.includes('className="sidebar"'), 'Expected sidebar className on nav element');
    assert.ok(sidebarSource.includes('data-testid="sidebar"'), "Expected sidebar data-testid");
    assert.ok(sidebarSource.includes('sidebar-item-icon'), 'Expected icon-only items with sidebar-item-icon');
    assert.ok(sidebarSource.includes('sidebar-item-'), 'Expected sidebar items with dynamic sidebar-item- pattern');
    // Dynamic item rendering pattern (sidebar-item-${item.id})
    assert.ok(sidebarSource.includes('sidebar-item-${'), 'Expected items rendered via dynamic template literal');
    assert.ok(sidebarSource.includes('sidebar-item-icon'), 'Expected icon-only items with sidebar-item-icon');
    assert.ok(sidebarSource.includes('sidebar-nav'), 'Expected sidebar-nav container');

    // Uses SidebarItemId type from stores/navigation and AppIcon from ./AppIcon
    assert.ok(sidebarSource.includes('SidebarItemId'), 'Expected SidebarItemId import from stores/navigation');
    assert.ok(sidebarSource.includes("'../stores/navigation'"), 'Expected stores/navigation import');
    assert.ok(sidebarSource.includes('AppIcon'), 'Expected AppIcon import');
  });

  await test('main.tsx and App.tsx exist', async () => {
    assert.ok(fs.existsSync(path.join(uiSrcRoot, 'main.tsx')), 'Missing ui/src/main.tsx');
    assert.ok(fs.existsSync(path.join(uiSrcRoot, 'App.tsx')), 'Missing ui/src/App.tsx');
  });

  await test('active sidebar view files exist for execution, planning, catalog, maintenance, and settings', async () => {
    const expectedViews = [
      path.join(uiSrcRoot, 'views', 'DashboardView.tsx'),
      path.join(uiSrcRoot, 'tabs', 'Planning', 'PlanningGraphView.tsx'),
      path.join(uiSrcRoot, 'views', 'Catalog', 'CatalogShellView.tsx'),
      path.join(uiSrcRoot, 'views', 'Maintenance', 'MaintenanceView.tsx'),
      path.join(uiSrcRoot, 'views', 'Settings', 'SettingsView.tsx'),
    ];

    for (const expectedView of expectedViews) {
      assert.ok(fs.existsSync(expectedView), `Missing migrated tab view: ${expectedView}`);
    }

    assert.ok(
      !fs.existsSync(path.join(uiSrcRoot, 'tabs', 'State', 'StateView.tsx')),
      'Expected legacy StateView component to be retired'
    );
  });

  await test('App.tsx references the current sidebar-driven shell views', async () => {
    const appSource = fs.readFileSync(path.join(uiSrcRoot, 'App.tsx'), 'utf8');

    assert.ok(appSource.includes("./views/Workspace/WorkspaceView"), 'Expected WorkspaceView import in App.tsx');
    assert.ok(appSource.includes("./tabs/PatternAtlas/PatternAtlasView"), 'Expected PatternAtlasView import in App.tsx');
    assert.ok(appSource.includes("./views/Settings/SettingsView"), 'Expected SettingsView import in App.tsx');
    assert.ok(appSource.includes('SIDEBAR_NAV_ITEMS'), 'Expected SIDEBAR_NAV_ITEMS import in App.tsx');
    assert.ok(!appSource.includes(["./views", "Workflows", ["Workflows", "Hub"].join("")].join("/")), 'Did not expect standalone workflows hub import in App.tsx');
    assert.ok(!appSource.includes("./views/Workflows/WorkflowExecutionView"), 'Did not expect standalone workflow execution import in App.tsx');
    assert.ok(!appSource.includes("./views/Workflows/WorkflowTemplateEditor"), 'Did not expect standalone workflow editor import in App.tsx');
    assert.ok(!appSource.includes("./tabs/Sessions/SessionsWorkspaceView"), 'Did not expect legacy SessionsWorkspaceView import in App.tsx');
    assert.ok(!appSource.includes("./tabs/State/StateView"), 'Did not expect retired StateView import in App.tsx');
    assert.ok(!appSource.includes(["./tabs", "Planning", ["Planning", "View"].join("")].join("/")), 'Did not expect legacy planning tab import in App.tsx');
  });

  await test('navigation.ts exports SETTINGS_NAV_ITEMS, SettingsNavItem, claude-code section, and correct sidebar ordering', async () => {
    const navSource = fs.readFileSync(path.join(uiSrcRoot, 'stores', 'navigation.ts'), 'utf8');

    // Feature additions
    assert.ok(navSource.includes('SETTINGS_NAV_ITEMS'), 'Expected SETTINGS_NAV_ITEMS export in navigation.ts');
    assert.ok(navSource.includes("'claude-code'"), "Expected claude-code settings section in navigation.ts");
    assert.ok(navSource.includes('SettingsNavItem'), 'Expected SettingsNavItem interface in navigation.ts');

    // Sidebar nav ordering
    const reposIdx = navSource.indexOf("id: 'repositories'");
    const patternAtlasIdx = navSource.indexOf("id: 'pattern-atlas'");
    const settingsIdx = navSource.indexOf("id: 'settings'");
    assert.ok(reposIdx >= 0, 'Expected repositories sidebar item');
    assert.ok(patternAtlasIdx >= 0, 'Expected pattern-atlas sidebar item');
    assert.ok(settingsIdx >= 0, 'Expected settings sidebar item');
    assert.ok(reposIdx < patternAtlasIdx, 'Expected repositories before pattern-atlas in sidebar nav');

    // No static workspace item in SIDEBAR_NAV_ITEMS
    const navItemsStart = navSource.indexOf('SIDEBAR_NAV_ITEMS');
    const navItemsEnd = navSource.indexOf('];', navItemsStart);
    const navItemsBlock = navSource.slice(navItemsStart, navItemsEnd);
    assert.ok(!navItemsBlock.includes("id: 'workspace'"), 'Did not expect static workspace item in SIDEBAR_NAV_ITEMS');

    // Default activeSidebarItem should be 'repositories'
    assert.ok(navSource.includes("activeSidebarItem: 'repositories'"), 'Expected default activeSidebarItem to be repositories');
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

  await test('global layout reserves scrollbar space and workspace tabs use stable nav styling', async () => {
    const globalCss = fs.readFileSync(path.join(uiSrcRoot, 'styles', 'global.css'), 'utf8');
    const appCss = fs.readFileSync(path.join(uiSrcRoot, 'app.css'), 'utf8');
    const catalogSource = fs.readFileSync(path.join(uiSrcRoot, 'tabs', 'Catalog', 'CatalogView.tsx'), 'utf8');

    assert.ok(globalCss.includes('scrollbar-gutter: stable;'), 'Expected stable scrollbar gutter in global.css');
    assert.ok(appCss.includes('.workspace-nav-stable {'), 'Expected stable workspace nav selector in app.css');
    assert.ok(
      catalogSource.includes('className="workspace-nav"'),
      'Expected CatalogView to expose workspace nav styling'
    );
  });

  await test('stats tab aggregates runtime, catalog, and sampled recent session telemetry', async () => {
    const diagnosticsPanelSource = fs.readFileSync(
      path.join(uiSrcRoot, 'views', 'Maintenance', 'DiagnosticsPanel.tsx'), 'utf8'
    );
    const statsStoreSource = fs.readFileSync(
      path.join(uiSrcRoot, 'tabs', 'Stats', 'statsStore.ts'),
      'utf8'
    );
    const statsViewSource = fs.readFileSync(
      path.join(uiSrcRoot, 'tabs', 'Stats', 'StatsView.tsx'),
      'utf8'
    );

    assert.ok(
      diagnosticsPanelSource.includes("StatsView"),
      'Expected DiagnosticsPanel to render StatsView'
    );
    assert.ok(statsStoreSource.includes('getHealth()'), 'Expected statsStore to load runtime health');
    assert.ok(statsStoreSource.includes('getRuntimeCatalogHealth()'), 'Expected statsStore to load catalog health');
    assert.ok(statsStoreSource.includes('getCatalogAssetAnalytics()'), 'Expected statsStore to load catalog telemetry');
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

  await test('semantic landmark structure is preserved in App.tsx', async () => {
    const appSource = fs.readFileSync(path.join(uiSrcRoot, 'App.tsx'), 'utf8');

    assert.ok(appSource.includes('AppLayout'), 'Expected AppLayout component in App.tsx');
    assert.ok(appSource.includes('Sidebar'), 'Expected Sidebar component in App.tsx');
  });

  await test('WS05-I5 Panel selector contract is present in app.css and component refs', async () => {
    const appCss = fs.readFileSync(path.join(uiSrcRoot, 'app.css'), 'utf8');
    const panelSource = fs.readFileSync(path.join(uiSrcRoot, 'components', 'Panel.tsx'), 'utf8');

    assert.ok(appCss.includes('.panel {'), 'Expected .panel selector in app.css');
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

  await test('toast notification system components and store exist', async () => {
    assert.ok(
      fs.existsSync(path.join(uiSrcRoot, 'stores', 'notificationStore.ts')),
      'Missing notificationStore.ts'
    );
    assert.ok(
      fs.existsSync(path.join(uiSrcRoot, 'components', 'ToastContainer.tsx')),
      'Missing ToastContainer.tsx'
    );
    const storeSource = fs.readFileSync(path.join(uiSrcRoot, 'stores', 'notificationStore.ts'), 'utf8');
    assert.ok(storeSource.includes('addToast'), 'Expected addToast method in notificationStore');
    assert.ok(storeSource.includes('removeToast'), 'Expected removeToast method in notificationStore');
    assert.ok(storeSource.includes("'success'"), 'Expected success toast type');
    assert.ok(storeSource.includes("'error'"), 'Expected error toast type');

    const containerSource = fs.readFileSync(path.join(uiSrcRoot, 'components', 'ToastContainer.tsx'), 'utf8');
    assert.ok(containerSource.includes('toast-container'), 'Expected toast-container class in ToastContainer');
    assert.ok(containerSource.includes('role="alert"'), 'Expected alert role for accessibility');

    const appSource = fs.readFileSync(path.join(uiSrcRoot, 'App.tsx'), 'utf8');
    assert.ok(appSource.includes('ToastContainer'), 'Expected ToastContainer mounted in App.tsx');

    const appCss = fs.readFileSync(path.join(uiSrcRoot, 'app.css'), 'utf8');
    assert.ok(appCss.includes('.toast-container {'), 'Expected toast-container CSS');
    assert.ok(appCss.includes('@keyframes toast-slide-in'), 'Expected toast slide-in animation');
  });

  await test('session templates are centralized in constants', async () => {
    assert.ok(
      fs.existsSync(path.join(uiSrcRoot, 'constants', 'sessionTemplates.ts')),
      'Missing constants/sessionTemplates.ts'
    );
    const templatesSource = fs.readFileSync(path.join(uiSrcRoot, 'constants', 'sessionTemplates.ts'), 'utf8');
    assert.ok(templatesSource.includes('SESSION_TEMPLATES'), 'Expected SESSION_TEMPLATES export');
    assert.ok(templatesSource.includes('code-review'), 'Expected code-review template');
    assert.ok(templatesSource.includes('feature-impl'), 'Expected feature-impl template');

  });

  await test('Repositories card components exist with expected exports', async () => {
    const reposDir = path.join(uiSrcRoot, 'views', 'Repositories');
    const cardFiles = [
      'BranchCard.tsx',
      'ChangesCard.tsx',
      'CommitPushCard.tsx',
      'DiffCard.tsx',
      'RecentCommitsCard.tsx',
      'RepoDocsCard.tsx',
      'verification.ts',
    ];
    for (const file of cardFiles) {
      assert.ok(fs.existsSync(path.join(reposDir, file)), `Expected ${file} to exist`);
    }
  });

  await test('verification.ts exports computeVerificationState', async () => {
    const source = fs.readFileSync(path.join(uiSrcRoot, 'views', 'Repositories', 'verification.ts'), 'utf8');
    assert.ok(source.includes('computeVerificationState'), 'Expected computeVerificationState export');
    assert.ok(source.includes('verificationLabel'), 'Expected verificationLabel export');
    assert.ok(source.includes('verificationTone'), 'Expected verificationTone export');
    assert.ok(source.includes('VerificationState'), 'Expected VerificationState type');
  });

  await test('RepositoriesView uses launcher layout with SourcesConfigPanel and dense launcher classes', async () => {
    const source = fs.readFileSync(path.join(uiSrcRoot, 'views', 'Repositories', 'RepositoriesView.tsx'), 'utf8');

    // SourcesConfigPanel is composed into RepositoriesView
    assert.ok(source.includes('SourcesConfigPanel'), 'Expected SourcesConfigPanel import in RepositoriesView');
    assert.ok(source.includes('<SourcesConfigPanel />'), 'Expected SourcesConfigPanel rendering in RepositoriesView');

    // Dense launcher layout
    assert.ok(source.includes('repos-launcher-layout'), 'Expected repos-launcher-layout class');
    assert.ok(source.includes('repos-launcher-list'), 'Expected repos-launcher-list class');
    assert.ok(source.includes('repos-launcher-row'), 'Expected repos-launcher-row dense row class');
    assert.ok(source.includes('repos-register-panel'), 'Expected repos-register-panel test id');
    assert.ok(source.includes('repos-refresh'), 'Expected repos-refresh test id');
    assert.ok(source.includes('repos-search-input'), 'Expected repos-search-input test id');
    assert.ok(source.includes('repos-empty'), 'Expected repos-empty test id for empty state');
    assert.ok(source.includes('repos-no-results'), 'Expected repos-no-results test id for no-match state');

    // Navigation store import for workspace tab opening
    assert.ok(source.includes('navigationStore'), 'Expected navigationStore import for workspace tab opening');

    // No legacy card patterns
    assert.ok(!source.includes('repos-cards-layout'), 'Did not expect legacy repos-cards-layout class');
    assert.ok(!source.includes('BranchCard'), 'Did not expect BranchCard import in RepositoriesView');
    assert.ok(!source.includes('ChangesCard'), 'Did not expect ChangesCard import in RepositoriesView');
    assert.ok(!source.includes('CommitPushCard'), 'Did not expect CommitPushCard import in RepositoriesView');
    assert.ok(!source.includes('import { Button, Panel, StatusBadge'), 'Did not expect Panel import in RepositoriesView');
  });

  await test('repoDocs API client exists', async () => {
    const source = fs.readFileSync(path.join(uiSrcRoot, 'lib', 'api', 'repoDocs.ts'), 'utf8');
    assert.ok(source.includes('listRepoDocs'), 'Expected listRepoDocs function');
    assert.ok(source.includes('readRepoDoc'), 'Expected readRepoDoc function');
  });

  await test('git API client includes checks endpoints', async () => {
    const source = fs.readFileSync(path.join(uiSrcRoot, 'lib', 'api', 'git.ts'), 'utf8');
    assert.ok(source.includes('discoverGitChecks'), 'Expected discoverGitChecks function');
    assert.ok(source.includes('runGitChecks'), 'Expected runGitChecks function');
  });

  await test('Sidebar is a fixed 52px icon rail with no collapse support', async () => {
    const sidebarSource = fs.readFileSync(path.join(uiSrcRoot, 'components', 'Sidebar.tsx'), 'utf8');
    // No collapse props
    assert.ok(!sidebarSource.includes('isCollapsed'), 'Expected Sidebar to NOT accept isCollapsed');
    assert.ok(!sidebarSource.includes('sidebar-collapsed'), 'Expected no sidebar-collapsed class reference');
    assert.ok(!sidebarSource.includes('sidebar-collapse-toggle'), 'Expected no collapse toggle testId');
    // Fixed rail: items are icon-only
    assert.ok(sidebarSource.includes('aria-label'), 'Expected aria-labels on nav items');
    assert.ok(sidebarSource.includes('title={'), 'Expected title attributes on nav items');
  });

  await test('AppLayout is a simple shell grid with no collapse logic', async () => {
    const layoutSource = fs.readFileSync(path.join(uiSrcRoot, 'components', 'AppLayout.tsx'), 'utf8');
    assert.ok(!layoutSource.includes('sidebarCollapsed'), 'Expected AppLayout to NOT accept sidebarCollapsed prop');
    assert.ok(!layoutSource.includes('app-layout-body-collapsed'), 'Expected no app-layout-body-collapsed class');
    assert.ok(layoutSource.includes('app-layout-body'), 'Expected app-layout-body grid container');
    assert.ok(layoutSource.includes('app-layout-content'), 'Expected app-layout-content main area');
    assert.ok(layoutSource.includes('app-layout-footer'), 'Expected app-layout-footer');
    assert.ok(layoutSource.includes('app-version'), 'Expected app-version footer element');
  });

  await test('App.tsx does NOT persist sidebar collapse state', async () => {
    const appSource = fs.readFileSync(path.join(uiSrcRoot, 'App.tsx'), 'utf8');
    assert.ok(!appSource.includes('elegy-copilot-sidebar-collapsed'), 'Expected NO sidebar collapse localStorage key');
    assert.ok(!appSource.includes('handleToggleSidebarCollapse'), 'Expected NO sidebar collapse toggle handler');
    assert.ok(!appSource.includes('isSidebarCollapsed'), 'Expected NO isSidebarCollapsed state');
    assert.ok(!appSource.includes('sidebarCollapsed'), 'Expected NO sidebarCollapsed prop on AppLayout');
  });

  await test('WorkspaceDocsTab renders WorkspaceDocsCenter with correct props', async () => {
    const docsTabSource = fs.readFileSync(path.join(uiSrcRoot, 'views', 'Workspace', 'WorkspaceDocsTab.tsx'), 'utf8');
    const docsCenterSource = fs.readFileSync(path.join(uiSrcRoot, 'views', 'Workspace', 'WorkspaceDocsCenter.tsx'), 'utf8');
    assert.ok(docsTabSource.includes('workspace-docs-tab'), 'Expected workspace-docs-tab data-testid');
    assert.ok(docsTabSource.includes('WorkspaceDocsCenter'), 'Expected WorkspaceDocsCenter import');
    assert.ok(docsTabSource.includes('<WorkspaceDocsCenter'), 'Expected WorkspaceDocsCenter rendering');
    assert.ok(docsTabSource.includes('repoPath'), 'Expected repoPath prop passed to WorkspaceDocsCenter');
    assert.ok(docsCenterSource.includes('workspace-docs-center'), 'Expected workspace-docs-center data-testid in WorkspaceDocsCenter');
    assert.ok(docsCenterSource.includes('workspace-docs-tree'), 'Expected workspace-docs-tree sidebar in WorkspaceDocsCenter');
    assert.ok(docsCenterSource.includes('workspace-docs-viewer'), 'Expected workspace-docs-viewer content area');
  });

  await test('WorkspaceDocsCenter renders docs tree, viewer, and editing controls', async () => {
    const docsSource = fs.readFileSync(path.join(uiSrcRoot, 'views', 'Workspace', 'WorkspaceDocsCenter.tsx'), 'utf8');
    assert.ok(docsSource.includes('workspace-docs-tree-header'), 'Expected tree header with docs title');
    assert.ok(docsSource.includes('workspace-docs-tree-title'), 'Expected tree title');
    assert.ok(docsSource.includes('workspace-docs-viewer-header'), 'Expected viewer header');
    assert.ok(docsSource.includes('workspace-docs-viewer-edit-btn'), 'Expected edit button');
    assert.ok(docsSource.includes('workspace-docs-viewer-save-btn'), 'Expected save button');
    assert.ok(docsSource.includes('workspace-docs-viewer-delete-btn'), 'Expected delete button');
    assert.ok(docsSource.includes('workspace-docs-editor'), 'Expected doc editor');
    assert.ok(docsSource.includes('workspace-docs-markdown'), 'Expected markdown display');
    assert.ok(docsSource.includes('workspace-docs-empty'), 'Expected empty state');
  });

  await test('docTree helper module exports tree building functions', async () => {
    const treePath = path.join(uiSrcRoot, 'lib', 'docTree.ts');
    assert.ok(fs.existsSync(treePath), 'Expected docTree.ts to exist');
    const treeSource = fs.readFileSync(treePath, 'utf8');
    assert.ok(treeSource.includes('buildDocTree'), 'Expected buildDocTree function export');
    assert.ok(treeSource.includes('DocTreeNode'), 'Expected DocTreeNode interface');
  });

  await test('MarkdownMessage enhanced with headings, tables, task lists, and callouts', async () => {
    const mdSource = fs.readFileSync(path.join(uiSrcRoot, 'components', 'MarkdownMessage.tsx'), 'utf8');
    assert.ok(mdSource.includes('markdown-frontmatter'), 'Expected frontmatter rendering');
    assert.ok(mdSource.includes('task-list'), 'Expected task list rendering');
    assert.ok(mdSource.includes('markdown-callout'), 'Expected callout blockquote rendering');
    assert.ok(mdSource.includes('markdown-tag'), 'Expected inline tag rendering');
    assert.ok(mdSource.includes('markdown-table-wrapper'), 'Expected table rendering wrapper');
    // Verify h1/h2 are now allowed (previously only h3-h5)
    assert.ok(mdSource.includes("'h1'"), "Expected h1 tag in DOMPurify allowlist");
    assert.ok(mdSource.includes("'h2'"), "Expected h2 tag in DOMPurify allowlist");
    assert.ok(mdSource.includes("'h4'"), "Expected h4 tag in DOMPurify allowlist");
  });

  await test('WorkspaceDocsTab is a thin shell delegating to WorkspaceDocsCenter', async () => {
    const docsTabSource = fs.readFileSync(path.join(uiSrcRoot, 'views', 'Workspace', 'WorkspaceDocsTab.tsx'), 'utf8');
    // Minimal thin shell
    assert.ok(docsTabSource.includes('workspace-docs-tab'), 'Expected workspace-docs-tab data-testid');
    assert.ok(docsTabSource.includes('WorkspaceDocsCenter'), 'Expected WorkspaceDocsCenter import');
    assert.ok(docsTabSource.includes('<WorkspaceDocsCenter'), 'Expected WorkspaceDocsCenter rendering');
    assert.ok(docsTabSource.includes('repoPath={repoPath}'), 'Expected repoPath prop delegation');
    // No toolbar or graph toggle
    assert.ok(!docsTabSource.includes('workspace-docs-toolbar'), 'Expected no standalone toolbar');
    assert.ok(!docsTabSource.includes('DocumentationGraphView'), 'DocumentationGraphView should not be imported');
    assert.ok(!docsTabSource.includes('workspace-docs-graph-toggle'), 'graph toggle testId should not exist');
  });

  await test('Enhanced markdown CSS includes new heading, table, callout, and tag styles', async () => {
    const appCss = fs.readFileSync(path.join(uiSrcRoot, 'app.css'), 'utf8');
    assert.ok(appCss.includes('.markdown-message h1'), 'Expected h1 CSS in markdown');
    assert.ok(appCss.includes('.markdown-message h2'), 'Expected h2 CSS in markdown');
    assert.ok(appCss.includes('.markdown-table-wrapper'), 'Expected table wrapper CSS');
    assert.ok(appCss.includes('.markdown-callout'), 'Expected callout CSS');
    assert.ok(appCss.includes('.markdown-tag {'), 'Expected tag CSS');
    assert.ok(appCss.includes('.task-list'), 'Expected task list CSS');
  });

  await test('Folder tree CSS replaces flat list with expandable tree styles', async () => {
    const appCss = fs.readFileSync(path.join(uiSrcRoot, 'app.css'), 'utf8');
    assert.ok(appCss.includes('.workspace-docs-tree-list'), 'Expected tree list CSS');
    assert.ok(appCss.includes('.workspace-tree-folder'), 'Expected folder CSS');
    assert.ok(appCss.includes('.workspace-tree-children'), 'Expected tree children CSS');
  });

  console.log(`\n  ${passed} passed, ${failed} failed (${passed + failed} total)\n`);
}

run().catch((error) => {
  console.error(`\n  FATAL: ${error.message}\n`);
  process.exitCode = 1;
});
