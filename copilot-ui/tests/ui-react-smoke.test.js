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

  await test('migrated tab view files exist for planning/gateway/sandboxes/lsp/tracker/skills preview', async () => {
    const expectedViews = [
      path.join(uiSrcRoot, 'tabs', 'Planning', 'PlanningView.tsx'),
      path.join(uiSrcRoot, 'tabs', 'Gateway', 'GatewayView.tsx'),
      path.join(uiSrcRoot, 'tabs', 'Sandboxes', 'SandboxesView.tsx'),
      path.join(uiSrcRoot, 'tabs', 'LSP', 'LspView.tsx'),
      path.join(uiSrcRoot, 'tabs', 'Tracker', 'TrackerView.tsx'),
      path.join(uiSrcRoot, 'tabs', 'SkillsPreview', 'SkillsPreviewView.tsx'),
    ];

    for (const expectedView of expectedViews) {
      assert.ok(fs.existsSync(expectedView), `Missing migrated tab view: ${expectedView}`);
    }
  });

  await test('App.tsx references migrated tab views', async () => {
    const appSource = fs.readFileSync(path.join(uiSrcRoot, 'App.tsx'), 'utf8');

    assert.ok(appSource.includes("./tabs/Planning/PlanningView"), 'Expected PlanningView import in App.tsx');
    assert.ok(appSource.includes("./tabs/Gateway/GatewayView"), 'Expected GatewayView import in App.tsx');
    assert.ok(appSource.includes("./tabs/Sandboxes/SandboxesView"), 'Expected SandboxesView import in App.tsx');
    assert.ok(appSource.includes("./tabs/LSP/LspView"), 'Expected LspView import in App.tsx');
    assert.ok(appSource.includes("./tabs/Tracker/TrackerView"), 'Expected TrackerView import in App.tsx');
    assert.ok(appSource.includes("./tabs/SkillsPreview/SkillsPreviewView"), 'Expected SkillsPreviewView import in App.tsx');
  });

  await test('responsive breakpoints for 1440px, 768px, and 320px exist in app.css', async () => {
    const appCss = fs.readFileSync(path.join(uiSrcRoot, 'app.css'), 'utf8');

    assert.ok(appCss.includes('@media (max-width: 1440px)'), 'Expected explicit 1440px breakpoint in app.css');
    assert.ok(appCss.includes('@media (max-width: 768px)'), 'Expected explicit 768px breakpoint in app.css');
    assert.ok(appCss.includes('@media (max-width: 320px)'), 'Expected explicit 320px breakpoint in app.css');
  });

  await test('accessibility styles include visible focus and reduced-motion handling', async () => {
    const appCss = fs.readFileSync(path.join(uiSrcRoot, 'app.css'), 'utf8');

    assert.ok(appCss.includes(':focus-visible'), 'Expected :focus-visible styles in app.css');
    assert.ok(appCss.includes('@media (prefers-reduced-motion: reduce)'), 'Expected reduced-motion media query in app.css');
  });

  await test('semantic landmark and tab structure is preserved in App.tsx and TabShell.tsx', async () => {
    const appSource = fs.readFileSync(path.join(uiSrcRoot, 'App.tsx'), 'utf8');
    const tabShellSource = fs.readFileSync(path.join(uiSrcRoot, 'components', 'TabShell.tsx'), 'utf8');

    assert.ok(appSource.includes('<main aria-labelledby="instruction-engine-title" className="app-shell">'), 'Expected labelled main landmark in App.tsx');
    assert.ok(appSource.includes('<header className="hero-card">'), 'Expected semantic header landmark in App.tsx');
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
