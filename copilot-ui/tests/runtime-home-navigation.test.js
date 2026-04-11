'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const uiSrcRoot = path.join(repoRoot, 'ui', 'src');

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

async function run() {
  console.log('\nRuntime Home Navigation Tests\n');

  const appSource = fs.readFileSync(path.join(uiSrcRoot, 'App.tsx'), 'utf8');
  const navigationSource = fs.readFileSync(path.join(uiSrcRoot, 'stores', 'navigation.ts'), 'utf8');
  const homeRuntimeSource = fs.readFileSync(path.join(uiSrcRoot, 'tabs', 'HomeRuntime', 'HomeRuntimeView.tsx'), 'utf8');

  await test('navigation store freezes the 4 top-level hubs and default landing state', async () => {
    assert.ok(navigationSource.includes("'home-runtime'"), 'Expected home-runtime tab id');
    assert.ok(navigationSource.includes("'catalog'"), 'Expected catalog tab id');
    assert.ok(navigationSource.includes("'planning'"), 'Expected planning tab id');
    assert.ok(navigationSource.includes("'stats'"), 'Expected stats tab id');
    assert.ok(navigationSource.includes("activeTabId: 'home-runtime'"), 'Expected default tab to be home-runtime');
    assert.ok(navigationSource.includes("runtimeSectionId: 'overview'"), 'Expected default runtime section to be overview');
    assert.ok(navigationSource.includes("diagnosticsSectionId: 'runtime'"), 'Expected default diagnostics section to be runtime');
  });

  await test('App handoff wiring routes planning back into Home / Runtime sessions', async () => {
    assert.ok(appSource.includes("navigationStore.goToRuntime('sessions', { sessionsMode: 'sdk' });"), 'Expected planning handoff to runtime sessions');
    assert.ok(appSource.includes("HomeRuntimeView"), 'Expected HomeRuntimeView rendered in App');
    assert.ok(appSource.includes("StatsView"), 'Expected StatsView rendered in App');
    assert.ok(appSource.includes("DashboardView"), 'Expected DashboardView rendered in App');
    assert.ok(appSource.includes("SIDEBAR_NAV_ITEMS"), 'Expected sidebar navigation in App');
  });

  await test('HomeRuntimeView exposes the frozen runtime subsections', async () => {
    for (const sectionTestId of [
      'home-runtime-section-overview',
      'home-runtime-section-sessions',
      'home-runtime-section-executor',
      'home-runtime-section-diagnostics',
    ]) {
      assert.ok(homeRuntimeSource.includes(sectionTestId), `Expected ${sectionTestId} in HomeRuntimeView`);
    }

    assert.ok(
      !homeRuntimeSource.includes('home-runtime-section-sandboxes'),
      'Did not expect a standalone sandbox runtime section in HomeRuntimeView'
    );
  });

  await test('Overview quick actions cover runtime refresh and cross-hub handoffs', async () => {
    for (const actionTestId of [
      'runtime-overview-refresh-action',
      'runtime-overview-sessions-action',
      'runtime-overview-sdk-action',
      'runtime-overview-executor-action',
      'runtime-overview-sandbox-action',
      'runtime-overview-catalog-action',
      'runtime-overview-planning-action',
    ]) {
      assert.ok(homeRuntimeSource.includes(actionTestId), `Expected ${actionTestId} quick action`);
    }
    assert.ok(homeRuntimeSource.includes('Orchestrated Flow'), 'Expected HomeRuntimeView to summarize orchestrated flow context');
  });

  await test('Diagnostics section exposes runtime, database, gateway, tracker, and lsp surfaces', async () => {
    assert.ok(homeRuntimeSource.includes('GatewayView'), 'Expected GatewayView in diagnostics');
    assert.ok(homeRuntimeSource.includes('TrackerView'), 'Expected TrackerView in diagnostics');
    assert.ok(homeRuntimeSource.includes('LspView'), 'Expected LspView in diagnostics');
    assert.ok(homeRuntimeSource.includes('Elegy Copilot Runtime'), 'Expected Elegy Copilot runtime diagnostics copy');
    assert.ok(homeRuntimeSource.includes('Planning Database'), 'Expected planning database diagnostics copy');
    assert.ok(homeRuntimeSource.includes('planningDurabilityDependencyGate'), 'Expected planning durability gate diagnostics');
    assert.ok(homeRuntimeSource.includes('GitHub CLI Access'), 'Expected GitHub CLI diagnostics card');
    assert.ok(homeRuntimeSource.includes('Workspace GitHub MCP'), 'Expected workspace GitHub MCP diagnostics card');
    assert.ok(homeRuntimeSource.includes('home-runtime-diagnostics-github-enable'), 'Expected workspace GitHub MCP enable button');
    assert.ok(homeRuntimeSource.includes('home-runtime-diagnostics-runtime'), 'Expected runtime diagnostics tab');
    assert.ok(homeRuntimeSource.includes('home-runtime-diagnostics-database'), 'Expected database diagnostics tab');
    assert.ok(homeRuntimeSource.includes('home-runtime-diagnostics-gateway'), 'Expected Gateway diagnostics tab');
    assert.ok(homeRuntimeSource.includes('home-runtime-diagnostics-tracker'), 'Expected Tracker diagnostics tab');
    assert.ok(homeRuntimeSource.includes('home-runtime-diagnostics-lsp'), 'Expected LSP diagnostics tab');
  });

  console.log(`\n  ${passed} passed, ${failed} failed (${passed + failed} total)\n`);
}

run().catch((error) => {
  console.error(`\n  FATAL: ${error.message}\n`);
  process.exitCode = 1;
});
