'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  isOptionalResource,
  loadTauriNodeSidecarLayout,
  scanRuntimeAssetReferences,
  validateRuntimeAssetReferences,
  validateTauriBundleConfig,
  validateTauriNodeSidecarLayoutModel,
} = require('./tauri-node-sidecar-layout');

test('declares catalog-assets as a packaged runtime resource', () => {
  const { manifest } = loadTauriNodeSidecarLayout();
  assert.ok(manifest.resourceCopies.some((resource) => (
    resource.id === 'catalog-assets'
      && resource.kind === 'directory'
      && resource.source === '../catalog-assets'
      && resource.target === 'catalog-assets'
  )));

  const bundle = validateTauriBundleConfig();
  assert.deepEqual(bundle.resourceMappings, {
    'gen/resources': 'resources',
  });
});

test('bundles every harness-specific asset directory referenced by runtime code', () => {
  const { manifest } = loadTauriNodeSidecarLayout();
  const harnessDirs = ['codex-assets', 'opencode-assets', 'claude-assets', 'antigravity-assets', 'ghcp-assets'];

  for (const dirId of harnessDirs) {
    const entry = manifest.resourceCopies.find((resource) => resource && resource.id === dirId);
    assert.ok(entry, `Expected resourceCopies to bundle ${dirId}`);
    assert.equal(entry.kind, 'directory', `Expected ${dirId} kind=directory`);
    assert.equal(entry.source, `../${dirId}`, `Expected ${dirId} source=../${dirId}`);
    assert.equal(entry.target, dirId, `Expected ${dirId} target=${dirId}`);
  }
});

test('bundles the local-repo-mcp runtime package', () => {
  const { manifest } = loadTauriNodeSidecarLayout();
  for (const id of ['local-repo-mcp-dist', 'local-repo-mcp-node-modules', 'local-repo-mcp-package-json']) {
    const entry = manifest.resourceCopies.find((resource) => resource && resource.id === id);
    assert.ok(entry, `Expected resourceCopies to include ${id}`);
  }
  const distEntry = manifest.resourceCopies.find((resource) => resource && resource.id === 'local-repo-mcp-dist');
  assert.equal(distEntry.kind, 'directory');
  assert.equal(distEntry.source, '../local-repo-mcp/dist');
  assert.equal(distEntry.target, 'local-repo-mcp/dist');
});

test('runtime asset drift guard passes against the real repo', () => {
  const result = validateRuntimeAssetReferences();
  assert.ok(result.scannedFileCount > 0, 'Expected the drift guard to scan at least one runtime file');
  assert.ok(
    result.harnessRefs.includes('codex-assets')
      && result.harnessRefs.includes('opencode-assets')
      && result.harnessRefs.includes('claude-assets')
      && result.harnessRefs.includes('antigravity-assets'),
    'Expected drift guard to detect codex/opencode/claude/antigravity asset references in runtime code',
  );
  assert.equal(result.referencesLocalRepoMcpPackage, true, 'Expected drift guard to detect resolveMcpPackageRoot usage');
});

test('drift guard detects a missing harness-assets manifest entry', () => {
  const { manifest, manifestPath } = loadTauriNodeSidecarLayout();
  const tampered = {
    ...manifest,
    resourceCopies: manifest.resourceCopies.filter((resource) => resource && resource.id !== 'codex-assets'),
  };
  assert.throws(
    () => validateRuntimeAssetReferences({
      manifestPath,
      manifest: tampered,
    }),
    /codex-assets/,
    'Expected drift guard to fail when a referenced harness-assets dir is missing from resourceCopies',
  );
});

test('treats the optional Moon Bridge binary as optional during installed-layout validation', () => {
  const { manifest } = loadTauriNodeSidecarLayout();
  const moonBridge = manifest.resourceCopies.find((resource) => resource.id === 'moon-bridge-binary');

  assert.ok(moonBridge);
  assert.equal(isOptionalResource(moonBridge), true);
});

test('declares js-yaml because packaged runtime routes require it', () => {
  const { manifest } = loadTauriNodeSidecarLayout();

  assert.ok(
    manifest.nodeModulePayload.requiredRuntimePackages.includes('js-yaml'),
    'Expected the packaged runtime dependency closure to include js-yaml.',
  );
});

test('validateTauriNodeSidecarLayoutModel runs the drift guard end-to-end', () => {
  const layout = validateTauriNodeSidecarLayoutModel();
  assert.ok(layout.runtimeAssetReferences, 'Expected layout model to include runtimeAssetReferences drift-guard result');
  assert.ok(layout.runtimeAssetReferences.scannedFileCount > 0);
});
